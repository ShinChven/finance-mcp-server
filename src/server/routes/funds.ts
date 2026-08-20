/**
 * The fund cache dashboard's API.
 *
 * Read routes are open to any signed-in user; anything that starts a sync is
 * admin-only — a run costs hours of outbound requests against hosts that rate
 * limit, so it is not something an ordinary account should be able to trigger.
 *
 * Coverage is reported per provider rather than pooled. A single
 * "3,412 of 27,000 cached" spanning markets would be meaningless: the two
 * universes differ by an order of magnitude in size and by a factor of seven in
 * how often they need refetching.
 */

import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  isProviderScope,
  previewQuerySchema,
  PROVIDER_IDS,
  PROVIDERS,
  selectableScopes,
  syncBodySchema,
} from "../../shared/funds.js";
import { db } from "../db/index.js";
import { fundHoldings, funds, ingestJobs, instruments } from "../db/schema.js";
import { previewSync } from "../funds/ingest.js";
import { refreshAllFundIndexes } from "../funds/universe.js";
import { activeJobId, cancelJob, JobInProgressError, startJob } from "../funds/jobs.js";
import { createLazyFundCache } from "../funds/ondemand.js";
import { getProvider } from "../funds/providers/index.js";
import { toCanonicalSymbol } from "../funds/symbols.js";
import { audit } from "../lib/audit.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { escapeLike, listQuerySchema, listResponse, parseSort } from "../lib/listing.js";
import { requireAdmin, requireAuth } from "../middleware/session.js";

const fundListQuerySchema = listQuerySchema.extend({
  provider: z.enum(PROVIDER_IDS).optional(),
  /** A scope of `provider`; ignored without one, because a scope id alone does
   *  not identify a provider — both of them have `equity`. */
  scope: z.string().min(1).optional(),
});

/** Holdings count per fund, joined into the list so the page can show coverage. */
const holdingsCount = db
  .select({
    fundCode: fundHoldings.fundCode,
    n: count().as("n"),
  })
  .from(fundHoldings)
  .groupBy(fundHoldings.fundCode)
  .as("holdings_count");

const fundCache = createLazyFundCache();

const cachedExpr = sql<number>`count(*) filter (where ${funds.holdingsSyncedAt} is not null)`.mapWith(
  Number,
);
const failingExpr = sql<number>`count(*) filter (where ${funds.lastSyncError} is not null)`.mapWith(
  Number,
);

