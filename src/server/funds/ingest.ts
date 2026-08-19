/**
 * Offline ingest — builds the relationship tables the MCP tools read.
 *
 * Runs on a schedule, never inside a tool call. The pipeline is the same six
 * steps for every market; what differs between them is behind the
 * `FundProvider` this module is handed. Steps 1-4 are the provider's, steps 5
 * and 6 are shared and market-agnostic by construction:
 *
 *   1. universe   → provider   2. details → provider
 *   3. holdings   → provider   4. NAV     → provider
 *   5. sector tags        → Yahoo `assetProfile`, one taxonomy for every market
 *   6. exposure           → derived from what steps 3 and 5 stored
 *
 * Step 5 is why a cross-market answer is possible at all: `assetProfile` covers
 * CN, HK and US listings alike, so a China fund's 贵州茅台 and a US ETF's NVDA
 * are classified in the same vocabulary and the exposure vectors are directly
 * comparable.
 */

import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { isFresh, SYNC_STEPS, type SyncStep } from "../../shared/funds.js";
import type { db as Database } from "../db/index.js";
import {
  fundExposure,
  fundHoldings,
  fundNav,
  funds,
  instrumentSectors,
  instruments,
} from "../db/schema.js";
import type { YahooFinanceClient } from "../mcp/client.js";
import { computeExposure, type SectorTag } from "./exposure.js";
import type { FundProvider } from "./provider.js";
import { currencyOf, marketOf } from "./symbols.js";

type Db = typeof Database;

export interface IngestSummary {
  fundsUpserted: number;
  fundDetailsUpserted: number;
  holdingsUpserted: number;
  navPointsUpserted: number;
  symbolsClassified: number;
  exposuresComputed: number;
  /** Funds skipped because every step was still inside its freshness window. */
  skippedFresh: number;
  /** Holdings rows the provider's parser could not read. Non-zero means a
   *  format drift — the failure mode that made Tokyo-coded positions vanish
   *  silently. */
  holdingsDropped: number;
  errors: string[];
}

export function emptySummary(): IngestSummary {
  return {
    fundsUpserted: 0,
    fundDetailsUpserted: 0,
    holdingsUpserted: 0,
    navPointsUpserted: 0,
    symbolsClassified: 0,
    exposuresComputed: 0,
    skippedFresh: 0,
    holdingsDropped: 0,
    errors: [],
  };
}

async function chunked<T>(items: T[], size: number, fn: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size));
  }
}

