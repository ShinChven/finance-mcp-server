/**
 * Arithmetic over a fetched series. Pure — no fetch, no clock of its own — so
 * every branch here is reachable from a test with a literal array.
 *
 * The one idea worth stating: **changes are matched by date, never by counting
 * back N rows**. A daily yield series skips weekends and holidays, a monthly
 * series can carry a suspended period, and a survey can be discontinued for a
 * year and resume. Indexing back twelve rows to find "a year ago" is right only
 * for a series with no gaps, and silently wrong for the rest.
 */

import {
  periodsPerYear,
  type Frequency,
  type IndicatorDescriptor,
} from "../../shared/economy.js";
import type { Observation, SeriesDocument } from "./dbnomics.js";

/** How far from an exact one-year offset a match may sit, per frequency. */
function toleranceDays(frequency: Frequency): number {
  switch (frequency) {
    case "annual":
      return 180;
    case "quarterly":
      return 50;
    case "monthly":
      return 20;
    case "weekly":
      return 10;
    case "daily":
      return 10;
  }
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function timeOf(observation: Observation): number {
  return Date.parse(observation.date);
}

/**
 * Percent change between two readings.
 *
 * Denominated by the magnitude of the base so that a series which crosses zero
 * — a yield spread, a trade balance — keeps the sign of the actual movement
 * instead of inverting it. The result is still hard to interpret for such a
 * series, which is why `economicRelease` reports the absolute change alongside.
 */
export function percentChange(current: number, base: number): number | null {
  if (base === 0) return null;
  return ((current - base) / Math.abs(base)) * 100;
}

/**
 * For each observation, the index of the reading closest to one year earlier,
 * or -1 where none falls inside the tolerance.
 *
 * Both the observations and their one-year-earlier targets increase
 * monotonically, so a single forward-moving pointer visits each row once: the
 * whole series resolves in one pass rather than a scan per row, which matters
 * for a daily series carrying sixty years of history.
 */
export function yearAgoIndexes(observations: Observation[], frequency: Frequency): number[] {
  const tolerance = toleranceDays(frequency) * DAY_MS;
  const times = observations.map(timeOf);
  const result: number[] = Array.from({ length: observations.length }, () => -1);
  let candidate = 0;

  for (let i = 0; i < observations.length; i += 1) {
    const here = times[i];
    if (here === undefined || Number.isNaN(here)) continue;
    const target = new Date(here);
    target.setUTCFullYear(target.getUTCFullYear() - 1);
    const targetTime = target.getTime();

    // Walk to the last reading at or before the target.
    while (candidate + 1 < times.length) {
      const next = times[candidate + 1];
      if (next === undefined || next > targetTime) break;
      candidate += 1;
    }

    // The nearer of that reading and the one after it wins.
    let best = -1;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const index of [candidate, candidate + 1]) {
      if (index < 0 || index >= times.length || index >= i) continue;
      const at = times[index];
      if (at === undefined || Number.isNaN(at)) continue;
      const gap = Math.abs(at - targetTime);
      if (gap < bestGap) {
        best = index;
        bestGap = gap;
      }
    }
    if (best !== -1 && bestGap <= tolerance) result[i] = best;
  }

  return result;
}

/** The index of the previous reading that carries a value, or -1. */
function previousValuedIndex(observations: Observation[], from: number): number {
  for (let i = from - 1; i >= 0; i -= 1) {
    if (observations[i]?.value !== null) return i;
  }
  return -1;
}

export type Transform = "none" | "pop_pct" | "yoy_pct";

/**
 * Which transform an indicator gets when the caller does not say.
 *
 * An index level answers nothing on its own — "CPI is 320.4" is not the number
 * anyone wants — so index series default to year-over-year. A rate is already a
 * percent and a level is already a count; both are reported as published.
 */
export function defaultTransform(indicator: Pick<IndicatorDescriptor, "kind">): Transform {
  return indicator.kind === "index" ? "yoy_pct" : "none";
}

export interface TransformedPoint extends Observation {
  /** Present only when a transform was applied and computable. */
  changePct?: number | null;
}

/** Applies `transform` across the whole series, before any windowing. */
export function applyTransform(
  observations: Observation[],
  frequency: Frequency,
  transform: Transform,
): TransformedPoint[] {
  if (transform === "none") return observations.map((o) => ({ ...o }));

  const bases =
    transform === "yoy_pct"
      ? yearAgoIndexes(observations, frequency)
      : observations.map((_, i) => previousValuedIndex(observations, i));

  return observations.map((observation, i) => {
    const baseIndex = bases[i] ?? -1;
    const base = baseIndex >= 0 ? observations[baseIndex]?.value ?? null : null;
    const value = observation.value;
    const changePct =
      value === null || base === null ? null : percentChange(value, base);
    return { ...observation, changePct };
  });
}

