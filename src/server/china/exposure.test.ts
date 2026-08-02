import { describe, expect, it } from "vitest";
import {
  computeExposure,
  cosineSimilarity,
  holdingStability,
  holdingsOverlap,
  toExposureVector,
  type SectorTag,
} from "./exposure.js";

const sectors = new Map<string, SectorTag[]>([
  ["NVDA", [{ taxonomy: "gics", sectorCode: "Technology", sectorName: "Semiconductors" }]],
  ["AAPL", [{ taxonomy: "gics", sectorCode: "Technology", sectorName: "Consumer Electronics" }]],
  ["JPM", [{ taxonomy: "gics", sectorCode: "Financial Services", sectorName: "Banks" }]],
]);

const markets = new Map([
  ["NVDA", "US"],
  ["AAPL", "US"],
  ["JPM", "US"],
  ["600519.SS", "CN"],
]);

describe("computeExposure", () => {
  it("aggregates holdings into sector and market weights", () => {
    const cells = computeExposure({
      holdings: [
        { symbol: "NVDA", weight: 30 },
        { symbol: "AAPL", weight: 20 },
        { symbol: "JPM", weight: 10 },
      ],
      sectors,
      markets,
    });

    const tech = cells.find((cell) => cell.dimension === "sector" && cell.key === "Technology");
    expect(tech?.weight).toBe(50);
    expect(tech?.coverage).toBe(1);

    const us = cells.find((cell) => cell.dimension === "market" && cell.key === "US");
    expect(us?.weight).toBe(60);
  });

  it("reports partial coverage when holdings are unclassified", () => {
    const cells = computeExposure({
      holdings: [
        { symbol: "NVDA", weight: 25 },
        { symbol: "UNKNOWN.SS", weight: 75 },
      ],
      sectors,
      markets,
    });

    const tech = cells.find((cell) => cell.dimension === "sector");
    expect(tech?.weight).toBe(25);
    // Only a quarter of the disclosed weight could be classified — the caller
    // must be able to see that before trusting the 25%.
    expect(tech?.coverage).toBe(0.25);
  });

  it("does not renormalize partially invested portfolios", () => {
    const cells = computeExposure({
      holdings: [{ symbol: "NVDA", weight: 40 }],
      sectors,
      markets,
    });
    // A fund 40% in NVDA has 40% exposure, not 100%.
    expect(cells.find((cell) => cell.dimension === "sector")?.weight).toBe(40);
  });

  it("returns nothing for an empty portfolio", () => {
    expect(computeExposure({ holdings: [], sectors, markets })).toEqual([]);
  });
});

describe("cosineSimilarity", () => {
  it("scores identical vectors as 1 and disjoint vectors as 0", () => {
    const a = new Map([["gics:Technology", 60]]);
    const b = new Map([["gics:Technology", 30]]);
    const c = new Map([["gics:Energy", 30]]);

    expect(cosineSimilarity(a, b)).toBe(1);
    expect(cosineSimilarity(a, c)).toBe(0);
    expect(cosineSimilarity(a, new Map())).toBe(0);
  });

  it("builds vectors from sector cells only", () => {
    const vector = toExposureVector([
      { dimension: "sector", taxonomy: "gics", key: "Technology", label: null, weight: 50, coverage: 1 },
      { dimension: "market", taxonomy: "", key: "US", label: "US", weight: 60, coverage: 1 },
    ]);
    expect([...vector.keys()]).toEqual(["gics:Technology"]);
  });
});

describe("holdingsOverlap", () => {
  it("sums the minimum shared weight", () => {
    const overlap = holdingsOverlap(
      [
        { symbol: "NVDA", weight: 30 },
        { symbol: "AAPL", weight: 20 },
      ],
      [
        { symbol: "NVDA", weight: 25 },
        { symbol: "MSFT", weight: 40 },
      ],
    );
    expect(overlap).toBe(25);
  });

  it("is zero for disjoint portfolios", () => {
    expect(
      holdingsOverlap([{ symbol: "NVDA", weight: 30 }], [{ symbol: "JPM", weight: 30 }]),
    ).toBe(0);
  });
});

describe("holdingStability", () => {
  it("scores an unchanged portfolio as fully stable", () => {
    const holdings = [
      { symbol: "NVDA", weight: 30 },
      { symbol: "AAPL", weight: 20 },
    ];
    expect(holdingStability(holdings, holdings).stability).toBe(1);
  });

  it("reports drift with the names that changed", () => {
    const result = holdingStability(
      [
        { symbol: "NVDA", weight: 30 },
        { symbol: "AAPL", weight: 10 },
      ],
      [
        { symbol: "NVDA", weight: 25 },
        { symbol: "JPM", weight: 15 },
      ],
    );

    expect(result.stability).toBe(0.75);
    expect(result.dropped).toEqual(["AAPL"]);
    expect(result.added).toEqual(["JPM"]);
    expect(result.retained).toEqual(["NVDA"]);
  });
});
