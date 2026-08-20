import { describe, expect, it, vi } from "vitest";
import { FUND_INDEX_FRESHNESS_MS } from "../../shared/funds.js";
import type { db as Database } from "../db/index.js";
import type { FundIndexState } from "../db/schema.js";

/**
 * The index refresh runs on boot, unattended, against sources that go down.
 * Every case here is one that would otherwise be discovered in production: a
 * restart loop re-downloading 27,000 funds, a failed listing buying itself a
 * day of silence, or an empty index quietly staying empty.
 */

const mocks = vi.hoisted(() => ({
  ingestFundUniverse: vi.fn(async () => ({ fundsUpserted: 27_541 })),
}));

vi.mock("./ingest.js", () => ({ ingestFundUniverse: mocks.ingestFundUniverse }));
vi.mock("./providers/index.js", () => ({ getProvider: (id: string) => ({ id }) }));

const { refreshFundIndex, seedEmptyFundIndexes } = await import("./universe.js");

const NOW = Date.parse("2026-08-19T12:00:00Z");

function state(overrides: Partial<FundIndexState> = {}): FundIndexState {
  return {
    provider: "eastmoney",
    fundCount: 27_000,
    syncedAt: new Date(NOW),
    lastError: null,
    ...overrides,
  };
}

/** Captures what the refresh writes, and serves one stored watermark row. */
function fakeDb(stored?: FundIndexState) {
  const writes: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (stored ? [stored] : []) }) }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          writes.push(values);
        },
      }),
    }),
  } as unknown as typeof Database;
  return { db, writes };
}

describe("refreshFundIndex", () => {
  it("downloads the index when there is none", async () => {
    mocks.ingestFundUniverse.mockClear();
    const { db } = fakeDb();

    const result = await refreshFundIndex(db, "eastmoney", { now: NOW });

    expect(mocks.ingestFundUniverse).toHaveBeenCalledOnce();
    expect(result).toEqual({ provider: "eastmoney", funds: 27_541, refreshed: true });
  });

  it("leaves a still-fresh index alone, so a restart loop costs nothing upstream", async () => {
    mocks.ingestFundUniverse.mockClear();
    const { db } = fakeDb(state({ syncedAt: new Date(NOW - 60_000) }));

    const result = await refreshFundIndex(db, "eastmoney", { now: NOW });

    expect(mocks.ingestFundUniverse).not.toHaveBeenCalled();
    expect(result).toEqual({ provider: "eastmoney", funds: 27_000, refreshed: false });
  });

  it("refreshes once the index has aged out", async () => {
    mocks.ingestFundUniverse.mockClear();
    const stale = new Date(NOW - FUND_INDEX_FRESHNESS_MS - 1);
    const { db } = fakeDb(state({ syncedAt: stale }));

    const result = await refreshFundIndex(db, "eastmoney", { now: NOW });

    expect(mocks.ingestFundUniverse).toHaveBeenCalledOnce();
    expect(result.refreshed).toBe(true);
  });

  it("refreshes a fresh index when forced", async () => {
    mocks.ingestFundUniverse.mockClear();
    const { db } = fakeDb(state({ syncedAt: new Date(NOW) }));

    const result = await refreshFundIndex(db, "eastmoney", { now: NOW, force: true });

    expect(mocks.ingestFundUniverse).toHaveBeenCalledOnce();
    expect(result.refreshed).toBe(true);
  });

  it("records a failure without advancing the watermark", async () => {
    mocks.ingestFundUniverse.mockClear();
    mocks.ingestFundUniverse.mockRejectedValueOnce(new Error("upstream 503"));
    const previous = new Date(NOW - FUND_INDEX_FRESHNESS_MS - 1);
    const { db, writes } = fakeDb(state({ syncedAt: previous }));

    const result = await refreshFundIndex(db, "eastmoney", { now: NOW });

    expect(result).toEqual({
      provider: "eastmoney",
      funds: 27_000,
      refreshed: false,
      error: "upstream 503",
    });
    // Advancing `synced_at` here would skip the retry for a full window.
    expect(writes[0]).toMatchObject({ syncedAt: previous, lastError: "upstream 503" });
  });

  it("backdates a first-ever failure so the next boot retries immediately", async () => {
    mocks.ingestFundUniverse.mockClear();
    mocks.ingestFundUniverse.mockRejectedValueOnce(new Error("dns"));
    const { db, writes } = fakeDb();

    const result = await refreshFundIndex(db, "eastmoney", { now: NOW });

    expect(result.funds).toBe(0);
    expect(writes[0]).toMatchObject({ syncedAt: new Date(0), lastError: "dns" });
  });
});

/** Serves the whole `fund_index_state` table for the seeding check. */
function fakeTable(rows: FundIndexState[]) {
  const db = {
    select: () => {
      const result = Promise.resolve(rows) as Promise<FundIndexState[]> & {
        from: () => typeof result;
        where: () => { limit: () => Promise<FundIndexState[]> };
      };
      result.from = () => result;
      result.where = () => ({
        limit: async () => rows.filter((row) => row.provider === "ishares"),
      });
      return result;
    },
    insert: () => ({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
    }),
  } as unknown as typeof Database;
  return db;
}

describe("seedEmptyFundIndexes", () => {
  it("loads an index nobody has ever managed to fetch", async () => {
    // The state a fund lookup cannot tell from a bad code: iShares has a
    // watermark row saying it holds nothing, so the answer to "cache IVV" was
    // "no such fund" forever.
    mocks.ingestFundUniverse.mockClear();
    const db = fakeTable([
      state({ provider: "eastmoney", fundCount: 27_000 }),
      state({ provider: "ishares", fundCount: 0, syncedAt: new Date(0) }),
    ]);

    const results = await seedEmptyFundIndexes(db, { now: NOW });

    expect(results.map((result) => result.provider)).toEqual(["ishares"]);
    expect(mocks.ingestFundUniverse).toHaveBeenCalledOnce();
  });

  it("does nothing when every index has funds in it", async () => {
    mocks.ingestFundUniverse.mockClear();
    const db = fakeTable([
      state({ provider: "eastmoney", fundCount: 27_000 }),
      state({ provider: "ishares", fundCount: 412 }),
    ]);

    expect(await seedEmptyFundIndexes(db, { now: NOW })).toEqual([]);
    expect(mocks.ingestFundUniverse).not.toHaveBeenCalled();
  });
});
