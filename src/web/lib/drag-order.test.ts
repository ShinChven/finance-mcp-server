import { describe, expect, it } from "vitest";
import { moveInOrder, slotForPosition, sortByIds } from "./drag-order.js";

describe("moveInOrder", () => {
  it("moves an entry down, closing the gap behind it", () => {
    expect(moveInOrder(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an entry up", () => {
    expect(moveInOrder(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("clamps a target past either end instead of dropping the entry", () => {
    expect(moveInOrder(["a", "b", "c"], 1, -5)).toEqual(["b", "a", "c"]);
    expect(moveInOrder(["a", "b", "c"], 1, 99)).toEqual(["a", "c", "b"]);
  });

  it("returns the same array when nothing moves, so callers can skip a commit", () => {
    const items = ["a", "b", "c"];
    expect(moveInOrder(items, 1, 1)).toBe(items);
    expect(moveInOrder(items, 7, 0)).toBe(items);
  });
});

describe("slotForPosition", () => {
  // Three rows of unequal height: 0–40, 40–140, 140–180.
  const midpoints = [20, 90, 160];

  it("keeps the first slot until the pointer passes the first midpoint", () => {
    expect(slotForPosition(midpoints, 0)).toBe(0);
    expect(slotForPosition(midpoints, 19)).toBe(0);
    expect(slotForPosition(midpoints, 21)).toBe(1);
  });

  it("uses each row's own midpoint rather than a uniform height", () => {
    // 100 is past the tall middle row's top but not its centre.
    expect(slotForPosition(midpoints, 89)).toBe(1);
    expect(slotForPosition(midpoints, 100)).toBe(2);
  });

  it("pins to the last slot below the last midpoint", () => {
    expect(slotForPosition(midpoints, 5_000)).toBe(2);
  });

  it("has no slot to offer for an empty list", () => {
    expect(slotForPosition([], 10)).toBe(0);
  });
});

describe("sortByIds", () => {
  const records = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("reorders records to match the id order", () => {
    expect(sortByIds(records, ["c", "a", "b"]).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps a record the order never mentions rather than dropping it", () => {
    expect(sortByIds(records, ["c"]).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("ignores ids with no record — a stale order must not invent rows", () => {
    expect(sortByIds(records, ["gone", "b"]).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });
});
