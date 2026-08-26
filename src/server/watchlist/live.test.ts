import { describe, expect, it, vi } from "vitest";
import type { WatchlistLevel } from "../db/schema.js";
import type { YahooFinanceClient } from "../mcp/client.js";
import { dividendYieldPercent, enrichItems, summarize } from "./live.js";
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

function fakeRepo(
  snapshots: FundSnapshot[],
  navWindows: Record<string, { navDate: string; nav: number | null; accNav: number | null }[]> = {},
): WatchlistRepo {
  return {
    getFundSnapshots: vi.fn(async (codes: string[]) => {
      const map = new Map<string, FundSnapshot>();
      for (const snapshot of snapshots) {
        if (codes.includes(snapshot.code)) map.set(snapshot.code, snapshot);
      }
      return map;
    }),
    getFundNavWindows: vi.fn(async (codes: string[], since: string) => {
      const map = new Map<string, { navDate: string; nav: number | null; accNav: number | null }[]>();
      for (const [code, points] of Object.entries(navWindows)) {
        if (!codes.includes(code)) continue;
        map.set(
          code,
          points.filter((point) => point.navDate >= since),
        );
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

describe("quote statistics", () => {
  it("carries the context the quote already returned", async () => {
    const enriched = await enrichItems([item({ kind: "symbol", ref: "NVDA" })], {
      client: fakeClient([
        {
          ...nvda,
          regularMarketPreviousClose: 118,
          regularMarketDayLow: 118.2,
          regularMarketDayHigh: 121.9,
          fiftyTwoWeekLow: 80,
          fiftyTwoWeekHigh: 140,
          regularMarketVolume: 41_000_000,
          averageDailyVolume3Month: 38_000_000,
          fiftyDayAverage: 115.4,
          twoHundredDayAverage: 104.2,
          marketCap: 2_960_000_000_000,
          trailingPE: 51.3,
          dividendYield: 0.03,
          fiftyTwoWeekChangePercent: 34.5,
        },
      ]),
      repo: fakeRepo([]),
    });

    const stats = enriched[0]?.live.stats;
    expect(stats).toMatchObject({
      previousClose: 118,
      fiftyTwoWeekLow: 80,
      fiftyTwoWeekHigh: 140,
      volume: 41_000_000,
      marketCap: 2_960_000_000_000,
      trailingPe: 51.3,
    });
    // 120.5 sits (120.5 - 80) / (140 - 80) of the way up the year's range.
    expect(stats?.fiftyTwoWeekPosition).toBeCloseTo(0.675, 3);
  });

  it("renders every statistic as absent when the quote omits them", async () => {
    // A crypto pair or a thinly covered listing arrives like this: a price and
    // almost nothing else. Absent must stay absent rather than become zero,
    // which would read as a real reading of nought.
    const enriched = await enrichItems([item({ kind: "symbol", ref: "BTC-USD" })], {
      client: fakeClient([
        { symbol: "BTC-USD", regularMarketPrice: 64_000, marketState: "REGULAR" },
      ]),
      repo: fakeRepo([]),
    });

    const stats = enriched[0]?.live.stats;
    expect(enriched[0]?.live.available).toBe(true);
    expect(stats).not.toBeNull();
    expect(stats?.marketCap).toBeNull();
    expect(stats?.trailingPe).toBeNull();
    expect(stats?.fiftyTwoWeekPosition).toBeNull();
    expect(stats?.dividendYieldPercent).toBeNull();
    expect(enriched[0]?.live.returns).toBeNull();
  });

  it("treats dividendYield as a percentage and derives one only from the rate", () => {
    // Documented as a percentage upstream, so it passes through untouched.
    expect(dividendYieldPercent({ dividendYield: 1.42 })).toBe(1.42);
    // Derived when absent, from figures whose units are ours.
    expect(
      dividendYieldPercent({ trailingAnnualDividendRate: 2, regularMarketPrice: 100 }),
    ).toBe(2);
    // Implausible values are dropped rather than printed beside real ones.
    expect(dividendYieldPercent({ dividendYield: 4000 })).toBeNull();
    expect(dividendYieldPercent({})).toBeNull();
  });

  it("shows an out-of-hours print only while the session says there is one", async () => {
    const afterHours = await enrichItems([item({ kind: "symbol", ref: "NVDA" })], {
      client: fakeClient([
        {
          ...nvda,
          marketState: "POST",
          postMarketPrice: 122.4,
          postMarketChangePercent: 1.58,
          postMarketTime: 1_775_020_000,
        },
      ]),
      repo: fakeRepo([]),
    });
    expect(afterHours[0]?.live.extended).toMatchObject({ phase: "post", price: 122.4 });

    // The same fields survive on the payload into the next session; a stale
    // print must not be shown as though it were live.
    const nextMorning = await enrichItems([item({ kind: "symbol", ref: "NVDA" })], {
      client: fakeClient([{ ...nvda, marketState: "REGULAR", postMarketPrice: 122.4 }]),
      repo: fakeRepo([]),
    });
    expect(nextMorning[0]?.live.extended).toBeNull();
  });

  it("quotes a symbol's year from the quote, labelled as a price return", async () => {
    const enriched = await enrichItems([item({ kind: "symbol", ref: "NVDA" })], {
      client: fakeClient([{ ...nvda, fiftyTwoWeekChangePercent: 34.5 }]),
      repo: fakeRepo([]),
    });

    expect(enriched[0]?.live.returns).toEqual({
      basis: "price",
      periods: [{ period: "1y", returnPercent: 34.5, from: null, to: null }],
    });
  });

  it("quotes a fund's trailing windows from cached NAV, and only the covered ones", async () => {
    // A year and a bit of daily NAV: enough for every window the row offers,
    // and deliberately not enough for the multi-year ones the fund page shows.
    const points: { navDate: string; nav: number; accNav: number }[] = [];
    const start = Date.UTC(2025, 6, 1);
    for (let day = 0; day <= 420; day++) {
      const date = new Date(start + day * 86_400_000).toISOString().slice(0, 10);
      points.push({ navDate: date, nav: 1 + day * 0.001, accNav: 1.5 + day * 0.001 });
    }
    const latest = points.at(-1)!;

    const enriched = await enrichItems([item({ kind: "fund", ref: "161125" })], {
      client: fakeClient([]),
      repo: fakeRepo(
        [
          {
            code: "161125",
            name: "标普500",
            nav: latest.nav,
            accNav: latest.accNav,
            dailyReturn: 0.1,
            navDate: latest.navDate,
          },
        ],
        { "161125": points },
      ),
    });

    const returns = enriched[0]?.live.returns;
    expect(returns?.basis).toBe("accNav");
    const periods = returns?.periods.map((entry) => entry.period) ?? [];
    // Only the windows the bounded read can honestly cover: no `max` claiming
    // the truncated start is inception, and no multi-year window at all.
    expect(periods).toContain("1m");
    expect(periods).toContain("1y");
    expect(periods).not.toContain("max");
    expect(periods).not.toContain("3y");
    // Every window names the observations it really spans.
    expect(returns?.periods.every((entry) => entry.from !== null && entry.to !== null)).toBe(true);
  });

  it("keeps a fund priced when its NAV history cannot be read", async () => {
    const enriched = await enrichItems([item({ kind: "fund", ref: "161125" })], {
      client: fakeClient([]),
      repo: {
        getFundSnapshots: vi.fn(async () =>
          new Map([
            [
              "161125",
              {
                code: "161125",
                name: "标普500",
                nav: 1.5,
                accNav: 2.1,
                dailyReturn: 0.5,
                navDate: "2026-08-15",
              },
            ],
          ]),
        ),
        getFundNavWindows: vi.fn(async () => {
          throw new Error("history table unavailable");
        }),
      } as unknown as WatchlistRepo,
    });

    expect(enriched[0]?.live.price).toBe(1.5);
    expect(enriched[0]?.live.available).toBe(true);
    expect(enriched[0]?.live.returns).toBeNull();
  });
});
