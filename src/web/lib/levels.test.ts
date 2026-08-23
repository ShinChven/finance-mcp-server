import { describe, expect, it } from "vitest";
import { parseLevelLines } from "./levels.js";

describe("parsing typed price levels", () => {
  it("reads a bare number by which side of the price it lands on", () => {
    expect(parseLevelLines("185 prior high\n168 20-day MA", 176)).toEqual([
      { kind: "resistance", price: 185, label: "prior high" },
      { kind: "support", price: 168, label: "20-day MA" },
    ]);
  });

  it("lets a named kind override the side", () => {
    // Below the price, but a stop is a stop.
    expect(parseLevelLines("stop 152 thesis breaks", 176)).toEqual([
      { kind: "stop", price: 152, label: "thesis breaks" },
    ]);
    // Above it, and still an entry: the name is the author's intent.
    expect(parseLevelLines("entry 190", 176)).toEqual([{ kind: "entry", price: 190 }]);
  });

  it("calls everything a target when there is no price to compare", () => {
    expect(parseLevelLines("210", null)).toEqual([{ kind: "target", price: 210 }]);
  });

  it("reads a range as a zone", () => {
    expect(parseLevelLines("125-135 supply", 176)).toEqual([
      { kind: "support", price: 125, priceHigh: 135, label: "supply" },
    ]);
    expect(parseLevelLines("3.20 ~ 3.40", 3)).toEqual([
      { kind: "resistance", price: 3.2, priceHigh: 3.4 },
    ]);
  });

  it("skips blank and unreadable lines instead of inventing levels", () => {
    expect(parseLevelLines("\n  \nprior high 185\nnot a level\n0 zero", 176)).toEqual([]);
  });
});
