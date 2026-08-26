import { describe, expect, it } from "vitest";
import { describeFactor, staleLevels } from "./splits.js";
import type { WatchlistLevel } from "./types.js";

function level(overrides: Partial<WatchlistLevel> & Pick<WatchlistLevel, "price" | "createdAt">): WatchlistLevel {
  return {
    id: `level-${overrides.price}`,
    kind: "target",
    priceHigh: null,
    label: null,
    note: null,
    source: "user",
    status: "active",
    hitAt: null,
    validUntil: null,
    expired: false,
    side: "above",
    distancePercent: null,
    ...overrides,
  };
}

const split = (date: string, factor: number) =>
  ({ date, kind: "split", factor, amount: null }) as const;

describe("staleLevels", () => {
  it("flags a level recorded before a split", () => {
    // A 4-for-1 turns a $600 target into a line the price can never reach.
    const stale = staleLevels(
      [level({ price: 600, createdAt: "2026-01-10T09:00:00Z" })],
      [split("2026-06-10", 4)],
    );

    expect(stale).toHaveLength(1);
    expect(stale[0]?.factor).toBe(4);
    expect(stale[0]?.suggested).toBe(150);
  });

  it("leaves a level recorded after the split alone", () => {
    const stale = staleLevels(
      [level({ price: 150, createdAt: "2026-07-01T09:00:00Z" })],
      [split("2026-06-10", 4)],
    );
    expect(stale).toEqual([]);
  });

  it("compounds two splits, because a level set before both is wrong by the product", () => {
    const stale = staleLevels(
      [level({ price: 600, createdAt: "2026-01-10T09:00:00Z" })],
      [split("2026-03-10", 4), split("2026-06-10", 2)],
    );
    expect(stale[0]?.factor).toBe(8);
    expect(stale[0]?.suggested).toBe(75);
  });

  it("rescales both edges of a zone", () => {
    const stale = staleLevels(
      [level({ price: 600, priceHigh: 640, createdAt: "2026-01-10T09:00:00Z" })],
      [split("2026-06-10", 4)],
    );
    expect(stale[0]?.suggested).toBe(150);
    expect(stale[0]?.suggestedHigh).toBe(160);
  });

  it("ignores dividends and no-op ratios", () => {
    const stale = staleLevels(
      [level({ price: 600, createdAt: "2026-01-10T09:00:00Z" })],
      [
        { date: "2026-06-10", kind: "dividend", factor: null, amount: 0.4 },
        split("2026-06-11", 1),
      ],
    );
    expect(stale).toEqual([]);
  });
});

describe("describeFactor", () => {
  it("reads a ratio the way a person says it", () => {
    expect(describeFactor(4)).toBe("4-for-1");
    expect(describeFactor(0.25)).toBe("1-for-4");
  });
});
