/**
 * NAV series statistics — pure functions, no database.
 *
 * Computed from cumulative NAV (累计净值) whenever it is available, because unit
 * NAV drops on every distribution: measuring a long-horizon return from it
 * understates the fund by exactly the dividends it paid.
 */

export interface NavSeriesPoint {
  navDate: string;
  nav: number | null;
  accNav: number | null;
}

export interface PerformanceResult {
  startDate: string;
  endDate: string;
  days: number;
  points: number;
  basis: "accNav" | "nav";
  cumulativeReturnPercent: number;
  /** Null below 30 days — annualizing a short window produces a meaningless number. */
  annualizedReturnPercent: number | null;
  maxDrawdownPercent: number;
  annualizedVolatilityPercent: number | null;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * @param points NAV observations in any order; sorted ascending internally.
 */
export function computePerformance(points: NavSeriesPoint[]): PerformanceResult | null {
  const sorted = [...points].sort((a, b) => a.navDate.localeCompare(b.navDate));

  // Prefer cumulative NAV, but only if the whole series has it — mixing the two
  // bases mid-series would invent a return on the switchover day.
  const basis: "accNav" | "nav" = sorted.every((point) => point.accNav !== null) ? "accNav" : "nav";
  const series = sorted
    .map((point) => ({ date: point.navDate, value: basis === "accNav" ? point.accNav : point.nav }))
    .filter((point): point is { date: string; value: number } => point.value !== null && point.value > 0);

  if (series.length < 2) return null;

  const first = series[0];
  const last = series.at(-1);
  if (first === undefined || last === undefined) return null;

  const cumulative = last.value / first.value - 1;
  const days = daysBetween(first.date, last.date);

  let peak = first.value;
  let maxDrawdown = 0;
  const dailyReturns: number[] = [];

  for (let i = 0; i < series.length; i++) {
    const point = series[i];
    if (point === undefined) continue;
    if (point.value > peak) peak = point.value;
    const drawdown = (peak - point.value) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    const previous = series[i - 1];
    if (previous !== undefined) dailyReturns.push(point.value / previous.value - 1);
  }

  let volatility: number | null = null;
  if (dailyReturns.length >= 20) {
    const mean = dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (dailyReturns.length - 1);
    volatility = Math.sqrt(variance) * Math.sqrt(252);
  }

  const annualized =
    days >= 30 ? (1 + cumulative) ** (365 / days) - 1 : null;

  return {
    startDate: first.date,
    endDate: last.date,
    days,
    points: series.length,
    basis,
    cumulativeReturnPercent: round(cumulative * 100, 2),
    annualizedReturnPercent: annualized === null ? null : round(annualized * 100, 2),
    maxDrawdownPercent: round(maxDrawdown * 100, 2),
    annualizedVolatilityPercent: volatility === null ? null : round(volatility * 100, 2),
  };
}
