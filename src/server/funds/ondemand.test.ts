import { describe, expect, it, vi } from "vitest";
import type { db as Database } from "../db/index.js";
import type { YahooFinanceClient } from "../mcp/client.js";
import type { Fund } from "../db/schema.js";

/**
 * The on-demand path is where a user meets a fund for the first time, and it
 * used to report success no matter what the upstream did.
 *
 * Every ingest step collects its per-fund failures into a summary instead of
 * throwing — that is what lets a category run survive one dead fund — and this
 * caller dropped that summary on the floor, then read an error column only the
 * batch runner ever wrote. So a US ETF whose holdings download was blocked came
 * back as "Cached fund IVV (details, holdings, nav) on demand.", the tool
 * rendered an empty portfolio, and nothing anywhere said the fetch had failed.
 * These tests pin the honest answers.
 */

const mocks = vi.hoisted(() => ({
  ingestFundDetails: vi.fn(),
  ingestHoldings: vi.fn(),
  ingestNav: vi.fn(),
  ingestInstrumentProfiles: vi.fn(async () => ({})),
  countStaleInstrumentProfiles: vi.fn(async () => 0),
  recomputeExposure: vi.fn(async () => ({})),
  seedEmptyFundIndexes: vi.fn(async (): Promise<{ provider: string; funds: number; refreshed: boolean }[]> => []),
}));

vi.mock("./ingest.js", () => ({
  emptySummary: () => ({ errors: [], symbolsClassified: 0 }),
  ingestFundDetails: mocks.ingestFundDetails,
  ingestHoldings: mocks.ingestHoldings,
  ingestNav: mocks.ingestNav,
  ingestInstrumentProfiles: mocks.ingestInstrumentProfiles,
  countStaleInstrumentProfiles: mocks.countStaleInstrumentProfiles,
  recomputeExposure: mocks.recomputeExposure,
}));
vi.mock("./providers/index.js", () => ({ getProvider: (id: string) => ({ id }) }));
vi.mock("./universe.js", () => ({ seedEmptyFundIndexes: mocks.seedEmptyFundIndexes }));

const { createFundCache } = await import("./ondemand.js");

type Watermarks = Pick<Fund, "detailsSyncedAt" | "holdingsSyncedAt" | "navSyncedAt">;

function fundRow(overrides: Partial<Fund> = {}): Fund {
  return {
    code: "IVV",
    provider: "ishares",
    detailsSyncedAt: null,
    holdingsSyncedAt: null,
    navSyncedAt: null,
    lastSyncError: null,
    ...overrides,
  } as Fund;
}

/**
 * Serves the fund row, then the watermarks the steps left behind, and records
 * every `update(funds).set(...)`. `selects` counts the row lookups so the index
 * seeding can be observed.
 */
