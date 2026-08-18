/**
 * The fund cache dashboard's API.
 *
 * Read routes are open to any signed-in user; anything that starts a sync is
 * admin-only — a run costs hours of outbound requests against hosts that rate
 * limit, so it is not something an ordinary account should be able to trigger.
 */

import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { previewSync } from "../china/ingest.js";
import { createLazyFundCache } from "../china/ondemand.js";
import {
  activeJobId,
  cancelJob,
  JobInProgressError,
  startJob,
} from "../china/jobs.js";
import { INGEST_SCOPES, scopeFilter, SELECTABLE_SCOPES, type IngestScope } from "../china/scope.js";
import { previewQuerySchema, syncBodySchema } from "../../shared/funds.js";
import { db } from "../db/index.js";
import { fundHoldings, funds, ingestJobs } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { escapeLike, listQuerySchema, listResponse, parseSort } from "../lib/listing.js";
import { requireAdmin, requireAuth } from "../middleware/session.js";

/** `status` on the funds list doubles as the cached/uncached filter. */
const fundListQuerySchema = listQuerySchema.extend({
  type: z.enum(INGEST_SCOPES).optional(),
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

export const fundRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  /** Cache-wide totals for the page header. */
  .get("/stats", async (c) => {
    const [totals] = await db
      .select({
        total: count(),
        cached: sql<number>`count(*) filter (where ${funds.holdingsSyncedAt} is not null)`.mapWith(
          Number,
        ),
        failing: sql<number>`count(*) filter (where ${funds.lastSyncError} is not null)`.mapWith(
          Number,
        ),
      })
      .from(funds);

    const [holdings] = await db
      .select({
        rows: count(),
        symbols: sql<number>`count(distinct ${fundHoldings.symbol})`.mapWith(Number),
        latestReport: sql<string | null>`max(${fundHoldings.reportDate})`,
      })
      .from(fundHoldings);

    // Per-scope coverage drives the category buttons' "x of y cached" labels.
    const byScope: Record<string, { total: number; cached: number }> = {};
    for (const scope of SELECTABLE_SCOPES) {
      const where = scopeFilter(scope);
      const [row] = await db
        .select({
          total: count(),
          cached: sql<number>`count(*) filter (where ${funds.holdingsSyncedAt} is not null)`.mapWith(
            Number,
          ),
        })
        .from(funds)
        .where(where);
      byScope[scope] = { total: row?.total ?? 0, cached: row?.cached ?? 0 };
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
      byScope,
      activeJobId: activeJobId(),
    });
  })

  .get("/", zValidator("query", fundListQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const filters: SQL[] = [];

    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      filters.push(
        or(
          ilike(funds.code, like),
          ilike(funds.name, like),
          ilike(funds.company, like),
          ilike(funds.trackingIndex, like),
        )!,
      );
    }
    if (query.type) {
      const scoped = scopeFilter(query.type);
      if (scoped) filters.push(scoped);
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
        name: funds.name,
        fundType: funds.fundType,
        isQdii: funds.isQdii,
        isIndexFund: funds.isIndexFund,
        trackingIndex: funds.trackingIndex,
        company: funds.company,
        fundSize: funds.fundSize,
        feeRate: funds.feeRate,
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
   * Any signed-in user may trigger it — unlike a category sync, this is three
   * requests for a fund they are already looking at, and it is de-duplicated
   * and throttled in `china/ondemand.ts`.
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

    const rows = await db
      .select({
        symbol: fundHoldings.symbol,
        name: fundHoldings.name,
        weight: fundHoldings.weight,
        reportDate: fundHoldings.reportDate,
      })
      .from(fundHoldings)
      .where(eq(fundHoldings.fundCode, code))
      .orderBy(desc(fundHoldings.reportDate), desc(fundHoldings.weight));

    // Only the latest disclosed report is the fund's current portfolio; older
    // quarters stay in the table but would double-count if mixed in.
    const latestReport = rows[0]?.reportDate ?? null;
    const current = rows.filter((row) => row.reportDate === latestReport);
    const disclosedWeight = current.reduce((sum, row) => sum + row.weight, 0);

    return c.json({
      fund: {
        code: fund.code,
        name: fund.name,
        fundType: fund.fundType,
        company: fund.company,
        trackingIndex: fund.trackingIndex,
        holdingsSyncedAt: fund.holdingsSyncedAt,
        lastSyncError: fund.lastSyncError,
      },
      latestReport,
      // Top-20 disclosure means this is well under 100 for most funds; saying so
      // beats letting the page imply the fund holds nothing else.
      disclosedWeight,
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
   * Read-only and cheap — it touches only the local watermarks, never
   * Eastmoney — so the confirmation dialog can be opened freely.
   */
  .get("/preview", zValidator("query", previewQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const preview = await previewSync(db, query.scope as IngestScope, {
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
        meta: { scope: body.scope, limit: body.limit ?? null, force: body.force },
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
