/**
 * An item's price, with the reader's own levels drawn across it.
 *
 * This is the thing a generic charting site cannot do. A line on its own says
 * what happened; a line with your stop and your target ruled across it says
 * whether what happened matters to you, and how far the price has to travel
 * before it does.
 *
 * Two consequences follow from drawing levels, and both shape the whole
 * component:
 *
 * The scale is absolute, not rebased. Levels are prices, so the axis has to be
 * prices — the fund page keeps its rebased percent view, which is the right
 * form for comparing funds, and this shares the geometry rather than the mode.
 *
 * The domain must contain the levels. A stop 20% below the window is the level
 * most worth seeing and the one a price-fitted scale would hide. Past three
 * times the window's own span a level is left out and drawn against the edge
 * instead, because flattening the price line into a rule to make room for one
 * number destroys the picture to show a footnote.
 *
 * Levels arrive as props from the item the caller already holds, never in the
 * series payload: the series is cached and levels are edited right beside the
 * chart, so bundling them would draw a stale stop until the cache expired.
 */

import { useState } from "react";
import { rangesFor, type PriceSeries, type SeriesRangeId } from "../../shared/series.js";
import {
  areaPath,
  domainWithLevels,
  linePath,
  nearestIndex,
  plotInDomain,
  plotInDomainSeries,
  type ChartBox,
} from "../lib/chart.js";
import { formatPercent, signClass } from "../lib/format.js";
import type { WatchlistItem, WatchlistLevel } from "../lib/types.js";
import type { DirectionPalette } from "../../shared/preferences.js";

/**
 * Fixed user space, scaled to the container through the viewBox.
 *
 * Measuring the container would mean a ResizeObserver and a re-render per frame
 * to draw the same line. Strokes are pinned with `vector-effect` so scaling
 * cannot thicken them.
 */
const BOX: ChartBox = { width: 720, height: 210, padTop: 12, padBottom: 12 };

/** A level nobody is waiting for any more is drawn as history. */
function isDone(level: WatchlistLevel): boolean {
  return level.status !== "active" || level.expired;
}

/**
 * Direction never rests on hue alone.
 *
 * The marks hold the 600 step in both themes rather than lightening in dark:
 * the lighter step is the right *text* token and the wrong chart mark, where it
 * falls outside the lightness band and collapses to a deuteranopia separation
 * of 6.5 against its counterpart. Holding 600 measures 8.6 in both themes.
 */
const TONES: Record<DirectionPalette, { up: string; down: string; flat: string }> = {
  classic: {
    up: "text-emerald-600 dark:text-emerald-600",
    down: "text-red-600 dark:text-red-600",
    flat: "text-zinc-500",
  },
  accessible: {
    up: "text-teal-600 dark:text-teal-600",
    down: "text-orange-600 dark:text-orange-600",
    flat: "text-zinc-500",
  },
};

/** Level rules take the same pair, so the chart never speaks in two palettes. */
const LEVEL_STROKES: Record<DirectionPalette, { below: string; above: string }> = {
  classic: { below: "stroke-emerald-600", above: "stroke-red-600" },
  accessible: { below: "stroke-teal-600", above: "stroke-orange-600" },
};

const ZONE_FILLS: Record<DirectionPalette, { below: string; above: string }> = {
  classic: { below: "fill-emerald-500/10", above: "fill-rose-500/10" },
  accessible: { below: "fill-teal-500/10", above: "fill-orange-500/10" },
};

function toneFor(change: number, palette: DirectionPalette): string {
  const tones = TONES[palette];
  return change > 0 ? tones.up : change < 0 ? tones.down : tones.flat;
}

