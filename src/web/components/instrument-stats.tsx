/**
 * The context around a quoted price: its ranges, its turnover, its multiples,
 * and the trailing windows the source can support.
 *
 * All of it arrives in the same payload as the price, so nothing here costs a
 * request. What it costs instead is discipline about absence: every field is
 * optional upstream and coverage genuinely varies — an ETF has no P/E, many CN
 * and HK listings carry no 52-week change, a crypto pair has almost none of it.
 * So a figure with nothing behind it is left out rather than printed as a dash.
 * A grid of dashes reads as a broken page; a shorter grid reads as an
 * instrument that simply does not have those numbers, which is the truth.
 */

import {
  WATCHLIST_RETURN_PERIODS,
  type ItemReturns,
  type ReturnBasis,
  type WatchlistReturnPeriod,
} from "../../shared/watchlist.js";
import { formatCompact, formatPercent, signClass } from "../lib/format.js";
import type { ExtendedQuote, QuoteStats } from "../lib/types.js";

/** How a returns column should describe what it is measuring. */
const BASIS_NOTE: Record<ReturnBasis, string> = {
  price: "Price return from the quote's own 52-week change — dividends excluded.",
  accNav: "From cumulative NAV, so distributions do not read as losses.",
  nav: "From unit NAV — this fund publishes no cumulative series, so a distribution shows as a fall.",
};

const PERIOD_LABELS: Record<WatchlistReturnPeriod, string> = {
  "1m": "1M",
  "3m": "3M",
  "6m": "6M",
  "1y": "1Y",
};

/**
 * Where the price sits between two bounds, drawn to scale.
 *
 * The marker is a line rather than a dot so it stays readable at the ends of
 * the track, where a dot would be half outside it. The bounds are printed
 * beside the track rather than on hover: they are the whole point of the
 * reading, and a number that needs a hover is a number nobody sees.
 */
