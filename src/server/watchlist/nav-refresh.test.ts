import { describe, expect, it, vi } from "vitest";
import type { EnsureResult, FundCache } from "../funds/ondemand.js";
import { isNavStale, MAX_NAV_REFRESH_PER_READ, refreshStaleFundNav } from "./nav-refresh.js";
import type { FundSnapshot } from "./repo.js";

const NOW = new Date("2026-09-08T12:00:00Z").getTime();

function snapshot(code: string, navSyncedAt: Date | null): FundSnapshot {
  return {
    code,
    name: `Fund ${code}`,
    nav: 1.5,
    accNav: 2,
    dailyReturn: 0.3,
    navDate: "2026-08-20",
    provider: "eastmoney",
    navSyncedAt,
  };
}

function stubCache(result: Partial<EnsureResult> = {}): {
  cache: FundCache;
  calls: { code: string; steps?: string[]; classify?: boolean }[];
} {
  const calls: { code: string; steps?: string[]; classify?: boolean }[] = [];
  const cache: FundCache = {
    ensure: async (code, options) => {
      calls.push({
        code,
        ...(options?.steps ? { steps: options.steps } : {}),
        ...(options?.classify !== undefined ? { classify: options.classify } : {}),
      });
      return {
        code,
        status: "cached",
        fetched: ["nav"],
        symbolsClassified: 0,
        unclassified: 0,
        message: `Cached fund ${code} on demand.`,
        ...result,
      } as EnsureResult;
    },
  };
  return { cache, calls };
}

/** The background batch is fire-and-forget, so tests wait for the microtasks. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("isNavStale", () => {
  it("reads the provider's own window, not a calendar guess", () => {
    // Eastmoney publishes NAV daily, so its window is a day.
    expect(isNavStale(snapshot("162411", new Date(NOW - 60 * 60 * 1000)), NOW)).toBe(false);
    expect(isNavStale(snapshot("162411", new Date(NOW - 48 * 60 * 60 * 1000)), NOW)).toBe(true);
  });

  it("treats a fund that has never been synced as stale", () => {
    expect(isNavStale(snapshot("162411", null), NOW)).toBe(true);
  });
});

describe("refreshStaleFundNav", () => {
  it("fetches NAV only, and skips classification", async () => {
    const { cache, calls } = stubCache();
    refreshStaleFundNav([snapshot("162411", null)], cache);
    await settle();

    expect(calls).toEqual([{ code: "162411", steps: ["nav"], classify: false }]);
  });

  it("leaves fresh funds alone", async () => {
    const { cache, calls } = stubCache();
    const started = refreshStaleFundNav([snapshot("162411", new Date(Date.now() - 1000))], cache);
    await settle();

    expect(started).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("caps how many funds one read may queue", async () => {
    const { cache, calls } = stubCache();
    const stale = Array.from({ length: MAX_NAV_REFRESH_PER_READ + 3 }, (_, index) =>
      snapshot(`10000${index}`, null),
    );

    const started = refreshStaleFundNav(stale, cache);
    await settle();

    expect(started).toHaveLength(MAX_NAV_REFRESH_PER_READ);
    expect(calls).toHaveLength(MAX_NAV_REFRESH_PER_READ);
  });

  it("returns before the fetches do, so a page load never waits on one", async () => {
    let resolveEnsure: (() => void) | undefined;
    const cache: FundCache = {
      ensure: async (code) => {
        await new Promise<void>((resolve) => {
          resolveEnsure = resolve;
        });
        return {
          code,
          status: "cached",
          fetched: ["nav"],
          symbolsClassified: 0,
          unclassified: 0,
          message: "",
        };
      },
    };

    const started = refreshStaleFundNav([snapshot("162411", null)], cache);

    expect(started).toEqual(["162411"]);
    await settle();
    resolveEnsure?.();
  });

  it("notifies once when something new landed", async () => {
    const onRefreshed = vi.fn();
    const { cache } = stubCache();
    refreshStaleFundNav([snapshot("162411", null), snapshot("017436", null)], cache, {
      onRefreshed,
    });
    await settle();

    expect(onRefreshed).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the upstream had nothing to add", async () => {
    const onRefreshed = vi.fn();
    const { cache } = stubCache({ status: "failed", message: "Eastmoney timed out" });
    refreshStaleFundNav([snapshot("162411", null)], cache, { onRefreshed });
    await settle();

    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it("swallows a throwing cache rather than crashing the process behind a sent response", async () => {
    const onRefreshed = vi.fn();
    const cache: FundCache = {
      ensure: async () => {
        throw new Error("Eastmoney unreachable");
      },
    };

    expect(() =>
      refreshStaleFundNav([snapshot("162411", null)], cache, { onRefreshed }),
    ).not.toThrow();
    await settle();
    expect(onRefreshed).not.toHaveBeenCalled();
  });
});
