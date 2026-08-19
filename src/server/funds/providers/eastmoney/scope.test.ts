import { describe, expect, it } from "vitest";
import { eastmoneyScopeFilter } from "./scope.js";

describe("eastmoneyScopeFilter", () => {
  it("returns no predicate for the unfiltered scopes", () => {
    // `all` means every fund this provider has; `codes` is filtered by the
    // caller's explicit list.
    expect(eastmoneyScopeFilter("all")).toBeUndefined();
    expect(eastmoneyScopeFilter("codes")).toBeUndefined();
  });

  it("returns a predicate for each narrowing scope", () => {
    expect(eastmoneyScopeFilter("qdii")).toBeDefined();
    expect(eastmoneyScopeFilter("index")).toBeDefined();
    expect(eastmoneyScopeFilter("equity")).toBeDefined();
  });

  it("ignores another provider's scope rather than matching everything", () => {
    // `international` belongs to iShares. Falling through to "no predicate"
    // here would silently widen a run to the entire 27k-fund universe.
    expect(eastmoneyScopeFilter("international")).toBeUndefined();
  });
});
