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
import {
  computeSeriesStats,
  computeTrailingWindows,
  decimate,
  DEFAULT_MAX_POINTS,
  monthsBefore,
  round,
  type SeriesStats,
  type TrailingWindow,
  type ValuePoint,
} from "../market/series-math.js";

export interface NavSeriesPoint {
  navDate: string;
  nav: number | null;
  accNav: number | null;
}

/** A window's statistics plus the NAV basis they were measured on. */
export interface PerformanceResult extends SeriesStats {
  basis: "accNav" | "nav";
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
  const stats = computeSeriesStats(series);
  return stats === null ? null : { ...stats, basis };
}

/**
 * One window's return, measured between two NAV observations that really exist.
 *
 * `from` is a real NAV date rather than the calendar target the window was
 * asked for.
 */
export type TrailingReturn = TrailingWindow<TrailingPeriodId>;

export interface TrailingReturns {
  /** The observation every window ends on — the latest NAV, not today. */
  asOf: string;
  basis: "accNav" | "nav";
  /** Only the periods the NAV history actually covers; a young fund reports fewer. */
  periods: TrailingReturn[];
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
  // `1d` is the step to the previous observation and `max` is the whole
  // history; every other window is a month count. Saying so here rather than in
  // the generic helper keeps the fund vocabulary on the fund side.
  const result = computeTrailingWindows(
    series,
    TRAILING_PERIODS.map((period) => ({
      id: period.id,
      months: period.months,
      whole: period.id === "max",
      previous: period.id === "1d",
    })),
    options,
  );
  if (result === null) return null;
  return { asOf: result.asOf, basis, periods: result.periods };
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
 * A window's statistics, with the annualized figure suppressed under a year.
 *
 * `computePerformance` annualizes anything past 30 days, which is right for a
 * caller that chose its own dates and knows what it asked for. A chart range is
 * not that: a one-month window on a fund that happened to gain 5% would print
 * "+90% a year" beside the line, which is the same noise-as-forecast the
 * trailing windows already refuse to quote. One rule, both places.
 */
function windowPerformance(points: NavSeriesPoint[]): PerformanceResult | null {
  const result = computePerformance(points);
  if (result === null || result.days >= 365) return result;
  return { ...result, annualizedReturnPercent: null };
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
  // It starts on the observation the matching trailing return is measured
  // from — the last one at or before the target, not the first one after it.
  // Starting after the anchor rebases the line to a different day than the
  // figure printed above it, and the two then disagree by however far the
  // target happened to fall inside a weekend.
  const anchor = from === null ? 0 : series.findLastIndex((point) => point.date <= from);
  const window = series.slice(anchor === -1 ? 0 : anchor);
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
    performance: windowPerformance(
      window.map((point) => ({
        navDate: point.date,
        nav: basis === "nav" ? point.value : null,
        accNav: basis === "accNav" ? point.value : null,
      })),
    ),
  };
}
