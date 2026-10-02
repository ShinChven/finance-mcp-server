import { describe, expect, it } from "vitest";
import type { Candle } from "../../shared/symbol.js";
import {
  barPaths,
  candlePaths,
  extent,
  linearScale,
  niceTicks,
  padExtent,
  priceDigits,
  seriesPath,
  slots,
  timeTicks,
  spreadLabels,
  exchangeDate,
  withLiveCandle,
} from "./candles.js";

function candle(t: string, o: number, c: number, session = t): Candle {
  return { t, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 100, session };
}

describe("linearScale", () => {
  it("maps the top of the domain to the top of the pane", () => {
    const scale = linearScale(0, 100, 10, 110);
    expect(scale.y(100)).toBe(10);
    expect(scale.y(0)).toBe(110);
    expect(scale.invert(60)).toBe(50);
  });

  it("opens a flat domain instead of dividing by zero", () => {
    const scale = linearScale(5, 5, 0, 100);
    expect(scale.y(5)).toBe(50);
  });
});

describe("extent and padding", () => {
  it("ignores nulls and non-finite values across series", () => {
    expect(extent([1, null, 5], [Number.NaN, -2])).toEqual([-2, 5]);
    expect(extent([null])).toBeNull();
  });

  it("pads by a share of the span", () => {
    expect(padExtent([0, 100], 0.1)).toEqual([-10, 110]);
  });
});

describe("niceTicks", () => {
  it("lands on round numbers inside the span", () => {
    expect(niceTicks(101.3, 118.9, 4)).toEqual([105, 110, 115]);
    expect(niceTicks(0.1, 0.35, 5)).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
  });

  it("returns nothing for an empty span", () => {
    expect(niceTicks(3, 3)).toEqual([]);
  });
});

describe("priceDigits", () => {
  it("shows more decimals as the price gets smaller", () => {
    expect(priceDigits(4321)).toBe(2);
    expect(priceDigits(3.21)).toBe(3);
    expect(priceDigits(0.0421)).toBe(4);
    expect(priceDigits(0.00001)).toBe(6);
  });
});

describe("slots", () => {
  it("centres candles in equal slots and finds the slot under a pixel", () => {
    const layout = slots(10, 200);
    expect(layout.step).toBe(20);
    expect(layout.x(0)).toBe(10);
    expect(layout.index(199)).toBe(9);
    expect(layout.index(-5)).toBe(0);
    expect(layout.index(500)).toBe(9);
    // An odd body width so the wick sits on its centre pixel.
    expect(layout.body % 2).toBe(1);
  });
});

describe("paths", () => {
  const scale = linearScale(0, 20, 0, 200);
  const layout = slots(2, 40);

  it("splits candles into up and down bodies and wicks", () => {
    const paths = candlePaths([candle("2026-01-02", 5, 10), candle("2026-01-05", 10, 6)], layout, scale);
    expect(paths.upBodies.match(/M/g)).toHaveLength(1);
    expect(paths.downBodies.match(/M/g)).toHaveLength(1);
    expect(paths.upWicks).toContain("V");
  });

  it("lifts the pen across a gap in an indicator", () => {
    const path = seriesPath([1, null, 3, 4], slots(4, 40), scale);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path.match(/L/g)).toHaveLength(1);
  });

  it("draws bars from the baseline in both directions", () => {
    const bars = barPaths([5, -5], [true, false], layout, linearScale(-10, 10, 0, 200), 0);
    expect(bars.up).toContain("M");
    expect(bars.down).toContain("M");
  });
});

describe("timeTicks", () => {
  it("labels month and year boundaries on daily candles", () => {
    const candles = [
      candle("2025-12-30", 1, 2),
      candle("2025-12-31", 1, 2),
      candle("2026-01-02", 1, 2),
      candle("2026-02-02", 1, 2),
    ];
    const ticks = timeTicks(candles, { intraday: false, interval: "1d", timezone: "UTC", maxTicks: 10 });
    expect(ticks.map((tick) => tick.index)).toEqual([2, 3]);
    expect(ticks[0]?.major).toBe(true);
  });

  it("marks each new session across a multi-day intraday window", () => {
    const candles = [
      candle("2026-08-25T13:30:00Z", 1, 2, "2026-08-25"),
      candle("2026-08-25T19:55:00Z", 1, 2, "2026-08-25"),
      candle("2026-08-26T13:30:00Z", 1, 2, "2026-08-26"),
    ];
    const ticks = timeTicks(candles, {
      intraday: true,
      interval: "15m",
      timezone: "America/New_York",
      maxTicks: 10,
    });
    expect(ticks.map((tick) => tick.index)).toEqual([0, 2]);
    expect(ticks.every((tick) => tick.major)).toBe(true);
  });

  it("thins to the room available, keeping the majors", () => {
    const candles = Array.from({ length: 400 }, (_, i) => {
      const date = new Date(Date.UTC(2023, 0, 2) + i * 3 * 86_400_000).toISOString().slice(0, 10);
      return candle(date, 1, 2);
    });
    const ticks = timeTicks(candles, { intraday: false, interval: "1d", timezone: "UTC", maxTicks: 6 });
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.filter((tick) => tick.major).length).toBeGreaterThanOrEqual(3);
  });
});

describe("withLiveCandle", () => {
  const history = [candle("2026-09-29", 10, 11), candle("2026-09-30", 11, 12)];
  const quote = {
    price: 13,
    asOf: "2026-09-30T19:30:00Z",
    open: 11,
    dayHigh: 13.5,
    dayLow: 10.5,
    volume: 900,
  };

  it("updates the forming candle when the quote is for the same session", () => {
    const out = withLiveCandle(history, quote, "America/New_York");
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ c: 13, h: 13.5, l: 10, v: 900 });
  });

  it("starts today's candle when the store has not seen it yet", () => {
    const out = withLiveCandle(history, { ...quote, asOf: "2026-10-01T14:00:00Z" }, "America/New_York");
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ t: "2026-10-01", o: 11, c: 13, session: "2026-10-01" });
  });

  it("leaves the history alone for a stale or missing quote", () => {
    expect(withLiveCandle(history, { ...quote, asOf: "2026-09-28T19:00:00Z" }, "America/New_York")).toBe(history);
    expect(withLiveCandle(history, null, "UTC")).toBe(history);
  });

  it("dates the quote at the exchange, not in UTC", () => {
    expect(exchangeDate("2026-10-01T02:00:00Z", "America/New_York")).toBe("2026-09-30");
    expect(exchangeDate("2026-10-01T02:00:00Z", "Asia/Shanghai")).toBe("2026-10-01");
  });
});

describe("spreadLabels", () => {
  it("pushes overlapping labels apart and keeps them inside the pane", () => {
    const out = spreadLabels([{ y: 100 }, { y: 104 }, { y: 103 }], 0, 200);
    expect(out.map((label) => label.y)).toEqual([100, 112, 124]);
  });

  it("shifts the stack back up when it would run off the bottom", () => {
    const out = spreadLabels([{ y: 195 }, { y: 196 }], 0, 200);
    expect(out.map((label) => label.y)).toEqual([188, 200]);
  });
});
