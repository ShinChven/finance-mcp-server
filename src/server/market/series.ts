/**
 * One drawable series for anything a watchlist can hold.
 *
 * Two sources meet here, exactly as they do in `watchlist/live.ts`: stored
 * daily bars for an instrument, cached NAV for a fund. They are unified in
 * shape and kept apart in labelling — a fund's daily NAV and a stock's session
 * are not the same measurement, and a payload that blurred them would let a
 * caption lie.
 *
 * The window is measured back from the series' own last observation rather than
 * from today, so an instrument whose last bar is three days stale does not lose
 * three days off the left edge of every range for a reason the reader cannot
 * see. That is the rule the fund chart already follows.
 */

import {
  DEFAULT_SERIES_RANGE,
  seriesRange,
  type PriceSeries,
  type SeriesEvent,
  type SeriesPoint,
  type SeriesRangeId,
} from "../../shared/series.js";
import type { WatchlistItemKind } from "../../shared/watchlist.js";
import {
  computeSeriesStats,
  decimate,
  DEFAULT_MAX_POINTS,
  monthsBefore,
  round,
  type ValuePoint,
} from "./series-math.js";
import { toExchangeDate, yearStartInZone, zoneLabel } from "./timezone.js";
import type { BarStore } from "./bars.js";
import type { DailyBar, MarketDataProvider } from "./provider.js";
import type { NavSeriesPoint } from "../funds/performance.js";

/** How far back the store must reach for a range, as an exchange-local date. */
export function windowStart(range: SeriesRangeId, endDate: string, timezone: string): string {
  const descriptor = seriesRange(range);
  if (descriptor.id === "ytd") return yearStartInZone(timezone);
  if (descriptor.months === null) return "0001-01-01";
  return monthsBefore(endDate, descriptor.months);
}

/**
 * The observation a window starts on.
 *
 * The last one at or before the target rather than the first one after it:
 * starting after the anchor rebases the line to a different day than the figure
 * printed above it, and the two then disagree by however far the target fell
 * inside a weekend.
 */
function anchorIndex(series: { date: string }[], from: string): number {
  const found = series.findLastIndex((point) => point.date <= from);
  return found === -1 ? 0 : found;
}

function toSeriesPoints(window: ValuePoint[], keep: ValuePoint[]): SeriesPoint[] {
  const base = window[0];
  if (base === undefined) return [];
  return keep.map((point) => ({
    t: point.date,
    value: point.value,
    changePercent: round((point.value / base.value - 1) * 100, 2),
  }));
}

interface BuildInput {
  ref: string;
  kind: WatchlistItemKind;
  range: SeriesRangeId;
  timezone: string;
  currency: string | null;
  drawnFrom: PriceSeries["drawnFrom"];
  measuredFrom: PriceSeries["measuredFrom"];
  basis: PriceSeries["basis"];
  /** The line: raw prints, the values a level is compared against. */
  drawn: ValuePoint[];
  /** The statistics: adjusted where the source has one, else the same series. */
  measured: ValuePoint[];
  events: SeriesEvent[];
  staleness: PriceSeries["staleness"];
  intraday?: boolean;
  maxPoints?: number;
}

/**
 * Windows, decimates and measures — the part that is identical for both kinds.
 *
 * Returns null below two observations: one dot is not a line, and an item asked
 * for a window it cannot fill should be told so rather than shown a flat rule.
 */
function build(input: BuildInput): PriceSeries | null {
  const end = input.drawn.at(-1);
  if (end === undefined || input.drawn.length < 2) return null;

  const intraday = input.intraday ?? false;
  const from = intraday
    ? (input.drawn[0]?.date ?? end.date)
    : windowStart(input.range, end.date, input.timezone);
  const window = input.drawn.slice(anchorIndex(input.drawn, from));
  const start = window[0];
  if (start === undefined || window.length < 2) return null;

  const kept = decimate(window, input.maxPoints ?? DEFAULT_MAX_POINTS);

  // Measured over the same window the line shows, on the adjusted series where
  // one exists, so the drawdown printed beside the chart is the one the chart
  // draws and the return is not short by the dividends the raw print dropped.
  const measuredWindow = input.measured.filter(
    (point) => point.date >= start.date && point.date <= end.date,
  );
  const stats = computeSeriesStats(measuredWindow.length >= 2 ? measuredWindow : window);

  return {
    ref: input.ref,
    kind: input.kind,
    range: input.range,
    intraday,
    basis: input.basis,
    drawnFrom: input.drawnFrom,
    measuredFrom: input.measuredFrom,
    timezone: input.timezone,
    timezoneLabel: zoneLabel(input.timezone),
    currency: input.currency,
    points: toSeriesPoints(window, kept),
    // Only the events inside the drawn window: a split from six years ago is
    // not a mark on a one-month chart.
    events: input.events.filter((event) => event.date >= start.date && event.date <= end.date),
    startDate: start.date,
    endDate: end.date,
    observations: window.length,
    downsampled: kept.length < window.length,
    stats:
      stats === null
        ? null
        : {
            cumulativeReturnPercent: stats.cumulativeReturnPercent,
            // Under a year the annualized figure is suppressed: a month that
            // happened to gain 5% would print "+80% a year" beside the line,
            // which is noise wearing a forecast's clothes.
            annualizedReturnPercent: stats.days >= 365 ? stats.annualizedReturnPercent : null,
            maxDrawdownPercent: stats.maxDrawdownPercent,
            annualizedVolatilityPercent: stats.annualizedVolatilityPercent,
          },
    staleness: input.staleness,
  };
}

