import { describe, expect, it } from "vitest";
import { computePerformance, computeTrailingReturns, type NavSeriesPoint } from "./performance.js";

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

/** A daily series of `days` observations ending on 2026-07-01, growing steadily. */
function dailySeries(days: number, dailyGrowth = 1.0005): NavSeriesPoint[] {
  const points: NavSeriesPoint[] = [];
  const end = Date.UTC(2026, 6, 1);
  let value = 1;
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    points.push({ navDate: date, nav: value, accNav: value });
    value *= dailyGrowth;
  }
  return points;
}

function byPeriod(points: NavSeriesPoint[], options?: { asOf?: string }) {
  const result = computeTrailingReturns(points, options);
  return new Map((result?.periods ?? []).map((entry) => [entry.period, entry]));
}

describe("computeTrailingReturns", () => {
  it("measures each window from the latest observation", () => {
    const periods = byPeriod(
      series([
        ["2025-07-01", 1, 1],
        ["2026-01-01", 1.1, 1.1],
        ["2026-04-01", 1.2, 1.2],
        ["2026-06-01", 1.25, 1.25],
        ["2026-06-30", 1.3, 1.3],
        ["2026-07-01", 1.32, 1.32],
      ]),
    );

    // 1D is the step from the previous observation, whatever its date.
    expect(periods.get("1d")?.returnPercent).toBeCloseTo(1.54, 1);
    expect(periods.get("1d")?.from).toBe("2026-06-30");
    // 1M anchors on 2026-06-01, the last NAV on or before 2026-06-01.
    expect(periods.get("1m")?.from).toBe("2026-06-01");
    expect(periods.get("1m")?.returnPercent).toBeCloseTo(5.6, 1);
    expect(periods.get("3m")?.from).toBe("2026-04-01");
    expect(periods.get("6m")?.from).toBe("2026-01-01");
    expect(periods.get("1y")?.from).toBe("2025-07-01");
    expect(periods.get("max")?.from).toBe("2025-07-01");
    expect(periods.get("max")?.returnPercent).toBeCloseTo(32, 5);
  });

  it("omits windows the history does not reach back to", () => {
    const periods = byPeriod(dailySeries(200));
    expect(periods.has("3m")).toBe(true);
    // 200 days of history cannot quote a year, let alone three.
    expect(periods.has("1y")).toBe(false);
    expect(periods.has("3y")).toBe(false);
    expect(periods.has("max")).toBe(true);
  });

  it("lets a fund a few days short of the anniversary still quote the window", () => {
    // First NAV is four days after the 1Y target — a fund that listed mid-week,
    // not a fund missing a year of history.
    const periods = byPeriod(dailySeries(362));
    expect(periods.get("1y")?.from).toBe("2025-07-05");
    expect(periods.get("1y")?.days).toBe(361);
  });

  it("annualizes only windows of a year or more", () => {
    const periods = byPeriod(dailySeries(800));
    expect(periods.get("6m")?.annualizedPercent).toBeNull();
    expect(periods.get("1y")?.annualizedPercent).toBeGreaterThan(0);
  });

  it("ends the windows at `asOf` so a windowed report agrees with them", () => {
    const points = series([
      ["2026-01-01", 1, 1],
      ["2026-04-01", 1.2, 1.2],
      ["2026-07-01", 1.5, 1.5],
    ]);
    const result = computeTrailingReturns(points, { asOf: "2026-05-01" });
    expect(result?.asOf).toBe("2026-04-01");
    expect(result?.periods.find((entry) => entry.period === "max")?.returnPercent).toBe(20);
  });

  it("prefers cumulative NAV so a distribution is not read as a one-day loss", () => {
    const periods = byPeriod(
      series([
        ["2026-06-01", 2, 2],
        ["2026-07-01", 1, 2.1],
      ]),
    );
    expect(periods.get("1d")?.returnPercent).toBe(5);
  });

  it("returns null when there is not enough data", () => {
    expect(computeTrailingReturns([])).toBeNull();
    expect(computeTrailingReturns(series([["2026-01-01", 1, 1]]))).toBeNull();
    // An `asOf` before the series begins leaves nothing to measure.
    expect(
      computeTrailingReturns(series([["2026-01-01", 1, 1], ["2026-02-01", 1.1, 1.1]]), {
        asOf: "2025-01-01",
      }),
    ).toBeNull();
  });
});
