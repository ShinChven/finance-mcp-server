/**
 * The windows a price chart offers, and what each one is made of.
 *
 * Shared because the client picks a range and the server has to honour exactly
 * that one: a descriptor list in one place is what stops `?range=5d` meaning a
 * different number of days on each side.
 *
 * Which ranges an item can offer depends on what it is. A fund publishes one
 * NAV a day, so an intraday window is not a shorter view of it — there is
 * nothing inside the day to see — and offering `1D` on a fund would produce a
 * chart with two points and a straight line between them.
 */

import { z } from "zod";
import type { WatchlistItemKind } from "./watchlist.js";

export const SERIES_RANGES = [
  { id: "1d", label: "1D", intraday: true, days: 1, months: null, kinds: ["symbol"] },
  { id: "5d", label: "5D", intraday: true, days: 5, months: null, kinds: ["symbol"] },
  { id: "1m", label: "1M", intraday: false, days: null, months: 1, kinds: ["symbol", "fund"] },
  { id: "6m", label: "6M", intraday: false, days: null, months: 6, kinds: ["symbol", "fund"] },
  { id: "ytd", label: "YTD", intraday: false, days: null, months: null, kinds: ["symbol", "fund"] },
  { id: "1y", label: "1Y", intraday: false, days: null, months: 12, kinds: ["symbol", "fund"] },
  { id: "5y", label: "5Y", intraday: false, days: null, months: 60, kinds: ["symbol", "fund"] },
  { id: "max", label: "Max", intraday: false, days: null, months: null, kinds: ["symbol", "fund"] },
] as const satisfies readonly {
  id: string;
  label: string;
  intraday: boolean;
  days: number | null;
  months: number | null;
  kinds: readonly WatchlistItemKind[];
}[];

export type SeriesRangeId = (typeof SERIES_RANGES)[number]["id"];

/** A year is long enough to show a cycle and short enough that most items cover it. */
export const DEFAULT_SERIES_RANGE: SeriesRangeId = "1y";

const RANGE_IDS = SERIES_RANGES.map((range) => range.id) as [SeriesRangeId, ...SeriesRangeId[]];

export function isSeriesRange(value: string): value is SeriesRangeId {
  return (RANGE_IDS as readonly string[]).includes(value);
}

export function seriesRange(id: SeriesRangeId): (typeof SERIES_RANGES)[number] {
  return SERIES_RANGES.find((range) => range.id === id) ?? SERIES_RANGES[3];
}

/** The ranges an item of this kind can actually be drawn over. */
export function rangesFor(kind: WatchlistItemKind): (typeof SERIES_RANGES)[number][] {
  return SERIES_RANGES.filter((range) => (range.kinds as readonly string[]).includes(kind));
}

export const seriesQuerySchema = z.object({
  range: z.enum(RANGE_IDS).default(DEFAULT_SERIES_RANGE),
});

/** One plotted observation. `at` is an instant only for intraday windows. */
export interface SeriesPoint {
  /** Exchange-local date for a daily series; ISO instant for an intraday one. */
  t: string;
  /** The raw print — what a price level was set against. */
  value: number;
  /** Percent change from the window's first observation. */
  changePercent: number;
}

export interface SeriesEvent {
  date: string;
  kind: "split" | "dividend";
  factor: number | null;
  amount: number | null;
}

export interface SeriesStatsView {
  cumulativeReturnPercent: number;
  annualizedReturnPercent: number | null;
  maxDrawdownPercent: number;
  annualizedVolatilityPercent: number | null;
}

/**
 * A drawable series and everything needed to read it honestly.
 *
 * `drawnFrom` and `measuredFrom` are separate because they must be: the line
 * plots the raw print so the levels drawn across it land where they were set,
 * while the statistics come off the adjusted series so a dividend payer is not
 * understated by exactly what it paid. Saying which is which is the same
 * caption the fund chart already carries for unit versus cumulative NAV.
 *
 * Levels are deliberately absent. They are edited beside the chart and this
 * payload is cached; carrying them here would serve a stale stop after every
 * edit until the cache expired.
 */
export interface PriceSeries {
  ref: string;
  kind: WatchlistItemKind;
  range: SeriesRangeId;
  intraday: boolean;
  basis: "market" | "nav";
  drawnFrom: "close" | "nav" | "accNav";
  measuredFrom: "adjClose" | "close" | "nav" | "accNav";
  /** IANA zone every date and instant above is expressed in. */
  timezone: string;
  /** Short label for that zone, for the caption under an intraday axis. */
  timezoneLabel: string;
  currency: string | null;
  points: SeriesPoint[];
  events: SeriesEvent[];
  startDate: string;
  endDate: string;
  /** Observations the window holds before any decimation. */
  observations: number;
  downsampled: boolean;
  stats: SeriesStatsView | null;
  /** Where the numbers came from, so the caption can say how fresh they are. */
  staleness: "live" | "cached";
}
