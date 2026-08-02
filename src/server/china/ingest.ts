/**
 * Offline ingest — builds the relationship tables the MCP tools read.
 *
 * Runs on a schedule (quarterly reports land ~15-30 days after quarter end),
 * never inside a tool call. Sector classification comes from Yahoo's
 * `assetProfile`, which covers CN and HK listings as well as US ones, so both
 * legs of a cross-market comparison share one taxonomy (`gics`) instead of
 * needing a name-level translation at query time.
 */

import { eq, inArray, sql } from "drizzle-orm";
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
import { EastmoneyClient } from "./eastmoney.js";
import { computeExposure, type SectorTag } from "./exposure.js";
import { currencyOf, looksLikeQdii, marketOf } from "./symbols.js";

type Db = typeof Database;

export interface IngestSummary {
  fundsUpserted: number;
  fundDetailsUpserted: number;
  holdingsUpserted: number;
  navPointsUpserted: number;
  symbolsClassified: number;
  exposuresComputed: number;
  errors: string[];
}

function emptySummary(): IngestSummary {
  return {
    fundsUpserted: 0,
    fundDetailsUpserted: 0,
    holdingsUpserted: 0,
    navPointsUpserted: 0,
    symbolsClassified: 0,
    exposuresComputed: 0,
    errors: [],
  };
}

async function chunked<T>(items: T[], size: number, fn: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size));
  }
}

/** Step 1 — the fund universe. Cheap (one request) and the seed for everything else. */
export async function ingestFundUniverse(
  db: Db,
  client: EastmoneyClient,
  summary: IngestSummary = emptySummary(),
): Promise<IngestSummary> {
  const list = await client.fetchFundList();
  await chunked(list, 500, async (batch) => {
    await db
      .insert(funds)
      .values(
        batch.map((entry) => ({
          code: entry.code,
          name: entry.name,
          fundType: entry.fundType,
          isQdii: looksLikeQdii(entry.fundType, entry.name),
          isIndexFund: /指数|ETF|LOF/.test(`${entry.fundType} ${entry.name}`),
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: funds.code,
        set: {
          name: sql`excluded.name`,
          fundType: sql`excluded.fund_type`,
          isQdii: sql`excluded.is_qdii`,
          isIndexFund: sql`excluded.is_index_fund`,
          updatedAt: new Date(),
        },
      });
    summary.fundsUpserted += batch.length;
  });
  return summary;
}

/**
 * Step 2 — per-fund profile detail, most importantly 跟踪标的.
 *
 * The universe list carries no mandate, so without this step `tracking_index`
 * stays null and every index-tracking lookup returns nothing.
 */
export async function ingestFundDetails(
  db: Db,
  client: EastmoneyClient,
  codes: string[],
  summary: IngestSummary = emptySummary(),
): Promise<IngestSummary> {
  for (const code of codes) {
    try {
      const basics = await client.fetchFundBasics(code);
      await db
        .update(funds)
        .set({
          ...(basics.name !== null ? { name: basics.name } : {}),
          ...(basics.fundType !== null ? { fundType: basics.fundType } : {}),
          trackingIndex: basics.trackingIndex,
          isIndexFund: basics.trackingIndex !== null,
          company: basics.company,
          manager: basics.manager,
          feeRate: basics.feeRate,
          fundSize: basics.fundSize,
          updatedAt: new Date(),
        })
        .where(eq(funds.code, code));
      summary.fundDetailsUpserted += 1;
    } catch (error) {
      summary.errors.push(`basics ${code}: ${(error as Error).message}`);
    }
  }
  return summary;
}

/** Step 3 — holdings for the requested funds, plus the instruments they reference. */
export async function ingestHoldings(
  db: Db,
  client: EastmoneyClient,
  codes: string[],
  summary: IngestSummary = emptySummary(),
): Promise<IngestSummary> {
  for (const code of codes) {
    try {
      const holdings = await client.fetchHoldings(code);
      if (holdings.length === 0) continue;

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
        .onConflictDoNothing({
          target: [fundHoldings.fundCode, fundHoldings.symbol, fundHoldings.reportDate],
        });

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
  client: EastmoneyClient,
  codes: string[],
  summary: IngestSummary = emptySummary(),
): Promise<IngestSummary> {
  for (const code of codes) {
    try {
      const points = await client.fetchNavHistory(code);
      if (points.length === 0) continue;
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
 * request per genuinely new holding rather than per position.
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

export interface RunIngestOptions {
  db: Db;
  yahoo: YahooFinanceClient;
  eastmoney?: EastmoneyClient;
  /** Explicit fund codes; defaults to the QDII + index-tracking subset. */
  codes?: string[];
  /** Cap on how many funds to pull holdings for in one run. */
  limit?: number;
  skipUniverse?: boolean;
}

/** Full pipeline. Each step accumulates into one summary so a partial failure
 *  still reports what landed. */
export async function runIngest(options: RunIngestOptions): Promise<IngestSummary> {
  const { db, yahoo, limit = 200, skipUniverse = false } = options;
  const client = options.eastmoney ?? new EastmoneyClient();
  const summary = emptySummary();

  if (!skipUniverse) {
    await ingestFundUniverse(db, client, summary);
  }

  let codes = options.codes;
  if (codes === undefined) {
    const rows = await db
      .select({ code: funds.code })
      .from(funds)
      .where(eq(funds.isQdii, true))
      .limit(limit);
    codes = rows.map((row) => row.code);
  }

  await ingestFundDetails(db, client, codes, summary);
  await ingestHoldings(db, client, codes, summary);
  await ingestNav(db, client, codes, summary);

  const symbolRows = await db
    .selectDistinct({ symbol: fundHoldings.symbol })
    .from(fundHoldings)
    .where(inArray(fundHoldings.fundCode, codes));
  await ingestSectors(db, yahoo, symbolRows.map((row) => row.symbol), summary);

  await recomputeExposure(db, codes, summary);
  return summary;
}