export function RangeMeter({
  low,
  high,
  position,
  label,
  compact = false,
}: {
  low: number;
  high: number;
  /** 0 at `low`, 1 at `high`; already clamped by the server. */
  position: number;
  label: string;
  compact?: boolean;
}) {
  const digits = Math.abs(high) < 10 ? 3 : 2;
  return (
    <div className="w-full">
      <div
        className={`relative w-full rounded-full bg-zinc-100 dark:bg-zinc-800 ${compact ? "h-1.5" : "h-2"}`}
        role="img"
        aria-label={`${label}: ${low.toFixed(digits)} to ${high.toFixed(digits)}, currently ${Math.round(
          position * 100,
        )}% of the way up`}
        title={`${label} ${low.toFixed(digits)} – ${high.toFixed(digits)}`}
      >
        <span
          className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-900 dark:bg-zinc-100"
          style={{ left: `${position * 100}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-zinc-400">
        <span>{low.toFixed(digits)}</span>
        <span>{high.toFixed(digits)}</span>
      </div>
    </div>
  );
}

/**
 * The trailing windows an item can quote.
 *
 * The basis travels with the figures because one strip shows all three: a
 * fund's year measured on cumulative NAV and a stock's year lifted from a
 * 52-week quote are both "1Y" and are not the same measurement.
 */
export function ReturnsStrip({ returns }: { returns: ItemReturns }) {
  const byPeriod = new Map(returns.periods.map((entry) => [entry.period, entry]));
  const present = WATCHLIST_RETURN_PERIODS.filter((period) => byPeriod.has(period));
  if (present.length === 0) return null;

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1" title={BASIS_NOTE[returns.basis]}>
      {present.map((period) => {
        const entry = byPeriod.get(period)!;
        return (
          <span key={period} className="text-xs text-zinc-500">
            {PERIOD_LABELS[period]}{" "}
            <span className={`font-medium tabular-nums ${signClass(entry.returnPercent)}`}>
              {formatPercent(entry.returnPercent)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** A pre- or post-market print, labelled as the out-of-hours number it is. */
export function ExtendedPrint({ quote }: { quote: ExtendedQuote }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-zinc-500">{quote.phase === "pre" ? "Pre-market" : "After hours"}</span>
      <span className="font-medium tabular-nums">{quote.price}</span>
      {quote.changePercent !== null && (
        <span className={`tabular-nums ${signClass(quote.changePercent)}`}>
          {formatPercent(quote.changePercent)}
        </span>
      )}
    </div>
  );
}

interface Tile {
  label: string;
  value: string;
  hint?: string;
}

/**
 * The figures worth a line each, built by collecting only what exists.
 *
 * Assembled as a list rather than rendered as a fixed grid so that absence
 * removes a tile instead of leaving a labelled hole.
 */
function statTiles(stats: QuoteStats): Tile[] {
  const tiles: Tile[] = [];

  if (stats.volume !== null) {
    tiles.push({
      label: "Volume",
      value: formatCompact(stats.volume),
      hint:
        stats.averageVolume3Month === null
          ? undefined
          : `${(stats.volume / stats.averageVolume3Month).toFixed(2)}× the 3-month average`,
    });
  }
  if (stats.marketCap !== null) {
    tiles.push({ label: "Market cap", value: formatCompact(stats.marketCap) });
  }
  if (stats.trailingPe !== null) {
    tiles.push({ label: "P/E", value: stats.trailingPe.toFixed(1), hint: "trailing twelve months" });
  }
  if (stats.dividendYieldPercent !== null) {
    tiles.push({ label: "Yield", value: `${stats.dividendYieldPercent.toFixed(2)}%` });
  }
  if (stats.fiftyDayAverage !== null) {
    tiles.push({ label: "50-day avg", value: stats.fiftyDayAverage.toFixed(2) });
  }
  if (stats.twoHundredDayAverage !== null) {
    tiles.push({ label: "200-day avg", value: stats.twoHundredDayAverage.toFixed(2) });
  }
  return tiles;
}

/**
 * Everything the quote knows beyond the price.
 *
 * Returns null when the instrument carried none of it, so the caller can leave
 * the section out entirely rather than render an empty frame.
 */
export function QuoteStatsPanel({
  stats,
  extended,
  returns,
  price,
}: {
  stats: QuoteStats | null;
  extended: ExtendedQuote | null;
  returns: ItemReturns | null;
  price: number | null;
}) {
  const tiles = stats === null ? [] : statTiles(stats);
  const dayRange =
    stats !== null && stats.dayLow !== null && stats.dayHigh !== null && price !== null
      ? { low: stats.dayLow, high: stats.dayHigh }
      : null;
  const yearRange =
    stats !== null && stats.fiftyTwoWeekPosition !== null
      ? {
          low: stats.fiftyTwoWeekLow!,
          high: stats.fiftyTwoWeekHigh!,
          position: stats.fiftyTwoWeekPosition,
        }
      : null;

  if (tiles.length === 0 && dayRange === null && yearRange === null && returns === null && extended === null) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
      {extended && <ExtendedPrint quote={extended} />}

      {returns && <ReturnsStrip returns={returns} />}

      {dayRange && price !== null && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-400">Day range</div>
          <RangeMeter
            low={dayRange.low}
            high={dayRange.high}
            position={
              dayRange.high <= dayRange.low
                ? 0.5
                : Math.min(1, Math.max(0, (price - dayRange.low) / (dayRange.high - dayRange.low)))
            }
            label="Day range"
            compact
          />
        </div>
      )}

      {yearRange && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-400">52-week range</div>
          <RangeMeter
            low={yearRange.low}
            high={yearRange.high}
            position={yearRange.position}
            label="52-week range"
            compact
          />
        </div>
      )}

      {tiles.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {tiles.map((tile) => (
            <div key={tile.label}>
              <dt className="text-[10px] uppercase tracking-wide text-zinc-400">{tile.label}</dt>
              <dd className="text-sm font-medium tabular-nums" title={tile.hint}>
                {tile.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * A month of closes in the width of a table cell.
 *
 * No axis, no labels, no hover: at this size every one of those would cost more
 * legibility than it adds, and the row already carries the numbers. What the
 * shape is for is the thing a percentage cannot say — whether the month was a
 * drift or a round trip.
 *
 * The endpoint is marked, because the eye reads a line's end as "now" and a
 * sparkline without one reads as still running.
 */
export function Sparkline({
  values,
  label,
  className = "",
}: {
  values: number[];
  label: string;
  className?: string;
}) {
  if (values.length < 2) return null;

  const width = 64;
  const height = 18;
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  // A month that did not move is drawn down the middle rather than against the
  // top edge, where a zero span would otherwise put it.
  const span = high - low;
  const y = (value: number): number =>
    span === 0 ? height / 2 : 1 + (1 - (value - low) / span) * (height - 2);
  const x = (index: number): number => (index / (values.length - 1)) * width;

  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const first = values[0]!;
  const last = values.at(-1)!;
  const rising = last >= first;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`h-4 w-16 ${rising ? "text-emerald-600" : "text-red-600"} ${className}`}
      role="img"
      aria-label={`${label}: ${rising ? "up" : "down"} over the last month`}
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(values.length - 1)} cy={y(last)} r="1.6" fill="currentColor" />
    </svg>
  );
}