function fakeDb(rows: (Fund | undefined)[], landed: (keyof Watermarks)[]) {
  const updates: Record<string, unknown>[] = [];
  const queue = [...rows];
  let lookups = 0;
  const db = {
    select: (columns?: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            // The watermark read asks for three named columns; the fund lookup
            // selects the whole row. Stamped at read time, because "landed"
            // means the step wrote it during this call.
            if (columns !== undefined) {
              const now = new Date();
              return [
                {
                  detailsSyncedAt: landed.includes("detailsSyncedAt") ? now : null,
                  holdingsSyncedAt: landed.includes("holdingsSyncedAt") ? now : null,
                  navSyncedAt: landed.includes("navSyncedAt") ? now : null,
                },
              ];
            }
            lookups += 1;
            const row = queue.shift();
            return row === undefined ? [] : [row];
          },
        }),
      }),
    }),
    selectDistinct: () => ({ from: () => ({ where: async () => [] }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
  } as unknown as typeof Database;
  return { db, updates, lookupCount: () => lookups };
}

const yahoo = {} as YahooFinanceClient;

function stepThatLands(step: "details" | "holdings" | "nav") {
  return vi.fn(async () => ({ step }));
}

function stepThatFails(message: string) {
  return vi.fn(
    async (
      _db: unknown,
      _provider: unknown,
      _codes: string[],
      summary: { errors: string[] },
    ) => {
      summary.errors.push(message);
    },
  );
}

function resetSteps() {
  mocks.ingestFundDetails.mockReset().mockImplementation(stepThatLands("details"));
  mocks.ingestHoldings.mockReset().mockImplementation(stepThatLands("holdings"));
  mocks.ingestNav.mockReset().mockImplementation(stepThatLands("nav"));
  mocks.seedEmptyFundIndexes.mockClear().mockResolvedValue([]);
}

const LANDED: (keyof Watermarks)[] = [
  "detailsSyncedAt",
  "holdingsSyncedAt",
  "navSyncedAt",
];
const NOTHING_LANDED: (keyof Watermarks)[] = [];

describe("fund cache ensure", () => {
  it("reports a failed fetch as failed, with the upstream's reason", async () => {
    resetSteps();
    mocks.ingestHoldings.mockImplementation(
      stepThatFails("holdings IVV: iShares request failed (403)"),
    );
    mocks.ingestFundDetails.mockImplementation(
      stepThatFails("details IVV: iShares request failed (403)"),
    );
    const { db } = fakeDb([fundRow()], NOTHING_LANDED);

    const result = await createFundCache(db, yahoo).ensure("IVV", {
      steps: ["details", "holdings"],
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("403");
    expect(result.message).toContain("Could not cache fund IVV");
    expect(result.fetched).toEqual([]);
  });

  it("records the failure on the fund row, where the console reads it", async () => {
    resetSteps();
    mocks.ingestNav.mockImplementation(stepThatFails("nav IVV: Yahoo timed out"));
    mocks.ingestHoldings.mockImplementation(stepThatFails("holdings IVV: blocked"));
    mocks.ingestFundDetails.mockImplementation(stepThatFails("details IVV: blocked"));
    const { db, updates } = fakeDb([fundRow()], NOTHING_LANDED);

    await createFundCache(db, yahoo).ensure("IVV");

    expect(updates.at(-1)).toMatchObject({
      lastSyncError: expect.stringContaining("blocked") as unknown as string,
    });
  });

  it("clears a stale failure once the fetch works", async () => {
    resetSteps();
    const { db, updates } = fakeDb([fundRow({ lastSyncError: "yesterday's 503" })], LANDED);

    const result = await createFundCache(db, yahoo).ensure("IVV", { classify: false });

    expect(result.status).toBe("cached");
    expect(result.error).toBeUndefined();
    expect(updates.at(-1)).toMatchObject({ lastSyncError: null });
  });

  it("names only the steps that actually landed", async () => {
    resetSteps();
    mocks.ingestNav.mockImplementation(stepThatFails("nav IVV: Yahoo timed out"));
    const { db } = fakeDb([fundRow()], ["detailsSyncedAt", "holdingsSyncedAt"]);

    const result = await createFundCache(db, yahoo).ensure("IVV", { classify: false });

    // Partial, and said so: the caller can tell an empty NAV series caused by a
    // failed fetch from a fund that simply has none.
    expect(result.status).toBe("cached");
    expect(result.fetched).toEqual(["details", "holdings"]);
    expect(result.message).toContain("nav failed");
  });

  it("treats a lower-case ticker as the same fund", async () => {
    resetSteps();
    const { db } = fakeDb([fundRow()], LANDED);

    const result = await createFundCache(db, yahoo).ensure("ivv", { classify: false });

    expect(result.code).toBe("IVV");
    expect(result.status).toBe("cached");
  });

  it("loads an index that has never landed before calling a code unknown", async () => {
    resetSteps();
    // First lookup misses, the index is seeded, the retry finds the fund.
    mocks.seedEmptyFundIndexes.mockResolvedValue([
      { provider: "ishares", funds: 400, refreshed: true },
    ]);
    const { db, lookupCount } = fakeDb([undefined, fundRow()], LANDED);

    const result = await createFundCache(db, yahoo).ensure("IVV", { classify: false });

    expect(mocks.seedEmptyFundIndexes).toHaveBeenCalledOnce();
    expect(lookupCount()).toBe(2);
    expect(result.status).toBe("cached");
  });

  it("does not re-list the universe for every unknown code", async () => {
    resetSteps();
    const { db } = fakeDb([undefined, undefined, undefined, undefined], LANDED);
    const cache = createFundCache(db, yahoo);

    const first = await cache.ensure("NOPE1");
    const second = await cache.ensure("NOPE2");

    expect(first.status).toBe("unknown");
    expect(second.status).toBe("unknown");
    // A typo must not cost a listing call each time it is retried.
    expect(mocks.seedEmptyFundIndexes).toHaveBeenCalledOnce();
  });
});
