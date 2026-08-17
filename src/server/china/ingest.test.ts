import { describe, expect, it, vi } from "vitest";
import type { db as Database } from "../db/index.js";
import type { EastmoneyClient } from "./eastmoney.js";
import { ingestFundDetails } from "./ingest.js";
import type { FundBasics } from "./parse.js";

/**
 * Regression cover for the gap that shipped in the first version: every tool
 * read `funds.tracking_index` and nothing ever wrote it, so the index-tracking
 * route — the highest-confidence path from a theme to a fund — silently
 * returned nothing. Mocking the repo could not catch that; only asserting on
 * what the ingest writes can.
 */

function basics(overrides: Partial<FundBasics> = {}): FundBasics {
  return {
    code: "513100",
    name: "国泰纳斯达克100ETF",
    fundType: "国际(QDII)",
    trackingIndex: "纳斯达克100指数",
    company: "国泰基金",
    manager: "某某某",
    feeRate: 0.8,
    fundSize: 123.45,
    ...overrides,
  };
}

/** Captures the values passed to `db.update(funds).set(...)`. */
function fakeDb() {
  const writes: Record<string, unknown>[] = [];
  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          writes.push(values);
        },
      }),
    }),
  } as unknown as typeof Database;
  return { db, writes };
}

function fakeClient(result: FundBasics | Error) {
  return {
    fetchFundBasics: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as EastmoneyClient;
}

describe("ingestFundDetails", () => {
  it("writes the tracking index onto the fund row", async () => {
    const { db, writes } = fakeDb();
    const summary = await ingestFundDetails(db, fakeClient(basics()), ["513100"]);

    expect(summary.fundDetailsUpserted).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      trackingIndex: "纳斯达克100指数",
      isIndexFund: true,
      company: "国泰基金",
      feeRate: 0.8,
      fundSize: 123.45,
    });
  });

  it("marks a fund without a mandate as not index-tracking", async () => {
    const { db, writes } = fakeDb();
    await ingestFundDetails(db, fakeClient(basics({ trackingIndex: null })), ["005827"]);

    expect(writes[0]).toMatchObject({ trackingIndex: null, isIndexFund: false });
  });

  it("keeps the existing name when the profile page has none", async () => {
    const { db, writes } = fakeDb();
    await ingestFundDetails(db, fakeClient(basics({ name: null, fundType: null })), ["513100"]);

    // Overwriting a good name from the universe list with null would be a regression.
    expect(writes[0]).not.toHaveProperty("name");
    expect(writes[0]).not.toHaveProperty("fundType");
  });

  it("records a per-fund failure without aborting the run", async () => {
    const { db, writes } = fakeDb();
    const summary = await ingestFundDetails(db, fakeClient(new Error("503")), ["513100"]);

    expect(writes).toHaveLength(0);
    expect(summary.fundDetailsUpserted).toBe(0);
    expect(summary.errors).toEqual(["basics 513100: 503"]);
  });
});
