import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { db as Database } from "../db/index.js";
import { createFundRepo } from "./repo.js";

/**
 * Guards the generated SQL, not its results.
 *
 * The repo's queries typecheck whatever they emit, and every other test here
 * mocks the repo away — so a statement Postgres rejects at parse time passes
 * the whole suite and fails in production on the first call. That is exactly
 * what happened: `max(report_date) as "report_date"` in the latest-report
 * subquery made the join predicate `fund_holdings.report_date = report_date`,
 * which Postgres refuses as ambiguous. `fundsByStock`, the tool the reverse
 * index exists for, was dead on every invocation.
 *
 * These assertions are deliberately about the shape of the SQL. Anything
 * needing real semantics belongs in a test with a database behind it.
 */

/**
 * A drizzle instance over a client that records SQL instead of running it.
 *
 * node-postgres is called with a query config object rather than a string, so
 * the text comes off `.text`.
 */
function recordingDb() {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (config: { text: string }) => {
      queries.push(config.text);
      return { rows: [], rowCount: 0 };
    }),
  };
  return { db: drizzle(client as never) as unknown as typeof Database, queries };
}

describe("latest-report subquery", () => {
  it("qualifies the aggregated report date in findFundsByStock", async () => {
    const { db, queries } = recordingDb();
    await createFundRepo(db).findFundsByStock("NVDA", { limit: 10 });

    const sql = queries[0] ?? "";
    expect(sql).toContain('"latest_report_date"');
    // The regression: an unqualified `= "report_date"` is the ambiguous form.
    expect(sql).not.toMatch(/=\s*"report_date"/);
  });

  it("qualifies it in findFundsByHoldingCriteria too", async () => {
    const { db, queries } = recordingDb();
    await createFundRepo(db).findFundsByHoldingCriteria({
      sectors: ["Technology"],
      limit: 10,
    });

    const sql = queries[0] ?? "";
    expect(sql).toContain('"latest_report_date"');
    expect(sql).not.toMatch(/=\s*"report_date"/);
  });

  it("groups the criteria query by the fund primary key", async () => {
    // Postgres allows selecting every `funds` column alongside the aggregates
    // only because the grouping key is the table's primary key.
    const { db, queries } = recordingDb();
    await createFundRepo(db).findFundsByHoldingCriteria({ symbols: ["NVDA"], limit: 5 });

    expect(queries[0]).toContain('group by "funds"."code"');
  });

  it("left-joins the sector table so a size filter survives an unclassified position", async () => {
    const { db, queries } = recordingDb();
    await createFundRepo(db).findFundsByHoldingCriteria({ minMarketCapUsd: 1e10, limit: 5 });

    expect(queries[0]).toContain('left join "instrument_sectors"');
    expect(queries[0]).toContain('"instruments"."market_cap_usd"');
  });
});
