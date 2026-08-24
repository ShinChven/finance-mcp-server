/**
 * NAV series statistics — pure functions, no database.
 *
 * Computed from cumulative NAV (累计净值) whenever it is available, because unit
 * NAV drops on every distribution: measuring a long-horizon return from it
 * understates the fund by exactly the dividends it paid.
 */

import {
  navRangeMonths,
  TRAILING_PERIODS,
  type NavRangeId,
  type TrailingPeriodId,
} from "../../shared/funds.js";

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

interface ValuePoint {
  date: string;
  value: number;
}

/**
 * The one series every statistic here is measured from.
 *
 * Prefers cumulative NAV, but only if the whole series has it — mixing the two
 * bases mid-series would invent a return on the switchover day.
 */
function toValueSeries(points: NavSeriesPoint[]): { basis: "accNav" | "nav"; series: ValuePoint[] } {
  const sorted = [...points].sort((a, b) => a.navDate.localeCompare(b.navDate));
  const basis: "accNav" | "nav" = sorted.every((point) => point.accNav !== null) ? "accNav" : "nav";
  const series = sorted
    .map((point) => ({ date: point.navDate, value: basis === "accNav" ? point.accNav : point.nav }))
    .filter((point): point is ValuePoint => point.value !== null && point.value > 0);
  return { basis, series };
}

/**
 * @param points NAV observations in any order; sorted ascending internally.
 */
export function computePerformance(points: NavSeriesPoint[]): PerformanceResult | null {
  const { basis, series } = toValueSeries(points);
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

/** One window's return, measured between two observations that really exist. */
export interface TrailingReturn {
  period: TrailingPeriodId;
  /** The observation the window is measured from — a real NAV date, not the calendar target. */
  from: string;
  to: string;
  days: number;
  returnPercent: number;
  /** Null under a year: annualizing a short window turns noise into a forecast. */
  annualizedPercent: number | null;
}

export interface TrailingReturns {
  /** The observation every window ends on — the latest NAV, not today. */
  asOf: string;
  basis: "accNav" | "nav";
  /** Only the periods the NAV history actually covers; a young fund reports fewer. */
  periods: TrailingReturn[];
}

/**
 * How far past the calendar target a fund's first NAV may sit and still anchor
 * the window.
 *
 * A fund listed 51 weeks ago has no observation a year back and genuinely
 * cannot quote 1Y. But a fund whose history begins three days after the target
 * — because it listed mid-week, or because the target fell inside a holiday
 * cluster — would report nothing at all under an exact rule, which reads as
 * missing data rather than as the near-complete year it is. Anything longer
 * than a week of slack would start quoting an eleven-month return as 1Y.
 */
const START_GRACE_DAYS = 7;

/** The last observation on or before `date`, or null if the series starts later. */
function lastAtOrBefore(series: ValuePoint[], date: string): ValuePoint | null {
  let found: ValuePoint | null = null;
  for (const point of series) {
    if (point.date > date) break;
    found = point;
  }
  return found;
}

/**
 * `date` shifted back by whole months, clamped to the end of the target month.
 *
 * Without the clamp the platform's own rollover turns 31 March minus one month
 * into 3 March, quietly measuring a two-month window as 1M.
 */
function monthsBefore(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const daysInMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const clamped = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, daysInMonth)),
  );
  return clamped.toISOString().slice(0, 10);
}

/**
 * Return over each of the standard windows, ending at the fund's latest NAV.
 *
 * Every window is anchored to an observation that exists rather than to the
 * calendar date, and reports the pair it actually used — a 1Y return measured
 * from 361 days back is the honest answer for a fund whose NAV was not
 * published on the anniversary, and saying so is what lets a reader tell it
 * apart from one measured over a stale two-year gap.
 *
 * @param points NAV observations in any order; sorted ascending internally.
 * @param asOf   End the windows at the last observation on or before this date,
 *               so a windowed report and its trailing figures agree.
 */
export function computeTrailingReturns(
  points: NavSeriesPoint[],
  options: { asOf?: string } = {},
): TrailingReturns | null {
  const { basis, series } = toValueSeries(points);
  if (series.length < 2) return null;

  const asOf = options.asOf;
  const endIndex =
    asOf === undefined ? series.length - 1 : series.findLastIndex((point) => point.date <= asOf);
  if (endIndex < 1) return null;

  const window = series.slice(0, endIndex + 1);
  const end = window[endIndex];
  const first = window[0];
  if (end === undefined || first === undefined) return null;

  const periods: TrailingReturn[] = [];
  for (const period of TRAILING_PERIODS) {
    let start: ValuePoint | null;
    if (period.id === "max") {
      start = first;
    } else if (period.id === "1d") {
      // The previous observation, not yesterday: NAV is published on trading
      // days, so a fixed one-day step lands on a weekend two times in seven.
      start = window[endIndex - 1] ?? null;
    } else if (period.months !== null) {
      const target = monthsBefore(end.date, period.months);
      start = lastAtOrBefore(window, target);
      if (start === null && daysBetween(target, first.date) <= START_GRACE_DAYS) start = first;
    } else {
      start = null;
    }

    if (start === null || start.date === end.date) continue;

    const days = daysBetween(start.date, end.date);
    const cumulative = end.value / start.value - 1;
    periods.push({
      period: period.id,
      from: start.date,
      to: end.date,
      days,
      returnPercent: round(cumulative * 100, 2),
      annualizedPercent:
        days >= 365 ? round(((1 + cumulative) ** (365 / days) - 1) * 100, 2) : null,
    });
  }

  return { asOf: end.date, basis, periods };
}

