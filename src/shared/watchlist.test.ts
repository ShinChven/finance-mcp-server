import { describe, expect, it } from "vitest";
import { detectItemKind, normalizeRef, targetDistancePercent } from "./watchlist.js";

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

  it("signs the target distance from below and above", () => {
    expect(targetDistancePercent(90, 100)).toBe(-10);
    expect(targetDistancePercent(120, 100)).toBe(20);
    expect(targetDistancePercent(null, 100)).toBeNull();
    expect(targetDistancePercent(100, null)).toBeNull();
    expect(targetDistancePercent(100, 0)).toBeNull();
  });
});
