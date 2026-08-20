import { describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "../../shared/funds.js";
import type { db as Database } from "../db/index.js";
import { ingestFundDetails, ingestFundUniverse } from "./ingest.js";
import type { FundDetails, FundProvider } from "./provider.js";

/**
 * Regression cover for the gap that shipped in the first version: every tool
 * read `funds.tracking_index` and nothing ever wrote it, so the index-tracking
 * route — the highest-confidence path from a theme to a fund — silently
 * returned nothing. Mocking the repo could not catch that; only asserting on
 * what the ingest writes can.
 */

function details(overrides: Partial<FundDetails> = {}): FundDetails {
  return {
    name: "国泰纳斯达克100ETF",
    fundType: "国际(QDII)",
    trackingIndex: "纳斯达克100指数",
    company: "国泰基金",
    manager: "某某某",
    feeRate: 0.8,
    fundSize: 12345,
    listedSymbol: null,
    isIndexFund: true,
    investsOffshore: null,
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

function fakeProvider(result: FundDetails | Error): FundProvider {
  return {
    id: "eastmoney",
    descriptor: PROVIDERS.eastmoney,
    requestIntervalMs: 0,
    requestsPerFund: 3,
    listUniverse: vi.fn(async () => []),
    fetchDetails: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    fetchHoldings: vi.fn(async () => ({ entries: [], dropped: 0 })),
    fetchNav: vi.fn(async () => []),
    scopeFilter: () => undefined,
  };
}

describe("ingestFundDetails", () => {
  it("writes the tracking index onto the fund row", async () => {
    const { db, writes } = fakeDb();
    const summary = await ingestFundDetails(db, fakeProvider(details()), ["513100"]);

    expect(summary.fundDetailsUpserted).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      trackingIndex: "纳斯达克100指数",
      isIndexFund: true,
      company: "国泰基金",
      feeRate: 0.8,
      fundSize: 12345,
    });
  });

  it("leaves the index flag alone when the provider cannot tell", async () => {
    // `null` means "this source does not know", which must not be written as
    // `false` over what the universe step already worked out.
    const { db, writes } = fakeDb();
    await ingestFundDetails(db, fakeProvider(details({ isIndexFund: null })), ["005827"]);

    expect(writes[0]).not.toHaveProperty("isIndexFund");
  });

  it("keeps the existing name when the profile page has none", async () => {
    const { db, writes } = fakeDb();
    await ingestFundDetails(db, fakeProvider(details({ name: null, fundType: null })), ["513100"]);

    // Overwriting a good name from the universe list with null would be a regression.
    expect(writes[0]).not.toHaveProperty("name");
    expect(writes[0]).not.toHaveProperty("fundType");
  });

  it("records a per-fund failure without aborting the run", async () => {
    const { db, writes } = fakeDb();
    const summary = await ingestFundDetails(db, fakeProvider(new Error("503")), ["513100"]);

    expect(writes).toHaveLength(0);
    expect(summary.fundDetailsUpserted).toBe(0);
    expect(summary.errors).toEqual(["details 513100: 503"]);
  });
});

describe("ingestFundUniverse", () => {
  it("refuses to record an empty listing as a loaded index", async () => {
    // No provider publishes zero funds, so an empty list is a block or a
    // format change. Stored as a success it wrote "0 funds, no error, synced
    // just now", which then answered every request for one of that provider's
    // funds with "not in the fund universe index" for a full day — the exact
    // shape of "caching iShares ETFs never worked".
    const { db, writes } = fakeDb();

    await expect(ingestFundUniverse(db, fakeProvider(details()))).rejects.toThrow(
      /empty fund index/,
    );
    expect(writes).toHaveLength(0);
  });
});
