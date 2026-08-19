import { describe, expect, it, vi } from "vitest";
import { INSTRUMENT_PROFILE_FRESHNESS_MS } from "../../shared/funds.js";
import type { db as Database } from "../db/index.js";
import type { YahooFinanceClient } from "../mcp/client.js";
import { countStaleInstrumentProfiles, ingestInstrumentProfiles } from "./ingest.js";

/**
 * The enrichment step is what joins the fund index to Yahoo, and its two
 * failure modes are both invisible in production: refetching instruments that
 * were already current (expensive), and never refetching the ones that failed
 * (silently stale). Both are watermark behaviour, so both are worth pinning.
 */

interface Existing {
  symbol: string;
  profileSyncedAt: Date | null;
}

function fakeDb(existing: Existing[]) {
  const updates: Record<string, unknown>[] = [];
  const sectorWrites: Record<string, unknown>[] = [];
  const db = {
    select: () => ({ from: () => ({ where: async () => existing }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          sectorWrites.push(values);
        },
      }),
    }),
  } as unknown as typeof Database;
  return { db, updates, sectorWrites };
}

function fakeYahoo(
  profiles: Record<string, unknown | Error>,
  fxRate = 0.14,
): { client: YahooFinanceClient; quoteSummary: ReturnType<typeof vi.fn> } {
  const quoteSummary = vi.fn(async (symbol: string) => {
    const profile = profiles[symbol];
    if (profile === undefined) return {};
    if (profile instanceof Error) throw profile;
    return profile;
  });
  const quote = vi.fn(async () => ({ regularMarketPrice: fxRate }));
  return { client: { quoteSummary, quote } as unknown as YahooFinanceClient, quoteSummary };
}

const NOW = Date.now();

describe("ingestInstrumentProfiles", () => {
  it("stores the attributes the sector step used to throw away", async () => {
    const { db, updates, sectorWrites } = fakeDb([{ symbol: "600519.SS", profileSyncedAt: null }]);
    const { client } = fakeYahoo({
      "600519.SS": {
        assetProfile: { sector: "Consumer Defensive", industry: "Beverages", country: "China" },
        price: {
          marketCap: 2_000_000_000_000,
          currency: "CNY",
          quoteType: "EQUITY",
          exchangeName: "Shanghai",
          longName: "Kweichow Moutai Co Ltd",
        },
      },
    });

    const summary = await ingestInstrumentProfiles(db, client, ["600519.SS"]);

    expect(summary.instrumentsEnriched).toBe(1);
    expect(summary.symbolsClassified).toBe(1);
    expect(updates[0]).toMatchObject({
      country: "China",
      type: "equity",
      exchange: "Shanghai",
      currency: "CNY",
      name: "Kweichow Moutai Co Ltd",
      marketCap: 2_000_000_000_000,
      // Converted so the column can be compared against a US name at all.
      marketCapUsd: 280_000_000_000,
    });
    expect(sectorWrites[0]).toMatchObject({ sectorCode: "Consumer Defensive", sectorName: "Beverages" });
  });

  it("skips instruments still inside the freshness window", async () => {
    const { db } = fakeDb([
      { symbol: "AAPL", profileSyncedAt: new Date(NOW - 1000) },
      { symbol: "NVDA", profileSyncedAt: new Date(NOW - INSTRUMENT_PROFILE_FRESHNESS_MS - 1000) },
    ]);
    const { client, quoteSummary } = fakeYahoo({});

    await ingestInstrumentProfiles(db, client, ["AAPL", "NVDA"]);

    expect(quoteSummary).toHaveBeenCalledTimes(1);
    expect(quoteSummary).toHaveBeenCalledWith("NVDA", expect.anything());
  });

  it("refetches everything under force", async () => {
    const { db } = fakeDb([{ symbol: "AAPL", profileSyncedAt: new Date(NOW - 1000) }]);
    const { client, quoteSummary } = fakeYahoo({});

    await ingestInstrumentProfiles(db, client, ["AAPL"], undefined, { force: true });
    expect(quoteSummary).toHaveBeenCalledTimes(1);
  });

  it("marks a symbol Yahoo could not answer for, rather than retrying it forever", async () => {
    // The alternative is one wasted request per uncovered symbol on every run,
    // for as long as the instrument stays in someone's portfolio.
    const { db, updates } = fakeDb([{ symbol: "NOSUCH", profileSyncedAt: null }]);
    const { client } = fakeYahoo({ NOSUCH: new Error("Not Found") });

    const summary = await ingestInstrumentProfiles(db, client, ["NOSUCH"]);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.profileSyncedAt).toBeInstanceOf(Date);
    // Still reported, so a run against a broken Yahoo is loud rather than quiet.
    expect(summary.errors[0]).toContain("profile NOSUCH");
  });

  it("stops at the deadline instead of running to completion", async () => {
    const { db } = fakeDb([
      { symbol: "A", profileSyncedAt: null },
      { symbol: "B", profileSyncedAt: null },
    ]);
    const { client, quoteSummary } = fakeYahoo({});

    await ingestInstrumentProfiles(db, client, ["A", "B"], undefined, {
      deadline: Date.now() - 1,
    });
    expect(quoteSummary).not.toHaveBeenCalled();
  });

  it("does nothing when every symbol is fresh", async () => {
    const { db, updates } = fakeDb([{ symbol: "AAPL", profileSyncedAt: new Date(NOW) }]);
    const { client, quoteSummary } = fakeYahoo({});

    await ingestInstrumentProfiles(db, client, ["AAPL"]);
    expect(quoteSummary).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});

describe("countStaleInstrumentProfiles", () => {
  it("counts the never-seen and the expired, but not the merely skipped", async () => {
    // Subtracting an enriched count from the input would call a fresh
    // instrument "left behind" — it was deliberately not touched.
    const { db } = fakeDb([
      { symbol: "AAPL", profileSyncedAt: new Date(NOW - 1000) },
      { symbol: "NVDA", profileSyncedAt: new Date(NOW - INSTRUMENT_PROFILE_FRESHNESS_MS - 1000) },
    ]);

    expect(await countStaleInstrumentProfiles(db, ["AAPL", "NVDA", "UNSEEN"], NOW)).toBe(2);
  });

  it("is zero for an empty request", async () => {
    const { db } = fakeDb([]);
    expect(await countStaleInstrumentProfiles(db, [])).toBe(0);
  });
});
