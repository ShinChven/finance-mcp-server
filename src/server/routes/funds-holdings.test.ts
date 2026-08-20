import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, or, sql } from "drizzle-orm";
import pg from "pg";
import type { db as Database } from "../db/index.js";
import * as schema from "../db/schema.js";
import { currentlyHolds, holdingsCoverage, matchedHoldings } from "./funds-holdings.js";

/**
 * Runs the fund list's holdings queries against a real Postgres.
 *
 * They are raw enough SQL that typechecking proves nothing about them — the
 * correlated latest-report subquery is the same shape that once shipped
 * ambiguous and failed on every call with a green suite behind it (see
 * `funds/repo-sql.test.ts`). These assertions are about results rather than
 * SQL text, because the bugs being pinned here are semantic: a holdings count
 * summed across cached quarters, and a search that answers "who has ever held
 * this" when the question was "who holds it".
 *
 * Skipped unless `DATABASE_URL` is set, so the default suite stays offline.
 * Everything runs inside a transaction that is always rolled back, so pointing
 * it at a populated database is safe.
 */

const connectionString = process.env.DATABASE_URL;

class Rollback extends Error {}

const fund = (code: string, name: string) => ({
  code,
  provider: "eastmoney" as const,
  market: "CN",
  currency: "CNY",
  name,
  holdingsCompleteness: "top_holdings" as const,
  providerMeta: {},
  holdingsSyncedAt: new Date(),
});

describe.skipIf(connectionString === undefined)("fund list holdings queries", () => {
  it("counts and matches only the latest disclosed report", async () => {
    const pool = new pg.Pool({ connectionString });
    const db = drizzle(pool, { schema });

    try {
      await expect(
        db.transaction(async (tx) => {
          const scoped = tx as unknown as typeof Database;
          const { funds, fundHoldings, instruments } = schema;

          await tx.insert(funds).values([
            fund("T-QUARTERS", "Four cached quarters"),
            fund("T-HOLDS", "Holds it now"),
            fund("T-SOLD", "Sold it in 2022"),
            fund("T-BYNAME", "Matches through the instrument name"),
          ]);

          // Twenty names, disclosed four times. The fund holds 20, not 80.
          await tx.insert(fundHoldings).values(
            ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"].flatMap((reportDate) =>
              Array.from({ length: 20 }, (_, i) => ({
                fundCode: "T-QUARTERS",
                symbol: `T${i}`,
                name: `Test ${i}`,
                weight: 3,
                reportDate,
              })),
            ),
          );
          await tx.insert(fundHoldings).values([
            // Two reports, both holding NVDA: the older weight must not win.
            { fundCode: "T-HOLDS", symbol: "ZQTEST", name: "泽奇科技", weight: 18.05, reportDate: "2025-12-31" },
            { fundCode: "T-HOLDS", symbol: "YBTEST", name: "宜柏电子", weight: 9.1, reportDate: "2025-12-31" },
            { fundCode: "T-HOLDS", symbol: "ZQTEST", name: "泽奇科技", weight: 11, reportDate: "2025-06-30" },
            // Held it once, and has since rotated out of it.
            { fundCode: "T-SOLD", symbol: "ZQTEST", name: "泽奇科技", weight: 7.4, reportDate: "2022-12-31" },
            { fundCode: "T-SOLD", symbol: "WQTEST", name: "万奇软件", weight: 8.2, reportDate: "2025-12-31" },
            // Undisclosed holding name — only the instrument row can match it.
            { fundCode: "T-BYNAME", symbol: "ZQTEST", weight: 5.55, reportDate: "2025-09-30" },
          ]);
          // Invented symbols throughout: a real one (NVDA) already has an
          // `instruments` row on a populated database, and this test needs to
          // own the name it searches for.
          await tx
            .insert(instruments)
            .values({ symbol: "ZQTEST", name: "Zqtest Corporation", market: "US" });

          const coverage = holdingsCoverage(scoped);
          const counts = await tx
            .select({ code: funds.code, n: coverage.n, reportDate: coverage.reportDate })
            .from(funds)
            .leftJoin(coverage, eq(coverage.fundCode, funds.code))
            .where(sql`${funds.code} like 'T-%'`);
          const byCode = new Map(counts.map((row) => [row.code, row]));

          // The bug this pins: four cached quarters read as 80 holdings.
          expect(byCode.get("T-QUARTERS")).toMatchObject({ n: 20, reportDate: "2025-12-31" });
          // The report date is the fund's disclosure, not when it was cached.
          expect(byCode.get("T-BYNAME")).toMatchObject({ n: 1, reportDate: "2025-09-30" });

          const search = async (q: string) => {
            const rows = await tx
              .select({ code: funds.code })
              .from(funds)
              .where(and(sql`${funds.code} like 'T-%'`, or(currentlyHolds(q))))
              .orderBy(funds.code);
            return rows.map((row) => row.code);
          };

          expect(await search("ZQTEST")).toEqual(["T-BYNAME", "T-HOLDS"]);
          // Chinese holding names are searchable, and reach only the discloser.
          expect(await search("泽奇")).toEqual(["T-HOLDS"]);
          // Via `instruments.name`, for the fund that disclosed no name itself.
          expect(await search("zqtest corporation")).toEqual(["T-BYNAME", "T-HOLDS"]);
          // The whole point of restricting to the latest report.
          expect(await search("ZQTEST")).not.toContain("T-SOLD");
          expect(await search("WQTEST")).toEqual(["T-SOLD"]);

          const matched = await matchedHoldings(
            scoped,
            ["T-HOLDS", "T-BYNAME", "T-SOLD"],
            "ZQTEST",
          );
          // The current weight, not the one from the report it also appears in.
          expect(matched.get("T-HOLDS")).toEqual({
            symbol: "ZQTEST",
            name: "泽奇科技",
            weight: 18.05,
            reportDate: "2025-12-31",
          });
          expect(matched.get("T-BYNAME")?.name).toBeNull();
          // Nothing to explain: it does not hold the name any more.
          expect(matched.has("T-SOLD")).toBe(false);

          throw new Rollback();
        }),
      ).rejects.toThrow(Rollback);
    } finally {
      await pool.end();
    }
  });
});
