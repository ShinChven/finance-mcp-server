import { describe, expect, it } from "vitest";
import { computePerformance, type NavSeriesPoint } from "./performance.js";

function series(values: [string, number, number | null][]): NavSeriesPoint[] {
  return values.map(([navDate, nav, accNav]) => ({ navDate, nav, accNav }));
}

describe("computePerformance", () => {
  it("measures cumulative return and drawdown from cumulative NAV", () => {
    const result = computePerformance(
      series([
        ["2026-01-01", 1, 1],
        ["2026-04-01", 1.5, 1.5],
        ["2026-07-01", 1.2, 1.2],
      ]),
    );

    expect(result?.basis).toBe("accNav");
    expect(result?.cumulativeReturnPercent).toBe(20);
    // Peak 1.5 → trough 1.2 is a 20% drawdown.
    expect(result?.maxDrawdownPercent).toBe(20);
    expect(result?.startDate).toBe("2026-01-01");
    expect(result?.endDate).toBe("2026-07-01");
  });

  it("sorts an out-of-order series before measuring", () => {
    const descending = computePerformance(
      series([
        ["2026-07-01", 1.2, 1.2],
        ["2026-01-01", 1, 1],
      ]),
    );
    // Eastmoney returns NAV newest-first; reading it as given would invert the return.
    expect(descending?.cumulativeReturnPercent).toBe(20);
  });

  it("prefers cumulative NAV so distributions are not read as losses", () => {
    // Unit NAV drops from 2.0 to 1.0 on a distribution while accNav keeps rising.
    const result = computePerformance(
      series([
        ["2026-01-01", 1, 1],
        ["2026-06-01", 2, 2],
        ["2026-07-01", 1, 2.1],
      ]),
    );

    expect(result?.basis).toBe("accNav");
    expect(result?.cumulativeReturnPercent).toBe(110);
    expect(result?.maxDrawdownPercent).toBe(0);
  });

  it("falls back to unit NAV when the series lacks cumulative values", () => {
    const result = computePerformance(
      series([
        ["2026-01-01", 1, null],
        ["2026-07-01", 1.1, null],
      ]),
    );
    expect(result?.basis).toBe("nav");
    expect(result?.cumulativeReturnPercent).toBeCloseTo(10, 2);
  });

  it("annualizes only over a meaningful window", () => {
    const short = computePerformance(
      series([
        ["2026-07-01", 1, 1],
        ["2026-07-10", 1.05, 1.05],
      ]),
    );
    expect(short?.annualizedReturnPercent).toBeNull();

    const full = computePerformance(
      series([
        ["2025-07-01", 1, 1],
        ["2026-07-01", 1.2, 1.2],
      ]),
    );
    expect(full?.annualizedReturnPercent).toBeCloseTo(20, 0);
  });

  it("omits volatility for a series too short to estimate it", () => {
    const result = computePerformance(
      series([
        ["2026-01-01", 1, 1],
        ["2026-07-01", 1.2, 1.2],
      ]),
    );
    expect(result?.annualizedVolatilityPercent).toBeNull();
  });

  it("computes volatility once enough observations exist", () => {
    const points: NavSeriesPoint[] = [];
    let value = 1;
    for (let i = 0; i < 40; i++) {
      value *= i % 2 === 0 ? 1.01 : 0.995;
      const day = String(i + 1).padStart(2, "0");
      points.push({ navDate: `2026-03-${day}`, nav: value, accNav: value });
    }
    expect(computePerformance(points)?.annualizedVolatilityPercent).toBeGreaterThan(0);
  });

  it("returns null when there is not enough data", () => {
    expect(computePerformance([])).toBeNull();
    expect(computePerformance(series([["2026-01-01", 1, 1]]))).toBeNull();
    // Non-positive NAV values are dropped rather than producing infinities.
    expect(computePerformance(series([["2026-01-01", 0, 0], ["2026-02-01", 0, 0]]))).toBeNull();
  });
});
