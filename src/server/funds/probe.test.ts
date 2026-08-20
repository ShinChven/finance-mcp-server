import { describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "../../shared/funds.js";
import { describeProbe, probeProvider } from "./probe.js";
import type { FundProvider } from "./provider.js";

/**
 * The probe exists to be believed when a provider caches nothing, so the one
 * thing it must never do is inherit the pipeline's tolerance for a step that
 * failed.
 */

function fakeProvider(overrides: Partial<FundProvider> = {}): FundProvider {
  return {
    id: "ishares",
    descriptor: PROVIDERS.ishares,
    requestIntervalMs: 0,
    requestsPerFund: 1,
    listUniverse: vi.fn(async () => [
      { code: "IVV", name: "iShares Core S&P 500 ETF", fundType: "Equity", isIndexFund: true, investsOffshore: false },
    ]),
    fetchDetails: vi.fn(async () => ({
      name: "iShares Core S&P 500 ETF",
      fundType: "Equity",
      trackingIndex: "S&P 500",
      company: "BlackRock",
      manager: null,
      feeRate: null,
      fundSize: 550_000,
      listedSymbol: "IVV",
      isIndexFund: true,
      investsOffshore: false,
    })),
    fetchHoldings: vi.fn(async () => ({
      entries: [{ symbol: "NVDA", name: "NVIDIA CORP", weight: 7.45, reportDate: "2026-08-15" }],
      dropped: 0,
    })),
    fetchNav: vi.fn(async () => [
      { navDate: "2026-08-15", nav: 640, accNav: 640, dailyReturn: 0.4 },
    ]),
    scopeFilter: () => undefined,
    ...overrides,
  };
}

describe("probeProvider", () => {
  it("walks all four calls and reports what each returned", async () => {
    const report = await probeProvider(fakeProvider());

    expect(report.ok).toBe(true);
    expect(report.code).toBe("IVV");
    expect(report.steps.map((step) => step.step)).toEqual([
      "universe",
      "details",
      "holdings",
      "nav",
    ]);
    expect(report.steps[2]?.detail).toContain("1 positions");
  });

  it("keeps going past a failed step, and says which one failed", async () => {
    // A source can list its lineup and still refuse the holdings download; one
    // report showing exactly where the wall is beats four separate runs.
    const provider = fakeProvider({
      fetchHoldings: vi.fn(async () => {
        throw new Error("iShares request failed (403)");
      }),
    });

    const report = await probeProvider(provider);

    expect(report.ok).toBe(false);
    expect(report.steps.find((step) => step.step === "holdings")).toMatchObject({
      ok: false,
      error: "iShares request failed (403)",
    });
    // The step after the failure still ran.
    expect(report.steps.find((step) => step.step === "nav")?.ok).toBe(true);
    expect(describeProbe(report)).toContain("FAIL holdings");
  });

  it("stops when the listing gives it no fund to ask about", async () => {
    const provider = fakeProvider({ listUniverse: vi.fn(async () => []) });

    const report = await probeProvider(provider);

    expect(report.ok).toBe(false);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]?.detail).toBe("0 funds");
  });

  it("probes the code it was given without waiting for the listing", async () => {
    const provider = fakeProvider({
      listUniverse: vi.fn(async () => {
        throw new Error("screener blocked");
      }),
    });

    const report = await probeProvider(provider, "IVV");

    expect(report.code).toBe("IVV");
    expect(report.steps[0]).toMatchObject({ step: "universe", ok: false });
    expect(report.steps.find((step) => step.step === "holdings")?.ok).toBe(true);
  });
});
