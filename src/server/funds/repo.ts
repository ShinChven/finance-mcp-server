/**
 * Read model for the relationship tools.
 *
 * Tools depend on the `FundRepo` interface, not on Drizzle, so the MCP layer
 * stays unit-testable without a database — the same way the Yahoo tools take an
 * injected client.
 */

import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { normalizeFundCode, type ProviderId } from "../../shared/funds.js";
import type { db as Database } from "../db/index.js";
import {
  fundExposure,
  fundHoldings,
  fundNav,
  funds,
  instrumentSectors,
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

/**
 * Which funds may answer, independent of what is being asked.
 *
 * Note the two different senses of "market" in this file, because conflating
 * them is the easy mistake: `FundFilter.domiciles` is where the *fund* lives —
 * the market a user can actually buy it in — while `SectorQuery.markets` is
 * where its *holdings* are. A China QDII tracking the Nasdaq has domicile CN
 * and market exposure US, and both filters are useful for opposite questions.
 */
export interface FundFilter {
  providers?: ProviderId[];
  /** `funds.market` — where the fund itself is domiciled and traded. */
  domiciles?: string[];
  /** Only funds whose mandate points outside their own market (QDII, ex-US). */
  offshoreOnly?: boolean;
}

export interface SectorQuery extends FundFilter {
  taxonomy?: string;
  /** `instrument_sectors.sector_code` values. */
  keys: string[];
  /** `instrument_sectors.sector_name` values, matched when codes are unknown. */
  labels: string[];
  /** Markets the fund's *holdings* are listed in. */
  markets?: string[];
  limit: number;
}

/**
 * Instrument-level predicates, resolved against the enriched `instruments` and
 * `instrument_sectors` tables.
 *
 * This is the federated half of the index: the fields come from Yahoo, the
 * weights come from each fund's provider, and because both are local the whole
 * question is one SQL statement rather than a fan-out nobody could filter on.
 */
export interface HoldingCriteria extends FundFilter {
  /** Canonical symbols a position must be one of. */
  symbols?: string[];
  /** `instrument_sectors.sector_code` — the GICS sector. */
  sectors?: string[];
  /** `instrument_sectors.sector_name` — the narrower industry. */
  industries?: string[];
  /** `instruments.country` — domicile per Yahoo, not the listing venue. */
  countries?: string[];
  /** `instruments.market` — where the position is listed. */
  holdingMarkets?: string[];
  /** Bounds on `instruments.market_cap_usd`. Always the USD column: the native
   *  one cannot be compared across markets. */
  minMarketCapUsd?: number;
  maxMarketCapUsd?: number;
  limit: number;
}

export interface HoldingCriteriaMatch {
  fund: Fund;
  /** Summed weight of the matching positions, percent of NAV. */
  matchedWeight: number;
  /** How many positions matched. */
  positions: number;
  /** Total disclosed weight of the fund's latest report — the denominator that
   *  makes `matchedWeight` readable against a top-holdings discloser. */
  disclosedWeight: number;
  reportDate: string | null;
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
    options: FundFilter & { limit: number },
  ): Promise<FundMatch[]>;
  findFundsBySector(query: SectorQuery): Promise<FundMatch[]>;
  findFundsByHoldingCriteria(criteria: HoldingCriteria): Promise<HoldingCriteriaMatch[]>;
  findFundsByTrackingIndex(
    patterns: string[],
    options: FundFilter & { limit: number },
  ): Promise<Fund[]>;
  findFundsByMarketExposure(
    markets: string[],
    options: FundFilter & { limit: number },
  ): Promise<FundMatch[]>;
  getExposureVectors(codes: string[]): Promise<Map<string, Map<string, number>>>;
  similarityCandidates(code: string, limit: number): Promise<string[]>;
  resolveSymbol(query: string): Promise<{ symbol: string; name: string | null } | null>;
}

type Db = typeof Database;