export const fundRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  /** Cache-wide totals for the page header, plus one block per provider. */
  .get("/stats", async (c) => {
    const [totals] = await db
      .select({ total: count(), cached: cachedExpr, failing: failingExpr })
      .from(funds);

    const [holdings] = await db
      .select({
        rows: count(),
        symbols: sql<number>`count(distinct ${fundHoldings.symbol})`.mapWith(Number),
        latestReport: sql<string | null>`max(${fundHoldings.reportDate})`,
      })
      .from(fundHoldings);

    const providers = [];
    for (const id of PROVIDER_IDS) {
      const provider = getProvider(id);
      const [row] = await db
        .select({ total: count(), cached: cachedExpr, failing: failingExpr })
        .from(funds)
        .where(eq(funds.provider, id));

      // Per-scope coverage drives the category buttons' "x of y cached" labels.
      const byScope: Record<string, { total: number; cached: number }> = {};
      for (const scope of selectableScopes(id)) {
        const scoped = provider.scopeFilter(scope.id);
        const [scopeRow] = await db
          .select({ total: count(), cached: cachedExpr })
          .from(funds)
          .where(scoped ? and(eq(funds.provider, id), scoped) : eq(funds.provider, id));
        byScope[scope.id] = { total: scopeRow?.total ?? 0, cached: scopeRow?.cached ?? 0 };
      }

      providers.push({
        id,
        label: PROVIDERS[id].label,
        domicile: PROVIDERS[id].domicile,
        completeness: PROVIDERS[id].completeness,
        total: row?.total ?? 0,
        cached: row?.cached ?? 0,
        failing: row?.failing ?? 0,
        byScope,
      });
    }

    return c.json({
      funds: {
        total: totals?.total ?? 0,
        cached: totals?.cached ?? 0,
        failing: totals?.failing ?? 0,
      },
      holdings: {
        rows: holdings?.rows ?? 0,
        symbols: holdings?.symbols ?? 0,
        latestReport: holdings?.latestReport ?? null,
      },
      providers,
      activeJobId: activeJobId(),
    });
  })

  .get("/", zValidator("query", fundListQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const filters: SQL[] = [];

    if (query.q) {
      const raw = query.q.trim();
      const like = `%${escapeLike(raw)}%`;
      const canonical = toCanonicalSymbol(raw);

      const holdingMatches: SQL[] = [
        ilike(fundHoldings.symbol, like),
        ilike(fundHoldings.name, like),
      ];
      if (canonical) {
        holdingMatches.push(eq(fundHoldings.symbol, canonical));
      }

      const holdsStock = sql`exists (
        select 1 from ${fundHoldings}
        where ${fundHoldings.fundCode} = ${funds.code}
          and (
            ${or(
              ...holdingMatches,
              sql`exists (
                select 1 from ${instruments}
                where ${instruments.symbol} = ${fundHoldings.symbol}
                  and ${ilike(instruments.name, like)}
              )`,
            )}
          )
      )`;

      filters.push(
        or(
          ilike(funds.code, like),
          ilike(funds.name, like),
          ilike(funds.company, like),
          ilike(funds.trackingIndex, like),
          holdsStock,
        )!,
      );
    }
    if (query.provider) {
      filters.push(eq(funds.provider, query.provider));
      if (query.scope !== undefined && isProviderScope(query.provider, query.scope)) {
        const scoped = getProvider(query.provider).scopeFilter(query.scope);
        if (scoped) filters.push(scoped);
      }
    }
    // `cached` / `uncached` / `failing` — the states the page filters on.
    if (query.status === "cached") filters.push(isNotNull(funds.holdingsSyncedAt));
    if (query.status === "uncached") filters.push(sql`${funds.holdingsSyncedAt} is null`);
    if (query.status === "failing") filters.push(isNotNull(funds.lastSyncError));

    const where = filters.length > 0 ? and(...filters) : undefined;
    const order = parseSort(
      query.sort,
      {
        code: funds.code,
        name: funds.name,
        fund_size: funds.fundSize,
        holdings_synced_at: funds.holdingsSyncedAt,
      },
      // Most-recently cached first: the page's job is to show what landed.
      sql`${funds.holdingsSyncedAt} desc nulls last`,
    );

    const [totalRow] = await db.select({ n: count() }).from(funds).where(where);
    const rows = await db
      .select({
        code: funds.code,
        provider: funds.provider,
        market: funds.market,
        currency: funds.currency,
        name: funds.name,
        fundType: funds.fundType,
        investsOffshore: funds.investsOffshore,
        isIndexFund: funds.isIndexFund,
        trackingIndex: funds.trackingIndex,
        company: funds.company,
        fundSize: funds.fundSize,
        feeRate: funds.feeRate,
        holdingsCompleteness: funds.holdingsCompleteness,
        detailsSyncedAt: funds.detailsSyncedAt,
        holdingsSyncedAt: funds.holdingsSyncedAt,
        navSyncedAt: funds.navSyncedAt,
        lastSyncError: funds.lastSyncError,
        holdingsCount: sql<number>`coalesce(${holdingsCount.n}, 0)`.mapWith(Number),
      })
      .from(funds)
      .leftJoin(holdingsCount, eq(holdingsCount.fundCode, funds.code))
      .where(where)
      .orderBy(order)
      .limit(query.per_page)
      .offset((query.page - 1) * query.per_page);

    return c.json(listResponse(rows, totalRow?.n ?? 0, query));
  })

  /**
   * Cache one fund now.
   *
   * Separate from the drill-down GET rather than folded into it: a GET that
   * quietly starts outbound fetches is not safe to retry, prefetch or reload,
   * and only a POST goes through CSRF protection. The page calls this when it
   * opens a fund that has never been synced.
   *
   * Any signed-in user may trigger it — unlike a category sync, this is a
   * handful of requests for a fund they are already looking at, and it is
   * de-duplicated and throttled in `funds/ondemand.ts`. Which upstream it hits
   * follows from the fund row, so this route stays provider-agnostic.
   */
  .post("/:code/cache", async (c) => {
    const result = await fundCache.ensure(c.req.param("code"));
    // "unknown" is the caller's mistake; "busy" is ours, temporarily.
    const status = result.status === "unknown" ? 404 : result.status === "busy" ? 429 : 200;
    return c.json(result, status);
  })

  /** The cached portfolio for one fund — the drill-down behind a list row. */
  .get("/:code/holdings", async (c) => {
    const code = c.req.param("code");
    const [fund] = await db.select().from(funds).where(eq(funds.code, code)).limit(1);
    if (!fund) return c.json({ error: "fund not found" }, 404);

    // Joined rather than looked up per row: the enriched instrument columns are
    // what turn a list of tickers into something a reader can judge, and they
    // are the visible proof that the Yahoo enrichment actually landed.
    const rows = await db
      .select({
        symbol: fundHoldings.symbol,
        name: fundHoldings.name,
        weight: fundHoldings.weight,
        reportDate: fundHoldings.reportDate,
        isin: instruments.isin,
        country: instruments.country,
        marketCapUsd: instruments.marketCapUsd,
        profileSyncedAt: instruments.profileSyncedAt,
      })
      .from(fundHoldings)
      .leftJoin(instruments, eq(instruments.symbol, fundHoldings.symbol))
      .where(eq(fundHoldings.fundCode, code))
      .orderBy(desc(fundHoldings.reportDate), desc(fundHoldings.weight));

    // Only the latest disclosed report is the fund's current portfolio; older
    // ones stay in the table but would double-count if mixed in.
    const latestReport = rows[0]?.reportDate ?? null;
    const current = rows.filter((row) => row.reportDate === latestReport);
    const disclosedWeight = current.reduce((sum, row) => sum + row.weight, 0);

    return c.json({
      fund: {
        code: fund.code,
        provider: fund.provider,
        market: fund.market,
        currency: fund.currency,
        name: fund.name,
        fundType: fund.fundType,
        company: fund.company,
        trackingIndex: fund.trackingIndex,
        holdingsCompleteness: fund.holdingsCompleteness,
        holdingsSyncedAt: fund.holdingsSyncedAt,
        lastSyncError: fund.lastSyncError,
      },
      latestReport,
      // Read against `holdingsCompleteness`, this is the honest coverage signal:
      // well under 100 is expected from a top-holdings discloser and a red flag
      // from a provider that publishes the whole book.
      disclosedWeight,
      // How much of this portfolio the Yahoo join actually reached. A low
      // figure explains a thin exposure breakdown far better than the
      // breakdown itself can.
      enrichedPositions: current.filter((row) => row.profileSyncedAt !== null).length,
      items: current,
      reportDates: [...new Set(rows.map((row) => row.reportDate))],
    });
  });