/** Step 1 — the fund universe. Cheap and the seed for everything else. */
export async function ingestFundUniverse(
  db: Db,
  provider: FundProvider,
  summary: IngestSummary = emptySummary(),
): Promise<IngestSummary> {
  const list = await provider.listUniverse();
  const { domicile, currency, completeness } = provider.descriptor;

  await chunked(list, 500, async (batch) => {
    await db
      .insert(funds)
      .values(
        batch.map((entry) => ({
          code: entry.code,
          provider: provider.id,
          market: domicile,
          currency,
          holdingsCompleteness: completeness,
          name: entry.name,
          fundType: entry.fundType,
          isIndexFund: entry.isIndexFund,
          investsOffshore: entry.investsOffshore,
          providerMeta: entry.providerMeta ?? {},
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: funds.code,
        set: {
          name: sql`excluded.name`,
          fundType: sql`excluded.fund_type`,
          isIndexFund: sql`excluded.is_index_fund`,
          investsOffshore: sql`excluded.invests_offshore`,
          // Merged rather than replaced: `fetchDetails` may have added keys the
          // universe row does not carry, and a re-seed should not drop them.
          providerMeta: sql`${funds.providerMeta} || excluded.provider_meta`,
          updatedAt: new Date(),
        },
      });
    summary.fundsUpserted += batch.length;
  });
  return summary;
}

/**
 * Step 2 — per-fund profile detail, most importantly the tracked index.
 *
 * The universe list carries no mandate, so without this step `tracking_index`
 * stays null and every index-tracking lookup returns nothing.
 *
 * Every field the provider reports as `null` is left alone rather than written:
 * `null` means "this source does not know", which is not the same as "this fund
 * does not have one", and overwriting would erase what an earlier step learned.
 */
export async function ingestFundDetails(
  db: Db,
  provider: FundProvider,
  codes: string[],
  summary: IngestSummary = emptySummary(),
): Promise<IngestSummary> {
  for (const code of codes) {
    try {
      const details = await provider.fetchDetails(code);
      await db
        .update(funds)
        .set({
          ...(details.name !== null ? { name: details.name } : {}),
          ...(details.fundType !== null ? { fundType: details.fundType } : {}),
          ...(details.isIndexFund !== null ? { isIndexFund: details.isIndexFund } : {}),
          ...(details.investsOffshore !== null
            ? { investsOffshore: details.investsOffshore }
            : {}),
          ...(details.listedSymbol !== null ? { listedSymbol: details.listedSymbol } : {}),
          ...(details.providerMeta !== undefined
            ? { providerMeta: sql`${funds.providerMeta} || ${JSON.stringify(details.providerMeta)}::jsonb` }
            : {}),
          trackingIndex: details.trackingIndex,
          company: details.company,
          manager: details.manager,
          feeRate: details.feeRate,
          fundSize: details.fundSize,
          detailsSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(funds.code, code));
      summary.fundDetailsUpserted += 1;
    } catch (error) {
      summary.errors.push(`details ${code}: ${(error as Error).message}`);
    }
  }
  return summary;
}

/** Step 3 — holdings for the requested funds, plus the instruments they reference. */
export async function ingestHoldings(
  db: Db,
  provider: FundProvider,
  codes: string[],
  summary: IngestSummary = emptySummary(),
): Promise<IngestSummary> {
  for (const code of codes) {
    try {
      const result = await provider.fetchHoldings(code);

      if (result.dropped > 0) {
        summary.holdingsDropped += result.dropped;
        // Surfaced as an error, not a debug log: an unreadable row means this
        // fund's stored portfolio is incomplete, and every exposure figure
        // derived from it is understated.
        summary.errors.push(
          `holdings ${code}: dropped ${result.dropped} unparseable row(s)` +
            (result.dropReason === undefined ? "" : ` (${result.dropReason})`),
        );
      }

      const completeness = result.completeness ?? provider.descriptor.completeness;
      const holdings = result.entries;

      // A fund with no disclosed portfolio is still a completed fetch — mark it
      // so the next run does not retry it every time.
      if (holdings.length === 0) {
        await db
          .update(funds)
          .set({ holdingsSyncedAt: new Date() })
          .where(eq(funds.code, code));
        continue;
      }

      const symbols = [...new Set(holdings.map((holding) => holding.symbol))];
      await db
        .insert(instruments)
        .values(
          symbols.map((symbol) => {
            const market = marketOf(symbol);
            return {
              symbol,
              name: holdings.find((holding) => holding.symbol === symbol)?.name ?? null,
              market,
              type: "stock",
              currency: currencyOf(market),
              updatedAt: new Date(),
            };
          }),
        )
        .onConflictDoNothing({ target: instruments.symbol });

      await db
        .insert(fundHoldings)
        .values(
          holdings.map((holding) => ({
            fundCode: code,
            symbol: holding.symbol,
            name: holding.name,
            weight: holding.weight,
            reportDate: holding.reportDate,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [fundHoldings.fundCode, fundHoldings.symbol, fundHoldings.reportDate],
          // A daily provider republishes the same report date with moved
          // weights, so the row has to be refreshed rather than ignored.
          set: { weight: sql`excluded.weight`, name: sql`excluded.name`, updatedAt: new Date() },
        });

      await db
        .update(funds)
        .set({ holdingsSyncedAt: new Date(), holdingsCompleteness: completeness })
        .where(eq(funds.code, code));
      summary.holdingsUpserted += holdings.length;
    } catch (error) {
      summary.errors.push(`holdings ${code}: ${(error as Error).message}`);
    }
  }
  return summary;
}

/** Step 4 — NAV history, read by the `fundPerformance` tool. */
export async function ingestNav(
  db: Db,
  provider: FundProvider,
  codes: string[],
  summary: IngestSummary = emptySummary(),
): Promise<IngestSummary> {
  for (const code of codes) {
    try {
      const points = await provider.fetchNav(code);
      if (points.length > 0) {
        await db
          .insert(fundNav)
          .values(
            points.map((point) => ({
              fundCode: code,
              navDate: point.navDate,
              nav: point.nav,
              accNav: point.accNav,
              dailyReturn: point.dailyReturn,
            })),
          )
          .onConflictDoNothing({ target: [fundNav.fundCode, fundNav.navDate] });
        summary.navPointsUpserted += points.length;
      }
      await db.update(funds).set({ navSyncedAt: new Date() }).where(eq(funds.code, code));
    } catch (error) {
      summary.errors.push(`nav ${code}: ${(error as Error).message}`);
    }
  }
  return summary;
}

/**
 * Step 5 — sector tags from Yahoo `assetProfile`.
 *
 * Only symbols missing a tag are fetched, so re-running the ingest costs one
 * request per genuinely new holding rather than per position. Shared across
 * providers on purpose: classifying NVDA once serves the QDII that holds it and
 * the US ETF that holds it alike.
 */
export async function ingestSectors(
  db: Db,
  yahoo: YahooFinanceClient,
  symbols: string[],
  summary: IngestSummary = emptySummary(),
): Promise<IngestSummary> {
  if (symbols.length === 0) return summary;

  const existing = await db
    .select({ symbol: instrumentSectors.symbol })
    .from(instrumentSectors)
    .where(inArray(instrumentSectors.symbol, symbols));
  const known = new Set(existing.map((row) => row.symbol));
  const missing = symbols.filter((symbol) => !known.has(symbol));

  for (const symbol of missing) {
    try {
      const profile = (await yahoo.quoteSummary(symbol, { modules: ["assetProfile"] })) as {
        assetProfile?: { sector?: string; industry?: string };
      };
      const sector = profile.assetProfile?.sector;
      if (sector === undefined || sector === "") continue;

      await db
        .insert(instrumentSectors)
        .values({
          symbol,
          taxonomy: "gics",
          sectorCode: sector,
          sectorName: profile.assetProfile?.industry ?? sector,
          updatedAt: new Date(),
        })
        .onConflictDoNothing({ target: [instrumentSectors.symbol, instrumentSectors.taxonomy] });
      summary.symbolsClassified += 1;
    } catch (error) {
      summary.errors.push(`sector ${symbol}: ${(error as Error).message}`);
    }
  }
  return summary;
}

/** Step 6 — recompute derived exposure for the given funds. */
export async function recomputeExposure(
  db: Db,
  codes: string[],
  summary: IngestSummary = emptySummary(),
): Promise<IngestSummary> {
  for (const code of codes) {
    const holdingRows = await db
      .select({
        symbol: fundHoldings.symbol,
        weight: fundHoldings.weight,
        reportDate: fundHoldings.reportDate,
      })
      .from(fundHoldings)
      .where(eq(fundHoldings.fundCode, code));

    if (holdingRows.length === 0) continue;

    // Latest disclosed report only.
    const latest = holdingRows
      .map((row) => row.reportDate)
      .sort()
      .at(-1);
    const current = holdingRows.filter((row) => row.reportDate === latest);
    const symbols = [...new Set(current.map((row) => row.symbol))];

    const sectorRows = await db
      .select({
        symbol: instrumentSectors.symbol,
        taxonomy: instrumentSectors.taxonomy,
        sectorCode: instrumentSectors.sectorCode,
        sectorName: instrumentSectors.sectorName,
      })
      .from(instrumentSectors)
      .where(inArray(instrumentSectors.symbol, symbols));

    const sectors = new Map<string, SectorTag[]>();
    for (const row of sectorRows) {
      const tags = sectors.get(row.symbol) ?? [];
      tags.push({
        taxonomy: row.taxonomy,
        sectorCode: row.sectorCode,
        sectorName: row.sectorName,
      });
      sectors.set(row.symbol, tags);
    }

    const markets = new Map(symbols.map((symbol) => [symbol, marketOf(symbol)]));
    const cells = computeExposure({ holdings: current, sectors, markets });
    if (cells.length === 0) continue;

    await db.delete(fundExposure).where(eq(fundExposure.fundCode, code));
    await db.insert(fundExposure).values(
      cells.map((cell) => ({
        fundCode: code,
        dimension: cell.dimension,
        taxonomy: cell.taxonomy,
        key: cell.key,
        label: cell.label,
        weight: cell.weight,
        coverage: cell.coverage,
        reportDate: latest ?? null,
        computedAt: new Date(),
      })),
    );
    summary.exposuresComputed += cells.length;
  }
  return summary;
}

/** A fund row reduced to the watermarks that decide what still needs fetching. */
interface Candidate {
  code: string;
  detailsSyncedAt: Date | null;
  holdingsSyncedAt: Date | null;
  navSyncedAt: Date | null;
}

/**
 * Funds a run would touch, least-recently-synced first.
 *
 * Ordering by `holdingsSyncedAt` with nulls first means a capped run always
 * spends its budget on funds that have never been cached, instead of
 * re-walking the same alphabetical prefix every time.
 */
export async function selectCandidates(
  db: Db,
  provider: FundProvider,
  scope: string,
  options: { codes?: string[]; limit?: number | null } = {},
): Promise<Candidate[]> {
  const columns = {
    code: funds.code,
    detailsSyncedAt: funds.detailsSyncedAt,
    holdingsSyncedAt: funds.holdingsSyncedAt,
    navSyncedAt: funds.navSyncedAt,
  };
  // Every scope is implicitly scoped to its provider; a scope filter never has
  // to repeat it, and one provider's run can never touch another's rows.
  const filters: SQL[] = [eq(funds.provider, provider.id)];
  const scoped = provider.scopeFilter(scope);
  if (scoped) filters.push(scoped);
  if (scope === "codes") filters.push(inArray(funds.code, options.codes ?? []));

  const query = db
    .select(columns)
    .from(funds)
    .where(and(...filters))
    .orderBy(sql`${funds.holdingsSyncedAt} asc nulls first`, asc(funds.code));

  // `null` and `undefined` both mean "no SQL limit" here; the caller decides
  // whether an omitted limit should become a default before it reaches this.
  return options.limit == null ? query : query.limit(options.limit);
}

/** Counts behind the dashboard's "you are about to fetch N funds" confirmation. */
export interface SyncPreview {
  provider: string;
  scope: string;
  /** Funds matching the scope, before the freshness filter. */
  matched: number;
  /** Of those, funds with nothing left to fetch. */
  fresh: number;
  /** Funds the run would actually fetch (after `limit`). */
  toFetch: number;
  estimatedRequests: number;
  estimatedMinutes: number;
}

/**
 * What a run would do, without doing any of it.
 *
 * Backs the dashboard's confirmation step — the counts a user approves come
 * from the same `selectCandidates` + freshness logic `runIngest` then applies,
 * so the preview cannot drift from the run.
 */
export async function previewSync(
  db: Db,
  provider: FundProvider,
  scope: string,
  options: { codes?: string[]; limit?: number | null; force?: boolean } = {},
): Promise<SyncPreview> {
  const candidates = await selectCandidates(db, provider, scope, {
    codes: options.codes,
    limit: options.limit,
  });

  const now = Date.now();
  const force = options.force ?? false;
  let fresh = 0;
  let requests = 0;
  let toFetch = 0;
  for (const row of candidates) {
    let steps = 0;
    if (force || !isFresh(row.detailsSyncedAt, "details", provider.id, now)) steps += 1;
    if (force || !isFresh(row.holdingsSyncedAt, "holdings", provider.id, now)) steps += 1;
    if (force || !isFresh(row.navSyncedAt, "nav", provider.id, now)) steps += 1;
    if (steps === 0) fresh += 1;
    else toFetch += 1;
    requests += steps;
  }

  // A step is not one upstream request for every provider: iShares serves
  // details from its memoized screener and NAV from the Yahoo client's own
  // queue, so a fund costs one download rather than three. Pricing the run at
  // the provider's own per-fund cost keeps a NAV-only refresh from being
  // quoted as if it were a full one.
  const perStep = provider.requestsPerFund / SYNC_STEPS.length;
  const upstream = Math.ceil(requests * perStep);
  return {
    provider: provider.id,
    scope,
    matched: candidates.length,
    fresh,
    toFetch,
    estimatedRequests: upstream,
    estimatedMinutes: Math.ceil((upstream * provider.requestIntervalMs) / 60_000),
  };
}

export interface RunIngestOptions {
  db: Db;
  yahoo: YahooFinanceClient;
  provider: FundProvider;
  /** Which slice of the provider's universe to walk. Defaults to the
   *  provider's own `defaultScope`. */
  scope?: string;
  /** Explicit fund codes. Implies `scope: "codes"` when no scope is given. */
  codes?: string[];
  /**
   * Cap on how many funds to pull in one run. `null` removes the cap entirely,
   * which is what the dashboard asks for — its confirmation dialog prices the
   * whole scope, so capping the run behind the user's back would contradict the
   * number they approved. Omitted keeps the CLI-friendly default below.
   */
  limit?: number | null;
  skipUniverse?: boolean;
  /** Ignore the watermarks and refetch everything in scope. */
  force?: boolean;
  /** Called as each fund completes, for the `ingest_jobs` progress row. */
  onProgress?: (progress: { processed: number; total: number }) => Promise<void> | void;
  /** Cooperative cancellation, checked between funds. */
  signal?: AbortSignal;
}

/** Full pipeline. Each step accumulates into one summary so a partial failure
 *  still reports what landed. */
export async function runIngest(options: RunIngestOptions): Promise<IngestSummary> {
  const { db, yahoo, provider, limit = 200, skipUniverse = false, force = false } = options;
  const scope = options.scope ?? (options.codes ? "codes" : provider.descriptor.defaultScope);
  const summary = emptySummary();

  if (!skipUniverse) {
    await ingestFundUniverse(db, provider, summary);
  }

  if (scope === "codes") {
    // `fund_holdings.fund_code` is a foreign key into `funds`, so an explicit
    // code that was never seeded fails every insert with a bare constraint
    // violation. Drop it here with an actionable message instead.
    const requested = options.codes ?? [];
    const known = await db
      .select({ code: funds.code })
      .from(funds)
      .where(and(eq(funds.provider, provider.id), inArray(funds.code, requested)));
    const knownCodes = new Set(known.map((row) => row.code));
    for (const code of requested.filter((code) => !knownCodes.has(code))) {
      summary.errors.push(
        `${code}: not in ${provider.id}'s fund index — run once without --skip-universe to seed it.`,
      );
    }
  }

  const candidates = await selectCandidates(db, provider, scope, { codes: options.codes, limit });

  // Each step has its own freshness window, so a daily run refreshes NAV
  // without refetching holdings that have not moved.
  const now = Date.now();
  const needsDetails: string[] = [];
  const needsHoldings: string[] = [];
  const needsNav: string[] = [];
  for (const row of candidates) {
    const details = force || !isFresh(row.detailsSyncedAt, "details", provider.id, now);
    const holdings = force || !isFresh(row.holdingsSyncedAt, "holdings", provider.id, now);
    const nav = force || !isFresh(row.navSyncedAt, "nav", provider.id, now);
    if (details) needsDetails.push(row.code);
    if (holdings) needsHoldings.push(row.code);
    if (nav) needsNav.push(row.code);
    if (!details && !holdings && !nav) summary.skippedFresh += 1;
  }

  const codes = candidates.map((row) => row.code);
  const total = needsDetails.length + needsHoldings.length + needsNav.length;
  let processed = 0;
  const tick = async () => {
    processed += 1;
    await options.onProgress?.({ processed, total });
  };

  // Stepping one fund at a time keeps the progress row and the cancellation
  // check at fund granularity rather than "somewhere inside step 3 of 6".
  for (const code of needsDetails) {
    if (options.signal?.aborted) return summary;
    await ingestFundDetails(db, provider, [code], summary);
    await tick();
  }
  for (const code of needsHoldings) {
    if (options.signal?.aborted) return summary;
    await ingestHoldings(db, provider, [code], summary);
    await tick();
  }
  for (const code of needsNav) {
    if (options.signal?.aborted) return summary;
    await ingestNav(db, provider, [code], summary);
    await tick();
  }

  if (codes.length > 0) {
    const symbolRows = await db
      .selectDistinct({ symbol: fundHoldings.symbol })
      .from(fundHoldings)
      .where(inArray(fundHoldings.fundCode, codes));
    await ingestSectors(db, yahoo, symbolRows.map((row) => row.symbol), summary);
    await recomputeExposure(db, codes, summary);
    await recordFundErrors(db, codes, summary);
  }

  return summary;
}

/** Step errors are formatted `"<step> <code>: <reason>"`. The code pattern is
 *  deliberately loose — it has to match a 6-digit China code and a US ticker
 *  alike, and a China-shaped `\d{6}` here would silently stop recording
 *  failures the moment a second provider existed. */
const STEP_ERROR_RE = /^\w+ ([A-Z0-9.-]{1,16}): (.+)$/i;

/**
 * Mirrors this run's per-fund failures onto the fund rows, and clears stale
 * ones, so the dashboard can show which funds are failing without parsing the
 * job's error list.
 */
async function recordFundErrors(db: Db, codes: string[], summary: IngestSummary): Promise<void> {
  const inRun = new Set(codes);
  const failed = new Map<string, string>();
  for (const message of summary.errors) {
    const match = STEP_ERROR_RE.exec(message);
    // Guarded against the sector-step errors, which carry a symbol rather than
    // a fund code and would otherwise be attributed to a fund of that name.
    if (match?.[1] && match[2] && inRun.has(match[1])) {
      failed.set(match[1], match[2].slice(0, 300));
    }
  }

  const cleared = codes.filter((code) => !failed.has(code));
  if (cleared.length > 0) {
    await db.update(funds).set({ lastSyncError: null }).where(inArray(funds.code, cleared));
  }
  for (const [code, message] of failed) {
    await db.update(funds).set({ lastSyncError: message }).where(eq(funds.code, code));
  }
}

export type { SyncStep };
