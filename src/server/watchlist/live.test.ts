import { describe, expect, it, vi } from "vitest";
import type { WatchlistItem } from "../db/schema.js";
import type { YahooFinanceClient } from "../mcp/client.js";
import { enrichItems, summarize } from "./live.js";
import type { FundSnapshot, WatchlistRepo } from "./repo.js";

function item(overrides: Partial<WatchlistItem> & Pick<WatchlistItem, "kind" | "ref">): WatchlistItem {
  return {
    id: `item-${overrides.ref}`,
    watchlistId: "list-1",
    name: null,
    note: null,
    targetPrice: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
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

  it("measures distance to a target once a price exists", async () => {
    const enriched = await enrichItems(
      [item({ kind: "symbol", ref: "NVDA", targetPrice: 100 })],
      { client: fakeClient([nvda]), repo: fakeRepo([]) },
    );
    expect(enriched[0]?.targetDistancePercent).toBe(20.5);
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
    });
  });
});
