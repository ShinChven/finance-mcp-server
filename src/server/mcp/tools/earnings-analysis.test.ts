import { describe, expect, it } from "vitest";
import { beatStreak, buildEarningsAnalysis, buildSurprises } from "./earnings-analysis.js";

describe("buildSurprises", () => {
  it("orders newest first regardless of the order Yahoo returns", () => {
    const surprises = buildSurprises({
      history: [
        { quarter: new Date("2025-03-31"), epsActual: 1, epsEstimate: 1 },
        { quarter: new Date("2026-03-31"), epsActual: 2, epsEstimate: 1.8 },
        { quarter: new Date("2025-09-30"), epsActual: 1.5, epsEstimate: 1.4 },
      ],
    });
    expect(surprises.map((s) => s.quarter)).toEqual(["2026-03-31", "2025-09-30", "2025-03-31"]);
  });

  it("recomputes the surprise percentage rather than trusting Yahoo's field", () => {
    const [surprise] = buildSurprises({
      history: [
        // Yahoo reports this one as a ratio (0.25); the recomputed value is a percentage.
        { quarter: new Date("2026-06-30"), epsActual: 2.5, epsEstimate: 2, surprisePercent: 0.25 },
      ],
    });
    expect(surprise?.surprisePercent).toBe(25);
    expect(surprise?.beat).toBe(true);
  });

  it("marks a miss and keeps the sign", () => {
    const [surprise] = buildSurprises({
      history: [{ quarter: new Date("2026-06-30"), epsActual: 1.6, epsEstimate: 2 }],
    });
    expect(surprise?.surprisePercent).toBe(-20);
    expect(surprise?.beat).toBe(false);
  });

  it("declines to divide by a zero estimate", () => {
    const [surprise] = buildSurprises({
      history: [{ quarter: new Date("2026-06-30"), epsActual: 0.1, epsEstimate: 0 }],
    });
    expect(surprise?.surprisePercent).toBeNull();
  });

  it("returns nothing when the module is absent", () => {
    expect(buildSurprises(undefined)).toEqual([]);
    expect(buildSurprises({})).toEqual([]);
  });
});

describe("beatStreak", () => {
  it("counts consecutive beats from the most recent quarter", () => {
    expect(
      beatStreak([
        { quarter: "2026-06-30", epsActual: 2, epsEstimate: 1, surprisePercent: 100, beat: true },
        { quarter: "2026-03-31", epsActual: 2, epsEstimate: 1, surprisePercent: 100, beat: true },
        { quarter: "2025-12-31", epsActual: 1, epsEstimate: 2, surprisePercent: -50, beat: false },
        { quarter: "2025-09-30", epsActual: 2, epsEstimate: 1, surprisePercent: 100, beat: true },
      ]),
    ).toBe(2);
  });

  it("is zero when the latest quarter missed", () => {
    expect(
      beatStreak([
        { quarter: "2026-06-30", epsActual: 1, epsEstimate: 2, surprisePercent: -50, beat: false },
      ]),
    ).toBe(0);
  });
});

describe("buildEarningsAnalysis", () => {
  const summary = {
    earningsHistory: {
      history: [{ quarter: new Date("2026-06-30"), epsActual: 2.2, epsEstimate: 2 }],
    },
    earningsTrend: {
      trend: [
        {
          period: "0q",
          endDate: new Date("2026-09-30"),
          earningsEstimate: { avg: 2.5, low: 2.2, high: 2.8, numberOfAnalysts: 30, yearAgoEps: 2 },
          revenueEstimate: { avg: 1_000, growth: 0.12 },
          epsTrend: { current: 2.5, "7daysAgo": 2.48, "30daysAgo": 2.4, "60daysAgo": 2.3, "90daysAgo": 2.2 },
          epsRevisions: { upLast30days: 12, downLast30days: 1 },
        },
        // Long-horizon rows carry no useful revision history and are dropped.
        { period: "+5y", endDate: null, earningsEstimate: {}, epsTrend: {} },
      ],
    },
    calendarEvents: {
      earnings: { earningsDate: [new Date("2026-10-28"), new Date("2026-11-01")] },
    },
    financialData: { revenueGrowth: 0.24, earningsGrowth: 2.94, profitMargins: 0.547 },
  };

  it("composes the modules into one answer", () => {
    const result = buildEarningsAnalysis("GOOG", summary) as Record<string, unknown>;
    expect(result["symbol"]).toBe("GOOG");
    expect(result["nextEarningsDate"]).toBe("2026-10-28");
    expect(result["beatStreak"]).toBe(1);
  });

  it("keeps only the forward periods that have revision history", () => {
    const result = buildEarningsAnalysis("GOOG", summary) as Record<string, unknown>;
    const revisions = result["revisions"] as { period: string | null }[];
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.period).toBe("0q");
  });

  it("reads the direction of the 30-day consensus move", () => {
    const result = buildEarningsAnalysis("GOOG", summary) as Record<string, unknown>;
    const revisions = result["revisions"] as { revision30dPercent: number | null; direction: string }[];
    // 2.5 vs 2.4 thirty days ago.
    expect(revisions[0]?.revision30dPercent).toBe(4.17);
    expect(revisions[0]?.direction).toBe("up");
  });

  it("calls a flat consensus flat rather than a rounding-noise trend", () => {
    const flat = buildEarningsAnalysis("X", {
      earningsTrend: {
        trend: [{ period: "0q", epsTrend: { current: 2.5, "30daysAgo": 2.5 }, epsRevisions: {} }],
      },
    }) as Record<string, unknown>;
    const revisions = flat["revisions"] as { direction: string }[];
    expect(revisions[0]?.direction).toBe("flat");
  });

  it("degrades to nulls instead of throwing when Yahoo returns nothing", () => {
    const empty = buildEarningsAnalysis("X", {}) as Record<string, unknown>;
    expect(empty["nextEarningsDate"]).toBeNull();
    expect(empty["surprises"]).toEqual([]);
    expect(empty["estimates"]).toEqual([]);
    expect(empty["beatStreak"]).toBe(0);
  });
});