export const syncRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  /** Recent runs, newest first, for the job history panel. */
  .get("/jobs", async (c) => {
    const rows = await db
      .select()
      .from(ingestJobs)
      .orderBy(desc(ingestJobs.createdAt))
      .limit(20);
    return c.json({ items: rows, activeJobId: activeJobId() });
  })

  /**
   * The numbers shown before a sync starts.
   *
   * Read-only and cheap — it touches only the local watermarks, never an
   * upstream — so the confirmation dialog can be opened freely.
   */
  .get("/preview", zValidator("query", previewQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const preview = await previewSync(db, getProvider(query.provider), query.scope, {
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      force: query.force,
    });
    return c.json(preview);
  })

  .post("/", requireAdmin, zValidator("json", syncBodySchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");

    try {
      const job = await startJob({
        provider: body.provider,
        scope: body.scope,
        ...(body.limit === undefined ? {} : { limit: body.limit }),
        force: body.force,
        requestedBy: user.id,
      });

      await audit({
        actorUserId: user.id,
        action: "fund.sync_start",
        targetType: "ingest_job",
        targetId: job.id,
        meta: {
          provider: body.provider,
          scope: body.scope,
          limit: body.limit ?? null,
          force: body.force,
        },
        ip: clientIp(c),
      });

      return c.json(job, 202);
    } catch (error) {
      if (error instanceof JobInProgressError) {
        return c.json({ error: "a sync is already running", jobId: error.jobId }, 409);
      }
      throw error;
    }
  })

  /**
   * Reload every provider's fund index now.
   *
   * The boot refresh covers the normal case; this is the escape hatch for when
   * a source was down at boot, or a new listing should show up without waiting
   * out the freshness window. Cheap — one listing call per provider — but it
   * writes, so it is admin-only and audited like any other sync action.
   */
  .post("/index", requireAdmin, async (c) => {
    const user = c.get("user");
    const results = await refreshAllFundIndexes(db, { force: true });

    await audit({
      actorUserId: user.id,
      action: "fund.index_refresh",
      targetType: "fund_index",
      meta: { results },
      ip: clientIp(c),
    });

    return c.json({ results });
  })

  .post("/:id/cancel", requireAdmin, async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!cancelJob(id)) return c.json({ error: "job is not running" }, 409);

    await audit({
      actorUserId: user.id,
      action: "fund.sync_cancel",
      targetType: "ingest_job",
      targetId: id,
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  });