export interface Window {
  from?: string | undefined;
  to?: string | undefined;
  limit: number;
}

/**
 * The last instant a partial date still covers.
 *
 * `to: "2026-01"` means "through January", not "on the first of January" —
 * taken literally the latter drops all but one reading of a daily series, which
 * is never what a caller typing a month meant.
 */
function endOfPeriod(value: string): number {
  const year = /^(\d{4})$/.exec(value);
  if (year !== null) return Date.UTC(Number(year[1]) + 1, 0, 1) - 1;

  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month !== null) return Date.UTC(Number(month[1]), Number(month[2]), 1) - 1;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed + DAY_MS - 1;
}

/**
 * Trims to the requested date range, then to the most recent `limit` readings.
 *
 * Newest-first truncation, not oldest-first: a caller asking for 24 points of a
 * series running since 1947 wants the last two years, never the Truman
 * administration.
 *
 * A reading whose date cannot be parsed is kept rather than dropped. Losing
 * data silently is the worse failure: an unrecognized period shape should show
 * up in the output where it can be noticed, not vanish from it.
 */
export function windowPoints<T extends Observation>(points: T[], window: Window): T[] {
  const from = window.from === undefined ? null : Date.parse(window.from);
  const to = window.to === undefined ? null : endOfPeriod(window.to);

  const ranged = points.filter((point) => {
    const at = Date.parse(point.date);
    if (Number.isNaN(at)) return true;
    if (from !== null && !Number.isNaN(from) && at < from) return false;
    if (to !== null && !Number.isNaN(to) && at > to) return false;
    return true;
  });

  return ranged.length > window.limit ? ranged.slice(ranged.length - window.limit) : ranged;
}

export interface ReleaseSummary {
  latest: { period: string; date: string; value: number } | null;
  previous: { period: string; date: string; value: number } | null;
  /** Latest minus previous, in the series' own unit. Always meaningful. */
  change: number | null;
  /** The same step as a percentage. Null where the base is zero. */
  changePct: number | null;
  /** Change against the reading closest to a year earlier. */
  yoyChange: number | null;
  yoyPct: number | null;
  /**
   * Days between the latest reading's period start and now. Macro data lags by
   * design — a CPI print lands weeks after the month it measures — so a caller
   * reasoning about "current" inflation needs to see how old "latest" is.
   */
  staleDays: number | null;
}

/** Reduces a series to its most recent print and the steps around it. */
export function summarizeRelease(
  document: SeriesDocument,
  now: Date = new Date(),
): ReleaseSummary {
  const observations = document.observations;
  let latestIndex = -1;
  for (let i = observations.length - 1; i >= 0; i -= 1) {
    if (observations[i]?.value !== null) {
      latestIndex = i;
      break;
    }
  }

  if (latestIndex === -1) {
    return {
      latest: null,
      previous: null,
      change: null,
      changePct: null,
      yoyChange: null,
      yoyPct: null,
      staleDays: null,
    };
  }

  const latest = observations[latestIndex];
  const latestValue = latest?.value;
  if (latest === undefined || latestValue === null || latestValue === undefined) {
    throw new Error("unreachable: latest index points at a valued observation");
  }

  const previousIndex = previousValuedIndex(observations, latestIndex);
  const previous = previousIndex >= 0 ? observations[previousIndex] : undefined;
  const previousValue = previous?.value ?? null;

  const yearAgoIndex = yearAgoIndexes(observations, document.frequency)[latestIndex] ?? -1;
  const yearAgoValue = yearAgoIndex >= 0 ? observations[yearAgoIndex]?.value ?? null : null;

  const latestAt = Date.parse(latest.date);
  const staleDays = Number.isNaN(latestAt)
    ? null
    : Math.max(0, Math.floor((now.getTime() - latestAt) / DAY_MS));

  return {
    latest: { period: latest.period, date: latest.date, value: latestValue },
    previous:
      previous !== undefined && previousValue !== null
        ? { period: previous.period, date: previous.date, value: previousValue }
        : null,
    change: previousValue === null ? null : latestValue - previousValue,
    changePct: previousValue === null ? null : percentChange(latestValue, previousValue),
    yoyChange: yearAgoValue === null ? null : latestValue - yearAgoValue,
    yoyPct: yearAgoValue === null ? null : percentChange(latestValue, yearAgoValue),
    staleDays,
  };
}

/** Rough count of readings a year holds, for sizing a default window. */
export function defaultLimit(frequency: Frequency): number {
  return Math.min(400, Math.max(24, periodsPerYear(frequency) * 5));
}