export function createFundRepo(db: Db): FundRepo {
  const fundFilter = (filter: FundFilter): SQL | undefined => {
    const parts: SQL[] = [];
    if (filter.providers !== undefined && filter.providers.length > 0) {
      parts.push(inArray(funds.provider, filter.providers));
    }
    if (filter.domiciles !== undefined && filter.domiciles.length > 0) {
      parts.push(inArray(funds.market, filter.domiciles));
    }
    if (filter.offshoreOnly === true) parts.push(eq(funds.investsOffshore, true));
    return parts.length === 0 ? undefined : and(...parts);
  };

  return {
    async getFund(code) {
      // Normalized here rather than at each call site: this is the lookup every
      // fund tool starts from, and a listing ticker typed in lower case is the
      // ordinary case, not a malformed one.
      const [row] = await db
        .select()
        .from(funds)
        .where(eq(funds.code, normalizeFundCode(code)))
        .limit(1);
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

    async findFundsByStock(symbol, { limit, ...filter }) {
      // Only the newest report per fund counts; older quarters would double-list
      // a fund that has held the name for a year.
      const latest = db
        .select({
          fundCode: fundHoldings.fundCode,
          // Aliased away from `report_date`: drizzle emits a bare alias when a
          // `sql` column of a subquery is referenced, so sharing the name with
          // the real column makes the join predicate ambiguous and Postgres
          // rejects the whole statement at runtime.
          reportDate: sql<string>`max(${fundHoldings.reportDate})`.as("latest_report_date"),
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
        .where(and(eq(fundHoldings.symbol, symbol), fundFilter(filter)))
        .orderBy(desc(fundHoldings.weight))
        .limit(limit);

      return rows.map((row) => ({
        fund: row.fund,
        weight: row.weight,
        reportDate: row.reportDate,
      }));
    },

    async findFundsByHoldingCriteria(criteria) {
      const {
        limit,
        symbols,
        sectors,
        industries,
        countries,
        holdingMarkets,
        minMarketCapUsd,
        maxMarketCapUsd,
        ...filter
      } = criteria;

      // Only each fund's newest report counts; older ones would double-count a
      // position the fund has held for a year.
      const latest = db
        .select({
          fundCode: fundHoldings.fundCode,
          // See `findFundsByStock`: the alias must not collide with the real
          // column, or the join predicate is ambiguous.
          reportDate: sql<string>`max(${fundHoldings.reportDate})`.as("latest_report_date"),
        })
        .from(fundHoldings)
        .groupBy(fundHoldings.fundCode)
        .as("latest");

      const onLatest = and(
        eq(fundHoldings.fundCode, latest.fundCode),
        eq(fundHoldings.reportDate, latest.reportDate),
      );

      const conditions: (SQL | undefined)[] = [fundFilter(filter)];
      if (symbols !== undefined && symbols.length > 0) {
        conditions.push(inArray(fundHoldings.symbol, symbols));
      }
      if (countries !== undefined && countries.length > 0) {
        conditions.push(inArray(instruments.country, countries));
      }
      if (holdingMarkets !== undefined && holdingMarkets.length > 0) {
        conditions.push(inArray(instruments.market, holdingMarkets));
      }
      if (minMarketCapUsd !== undefined) {
        conditions.push(gte(instruments.marketCapUsd, minMarketCapUsd));
      }
      if (maxMarketCapUsd !== undefined) {
        conditions.push(lte(instruments.marketCapUsd, maxMarketCapUsd));
      }
      const sectorMatchers: SQL[] = [];
      if (sectors !== undefined && sectors.length > 0) {
        sectorMatchers.push(inArray(instrumentSectors.sectorCode, sectors));
      }
      if (industries !== undefined && industries.length > 0) {
        sectorMatchers.push(inArray(instrumentSectors.sectorName, industries));
      }
      if (sectorMatchers.length > 0) {
        conditions.push(
          sectorMatchers.length === 1 ? sectorMatchers[0] : or(...sectorMatchers),
        );
      }

      const matchedWeight = sql<number>`sum(${fundHoldings.weight})`;
      const rows = await db
        .select({
          fund: funds,
          matchedWeight: matchedWeight.mapWith(Number),
          positions: sql<number>`count(*)`.mapWith(Number),
          reportDate: fundHoldings.reportDate,
        })
        .from(fundHoldings)
        .innerJoin(latest, onLatest)
        .innerJoin(funds, eq(funds.code, fundHoldings.fundCode))
        .innerJoin(instruments, eq(instruments.symbol, fundHoldings.symbol))
        // Left, not inner: a size or country filter must still work on a
        // position whose sector Yahoo never returned.
        .leftJoin(
          instrumentSectors,
          and(
            eq(instrumentSectors.symbol, fundHoldings.symbol),
            eq(instrumentSectors.taxonomy, "gics"),
          ),
        )
        .where(and(...conditions))
        // `funds.code` is the primary key, so Postgres allows the whole row
        // alongside the aggregates.
        .groupBy(funds.code, fundHoldings.reportDate)
        .orderBy(desc(matchedWeight))
        .limit(limit);

      if (rows.length === 0) return [];

      // The denominator, fetched only for the funds that survived: a matched
      // weight of 30% means something different in a book that discloses 62%
      // than in one that discloses all of it.
      const codes = rows.map((row) => row.fund.code);
      const totals = await db
        .select({
          fundCode: fundHoldings.fundCode,
          disclosed: sql<number>`sum(${fundHoldings.weight})`.mapWith(Number),
        })
        .from(fundHoldings)
        .innerJoin(latest, onLatest)
        .where(inArray(fundHoldings.fundCode, codes))
        .groupBy(fundHoldings.fundCode);
      const disclosedBy = new Map(totals.map((row) => [row.fundCode, row.disclosed]));

      return rows.map((row) => ({
        fund: row.fund,
        matchedWeight: row.matchedWeight,
        positions: row.positions,
        disclosedWeight: disclosedBy.get(row.fund.code) ?? row.matchedWeight,
        reportDate: row.reportDate,
      }));
    },

    async findFundsBySector({ taxonomy, keys, labels, markets, limit, ...filter }) {
      const matchers: SQL[] = [];
      if (keys.length > 0) matchers.push(inArray(fundExposure.key, keys));
      if (labels.length > 0) matchers.push(inArray(fundExposure.label, labels));
      if (matchers.length === 0) return [];

      const conditions: (SQL | undefined)[] = [
        eq(fundExposure.dimension, "sector"),
        matchers.length === 1 ? matchers[0] : or(...matchers),
        fundFilter(filter),
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

    async findFundsByMarketExposure(markets, { limit, ...filter }) {
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
            fundFilter(filter),
          ),
        )
        .orderBy(desc(fundExposure.weight))
        .limit(limit);
      return rows;
    },

    async findFundsByTrackingIndex(patterns, { limit, ...filter }) {
      if (patterns.length === 0) return [];
      const conditions = patterns.map(
        (pattern) => sql`${funds.trackingIndex} ilike ${`%${pattern}%`}`,
      );
      return db
        .select()
        .from(funds)
        .where(and(or(...conditions), fundFilter(filter)))
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
      const columns = { symbol: instruments.symbol, name: instruments.name };
      const [exact] = await db
        .select(columns)
        .from(instruments)
        .where(eq(instruments.symbol, query))
        .limit(1);
      if (exact) return exact;

      // An ISIN before a name: it is an exact identifier, and a caller holding
      // one from another system has no way to guess this index's symbol for it.
      const upper = query.trim().toUpperCase();
      if (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(upper)) {
        const [byIsin] = await db
          .select(columns)
          .from(instruments)
          .where(eq(instruments.isin, upper))
          .limit(1);
        if (byIsin) return byIsin;
      }

      const [byName] = await db
        .select(columns)
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
