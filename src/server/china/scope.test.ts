import { describe, expect, it } from "vitest";
import { FRESHNESS_MS, isFresh, isIngestScope, scopeFilter } from "./scope.js";

describe("isIngestScope", () => {
  it("accepts the known scopes and rejects anything else", () => {
    expect(isIngestScope("qdii")).toBe(true);
    expect(isIngestScope("all")).toBe(true);
    // Guards the `--types=` flag and the API body against a silent fallthrough
    // to "everything", which would be a 27k-fund run nobody asked for.
    expect(isIngestScope("QDII")).toBe(false);
    expect(isIngestScope("bonds")).toBe(false);
  });
});

describe("scopeFilter", () => {
  it("returns no predicate for the unfiltered scopes", () => {
    // `all` means every fund; `codes` is filtered by the caller's explicit list.
    expect(scopeFilter("all")).toBeUndefined();
    expect(scopeFilter("codes")).toBeUndefined();
  });

  it("returns a predicate for each narrowing scope", () => {
    expect(scopeFilter("qdii")).toBeDefined();
    expect(scopeFilter("index")).toBeDefined();
    expect(scopeFilter("equity")).toBeDefined();
  });
});

describe("isFresh", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);

  it("treats a never-synced fund as stale", () => {
    expect(isFresh(null, "holdings", now)).toBe(false);
  });

  it("keeps a fund fresh inside its window and drops it outside", () => {
    const justInside = new Date(now - FRESHNESS_MS.holdings + 60_000);
    const justOutside = new Date(now - FRESHNESS_MS.holdings - 60_000);
    expect(isFresh(justInside, "holdings", now)).toBe(true);
    expect(isFresh(justOutside, "holdings", now)).toBe(false);
  });

  it("ages NAV faster than holdings", () => {
    // A daily run has to refresh NAV without refetching quarterly holdings;
    // one shared window would force a choice between stale NAV and wasted
    // holdings requests.
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
    expect(isFresh(twoDaysAgo, "nav", now)).toBe(false);
    expect(isFresh(twoDaysAgo, "holdings", now)).toBe(true);
    expect(isFresh(twoDaysAgo, "details", now)).toBe(true);
  });
});
