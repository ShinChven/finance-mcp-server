import { describe, expect, it } from "vitest";
import {
  detectItemKind,
  isLevelExpired,
  locateLevel,
  normalizeRef,
  percentChange,
} from "./watchlist.js";

describe("watchlist vocabulary", () => {
  it("reads a bare 6-digit code as a fund and anything else as a symbol", () => {
    expect(detectItemKind("161125")).toBe("fund");
    expect(detectItemKind(" 000001 ")).toBe("fund");
    expect(detectItemKind("NVDA")).toBe("symbol");
    // The suffix is what separates a Shanghai listing from a fund code.
    expect(detectItemKind("600519.SS")).toBe("symbol");
    expect(detectItemKind("BTC-USD")).toBe("symbol");
  });

  it("upper-cases symbols so one instrument cannot be tracked twice", () => {
    expect(normalizeRef(" nvda ", "symbol")).toBe("NVDA");
    expect(normalizeRef("0700.hk", "symbol")).toBe("0700.HK");
    expect(normalizeRef(" 161125 ", "fund")).toBe("161125");
  });

  it("measures a percentage move from whichever number is the reference", () => {
    // From entry to price: how the position has done.
    expect(percentChange(100, 120)).toBe(20);
    // From price to level: how far the market still has to travel.
    expect(percentChange(120, 100)).toBe(-16.67);
    expect(percentChange(null, 100)).toBeNull();
    expect(percentChange(100, null)).toBeNull();
    expect(percentChange(0, 100)).toBeNull();
  });
});

describe("price levels", () => {
  it("places a level by the live price rather than by how it was labelled", () => {
    // The same target, before and after the price trades through it.
    expect(locateLevel(90, 100)).toMatchObject({ side: "above", distancePercent: 11.11 });
    expect(locateLevel(120, 100)).toMatchObject({ side: "below", distancePercent: -16.67 });
    expect(locateLevel(100, 100)).toEqual({ side: "at", distancePercent: 0 });
  });

  it("measures a zone from the edge the price meets first", () => {
    expect(locateLevel(90, 100, 110)).toMatchObject({ side: "above", distancePercent: 11.11 });
    expect(locateLevel(120, 100, 110)).toMatchObject({ side: "below", distancePercent: -8.33 });
    expect(locateLevel(105, 100, 110)).toEqual({ side: "inside", distancePercent: 0 });
  });

  it("has nothing to say about a level with no price to compare", () => {
    expect(locateLevel(null, 100)).toEqual({ side: null, distancePercent: null });
  });

  it("expires a level the day after it stops applying", () => {
    const today = new Date("2026-08-23T12:00:00Z");
    expect(isLevelExpired(null, today)).toBe(false);
    expect(isLevelExpired("2026-08-23", today)).toBe(false);
    expect(isLevelExpired("2026-08-22", today)).toBe(true);
  });
});
