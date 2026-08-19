import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { db as Database } from "../db/index.js";
import * as schema from "../db/schema.js";
import { createFundRepo } from "./repo.js";

/**
 * Executes every repo query against a real Postgres.
 *
 * The gap this closes: the queries typecheck whatever they emit, and the tool
 * tests mock the repo away, so a statement Postgres rejects at parse time
 * passes the entire suite. One did — the latest-report subquery aliased its
 * aggregate to `report_date`, which made the join predicate ambiguous, and
 * `fundsByStock` failed on every call in production while every test was green.
 * `repo-sql.test.ts` pins that specific shape without a database; this pins the
 * rest of them by actually running them.
 *
 * Skipped unless `DATABASE_URL` is set, so the default suite stays offline.
 * Everything runs inside a transaction that is always rolled back, so pointing
 * it at a populated database is safe.
 */

const connectionString = process.env.DATABASE_URL;

class Rollback extends Error {}

describe.skipIf(connectionString === undefined)("repo queries against Postgres", () => {
  it("executes every query, with every filter combination, without a SQL error", async () => {
    const pool = new pg.Pool({ connectionString });
    const db = drizzle(pool, { schema });

    try {
      await expect(
        db.transaction(async (tx) => {
          const repo = createFundRepo(tx as unknown as typeof Database);
          const { funds, instruments, instrumentSectors, fundHoldings, fundExposure } = schema;

          await tx.insert(funds).values([
            {
              code: "TEST-CN",
              provider: "eastmoney",
              market: "CN",
              currency: "CNY",
              name: "Test QDII",
              investsOffshore: true,
              isIndexFund: true,
              trackingIndex: "纳斯达克100",
              holdingsCompleteness: "top_holdings",
              providerMeta: {},
            },
            {
              code: "TEST-US",
              provider: "ishares",
              market: "US",
              currency: "USD",
              name: "Test ETF",
              investsOffshore: false,
              isIndexFund: true,
              trackingIndex: "S&P 500",
              holdingsCompleteness: "full",
              providerMeta: {},
            },
          ]);
          await tx.insert(instruments).values({
            symbol: "TEST.NV",
            isin: "ZZ9999999990",
            name: "Test Instrument",
            market: "US",
            currency: "USD",
            country: "United States",
            marketCap: 1e12,
            marketCapUsd: 1e12,
            profileSyncedAt: new Date(),
          });
          await tx.insert(instrumentSectors).values({
            symbol: "TEST.NV",
            taxonomy: "gics",
            sectorCode: "Technology",
            sectorName: "Semiconductors",
          });
          await tx.insert(fundHoldings).values([
            { fundCode: "TEST-CN", symbol: "TEST.NV", weight: 5, reportDate: "2025-12-31" },
            { fundCode: "TEST-CN", symbol: "TEST.NV", weight: 12, reportDate: "2026-03-31" },
            { fundCode: "TEST-US", symbol: "TEST.NV", weight: 7, reportDate: "2026-08-15" },
          ]);
          await tx.insert(fundExposure).values([
            { fundCode: "TEST-CN", dimension: "sector", taxonomy: "gics", key: "Technology", label: "Semiconductors", weight: 12, coverage: 1, reportDate: "2026-03-31" },
            { fundCode: "TEST-CN", dimension: "market", taxonomy: "", key: "US", label: "US", weight: 12, coverage: 1, reportDate: "2026-03-31" },
          ]);

          const filters = { domiciles: ["CN"], offshoreOnly: true, providers: ["eastmoney" as const] };

          // Each entry is one statement that has to survive Postgres's parser.
          await repo.getFund("TEST-CN");
          await repo.getNavSeries("TEST-CN", { from: "2026-01-01", to: "2026-08-01", limit: 10 });
          await repo.getExposure("TEST-CN");
          await repo.getHoldings("TEST-CN");
          await repo.getHoldings("TEST-CN", "2026-03-31");
          await repo.listReportDates("TEST-CN");
          await repo.findFundsByStock("TEST.NV", { limit: 5 });
          await repo.findFundsByStock("TEST.NV", { limit: 5, ...filters });
          await repo.findFundsBySector({ keys: ["Technology"], labels: ["Semiconductors"], limit: 5 });
          await repo.findFundsBySector({ keys: ["Technology"], labels: [], markets: ["US"], limit: 5, ...filters });
          await repo.findFundsByHoldingCriteria({ symbols: ["TEST.NV"], limit: 5 });
          await repo.findFundsByHoldingCriteria({
            sectors: ["Technology"],
            industries: ["Semiconductors"],
            countries: ["United States"],
            holdingMarkets: ["US"],
            minMarketCapUsd: 1e9,
            maxMarketCapUsd: 1e13,
            limit: 5,
            ...filters,
          });
          await repo.findFundsByTrackingIndex(["S&P"], { limit: 5 });
          await repo.findFundsByTrackingIndex(["S&P"], { limit: 5, domiciles: ["US"] });
          await repo.findFundsByMarketExposure(["US"], { limit: 5 });
          await repo.findFundsByMarketExposure(["US"], { limit: 5, ...filters });
          await repo.getExposureVectors(["TEST-CN", "TEST-US"]);
          await repo.similarityCandidates("TEST-CN", 20);
          await repo.resolveSymbol("TEST.NV");
          await repo.resolveSymbol("ZZ9999999990");
          await repo.resolveSymbol("Test Instrument");

          // Results, not just parseability: the reverse index has to span
          // providers and use each fund's newest report only.
          const holders = await repo.findFundsByStock("TEST.NV", { limit: 5 });
          expect(holders.map((match) => match.fund.provider).sort()).toEqual([
            "eastmoney",
            "ishares",
          ]);
          expect(holders.find((match) => match.fund.code === "TEST-CN")?.weight).toBe(12);

          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
    } finally {
      await pool.end();
    }
  }, 30_000);
});
