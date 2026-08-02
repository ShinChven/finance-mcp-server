/**
 * Read model for the relationship tools.
 *
 * Tools depend on the `FundRepo` interface, not on Drizzle, so the MCP layer
 * stays unit-testable without a database — the same way the Yahoo tools take an
 * injected client.
 */

import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { db as Database } from "../db/index.js";
import {
  fundExposure,
  fundHoldings,
  fundNav,
  funds,
  instruments,
  type Fund,
} from "../db/schema.js";
import type { NavSeriesPoint } from "./performance.js";

export interface HoldingRow {
  symbol: string;
  name: string | null;
  weight: number;
  reportDate: string;
}

export interface ExposureRow {
  dimension: string;
  taxonomy: string;
  key: string;
  label: string | null;
  weight: number;
  coverage: number;
  reportDate: string | null;
}

export interface FundMatch {
  fund: Fund;
  weight: number;
  coverage?: number;
  key?: string;
  label?: string | null;
  reportDate: string | null;
}

export interface SectorQuery {
  taxonomy?: string;
  /** `instrument_sectors.sector_code` values. */
  keys: string[];
  /** `instrument_sectors.sector_name` values, matched when codes are unknown. */
  labels: string[];
  markets?: string[];
  qdiiOnly?: boolean;
  limit: number;
}

export interface NavQuery {
  from?: string;
  to?: string;
  limit?: number;
}

export interface FundRepo {
  getFund(code: string): Promise<Fund | null>;
  getNavSeries(code: string, query?: NavQuery): Promise<NavSeriesPoint[]>;
  getExposure(code: string): Promise<ExposureRow[]>;
  getHoldings(code: string, reportDate?: string): Promise<HoldingRow[]>;
  listReportDates(code: string): Promise<string[]>;
  findFundsByStock(
    symbol: string,
    options: { limit: number; qdiiOnly?: boolean },
  ): Promise<FundMatch[]>;
  findFundsBySector(query: SectorQuery): Promise<FundMatch[]>;
  findFundsByTrackingIndex(patterns: string[], limit: number): Promise<Fund[]>;
  findFundsByMarketExposure(
    markets: string[],
    options: { limit: number; qdiiOnly?: boolean },
  ): Promise<FundMatch[]>;
  getExposureVectors(codes: string[]): Promise<Map<string, Map<string, number>>>;
  similarityCandidates(code: string, limit: number): Promise<string[]>;
  resolveSymbol(query: string): Promise<{ symbol: string; name: string | null } | null>;
}

type Db = typeof Database;

