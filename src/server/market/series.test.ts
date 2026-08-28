import { describe, expect, it, vi } from "vitest";
import type { NavSeriesPoint } from "../funds/performance.js";
import type { BarStore, StoredBars } from "./bars.js";
import type { MarketDataProvider } from "./provider.js";
import { fundSeries, priceSeries, symbolSeries, windowStart } from "./series.js";

/** A run of daily bars whose raw and adjusted series differ by a fixed factor. */
function bars(days: number, options: { adjustBy?: number; start?: string } = {}) {
  const factor = options.adjustBy ?? 1;
  const from = Date.parse(`${options.start ?? "2025-08-25"}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(from + index * 86_400_000).toISOString().slice(0, 10);
    const close = 100 + index * 0.1;
    return {
      date,
      open: close,
      high: close,
      low: close,
      close,
      adjClose: close * factor,
      volume: 1_000,
    };
  });
}

function fakeStore(stored: Partial<StoredBars> & Pick<StoredBars, "bars">): BarStore {
  const full: StoredBars = {
    timezone: "America/New_York",
    currency: "USD",
    events: [],
    firstBar: stored.bars[0]?.date ?? null,
    lastBar: stored.bars.at(-1)?.date ?? null,
    ...stored,
  };
  return {
    read: vi.fn(async () => full),
    ensure: vi.fn(async () => full),
    readMany: vi.fn(async () => new Map()),
  };
}

function fakeProvider(overrides: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return {
    id: "fake",
    fetchDailyBars: vi.fn(async () => ({
      timezone: "America/New_York",
      currency: "USD",
      bars: bars(30),
      events: [],
    })),
    fetchIntraday: vi.fn(async () => ({
      timezone: "America/New_York",
      currency: "USD",
      previousClose: 100,
      points: Array.from({ length: 12 }, (_, index) => ({
        at: Date.parse("2026-08-25T13:30:00Z") + index * 300_000,
        close: 100 + index * 0.05,
      })),
    })),
    ...overrides,
  };
}

const noNav = async (): Promise<NavSeriesPoint[]> => [];

describe("windowStart", () => {
  it("starts YTD at the exchange's own new year", () => {
    // Not UTC's, and not the reader's: the year turns over on the exchange.
    expect(windowStart("ytd", "2026-08-25", "America/New_York")).toBe("2026-01-01");
  });

  it("reaches to the beginning of time for max", () => {
    expect(windowStart("max", "2026-08-25", "UTC")).toBe("0001-01-01");
  });

  it("clamps a month step to the end of the target month", () => {
    // Without the clamp, 31 March minus one month is 3 March and a two-month
    // window gets drawn as 1M.
    expect(windowStart("1m", "2026-03-31", "UTC")).toBe("2026-02-28");
  });
});

describe("symbolSeries", () => {
  it("draws the raw close and measures the adjusted one", async () => {
    // A dividend payer: the adjusted series sits 10% below the raw prints, so
    // the two disagree about the return by exactly what was paid out.
    const series = await symbolSeries("NVDA", "1m", {
      bars: fakeStore({ bars: bars(90, { adjustBy: 0.9 }) }),
      provider: fakeProvider(),
      navHistory: noNav,
    });

    expect(series).not.toBeNull();
    expect(series?.drawnFrom).toBe("close");
    expect(series?.measuredFrom).toBe("adjClose");
    // The plotted values are the raw prints — the ones a level was set against.
    const last = series?.points.at(-1);
    expect(last?.value).toBeCloseTo(108.9, 4);
  });

  it("keeps only the events that fall inside the drawn window", async () => {
    const series = await symbolSeries("NVDA", "1m", {
      bars: fakeStore({
        bars: bars(200),
        events: [
          { date: "2025-09-01", kind: "split", factor: 4, amount: null },
          { date: "2026-03-05", kind: "dividend", factor: null, amount: 0.4 },
        ],
      }),
      provider: fakeProvider(),
      navHistory: noNav,
    });

    // The dividend falls inside the drawn month and is kept; the split from
    // the far end of the history is not a mark on a 1M chart.
    expect(series?.events).toHaveLength(1);
    expect(series?.events[0]).toMatchObject({ kind: "dividend", date: "2026-03-05" });
  });

  it("suppresses the annualized figure on a window under a year", async () => {
    const series = await symbolSeries("NVDA", "1m", {
      bars: fakeStore({ bars: bars(90) }),
      provider: fakeProvider(),
      navHistory: noNav,
    });

    expect(series?.stats).not.toBeNull();
    expect(series?.stats?.annualizedReturnPercent).toBeNull();
    expect(series?.stats?.maxDrawdownPercent).toBe(0);
  });

  it("goes to the provider for an intraday window and never to the store", async () => {
    const store = fakeStore({ bars: bars(90) });
    const provider = fakeProvider();
    const series = await symbolSeries("NVDA", "1d", {
      bars: store,
      provider,
      navHistory: noNav,
    });

    expect(series?.intraday).toBe(true);
    expect(provider.fetchIntraday).toHaveBeenCalled();
    // Nothing intraday is ever stored: it is superseded within the minute.
    expect(store.ensure).not.toHaveBeenCalled();
    // Points carry instants rather than dates, so the axis can be drawn in
    // exchange time rather than in whole days.
    expect(series?.points[0]?.t).toContain("T");
  });

  it("measures the window from the last observation, not from today", async () => {
    // A listing whose last bar is months old must still show a full year ending
    // at that bar. Anchoring to today instead silently trims the left edge by
    // however stale the series is, and nothing on the chart says so.
    const stale = bars(400, { start: "2024-01-02" });
    const store = fakeStore({ bars: stale });
    const series = await symbolSeries("STALE", "1y", {
      bars: store,
      provider: fakeProvider(),
      navHistory: noNav,
    });

    expect(series?.endDate).toBe(stale.at(-1)!.date);
    // A year back from that last bar, not a year back from now.
    expect(series?.startDate.slice(0, 4)).toBe("2024");
    expect(series?.observations).toBeGreaterThan(300);
  });

  it("returns null rather than a flat rule when there is nothing to draw", async () => {
    const series = await symbolSeries("NEW", "1y", {
      bars: fakeStore({ bars: bars(1) }),
      provider: fakeProvider(),
      navHistory: noNav,
    });
    expect(series).toBeNull();
  });
});

describe("fundSeries", () => {
  it("prefers cumulative NAV and says which basis it drew", async () => {
    const points: NavSeriesPoint[] = Array.from({ length: 120 }, (_, index) => ({
      navDate: new Date(Date.parse("2026-01-01T00:00:00Z") + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
      nav: 1 + index * 0.001,
      accNav: 1.5 + index * 0.001,
    }));

    const series = await fundSeries("161125", "1m", {
      bars: fakeStore({ bars: [] }),
      provider: fakeProvider(),
      navHistory: async () => points,
    });

    expect(series?.basis).toBe("nav");
    expect(series?.drawnFrom).toBe("accNav");
    expect(series?.currency).toBe("CNY");
  });

  it("falls back to unit NAV when the series is not wholly cumulative", async () => {
    const points: NavSeriesPoint[] = Array.from({ length: 60 }, (_, index) => ({
      navDate: new Date(Date.parse("2026-01-01T00:00:00Z") + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
      nav: 1 + index * 0.001,
      // One gap is enough: mixing bases mid-series would invent a return on the
      // switchover day.
      accNav: index === 30 ? null : 1.5 + index * 0.001,
    }));

    const series = await fundSeries("161125", "1m", {
      bars: fakeStore({ bars: [] }),
      provider: fakeProvider(),
      navHistory: async () => points,
    });

    expect(series?.drawnFrom).toBe("nav");
  });
});

describe("priceSeries", () => {
  it("gives a fund a daily window when an intraday one was asked for", async () => {
    // There is nothing inside a NAV day to draw, so the request is answered
    // with the window the item can actually support rather than an error.
    const points: NavSeriesPoint[] = Array.from({ length: 400 }, (_, index) => ({
      navDate: new Date(Date.parse("2025-08-01T00:00:00Z") + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
      nav: 1 + index * 0.001,
      accNav: 1.5 + index * 0.001,
    }));

    const series = await priceSeries({ kind: "fund", ref: "161125" }, "1d", {
      bars: fakeStore({ bars: [] }),
      provider: fakeProvider(),
      navHistory: async () => points,
    });

    expect(series?.intraday).toBe(false);
    expect(series?.range).toBe("1y");
  });
});