export function PriceChart({
  item,
  series,
  range,
  onRange,
  pending,
  palette,
}: {
  item: WatchlistItem;
  series: PriceSeries | null;
  range: SeriesRangeId;
  onRange: (next: SeriesRangeId) => void;
  pending: boolean;
  palette: DirectionPalette;
}) {
  const ranges = rangesFor(item.kind);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-end gap-1">
        {ranges.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onRange(entry.id)}
            aria-pressed={entry.id === range}
            className={`cursor-pointer rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              entry.id === range
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {pending ? (
        <div className="h-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60" />
      ) : series === null || series.points.length < 2 ? (
        <p className="py-10 text-center text-xs text-zinc-400">
          Not enough price history to draw a line over this window.
        </p>
      ) : (
        <Plot item={item} series={series} palette={palette} />
      )}
    </div>
  );
}

function Plot({
  item,
  series,
  palette,
}: {
  item: WatchlistItem;
  series: PriceSeries;
  palette: DirectionPalette;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const values = series.points.map((point) => point.value);
  // Real elapsed time along x, so a suspended listing shows its gap as a gap
  // rather than as one evenly spaced step like any other.
  const base = Date.parse(series.points[0]?.t ?? "");
  const xs = series.points.map((point) => (Date.parse(point.t) - base) / 86_400_000);

  const drawable = item.levels.filter((level) => !isDone(level));
  const levelPrices = [
    ...drawable.flatMap((level) => [level.price, level.priceHigh ?? level.price]),
    ...(item.entryPrice === null ? [] : [item.entryPrice]),
  ];
  const domain = domainWithLevels(values, levelPrices);
  const plot = plotInDomainSeries(xs, values, domain, BOX);

  const change = series.points.at(-1)?.changePercent ?? 0;
  const tone = toneFor(change, palette);
  const gradientId = `price-fill-${item.id}-${series.range}`;

  const active = hover === null ? null : series.points[hover];
  const activePlot = hover === null ? null : plot[hover];

  const at = (price: number): number => plotInDomain(price, domain, BOX);
  const isClamped = (price: number): boolean => domain.clamped.includes(price);

  // Only the nearest level either way is labelled. Every level labelled is a
  // wall of text over the line; none labelled makes the reader hover to learn
  // what the rules are.
  const labelled = new Set(
    [item.nearest.above?.id, item.nearest.below?.id].filter((id): id is string => id !== undefined),
  );

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className={`text-xl font-semibold tabular-nums ${tone}`}>
          {formatPercent(change)}
        </span>
        {series.stats && (
          <>
            <Stat
              label="Max drawdown"
              value={`-${series.stats.maxDrawdownPercent.toFixed(2)}%`}
              title="The deepest peak-to-trough fall inside this window."
            />
            <Stat
              label="Volatility"
              value={
                series.stats.annualizedVolatilityPercent === null
                  ? "—"
                  : `${series.stats.annualizedVolatilityPercent.toFixed(1)}%`
              }
              title="Annualized standard deviation of daily returns; needs at least 20 observations."
            />
            {series.stats.annualizedReturnPercent !== null && (
              <Stat
                label="Annualized"
                value={formatPercent(series.stats.annualizedReturnPercent)}
                title="This window's return expressed as a yearly rate."
                className={signClass(series.stats.annualizedReturnPercent)}
              />
            )}
          </>
        )}
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${BOX.width} ${BOX.height}`}
          className={`w-full ${tone}`}
          role="img"
          aria-label={`${item.ref} from ${series.startDate} to ${series.endDate}, ${formatPercent(change)}. ${drawable.length} price levels drawn.`}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            if (rect.width === 0) return;
            setHover(nearestIndex(plot, ((event.clientX - rect.left) / rect.width) * BOX.width));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Zones first, so a band never sits over the line it frames. */}
          {drawable
            .filter((level) => level.priceHigh !== null)
            .map((level) => {
              const top = at(Math.max(level.price, level.priceHigh!));
              const bottom = at(Math.min(level.price, level.priceHigh!));
              return (
                <rect
                  key={`zone-${level.id}`}
                  x="0"
                  y={top}
                  width={BOX.width}
                  height={Math.max(1, bottom - top)}
                  className={
                    level.side === "below"
                      ? ZONE_FILLS[palette].below
                      : ZONE_FILLS[palette].above
                  }
                />
              );
            })}

          {item.entryPrice !== null && !isClamped(item.entryPrice) && (
            <line
              x1="0"
              y1={at(item.entryPrice)}
              x2={BOX.width}
              y2={at(item.entryPrice)}
              className="stroke-zinc-400 dark:stroke-zinc-500"
              strokeDasharray="2 3"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path d={areaPath(plot, BOX.height)} fill={`url(#${gradientId})`} />
          <path
            d={linePath(plot)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {drawable.map((level) => {
            if (isClamped(level.price)) return null;
            const y = at(level.price);
            return (
              <line
                key={`level-${level.id}`}
                x1="0"
                y1={y}
                x2={BOX.width}
                y2={y}
                className={
                  level.side === "below"
                    ? LEVEL_STROKES[palette].below
                    : level.side === "above"
                      ? LEVEL_STROKES[palette].above
                      : "stroke-indigo-500"
                }
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {/* Corporate actions on the axis: a split is the reason a level set
              before it can no longer be met, and a dividend explains a fall the
              adjusted series does not show. */}
          {series.events.map((event) => {
            const offset = (Date.parse(`${event.date}T00:00:00Z`) - base) / 86_400_000;
            const span = (xs.at(-1) ?? 1) - (xs[0] ?? 0);
            if (span <= 0) return null;
            const x = (offset / span) * BOX.width;
            return (
              <g key={`${event.kind}-${event.date}`}>
                <line
                  x1={x}
                  y1={BOX.height - 8}
                  x2={x}
                  y2={BOX.height}
                  className={event.kind === "split" ? "stroke-amber-500" : "stroke-zinc-400"}
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

          {activePlot && (
            <>
              <line
                x1={activePlot.x}
                y1="0"
                x2={activePlot.x}
                y2={BOX.height}
                className="stroke-zinc-400 dark:stroke-zinc-500"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={activePlot.x}
                cy={activePlot.y}
                r="4"
                fill="currentColor"
                className="stroke-white dark:stroke-zinc-900"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>

        {/* Level labels sit outside the SVG so they inherit page type rather
            than being scaled by the viewBox along with the geometry. */}
        {drawable
          .filter((level) => labelled.has(level.id) && !isClamped(level.price))
          .map((level) => (
            <span
              key={`label-${level.id}`}
              className="pointer-events-none absolute right-0 -translate-y-1/2 rounded bg-white/85 px-1 text-[10px] tabular-nums text-zinc-600 dark:bg-zinc-900/85 dark:text-zinc-300"
              style={{ top: `${(at(level.price) / BOX.height) * 100}%` }}
            >
              {level.label ?? level.price}
            </span>
          ))}

        {active && activePlot && (
          <div
            className="pointer-events-none absolute top-0 rounded border border-zinc-200 bg-white/95 px-2 py-1 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95"
            style={{
              left: `${(activePlot.x / BOX.width) * 100}%`,
              transform: `translateX(${
                activePlot.x < BOX.width * 0.15
                  ? "0"
                  : activePlot.x > BOX.width * 0.85
                    ? "-100%"
                    : "-50%"
              })`,
            }}
          >
            <div className="text-zinc-500">
              {series.intraday ? new Date(active.t).toLocaleString() : active.t}
            </div>
            <div className="tabular-nums">
              <span className="font-medium">{active.value.toFixed(2)}</span>{" "}
              <span className={signClass(active.changePercent)}>
                {formatPercent(active.changePercent)}
              </span>
            </div>
          </div>
        )}
      </div>

      {domain.clamped.length > 0 && (
        <p className="text-[10px] text-zinc-400">
          {domain.clamped.length} level{domain.clamped.length === 1 ? " is" : "s are"} too far
          outside this window to draw — widen the range to see {domain.clamped.length === 1 ? "it" : "them"}.
        </p>
      )}

      <Caption series={series} />
    </>
  );
}

/**
 * What the reader needs in order to trust the picture.
 *
 * The window actually drawn is not always the one asked for — an instrument
 * younger than the range shows its whole life, and saying so is what stops that
 * reading as a five-year record. The basis matters for the same reason: the
 * line is the raw print and the statistics beside it are not.
 */
function Caption({ series }: { series: PriceSeries }) {
  const basis =
    series.drawnFrom === "accNav"
      ? "cumulative NAV, so distributions do not read as losses"
      : series.drawnFrom === "nav"
        ? "unit NAV — this fund publishes no cumulative series, so a distribution shows as a fall"
        : series.measuredFrom === "adjClose"
          ? "closing prices; the statistics above use the adjusted series, so dividends are counted"
          : "closing prices";

  return (
    <p className="text-[10px] text-zinc-400">
      {series.intraday ? `${series.timezoneLabel} · ` : ""}
      {series.startDate.slice(0, 10)} → {series.endDate.slice(0, 10)} · {series.observations}{" "}
      observation{series.observations === 1 ? "" : "s"}
      {series.downsampled && ` (${series.points.length} plotted)`} · {basis}
    </p>
  );
}

function Stat({
  label,
  value,
  title,
  className,
}: {
  label: string;
  value: string;
  title: string;
  className?: string;
}) {
  return (
    <span className="text-xs text-zinc-500" title={title}>
      {label}{" "}
      <span
        className={`font-medium tabular-nums ${className ?? "text-zinc-700 dark:text-zinc-300"}`}
      >
        {value}
      </span>
    </span>
  );
}
