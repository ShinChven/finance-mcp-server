import { describe, expect, it, vi } from "vitest";
import type { BarStore, StoredBars } from "./bars.js";
import {
  aggregateCandles,
  barsToCandles,
  intradayToCandles,
  symbolCandles,
  tidy,
  warmupStart,
  weekKey,
} from "./candles.js";
import type { DailyBar, MarketDataProvider } from "./provider.js";

/** Weekdays only, so weekly aggregation sees real trading weeks. */
function tradingBars(count: number, start = "2024-01-01"): DailyBar[] {
  const out: DailyBar[] = [];
  let at = Date.parse(`${start}T00:00:00Z`);
  while (out.length < count) {
    const day = new Date(at).getUTCDay();
    if (day !== 0 && day !== 6) {
      const close = 100 + out.length;
      out.push({
        date: new Date(at).toISOString().slice(0, 10),
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
        adjClose: close * 0.9,
        volume: 1_000,
      });
    }
    at += 86_400_000;
  }
  return out;
}

function fakeStore(bars: DailyBar[]): BarStore & { read: ReturnType<typeof vi.fn> } {
  const full: StoredBars = {
    timezone: "America/New_York",
    currency: "USD",
    bars,
    events: [{ date: bars.at(-3)!.date, kind: "dividend", factor: null, amount: 0.2 }],
    firstBar: bars[0]?.date ?? null,
    lastBar: bars.at(-1)?.date ?? null,
  };
  return {
    read: vi.fn(async () => full),
    ensure: vi.fn(async () => full),
    readMany: vi.fn(async () => new Map()),
  };
}

function fakeProvider(): MarketDataProvider {
  // Two New York sessions at five minutes: 25 and 26 August 2026.
  const session = (day: string, base: number) =>
    Array.from({ length: 4 }, (_, index) => ({
      at: Date.parse(`${day}T13:30:00Z`) + index * 300_000,
      open: base + index,
      high: base + index + 0.5,
      low: base + index - 0.5,
      close: base + index + 0.25,
      volume: 100,
    }));
  return {
    id: "fake",
    fetchDailyBars: vi.fn(),
    fetchIntraday: vi.fn(async () => ({
      timezone: "America/New_York",
      currency: "USD",
      previousClose: 1,
      points: [...session("2026-08-25", 50), ...session("2026-08-26", 60)],
    })),
  };
}

describe("barsToCandles", () => {
  it("drops a bar without a close and flattens one missing its range", () => {
    const candles = barsToCandles([
      { date: "2026-01-02", open: null, high: null, low: null, close: 10, adjClose: 10, volume: null },
      { date: "2026-01-05", open: 1, high: 2, low: 0.5, close: null, adjClose: null, volume: 5 },
    ]);
    expect(candles).toEqual([
      { t: "2026-01-02", o: 10, h: 10, l: 10, c: 10, v: null, session: "2026-01-02" },
    ]);
  });

  it("widens a range the feed got wrong so the body always sits inside the wick", () => {
    const [candle] = barsToCandles([
      { date: "2026-01-02", open: 12, high: 11, low: 10, close: 9, adjClose: 9, volume: 1 },
    ]);
    expect(candle?.h).toBe(12);
    expect(candle?.l).toBe(9);
  });
});

describe("tidy", () => {
  it("drops float noise without losing a small price's resolution", () => {
    expect(tidy(229.95000457763672)).toBe(229.95);
    expect(tidy(0.000012345678912)).toBe(0.000012345679);
  });
});

describe("aggregateCandles", () => {
  it("folds trading days into ISO weeks stamped with their first day", () => {
    const weekly = aggregateCandles(barsToCandles(tradingBars(10, "2024-01-01")), "1wk");
    expect(weekly).toHaveLength(2);
    expect(weekly[0]).toMatchObject({ t: "2024-01-01", o: 99.5, c: 104, h: 105, l: 99, v: 5_000 });
    expect(weekly[1]).toMatchObject({ t: "2024-01-08", o: 104.5, c: 109, session: "2024-01-12" });
  });

  it("folds into calendar months", () => {
    const monthly = aggregateCandles(barsToCandles(tradingBars(30, "2024-01-01")), "1mo");
    expect(monthly.map((candle) => candle.t)).toEqual(["2024-01-01", "2024-02-01"]);
  });

  it("finds the Monday of a week from any day in it", () => {
    expect(weekKey("2024-01-07")).toBe("2024-01-01");
    expect(weekKey("2024-01-08")).toBe("2024-01-08");
  });
});

describe("intradayToCandles", () => {
  it("keeps the last sessions and reports the close before them", async () => {
    const provider = fakeProvider();
    const result = await provider.fetchIntraday("X", { days: 1 });
    const { candles, previousSessionClose } = intradayToCandles(
      result.points,
      "America/New_York",
      1,
    );
    expect(candles).toHaveLength(4);
    expect(candles.every((candle) => candle.session === "2026-08-26")).toBe(true);
    expect(previousSessionClose).toBe(53.25);
  });
});

describe("warmupStart", () => {
  it("reaches back far enough for a 200-candle average at every width", () => {
    expect(warmupStart("2026-01-01", "1d") < "2025-03-31").toBe(true);
    expect(warmupStart("2026-01-01", "1wk") < "2022-03-01").toBe(true);
  });

  it("leaves an unbounded window unbounded", () => {
    expect(warmupStart("0001-01-01", "1d")).toBe("0001-01-01");
    expect(warmupStart("0010-01-01", "1mo")).toBe("0001-01-01");
  });
});

describe("symbolCandles", () => {
  it("sends warm-up history in front of the visible window", async () => {
    const bars = tradingBars(600, "2024-01-01");
    const series = await symbolCandles("NVDA", "1m", "auto", {
      bars: fakeStore(bars),
      provider: fakeProvider(),
    });
    expect(series).not.toBeNull();
    expect(series!.interval).toBe("1d");
    // A month is ~21 candles; everything before them is warm-up.
    const visible = series!.candles.length - series!.firstVisible;
    expect(visible).toBeGreaterThan(18);
    expect(visible).toBeLessThan(25);
    expect(series!.firstVisible).toBeGreaterThanOrEqual(200);
    // Raw close for the change, adjusted series for the statistics.
    const first = series!.candles[series!.firstVisible]!.c;
    const last = series!.candles.at(-1)!.c;
    expect(series!.changePercent).toBeCloseTo((last / first - 1) * 100, 1);
    expect(series!.stats?.annualizedReturnPercent).toBeNull();
    expect(series!.events).toHaveLength(1);
  });

  it("draws five years in weekly candles by default", async () => {
    const series = await symbolCandles("NVDA", "5y", "auto", {
      bars: fakeStore(tradingBars(600, "2024-01-01")),
      provider: fakeProvider(),
    });
    expect(series!.interval).toBe("1wk");
    expect(series!.candles.every((candle) => new Date(`${candle.t}T00:00:00Z`).getUTCDay() <= 5)).toBe(
      true,
    );
  });

  it("goes to the provider for intraday and baselines on the prior session", async () => {
    const store = fakeStore(tradingBars(10));
    const provider = fakeProvider();
    const series = await symbolCandles("NVDA", "1d", "auto", { bars: store, provider });
    expect(store.ensure).not.toHaveBeenCalled();
    expect(provider.fetchIntraday).toHaveBeenCalledWith("NVDA", { days: 1, intervalMinutes: 5 });
    expect(series!.intraday).toBe(true);
    expect(series!.previousClose).toBe(53.25);
    expect(series!.changePercent).toBeCloseTo((63.25 / 53.25 - 1) * 100, 2);
  });
});
