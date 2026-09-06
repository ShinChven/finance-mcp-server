import { describe, expect, it } from "vitest";
import { fallbackIdea, ideaParam, looksLikeRef, parseIdeaParam } from "./discover.js";

describe("parseIdeaParam", () => {
  it("round-trips an address", () => {
    expect(parseIdeaParam(ideaParam({ kind: "symbol", ref: "0700.HK" }))).toEqual({
      kind: "symbol",
      ref: "0700.HK",
    });
    expect(parseIdeaParam(ideaParam({ kind: "fund", ref: "161125" }))).toEqual({
      kind: "fund",
      ref: "161125",
    });
  });

  it("splits on the first colon only, so a ref may contain one", () => {
    expect(parseIdeaParam("symbol:BRK:B")).toEqual({ kind: "symbol", ref: "BRK:B" });
  });

  it("rejects anything that does not address an instrument", () => {
    for (const value of ["", "NVDA", "symbol:", ":NVDA", "note:1", "symbol"]) {
      expect(parseIdeaParam(value)).toBeNull();
    }
  });
});

describe("looksLikeRef", () => {
  it("accepts the shapes a symbol actually takes", () => {
    for (const value of ["NVDA", "0700.HK", "BRK-B", "^GSPC", "BTC-USD", "161125"]) {
      expect(looksLikeRef(value)).toBe(true);
    }
  });

  it("rejects names, which could never be tracked as typed", () => {
    for (const value of ["易方达", "NVIDIA Corp", "", "   ", "a".repeat(33)]) {
      expect(looksLikeRef(value)).toBe(false);
    }
  });
});

describe("fallbackIdea", () => {
  it("stores a symbol the way the watchlist would", () => {
    expect(fallbackIdea(" nvda ")).toMatchObject({ kind: "symbol", ref: "NVDA" });
  });

  it("reads bare six digits as a fund code, like detectItemKind", () => {
    expect(fallbackIdea("161125")).toMatchObject({ kind: "fund", ref: "161125" });
  });
});
