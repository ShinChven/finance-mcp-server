import { describe, expect, it } from "vitest";
import { applySymbolPatch, carriedQuery } from "./symbol-params.js";

describe("symbol params", () => {
  it("drops a value that equals its default", () => {
    const next = applySymbolPatch(new URLSearchParams("tab=options&range=1y"), {
      tab: "summary",
      range: "6m",
    });
    expect(next.toString()).toBe("");
  });

  it("writes non-default values and serializes indicators", () => {
    const next = applySymbolPatch(new URLSearchParams("find=x"), {
      range: "5y",
      ind: ["macd", "sma20"],
      expiry: "2026-12-18",
    });
    expect(Object.fromEntries(next)).toEqual({
      find: "x",
      range: "5y",
      ind: "sma20,macd",
      expiry: "2026-12-18",
    });
  });

  it("removes the indicator param when the defaults are chosen again", () => {
    const next = applySymbolPatch(new URLSearchParams("ind=rsi"), { ind: ["sma20", "sma50", "vol"] });
    expect(next.has("ind")).toBe(false);
  });

  it("carries view settings to the next symbol but not per-symbol choices", () => {
    expect(carriedQuery(new URLSearchParams("tab=options&range=1y&expiry=2026-12-18&form=10-K&ind=rsi"))).toBe(
      "?tab=options&range=1y&ind=rsi",
    );
    expect(carriedQuery(new URLSearchParams())).toBe("");
  });
});
