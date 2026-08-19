import { describe, expect, it } from "vitest";
import { isFresh, PROVIDERS, previewQuerySchema, syncBodySchema } from "./funds.js";

describe("previewQuerySchema", () => {
  it("reads ?force=false as false", () => {
    // Regression: `z.coerce.boolean()` is `Boolean(value)`, and
    // `Boolean("false")` is `true`. The dashboard sends the flag on every
    // preview request, so the confirmation dialog quoted full-refetch numbers
    // for a run that would have skipped the fresh funds.
    const parsed = previewQuerySchema.parse({ provider: "eastmoney", scope: "qdii", force: "false" });
    expect(parsed.force).toBe(false);
  });

  it("reads ?force=true as true", () => {
    expect(previewQuerySchema.parse({ provider: "eastmoney", scope: "qdii", force: "true" }).force).toBe(true);
  });

  it("defaults force to false when the param is absent", () => {
    expect(previewQuerySchema.parse({ provider: "eastmoney", scope: "qdii" }).force).toBe(false);
  });

  it("rejects a non-boolean force rather than guessing", () => {
    expect(previewQuerySchema.safeParse({ provider: "eastmoney", scope: "qdii", force: "yes" }).success).toBe(false);
  });

  it("rejects a scope the provider does not have", () => {
    expect(previewQuerySchema.safeParse({ provider: "eastmoney", scope: "bonds" }).success).toBe(
      false,
    );
  });

  it("rejects a scope belonging to a different provider", () => {
    // Both providers have `equity`, but only iShares has `international` and
    // only Eastmoney has `qdii`. Without the cross-check a run would start with
    // a scope whose filter matches nothing, and silently do nothing.
    expect(
      previewQuerySchema.safeParse({ provider: "eastmoney", scope: "international" }).success,
    ).toBe(false);
    expect(previewQuerySchema.safeParse({ provider: "ishares", scope: "qdii" }).success).toBe(false);
    expect(previewQuerySchema.safeParse({ provider: "ishares", scope: "equity" }).success).toBe(
      true,
    );
  });

  it("rejects an unknown provider", () => {
    expect(previewQuerySchema.safeParse({ provider: "morningstar", scope: "all" }).success).toBe(
      false,
    );
  });
});

describe("syncBodySchema", () => {
  it("accepts a scope with an optional limit", () => {
    expect(syncBodySchema.parse({ provider: "eastmoney", scope: "all", limit: 50 })).toEqual({
      provider: "eastmoney",
      scope: "all",
      limit: 50,
      force: false,
    });
  });

  it("rejects a limit of zero or a negative limit", () => {
    expect(syncBodySchema.safeParse({ provider: "eastmoney", scope: "qdii", limit: 0 }).success).toBe(false);
    expect(syncBodySchema.safeParse({ provider: "eastmoney", scope: "qdii", limit: -5 }).success).toBe(false);
  });

  it("accepts a null limit as the uncapped signal", () => {
    // Regression: the dashboard used to send no limit at all, so `runIngest`
    // fell back to its CLI-oriented default of 200 while the confirmation
    // dialog had already priced the whole scope. The user approved "3,000
    // funds, ~45 min" and got 200. `null` is how the dashboard now says
    // "no cap" out loud.
    expect(syncBodySchema.parse({ provider: "eastmoney", scope: "all", limit: null })).toEqual({
      provider: "eastmoney",
      scope: "all",
      limit: null,
      force: false,
    });
  });

  it("keeps an omitted limit distinct from an explicit null", () => {
    // The two mean different things downstream — omitted defers to the
    // runner's default, null removes the cap — so the schema must not
    // collapse one into the other.
    expect(syncBodySchema.parse({ provider: "eastmoney", scope: "qdii" }).limit).toBeUndefined();
    expect(syncBodySchema.parse({ provider: "eastmoney", scope: "qdii", limit: null }).limit).toBeNull();
  });
});

describe("isFresh", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);

  it("treats a never-synced fund as stale", () => {
    expect(isFresh(null, "holdings", "eastmoney", now)).toBe(false);
  });

  it("keeps a fund fresh inside its window and drops it outside", () => {
    const window = PROVIDERS.eastmoney.freshness.holdings;
    expect(isFresh(new Date(now - window + 60_000), "holdings", "eastmoney", now)).toBe(true);
    expect(isFresh(new Date(now - window - 60_000), "holdings", "eastmoney", now)).toBe(false);
  });

  it("ages NAV faster than holdings", () => {
    // A daily run has to refresh NAV without refetching quarterly holdings;
    // one shared window would force a choice between stale NAV and wasted
    // holdings requests.
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
    expect(isFresh(twoDaysAgo, "nav", "eastmoney", now)).toBe(false);
    expect(isFresh(twoDaysAgo, "holdings", "eastmoney", now)).toBe(true);
    expect(isFresh(twoDaysAgo, "details", "eastmoney", now)).toBe(true);
  });

  it("expires a daily provider's holdings that a quarterly one would keep", () => {
    // The reason freshness is per provider at all: iShares republishes its
    // whole book every trading day, so caching it for a week would serve
    // week-old positions as current.
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
    expect(isFresh(twoDaysAgo, "holdings", "eastmoney", now)).toBe(true);
    expect(isFresh(twoDaysAgo, "holdings", "ishares", now)).toBe(false);
  });
});
