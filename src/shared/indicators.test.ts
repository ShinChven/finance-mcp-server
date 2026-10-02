import { describe, expect, it } from "vitest";
import {
  bollinger,
  DEFAULT_INDICATORS,
  ema,
  macd,
  MAX_WARMUP,
  parseIndicators,
  rsi,
  serializeIndicators,
  sma,
  vwap,
} from "./indicators.js";

describe("sma", () => {
  it("averages the trailing window and is undefined until it is full", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("treats a window containing a gap as undefined rather than shortening it", () => {
    expect(sma([1, null, 3, 4, 5], 2)).toEqual([null, null, null, 3.5, 4.5]);
  });

  it("returns all nulls for a period longer than the series", () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });
});

describe("ema", () => {
  it("seeds with the SMA and then smooths with 2/(n+1)", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("carries the average across a gap instead of restarting the warm-up", () => {
    const out = ema([1, 2, 3, null, 5], 3);
    expect(out[3]).toBeNull();
    // 5·½ + 2·½ — the gap neither resets nor advances the average.
    expect(out[4]).toBe(3.5);
  });
});

describe("bollinger", () => {
  it("puts the bands k population deviations either side of the mean", () => {
    const out = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(out.slice(0, 7).every((point) => point === null)).toBe(true);
    expect(out[7]).toEqual({ upper: 9, middle: 5, lower: 1 });
  });
});

describe("rsi", () => {
  it("follows Wilder's smoothing after a simple-average seed", () => {
    const out = rsi([1, 2, 1, 2, 1], 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(50);
    expect(out[3]).toBe(75);
    expect(out[4]).toBeCloseTo(37.5, 10);
  });

  it("reads 100 with no losses, 0 with no gains and 50 when nothing moved", () => {
    expect(rsi([1, 2, 3, 4], 2).at(-1)).toBe(100);
    expect(rsi([4, 3, 2, 1], 2).at(-1)).toBe(0);
    expect(rsi([3, 3, 3, 3], 2).at(-1)).toBe(50);
  });
});

describe("macd", () => {
  it("is the difference of two EMAs, with a signal line once that is warm", () => {
    // On a straight line an EMA lags by exactly (n − 1) / 2, so the MACD of
    // 0, 1, 2, … is the constant 12.5 − 5.5 = 7 and the histogram is zero.
    const line = Array.from({ length: 40 }, (_, i) => i);
    const out = macd(line);
    expect(out[24]).toBeNull();
    expect(out[25]?.macd).toBeCloseTo(7, 10);
    expect(out[25]?.signal).toBeNull();
    expect(out[33]?.signal).toBeCloseTo(7, 10);
    expect(out[39]?.histogram).toBeCloseTo(0, 10);
  });
});

describe("vwap", () => {
  it("accumulates typical price by volume and resets each session", () => {
    const out = vwap([
      { high: 12, low: 8, close: 10, volume: 100, session: "a" },
      { high: 22, low: 18, close: 20, volume: 300, session: "a" },
      { high: 31, low: 29, close: 30, volume: 50, session: "b" },
    ]);
    expect(out[0]).toBe(10);
    expect(out[1]).toBe(17.5);
    expect(out[2]).toBe(30);
  });

  it("has no value until a session has traded", () => {
    const out = vwap([
      { high: 1, low: 1, close: 1, volume: 0, session: "a" },
      { high: 2, low: 2, close: 2, volume: null, session: "a" },
    ]);
    expect(out).toEqual([null, null]);
  });
});

describe("indicator params", () => {
  it("falls back to the defaults when the param is absent", () => {
    expect(parseIndicators(null)).toEqual([...DEFAULT_INDICATORS]);
    expect(parseIndicators("")).toEqual([...DEFAULT_INDICATORS]);
  });

  it("keeps registry order, drops unknown ids and honours an explicit none", () => {
    expect(parseIndicators("rsi,bogus,sma200,rsi")).toEqual(["sma200", "rsi"]);
    expect(parseIndicators("none")).toEqual([]);
  });

  it("serializes the defaults as an absent param so URLs stay clean", () => {
    expect(serializeIndicators(["vol", "sma50", "sma20"])).toBe("");
    expect(serializeIndicators([])).toBe("none");
    expect(serializeIndicators(["rsi", "sma20"])).toBe("sma20,rsi");
  });

  it("warms up for the longest indicator on offer", () => {
    expect(MAX_WARMUP).toBe(200);
  });
});