export function createFundRepo(db: Db): FundRepo {
  const qdiiFilter = (enabled: boolean | undefined): SQL | undefined =>
    enabled === true ? eq(funds.isQdii, true) : undefined;

  return {
    async getFund(code) {
      const [row] = await db.select().from(funds).where(eq(funds.code, code)).limit(1);
      return row ?? null;
    },

    async getNavSeries(code, query = {}) {
      const conditions: (SQL | undefined)[] = [eq(fundNav.fundCode, code)];
      if (query.from !== undefined) conditions.push(gte(fundNav.navDate, query.from));
      if (query.to !== undefined) conditions.push(lte(fundNav.navDate, query.to));

      return db
        .select({ navDate: fundNav.navDate, nav: fundNav.nav, accNav: fundNav.accNav })
        .from(fundNav)
        .where(and(...conditions))
        .orderBy(asc(fundNav.navDate))
        .limit(query.limit ?? 2000);
    },

    async getExposure(code) {
      return db
        .select({
          dimension: fundExposure.dimension,
          taxonomy: fundExposure.taxonomy,
          key: fundExposure.key,
          label: fundExposure.label,
          weight: fundExposure.weight,
          coverage: fundExposure.coverage,
          reportDate: fundExposure.reportDate,
        })
        .from(fundExposure)
        .where(eq(fundExposure.fundCode, code))
        .orderBy(desc(fundExposure.weight));
    },

    async getHoldings(code, reportDate) {
      const target = reportDate ?? (await this.listReportDates(code))[0];
      if (target === undefined) return [];
      return db
        .select({
          symbol: fundHoldings.symbol,
          name: fundHoldings.name,
          weight: fundHoldings.weight,
          reportDate: fundHoldings.reportDate,
        })
        .from(fundHoldings)
        .where(and(eq(fundHoldings.fundCode, code), eq(fundHoldings.reportDate, target)))
        .orderBy(desc(fundHoldings.weight));
    },

    async listReportDates(code) {
      const rows = await db
        .selectDistinct({ reportDate: fundHoldings.reportDate })
        .from(fundHoldings)
        .where(eq(fundHoldings.fundCode, code))
        .orderBy(desc(fundHoldings.reportDate));
      return rows.map((row) => row.reportDate);
    },

    async findFundsByStock(symbol, { limit, qdiiOnly }) {
      // Only the newest report per fund counts; older quarters would double-list
      // a fund that has held the name for a year.
      const latest = db
        .select({
          fundCode: fundHoldings.fundCode,
          reportDate: sql<string>`max(${fundHoldings.reportDate})`.as("report_date"),
        })
        .from(fundHoldings)
        .where(eq(fundHoldings.symbol, symbol))
        .groupBy(fundHoldings.fundCode)
        .as("latest");

      const rows = await db
        .select({
          fund: funds,
          weight: fundHoldings.weight,
          reportDate: fundHoldings.reportDate,
        })
        .from(fundHoldings)
        .innerJoin(
          latest,
          and(
            eq(fundHoldings.fundCode, latest.fundCode),
            eq(fundHoldings.reportDate, latest.reportDate),
          ),
        )
        .innerJoin(funds, eq(funds.code, fundHoldings.fundCode))
        .where(and(eq(fundHoldings.symbol, symbol), qdiiFilter(qdiiOnly)))
        .orderBy(desc(fundHoldings.weight))
        .limit(limit);

      return rows.map((row) => ({
        fund: row.fund,
        weight: row.weight,
        reportDate: row.reportDate,
      }));
    },

    async findFundsBySector({ taxonomy, keys, labels, markets, qdiiOnly, limit }) {
      const matchers: SQL[] = [];
      if (keys.length > 0) matchers.push(inArray(fundExposure.key, keys));
      if (labels.length > 0) matchers.push(inArray(fundExposure.label, labels));
      if (matchers.length === 0) return [];

      const conditions: (SQL | undefined)[] = [
        eq(fundExposure.dimension, "sector"),
        matchers.length === 1 ? matchers[0] : or(...matchers),
        qdiiFilter(qdiiOnly),
      ];
      if (taxonomy !== undefined) conditions.push(eq(fundExposure.taxonomy, taxonomy));
      if (markets !== undefined && markets.length > 0) {
        // Restrict to funds that also carry exposure to the requested markets.
        const marketFunds = db
          .select({ fundCode: fundExposure.fundCode })
          .from(fundExposure)
          .where(and(eq(fundExposure.dimension, "market"), inArray(fundExposure.key, markets)));
        conditions.push(inArray(fundExposure.fundCode, marketFunds));
      }

      const rows = await db
        .select({
          fund: funds,
          weight: fundExposure.weight,
          coverage: fundExposure.coverage,
          key: fundExposure.key,
          label: fundExposure.label,
          reportDate: fundExposure.reportDate,
        })
        .from(fundExposure)
        .innerJoin(funds, eq(funds.code, fundExposure.fundCode))
        .where(and(...conditions))
        .orderBy(desc(fundExposure.weight))
        .limit(limit);

      return rows;
    },

    async findFundsByMarketExposure(markets, { limit, qdiiOnly }) {
      if (markets.length === 0) return [];
      const rows = await db
        .select({
          fund: funds,
          weight: fundExposure.weight,
          coverage: fundExposure.coverage,
          key: fundExposure.key,
          label: fundExposure.label,
          reportDate: fundExposure.reportDate,
        })
        .from(fundExposure)
        .innerJoin(funds, eq(funds.code, fundExposure.fundCode))
        .where(
          and(
            eq(fundExposure.dimension, "market"),
            inArray(fundExposure.key, markets),
            qdiiFilter(qdiiOnly),
          ),
        )
        .orderBy(desc(fundExposure.weight))
        .limit(limit);
      return rows;
    },

    async findFundsByTrackingIndex(patterns, limit) {
      if (patterns.length === 0) return [];
      const conditions = patterns.map(
        (pattern) => sql`${funds.trackingIndex} ilike ${`%${pattern}%`}`,
      );
      return db
        .select()
        .from(funds)
        .where(or(...conditions))
        .limit(limit);
    },

    async getExposureVectors(codes) {
      const result = new Map<string, Map<string, number>>();
      if (codes.length === 0) return result;

      const rows = await db
        .select({
          fundCode: fundExposure.fundCode,
          taxonomy: fundExposure.taxonomy,
          key: fundExposure.key,
          weight: fundExposure.weight,
        })
        .from(fundExposure)
        .where(
          and(eq(fundExposure.dimension, "sector"), inArray(fundExposure.fundCode, codes)),
        );

      for (const row of rows) {
        let vector = result.get(row.fundCode);
        if (vector === undefined) {
          vector = new Map();
          result.set(row.fundCode, vector);
        }
        vector.set(`${row.taxonomy}:${row.key}`, row.weight);
      }
      return result;
    },

    async similarityCandidates(code, limit) {
      // Funds sharing this fund's three heaviest sectors — a cheap prefilter so
      // similarity is computed over dozens of vectors rather than thousands.
      const top = db
        .select({ key: fundExposure.key, taxonomy: fundExposure.taxonomy })
        .from(fundExposure)
        .where(and(eq(fundExposure.fundCode, code), eq(fundExposure.dimension, "sector")))
        .orderBy(desc(fundExposure.weight))
        .limit(3);

      const topRows = await top;
      if (topRows.length === 0) return [];

      const rows = await db
        .selectDistinct({ fundCode: fundExposure.fundCode })
        .from(fundExposure)
        .where(
          and(
            eq(fundExposure.dimension, "sector"),
            or(
              ...topRows.map((row) =>
                and(eq(fundExposure.taxonomy, row.taxonomy), eq(fundExposure.key, row.key)),
              ),
            ),
          ),
        )
        .limit(limit);

      return rows.map((row) => row.fundCode).filter((candidate) => candidate !== code);
    },

    async resolveSymbol(query) {
      const [exact] = await db
        .select({ symbol: instruments.symbol, name: instruments.name })
        .from(instruments)
        .where(eq(instruments.symbol, query))
        .limit(1);
      if (exact) return exact;

      const [byName] = await db
        .select({ symbol: instruments.symbol, name: instruments.name })
        .from(instruments)
        .where(sql`${instruments.name} ilike ${`%${query}%`}`)
        .limit(1);
      return byName ?? null;
    },
  };
}

/**
 * Defers both the database import and the connection until a relationship tool
 * is actually called, so building an MCP server — as the unit tests do — never
 * requires a configured database.
 */
export function createLazyFundRepo(): FundRepo {
  let cached: Promise<FundRepo> | undefined;

  const load = (): Promise<FundRepo> => {
    cached ??= import("../db/index.js").then((module) => createFundRepo(module.db));
    return cached;
  };

  return new Proxy({} as FundRepo, {
    get(_target, property) {
      return async (...args: unknown[]) => {
        const repo = await load();
        const method = repo[property as keyof FundRepo] as (...inner: unknown[]) => unknown;
        return method.apply(repo, args);
      };
    },
  });
}