function barsToValues(bars: DailyBar[], field: "close" | "adjClose"): ValuePoint[] {
  return bars
    .map((bar) => ({ date: bar.date, value: bar[field] }))
    .filter((point): point is ValuePoint => point.value !== null && point.value > 0);
}

export interface SeriesDeps {
  bars: BarStore;
  provider: MarketDataProvider;
  /** NAV history for a fund code, bounded by the caller. */
  navHistory(code: string, since: string): Promise<NavSeriesPoint[]>;
}

/** An instrument's series, from stored bars — fetching them if they are absent. */
export async function symbolSeries(
  symbol: string,
  range: SeriesRangeId,
  deps: SeriesDeps,
): Promise<PriceSeries | null> {
  const descriptor = seriesRange(range);

  if (descriptor.intraday) {
    // Never stored: an intraday point is superseded within the minute, so the
    // only sensible copy is the live one.
    const result = await deps.provider.fetchIntraday(symbol, {
      days: descriptor.days === 1 ? 1 : 5,
    });
    const drawn = result.points
      .map((point) => ({
        date: new Date(point.at).toISOString(),
        value: point.close,
      }))
      .filter((point): point is ValuePoint => point.value !== null && point.value > 0);

    return build({
      ref: symbol,
      kind: "symbol",
      range,
      timezone: result.timezone,
      currency: result.currency,
      drawnFrom: "close",
      measuredFrom: "close",
      basis: "market",
      drawn,
      measured: drawn,
      events: [],
      staleness: "live",
      intraday: true,
    });
  }

  // A year of slack past the window, so the anchor observation that a window
  // starts on is inside what was fetched rather than one bar off the edge.
  const need = windowStart(range, toExchangeDate(Date.now(), "UTC"), "UTC");
  const stored = await deps.bars.ensure(symbol, need === "0001-01-01" ? "0001-01-01" : need);

  return build({
    ref: symbol,
    kind: "symbol",
    range,
    timezone: stored.timezone,
    currency: stored.currency,
    drawnFrom: "close",
    measuredFrom: "adjClose",
    basis: "market",
    drawn: barsToValues(stored.bars, "close"),
    measured: barsToValues(stored.bars, "adjClose"),
    events: stored.events,
    staleness: "cached",
  });
}

/** A fund's series, from cached NAV — the same shape, labelled as NAV. */
export async function fundSeries(
  code: string,
  range: SeriesRangeId,
  deps: SeriesDeps,
): Promise<PriceSeries | null> {
  const points = await deps.navHistory(code, "0001-01-01");
  const sorted = [...points].sort((a, b) => a.navDate.localeCompare(b.navDate));

  // Cumulative NAV wherever the whole series has it, because unit NAV drops on
  // every distribution: a long window measured from it understates the fund by
  // exactly the dividends it paid. Mixing the two mid-series would invent a
  // return on the switchover day, so it is all or nothing.
  const hasAcc = sorted.length > 0 && sorted.every((point) => point.accNav !== null);
  const field: "accNav" | "nav" = hasAcc ? "accNav" : "nav";
  const values = sorted
    .map((point) => ({ date: point.navDate, value: point[field] }))
    .filter((point): point is ValuePoint => point.value !== null && point.value > 0);

  return build({
    ref: code,
    kind: "fund",
    range,
    // A China fund's NAV date is already a Shanghai calendar date.
    timezone: "Asia/Shanghai",
    currency: "CNY",
    drawnFrom: field,
    measuredFrom: field,
    basis: "nav",
    drawn: values,
    measured: values,
    events: [],
    staleness: "cached",
  });
}

/** Either kind, dispatched on what the item is. */
export async function priceSeries(
  item: { kind: WatchlistItemKind; ref: string },
  range: SeriesRangeId,
  deps: SeriesDeps,
): Promise<PriceSeries | null> {
  const descriptor = seriesRange(range);
  // A fund asked for an intraday window gets the shortest one it can answer
  // rather than an error: there is nothing inside a NAV day to draw.
  const usable = (descriptor.kinds as readonly string[]).includes(item.kind)
    ? range
    : DEFAULT_SERIES_RANGE;

  return item.kind === "fund"
    ? fundSeries(item.ref, usable, deps)
    : symbolSeries(item.ref, usable, deps);
}
