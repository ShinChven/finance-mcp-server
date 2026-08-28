import { describe, expect, it, vi } from "vitest";
import type { WatchlistLevel } from "../db/schema.js";
import type { YahooFinanceClient } from "../mcp/client.js";
import { enrichItems, summarize } from "./live.js";
import type { FundSnapshot, WatchlistItemRow, WatchlistRepo } from "./repo.js";

function item(
  overrides: Partial<WatchlistItemRow> & Pick<WatchlistItemRow, "kind" | "ref">,
): WatchlistItemRow {
  return {
    id: `item-${overrides.ref}`,
    watchlistId: "list-1",
    name: null,
    note: null,
    entryPrice: null,
    entryAt: null,
    position: 0,
    levels: [],
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

function level(overrides: Partial<WatchlistLevel> & Pick<WatchlistLevel, "kind" | "price">): WatchlistLevel {
  return {
    id: `level-${overrides.kind}-${overrides.price}`,
    itemId: "item-NVDA",
    priceHigh: null,
    label: null,
    note: null,
    source: "user",
    status: "active",
    hitAt: null,
    validUntil: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

function fakeClient(quotes: unknown[], fail = false): YahooFinanceClient {
  return {
    quote: vi.fn(async () => {
      if (fail) throw new Error("Yahoo unreachable");
      return quotes;
    }),
  } as unknown as YahooFinanceClient;
}

function fakeRepo(snapshots: FundSnapshot[]): WatchlistRepo {
  return {
    getFundSnapshots: vi.fn(async (codes: string[]) => {
      const map = new Map<string, FundSnapshot>();
      for (const snapshot of snapshots) {
        if (codes.includes(snapshot.code)) map.set(snapshot.code, snapshot);
      }
      return map;
    }),
  } as unknown as WatchlistRepo;
}

const nvda = {
  symbol: "NVDA",
  regularMarketPrice: 120.5,
  regularMarketChange: 2.5,
  regularMarketChangePercent: 2.12,
  currency: "USD",
  marketState: "REGULAR",
  regularMarketTime: 1_775_000_000,
};

describe("watchlist live values", () => {
  it("prices symbols from Yahoo and funds from the cached NAV, labelled apart", async () => {
    const items = [item({ kind: "symbol", ref: "NVDA" }), item({ kind: "fund", ref: "161125" })];
    const enriched = await enrichItems(items, {
      client: fakeClient([nvda]),
      repo: fakeRepo([
        {
          code: "161125",
          name: "标普500",
          nav: 1.5,
          accNav: 2.1,
          dailyReturn: 0.5,
          navDate: "2026-08-15",
        },
      ]),
    });

    expect(enriched[0]?.live).toMatchObject({
      basis: "market",
      price: 120.5,
      changePercent: 2.12,
      currency: "USD",
      available: true,
    });
    expect(enriched[1]?.live).toMatchObject({
      basis: "nav",
      price: 1.5,
      changePercent: 0.5,
      currency: "CNY",
      asOf: "2026-08-15",
      available: true,
    });
    // The fund's name comes from the cache when the item never captured one.
    expect(enriched[1]?.name).toBe("标普500");
  });

  it("keeps the list renderable when the quote provider fails", async () => {
    const enriched = await enrichItems([item({ kind: "symbol", ref: "NVDA" })], {
      client: fakeClient([], true),
      repo: fakeRepo([]),
    });

    expect(enriched).toHaveLength(1);
    expect(enriched[0]?.live.available).toBe(false);
    expect(enriched[0]?.live.unavailableReason).toContain("Yahoo unreachable");
  });

  it("explains a symbol Yahoo dropped and a fund that is not cached", async () => {
    const enriched = await enrichItems(
      [item({ kind: "symbol", ref: "NOPE" }), item({ kind: "fund", ref: "999999" })],
      { client: fakeClient([]), repo: fakeRepo([]) },
    );

    expect(enriched[0]?.live.unavailableReason).toContain("No Yahoo Finance data");
    expect(enriched[1]?.live.unavailableReason).toContain("not in the local index");
  });

  it("measures each level against the live price and reports the nearest either way", async () => {
    // Live price is 120.5.
    const enriched = await enrichItems(
      [
        item({
          kind: "symbol",
          ref: "NVDA",
          entryPrice: 100,
          levels: [
            level({ kind: "resistance", price: 130 }),
            level({ kind: "target", price: 150 }),
            level({ kind: "support", price: 115 }),
            level({ kind: "stop", price: 90 }),
          ],
        }),
      ],
      { client: fakeClient([nvda]), repo: fakeRepo([]) },
    );

    const enrichedItem = enriched[0]!;
    // Sorted high to low, the way a ladder reads.
    expect(enrichedItem.levels.map((l) => l.price)).toEqual([150, 130, 115, 90]);
    // Distance is the move the price must make, signed: up is positive.
    expect(enrichedItem.levels[1]).toMatchObject({ side: "above", distancePercent: 7.88 });
    expect(enrichedItem.levels[2]).toMatchObject({ side: "below", distancePercent: -4.56 });
    // Not the highest above and lowest below — the two adjacent to the price.
    expect(enrichedItem.nearest.above?.price).toBe(130);
    expect(enrichedItem.nearest.below?.price).toBe(115);
    expect(enrichedItem.sinceEntryPercent).toBe(20.5);
  });

  it("measures a zone from its near edge and skips levels that are done", async () => {
    const enriched = await enrichItems(
      [
        item({
          kind: "symbol",
          ref: "NVDA",
          levels: [
            level({ kind: "resistance", price: 125, priceHigh: 135 }),
            // Already reached, so it is history rather than the next thing up.
            level({ kind: "target", price: 122, status: "hit" }),
            // Expired the day before the test's clock, whatever day that is.
            level({
              kind: "support",
              price: 118,
              validUntil: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
            }),
            level({ kind: "support", price: 110 }),
          ],
        }),
      ],
      { client: fakeClient([nvda]), repo: fakeRepo([]) },
    );

    const levels = enriched[0]!.levels;
    // 120.5 into a 125–135 band: measured to 125, the edge it meets first.
    expect(levels[0]).toMatchObject({ side: "above", distancePercent: 3.73 });
    expect(levels[2]?.expired).toBe(true);
    expect(enriched[0]?.nearest.above?.price).toBe(125);
    expect(enriched[0]?.nearest.below?.price).toBe(110);
  });

  it("reads a price inside a zone as neither above nor below", async () => {
    const enriched = await enrichItems(
      [
        item({
          kind: "symbol",
          ref: "NVDA",
          levels: [level({ kind: "entry", price: 115, priceHigh: 125 })],
        }),
      ],
      { client: fakeClient([nvda]), repo: fakeRepo([]) },
    );
    expect(enriched[0]?.levels[0]).toMatchObject({ side: "inside", distancePercent: 0 });
    expect(enriched[0]?.nearest).toEqual({ above: null, below: null });
  });

  it("leaves levels unplaced when nothing priced", async () => {
    const enriched = await enrichItems(
      [item({ kind: "symbol", ref: "NOPE", levels: [level({ kind: "target", price: 10 })] })],
      { client: fakeClient([]), repo: fakeRepo([]) },
    );
    expect(enriched[0]?.levels[0]).toMatchObject({ side: null, distancePercent: null });
    expect(enriched[0]?.sinceEntryPercent).toBeNull();
  });

  it("summarizes breadth over the items that actually priced", async () => {
    const enriched = await enrichItems(
      [
        item({ kind: "symbol", ref: "NVDA" }),
        item({ kind: "symbol", ref: "AAPL" }),
        item({ kind: "symbol", ref: "NOPE" }),
      ],
      {
        client: fakeClient([
          nvda,
          { ...nvda, symbol: "AAPL", regularMarketPrice: 200, regularMarketChangePercent: -1.12 },
        ]),
        repo: fakeRepo([]),
      },
    );

    const summary = summarize(enriched);
    expect(summary).toMatchObject({
      items: 3,
      priced: 2,
      advancing: 1,
      declining: 1,
      averageChangePercent: 0.5,
      best: { ref: "NVDA" },
      worst: { ref: "AAPL" },
      approaching: 0,
    });
  });

  it("counts the items whose next level is within reach", async () => {
    const enriched = await enrichItems(
      [
        // 120.5 against 121 is 0.41% away — worth looking at today.
        item({ kind: "symbol", ref: "NVDA", levels: [level({ kind: "resistance", price: 121 })] }),
        item({ kind: "symbol", ref: "AAPL", levels: [level({ kind: "resistance", price: 400 })] }),
      ],
      {
        client: fakeClient([nvda, { ...nvda, symbol: "AAPL", regularMarketPrice: 200 }]),
        repo: fakeRepo([]),
      },
    );
    expect(summarize(enriched).approaching).toBe(1);
  });
});
