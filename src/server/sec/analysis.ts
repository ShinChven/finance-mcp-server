/**
 * Derived numbers on top of the extracted XBRL series.
 *
 * Kept separate from `parse.ts` so the arithmetic is testable without a
 * companyfacts fixture.
 */

import type { MetricPoint, MetricSeries, PeriodType } from "./parse.js";

export interface AnalyzedPoint extends MetricPoint {
  /** Growth vs the comparable period one year earlier; null when unmatched. */
  yoyPercent: number | null;
}

export interface AnalyzedSeries {
  key: string;
  label: string;
  unit: string;
  concept: string | null;
  points: AnalyzedPoint[];
}

const DAY_MS = 86_400_000;
/** Fiscal calendars drift by a few weeks, so year-ago matching needs slack. */
const YEAR_MATCH_TOLERANCE_DAYS = 45;

/**
 * Matches each point to the one a year earlier by end date rather than by
 * array offset: a filer that skips a period would otherwise silently produce a
 * quarter-vs-quarter comparison labelled as year-over-year.
 */
export function attachYoY(points: readonly MetricPoint[]): AnalyzedPoint[] {
  return points.map((point) => {
    const target = Date.parse(point.end) - 365 * DAY_MS;
    if (!Number.isFinite(target)) return { ...point, yoyPercent: null };

    let best: MetricPoint | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const candidate of points) {
      if (candidate === point) continue;
      const gap = Math.abs(Date.parse(candidate.end) - target);
      if (!Number.isFinite(gap) || gap > YEAR_MATCH_TOLERANCE_DAYS * DAY_MS) continue;
      if (gap < bestGap) {
        best = candidate;
        bestGap = gap;
      }
    }

    if (best === null || best.value === 0) return { ...point, yoyPercent: null };
    // Sign flips (loss → profit) make a percentage meaningless rather than large.
    if (best.value < 0 && point.value >= 0) return { ...point, yoyPercent: null };

    const change = ((point.value - best.value) / Math.abs(best.value)) * 100;
    return { ...point, yoyPercent: Number(change.toFixed(2)) };
  });
}

/**
 * Narrows a raw series to the requested period type, newest first, with
 * year-over-year growth attached.
 */
export function buildSeries(
  series: MetricSeries,
  periodType: PeriodType,
  limit: number,
): AnalyzedSeries {
  const matching = series.points.filter((point) => point.periodType === periodType);
  // YoY is computed over the full filtered history so the oldest returned
  // point still finds its comparison, then the window is applied.
  const analyzed = attachYoY(matching).slice(0, limit);
  return {
    key: series.key,
    label: series.label,
    unit: series.unit,
    concept: series.concept,
    points: analyzed,
  };
}