/** One plotted observation: the date, the NAV on the chosen basis, and the
 *  percent change from the window's first observation. */
export interface NavChartPoint {
  date: string;
  value: number;
  changePercent: number;
}

export interface NavChartSeries {
  range: NavRangeId;
  basis: "accNav" | "nav";
  /** The window's real first and last observations, not the calendar bounds. */
  startDate: string;
  endDate: string;
  /** Observations the window actually holds, before any decimation. */
  observations: number;
  /** True when `points` is a decimated view — the caption has to say so. */
  downsampled: boolean;
  points: NavChartPoint[];
  /** Return, drawdown and volatility over this window, not the whole history. */
  performance: PerformanceResult | null;
}

/**
 * How many points a chart is drawn from at most.
 *
 * A twenty-year Chinese fund has ~4800 daily observations and the chart is a
 * few hundred pixels wide, so most of them would land on a pixel already
 * occupied. The cap is well above that width so the decimation never becomes
 * visible; it exists to keep the payload proportional to what can be seen.
 */
const DEFAULT_MAX_POINTS = 600;

/**
 * Largest-Triangle-Three-Buckets decimation.
 *
 * Plain every-nth sampling is what makes a decimated NAV line lie: a crash that
 * happens between two kept observations disappears entirely, and the drawdown
 * the eye measures off the chart stops matching the drawdown printed beside it.
 * LTTB keeps the point in each bucket that spans the largest area with its
 * neighbours, which is exactly the turning points, and always keeps the first
 * and last.
 *
 * `x` is the day offset rather than the array index, so a series with gaps —
 * a suspended fund, a provider that skips holidays — is weighted by real time.
 */
function decimate(series: ValuePoint[], threshold: number): ValuePoint[] {
  if (threshold < 3 || series.length <= threshold) return series;

  const first = series[0];
  const last = series.at(-1);
  if (first === undefined || last === undefined) return series;

  const x = series.map((point) => daysBetween(first.date, point.date));
  const sampled: ValuePoint[] = [first];
  const bucketSize = (series.length - 2) / (threshold - 2);
  let anchor = 0;

  for (let i = 0; i < threshold - 2; i++) {
    // The averaged point of the *next* bucket forms the far vertex of the
    // triangle; for the final bucket that is the last observation itself.
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, series.length - 1);
    let avgX = x[series.length - 1] ?? 0;
    let avgY = last.value;
    if (nextEnd > nextStart) {
      let sumX = 0;
      let sumY = 0;
      for (let j = nextStart; j < nextEnd; j++) {
        sumX += x[j] ?? 0;
        sumY += series[j]?.value ?? 0;
      }
      avgX = sumX / (nextEnd - nextStart);
      avgY = sumY / (nextEnd - nextStart);
    }

    const anchorX = x[anchor] ?? 0;
    const anchorY = series[anchor]?.value ?? 0;
    const start = Math.floor(i * bucketSize) + 1;
    const end = Math.min(Math.floor((i + 1) * bucketSize) + 1, series.length - 1);

    let bestArea = -1;
    let bestIndex = start;
    for (let j = start; j < end; j++) {
      const point = series[j];
      if (point === undefined) continue;
      const area = Math.abs(
        (anchorX - avgX) * (point.value - anchorY) - (anchorX - (x[j] ?? 0)) * (avgY - anchorY),
      );
      if (area > bestArea) {
        bestArea = area;
        bestIndex = j;
      }
    }

    const chosen = series[bestIndex];
    if (chosen !== undefined) sampled.push(chosen);
    anchor = bestIndex;
  }

  sampled.push(last);
  return sampled;
}

/**
 * The plotted series for one fund over one window.
 *
 * Rebased to the window's own first observation rather than to an absolute NAV,
 * because that is the question a fund chart answers — what a holding bought at
 * the left edge would be worth now — and because it is the only form in which
 * two funds priced at 1.03 and 4.82 can be read on the same axis.
 *
 * Returns null when the window holds fewer than two observations: a single dot
 * is not a line, and a young fund asked for 5Y should be told so rather than
 * shown a flat rule.
 *
 * @param points NAV observations in any order; sorted ascending internally.
 */
export function buildNavChartSeries(
  points: NavSeriesPoint[],
  options: { range: NavRangeId; maxPoints?: number },
): NavChartSeries | null {
  const { basis, series } = toValueSeries(points);
  const end = series.at(-1);
  if (end === undefined || series.length < 2) return null;

  const months = navRangeMonths(options.range);
  // The window is measured back from the latest observation, not from today: a
  // fund whose NAV is three days stale would otherwise lose three days off the
  // left edge of every range for no reason the reader can see.
  const from = months === null ? null : monthsBefore(end.date, months);
  const window = from === null ? series : series.filter((point) => point.date >= from);
  const start = window[0];
  if (start === undefined || window.length < 2) return null;

  const kept = decimate(window, options.maxPoints ?? DEFAULT_MAX_POINTS);

  return {
    range: options.range,
    basis,
    startDate: start.date,
    endDate: end.date,
    observations: window.length,
    downsampled: kept.length < window.length,
    points: kept.map((point) => ({
      date: point.date,
      value: point.value,
      changePercent: round((point.value / start.value - 1) * 100, 2),
    })),
    // Measured over the window rather than the whole history, so the drawdown
    // printed beside the chart is the one the chart shows.
    performance: computePerformance(
      window.map((point) => ({
        navDate: point.date,
        nav: basis === "nav" ? point.value : null,
        accNav: basis === "accNav" ? point.value : null,
      })),
    ),
  };
}
