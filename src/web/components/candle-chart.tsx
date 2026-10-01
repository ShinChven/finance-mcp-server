/**
 * The symbol page's chart: candles, volume, overlays and oscillator panes.
 *
 * Laid out in measured pixels rather than a scaled viewBox, unlike the line
 * chart beside the watchlist — see `lib/candles.ts` for why a trading chart
 * cannot be drawn the other way. Everything that decides where a mark lands
 * lives there and is tested; this file is the markup.
 *
 * Indicators are computed here from the candles the server sent, including
 * the warm-up history before the visible window, so toggling one is a redraw
 * and never a request. Only `candles.slice(firstVisible)` is drawn.
 *
 * The reader's own price levels are ruled across the price pane when the
 * symbol is on one of their lists — the same overlay the watchlist chart
 * draws, so a stop set there is visible here.
 *
 * Every value the crosshair is on is printed as text in the legend, in text
 * colours, with the series colour only as a swatch beside it: two of the line
 * colours sit under 3:1 against a light surface, and a reading that depended
 * on finding a pale yellow line would be no reading at all.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  bollinger,
  ema,
  macd as macdSeries,
  rsi as rsiSeries,
  sma,
  vwap as vwapSeries,
  type IndicatorId,
} from "../../shared/indicators.js";
import type { DirectionPalette } from "../../shared/preferences.js";
import type { CandleSeries, ChartStyle } from "../../shared/symbol.js";
import {
  barPaths,
  candleLabel,
  candlePaths,
  extent,
  formatPrice,
  isUp,
  linearScale,
  MIN_CANDLE_STEP,
  niceTicks,
  padExtent,
  seriesPath,
  slots,
  spreadLabels,
  timeTicks,
} from "../lib/candles.js";
import { domainWithLevels } from "../lib/chart.js";
import { formatCompact, formatPercent } from "../lib/format.js";
import type { WatchlistLevel } from "../lib/types.js";

/** Right-hand gutter for the price axis. */
const AXIS = 64;
const TIME_AXIS = 22;
const PANE_GAP = 8;
const PANE_HEIGHTS = { volume: 64, macd: 88, rsi: 76 } as const;

const TONES: Record<DirectionPalette, { up: string; down: string; upFill: string; downFill: string; upStroke: string; downStroke: string }> = {
  classic: {
    up: "text-emerald-600",
    down: "text-red-600",
    upFill: "fill-emerald-600",
    downFill: "fill-red-600",
    upStroke: "stroke-emerald-600",
    downStroke: "stroke-red-600",
  },
  accessible: {
    up: "text-teal-600",
    down: "text-orange-600",
    upFill: "fill-teal-600",
    downFill: "fill-orange-600",
    upStroke: "stroke-teal-600",
    downStroke: "stroke-orange-600",
  },
};

/** Line colour per overlay — fixed per indicator, so a toggle never repaints the others. */
const OVERLAY_COLOR: Partial<Record<IndicatorId, string>> = {
  sma20: "var(--viz-1)",
  sma50: "var(--viz-2)",
  sma200: "var(--viz-3)",
  ema20: "var(--viz-4)",
  boll: "var(--viz-5)",
};

function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export interface ChartGuide {
  price: number;
  label: string;
}

export function CandleChart({
  series,
  style,
  indicators,
  palette,
  levels = [],
  entryPrice = null,
  guides = [],
}: {
  series: CandleSeries;
  style: ChartStyle;
  indicators: IndicatorId[];
  palette: DirectionPalette;
  levels?: WatchlistLevel[];
  entryPrice?: number | null;
  guides?: ChartGuide[];
}) {
  const [container, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [pointerY, setPointerY] = useState<number | null>(null);

  const on = (id: IndicatorId) => indicators.includes(id);
  const all = series.candles;
  const offset = series.firstVisible;
  const visible = useMemo(() => all.slice(offset), [all, offset]);

  // Computed over every candle sent, warm-up included, then cut to the window.
  const computed = useMemo(() => {
    const closes = all.map((candle) => candle.c);
    const cut = <T,>(values: T[]) => values.slice(offset);
    return {
      sma20: cut(sma(closes, 20)),
      sma50: cut(sma(closes, 50)),
      sma200: cut(sma(closes, 200)),
      ema20: cut(ema(closes, 20)),
      boll: cut(bollinger(closes, 20, 2)),
      vwap: cut(
        vwapSeries(all.map((candle) => ({ high: candle.h, low: candle.l, close: candle.c, volume: candle.v, session: candle.session }))),
      ),
      macd: cut(macdSeries(closes)),
      rsi: cut(rsiSeries(closes, 14)),
    };
  }, [all, offset]);

  // Drop the hover when the window changes — not on every refresh, which only
  // moves the last candle and would yank the crosshair out from under the
  // pointer every fifteen seconds.
  useEffect(() => setHover(null), [series.symbol, series.range, series.interval]);

  const showVolume = on("vol") && visible.some((candle) => (candle.v ?? 0) > 0);
  const showMacd = on("macd");
  const showRsi = on("rsi");
  const showVwap = on("vwap") && series.intraday;

  const plotWidth = Math.max(0, width - AXIS);
  const narrow = width < 640;
  const priceHeight = narrow ? 240 : 340;
  const panes: { id: "price" | "volume" | "macd" | "rsi"; top: number; height: number }[] = [];
  let cursor = 0;
  panes.push({ id: "price", top: 0, height: priceHeight });
  cursor = priceHeight;
  for (const id of ["volume", "macd", "rsi"] as const) {
    const wanted = id === "volume" ? showVolume : id === "macd" ? showMacd : showRsi;
    if (!wanted) continue;
    cursor += PANE_GAP;
    panes.push({ id, top: cursor, height: PANE_HEIGHTS[id] });
    cursor += PANE_HEIGHTS[id];
  }
  const totalHeight = cursor + TIME_AXIS;
  const pane = (id: (typeof panes)[number]["id"]) => panes.find((entry) => entry.id === id);

  const layout = slots(visible.length, plotWidth);
  const dense = layout.step < MIN_CANDLE_STEP || style === "line";

  // The price domain holds the candles; overlays and levels join it only
  // when they are near enough not to flatten the candles into a rule.
  const levelPrices = levels
    .filter((level) => level.status === "active" && !level.expired)
    .flatMap((level) => [level.price, level.priceHigh ?? level.price]);
  const overlayExtent = extent(
    on("sma20") ? computed.sma20 : [],
    on("sma50") ? computed.sma50 : [],
    on("sma200") ? computed.sma200 : [],
    on("ema20") ? computed.ema20 : [],
    on("boll") ? computed.boll.flatMap((point) => (point === null ? [] : [point.upper, point.lower])) : [],
    showVwap ? computed.vwap : [],
  );
  const domain = domainWithLevels(
    dense ? visible.map((candle) => candle.c) : visible.flatMap((candle) => [candle.h, candle.l]),
    [
      ...levelPrices,
      ...(entryPrice === null ? [] : [entryPrice]),
      ...(series.previousClose === null ? [] : [series.previousClose]),
      ...guides.map((guide) => guide.price),
      ...(overlayExtent ?? []),
    ],
    // Tighter than the watchlist chart's reach: a trading chart is read for
    // the candles' shape, and an intraday window spans a fraction of the
    // distance to a typical stop.
    { padding: 0.05, maxSpanMultiple: 1.5 },
  );
  const pricePane = pane("price")!;
  const price = linearScale(domain.low, domain.high, pricePane.top + 4, pricePane.top + pricePane.height - 4);
  const priceTicks = niceTicks(domain.low, domain.high, Math.max(3, Math.round(priceHeight / 56)));

  const ticks = timeTicks(visible, {
    intraday: series.intraday,
    interval: series.interval,
    timezone: series.timezone,
    maxTicks: Math.max(2, Math.floor(plotWidth / 80)),
  });

  const tones = TONES[palette];
  const last = visible.at(-1);
  const previous = visible.at(-2);
  const lastUp =
    last === undefined
      ? true
      : series.intraday && series.previousClose !== null
        ? last.c >= series.previousClose
        : previous === undefined
          ? isUp(last)
          : last.c >= previous.c;

  const active = hover === null ? null : (visible[hover] ?? null);
  const shown = active ?? last ?? null;
  const shownIndex = hover ?? visible.length - 1;
  const shownPrevious = shownIndex > 0 ? visible[shownIndex - 1] : (all[offset - 1] ?? null);
  const shownChange =
    shown === null
      ? null
      : shownPrevious
        ? (shown.c / shownPrevious.c - 1) * 100
        : series.previousClose !== null
          ? (shown.c / series.previousClose - 1) * 100
          : null;

  if (visible.length < 2) {
    return (
      <p className="py-16 text-center text-sm text-zinc-400">
        Not enough price history to draw this window.
      </p>
    );
  }

  const paths = !dense ? candlePaths(visible, layout, price) : null;
  const closePath = dense ? seriesPath(visible.map((candle) => candle.c), layout, price) : "";
  const lineTone = (series.changePercent ?? 0) >= 0 ? tones.up : tones.down;
  const gradientId = `candle-area-${series.symbol}-${series.range}`.replace(/[^A-Za-z0-9-]/g, "_");

  const volumePane = pane("volume");
  const volumeMax = Math.max(1, ...visible.map((candle) => candle.v ?? 0));
  const volumeScale = volumePane ? linearScale(0, volumeMax, volumePane.top + 2, volumePane.top + volumePane.height) : null;
  const volumeBars =
    volumePane && volumeScale
      ? barPaths(
          visible.map((candle) => candle.v),
          visible.map((candle, i) => (i === 0 ? isUp(candle) : candle.c >= visible[i - 1]!.c)),
          layout,
          volumeScale,
          0,
        )
      : null;

  const macdPane = pane("macd");
  const macdValues = computed.macd;
  const macdExtent = extent(
    macdValues.map((point) => point?.macd ?? null),
    macdValues.map((point) => point?.signal ?? null),
    macdValues.map((point) => point?.histogram ?? null),
    [0],
  );
  const macdScale =
    macdPane && macdExtent
      ? (() => {
          const [low, high] = padExtent(macdExtent, 0.1);
          return linearScale(low, high, macdPane.top + 4, macdPane.top + macdPane.height - 4);
        })()
      : null;

  const rsiPane = pane("rsi");
  const rsiScale = rsiPane ? linearScale(0, 100, rsiPane.top + 4, rsiPane.top + rsiPane.height - 4) : null;

  const sessionStarts = series.intraday
    ? visible.flatMap((candle, i) => (i > 0 && candle.session !== visible[i - 1]!.session ? [i] : []))
    : [];

  const dividendCount = series.events.filter((event) => event.kind === "dividend").length;
  const activeLevels = levels.filter(
    (level) => level.status === "active" && !level.expired && !domain.clamped.includes(level.price),
  );

  function onPointer(event: React.PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setHover(layout.index(x));
    setPointerY(y <= pricePane.height ? y : null);
  }

  function onKey(event: React.KeyboardEvent<SVGSVGElement>) {
    const lastIndex = visible.length - 1;
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "Home" ? -Infinity : event.key === "End" ? Infinity : null;
    if (step === null) return;
    event.preventDefault();
    setPointerY(null);
    setHover((current) => {
      const from = current ?? lastIndex;
      if (step === Infinity) return lastIndex;
      if (step === -Infinity) return 0;
      return Math.max(0, Math.min(lastIndex, from + step));
    });
  }

  const legendAt = (values: (number | null)[]) => values[shownIndex] ?? null;
  const overlayLegend: { id: string; label: string; color: string; value: string; dashed?: boolean }[] = [];
  for (const id of ["sma20", "sma50", "sma200", "ema20"] as const) {
    if (!on(id)) continue;
    overlayLegend.push({
      id,
      label: id === "ema20" ? "EMA20" : `MA${id.slice(3)}`,
      color: OVERLAY_COLOR[id]!,
      value: formatPrice(legendAt(computed[id])),
    });
  }
  if (on("boll")) {
    const point = computed.boll[shownIndex] ?? null;
    overlayLegend.push({
      id: "boll",
      label: "BOLL",
      color: OVERLAY_COLOR.boll!,
      value: point === null ? "—" : `${formatPrice(point.upper)} / ${formatPrice(point.middle)} / ${formatPrice(point.lower)}`,
    });
  }
  if (showVwap) {
    overlayLegend.push({ id: "vwap", label: "VWAP", color: "currentColor", value: formatPrice(legendAt(computed.vwap)), dashed: true });
  }

  const macdShown = computed.macd[shownIndex] ?? null;
  const rsiShown = computed.rsi[shownIndex] ?? null;
  const crosshairX = hover === null ? null : layout.x(hover);

  return (
    <div ref={container} className="relative w-full select-none">
      {width > 0 && (
        <>
          {/* Legend: what the crosshair is on, or the latest candle. */}
          {/* Over the plot where there is room; above it on a phone, where
              four wrapped lines would cover a third of the candles. */}
          <div
            className={`pointer-events-none z-10 flex flex-col gap-0.5 rounded px-1.5 py-1 text-[11px] leading-4 tabular-nums ${
              narrow
                ? "mb-1"
                : "absolute top-1 left-1 max-w-[calc(100%-4.5rem)] bg-white/80 backdrop-blur-[1px] dark:bg-zinc-900/80"
            }`}
          >
            {shown && (
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="text-zinc-500">{candleLabel(shown, series.intraday, series.timezone)}</span>
                <span className="text-zinc-500">
                  O <span className="text-zinc-800 dark:text-zinc-200">{formatPrice(shown.o)}</span>
                </span>
                <span className="text-zinc-500">
                  H <span className="text-zinc-800 dark:text-zinc-200">{formatPrice(shown.h)}</span>
                </span>
                <span className="text-zinc-500">
                  L <span className="text-zinc-800 dark:text-zinc-200">{formatPrice(shown.l)}</span>
                </span>
                <span className="text-zinc-500">
                  C <span className="font-medium text-zinc-900 dark:text-zinc-100">{formatPrice(shown.c)}</span>
                </span>
                {shownChange !== null && (
                  <span className={shownChange >= 0 ? tones.up : tones.down}>{formatPercent(shownChange)}</span>
                )}
                {shown.v !== null && (
                  <span className="text-zinc-500">
                    Vol <span className="text-zinc-800 dark:text-zinc-200">{formatCompact(shown.v)}</span>
                  </span>
                )}
              </div>
            )}
            {overlayLegend.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2.5">
                {overlayLegend.map((entry) => (
                  <span key={entry.id} className="inline-flex items-center gap-1 text-zinc-500">
                    <svg width="12" height="4" aria-hidden="true" className="text-zinc-500">
                      <line
                        x1="0"
                        y1="2"
                        x2="12"
                        y2="2"
                        stroke={entry.color}
                        strokeWidth="2"
                        strokeDasharray={entry.dashed ? "3 2" : undefined}
                      />
                    </svg>
                    {entry.label} <span className="text-zinc-800 dark:text-zinc-200">{entry.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
          <svg
            width={width}
            height={totalHeight}
            role="img"
            tabIndex={0}
            aria-label={`${series.symbol} ${dense ? "price line" : "candlestick chart"}, ${visible.length} ${series.interval} candles from ${visible[0]!.t.slice(0, 10)} to ${last!.t.slice(0, 10)}${series.changePercent === null ? "" : `, ${formatPercent(series.changePercent)}`}. Use the arrow keys to read individual candles.`}
            onKeyDown={onKey}
            onFocus={() => setHover((current) => current ?? visible.length - 1)}
            onBlur={() => {
              setHover(null);
              setPointerY(null);
            }}
            className="block rounded outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
              <clipPath id={`${gradientId}-clip`}>
                <rect x="0" y="0" width={plotWidth} height={totalHeight} />
              </clipPath>
            </defs>

            {/* Grid and axes first, so every mark sits above them. */}
            {panes.map((entry) => (
              <rect
                key={`frame-${entry.id}`}
                x="0.5"
                y={entry.top + 0.5}
                width={plotWidth - 1}
                height={entry.height - 1}
                className="fill-none stroke-zinc-200 dark:stroke-zinc-800"
              />
            ))}
            {priceTicks.map((tick) => (
              <g key={`py-${tick}`}>
                <line
                  x1="0"
                  x2={plotWidth}
                  y1={Math.round(price.y(tick)) + 0.5}
                  y2={Math.round(price.y(tick)) + 0.5}
                  className="stroke-zinc-100 dark:stroke-zinc-800/70"
                />
                <text x={plotWidth + 6} y={price.y(tick) + 3.5} className="fill-zinc-400 text-[10px] tabular-nums">
                  {formatPrice(tick, tick % 1 === 0 && Math.abs(tick) >= 100 ? 0 : undefined)}
                </text>
              </g>
            ))}
            {ticks.map((tick) => {
              const x = Math.round(layout.x(tick.index)) + 0.5;
              return (
                <g key={`tx-${tick.index}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1="0"
                    y2={totalHeight - TIME_AXIS}
                    className={tick.major ? "stroke-zinc-200 dark:stroke-zinc-700/70" : "stroke-zinc-100 dark:stroke-zinc-800/70"}
                  />
                  <text
                    x={Math.min(Math.max(x, 14), plotWidth - 14)}
                    y={totalHeight - 7}
                    textAnchor="middle"
                    className={`text-[10px] ${tick.major ? "fill-zinc-600 dark:fill-zinc-300" : "fill-zinc-400"}`}
                  >
                    {tick.label}
                  </text>
                </g>
              );
            })}
            {sessionStarts.map((index) => {
              const x = Math.round(index * layout.step) + 0.5;
              return (
                <line
                  key={`session-${index}`}
                  x1={x}
                  x2={x}
                  y1="0"
                  y2={totalHeight - TIME_AXIS}
                  className="stroke-zinc-300 dark:stroke-zinc-600"
                  strokeDasharray="2 3"
                />
              );
            })}

            <g clipPath={`url(#${gradientId}-clip)`}>
              {/* Reference lines: previous close, entry, analyst guides, the reader's levels. */}
              {series.previousClose !== null && (
                <line
                  x1="0"
                  x2={plotWidth}
                  y1={price.y(series.previousClose)}
                  y2={price.y(series.previousClose)}
                  className="stroke-zinc-400 dark:stroke-zinc-500"
                  strokeDasharray="4 3"
                />
              )}
              {entryPrice !== null && !domain.clamped.includes(entryPrice) && (
                <line
                  x1="0"
                  x2={plotWidth}
                  y1={price.y(entryPrice)}
                  y2={price.y(entryPrice)}
                  className="stroke-zinc-400 dark:stroke-zinc-500"
                  strokeDasharray="2 3"
                />
              )}
              {guides
                .filter((guide) => !domain.clamped.includes(guide.price))
                .map((guide) => (
                  <line
                    key={`guide-${guide.label}`}
                    x1="0"
                    x2={plotWidth}
                    y1={price.y(guide.price)}
                    y2={price.y(guide.price)}
                    className="stroke-indigo-400 dark:stroke-indigo-500"
                    strokeDasharray="6 4"
                  />
                ))}
              {activeLevels.map((level) => (
                <g key={`level-${level.id}`}>
                  {level.priceHigh !== null && (
                    <rect
                      x="0"
                      width={plotWidth}
                      y={price.y(Math.max(level.price, level.priceHigh))}
                      height={Math.max(1, Math.abs(price.y(level.price) - price.y(level.priceHigh)))}
                      className={level.side === "below" ? "fill-emerald-500/10" : "fill-rose-500/10"}
                    />
                  )}
                  <line
                    x1="0"
                    x2={plotWidth}
                    y1={price.y(level.price)}
                    y2={price.y(level.price)}
                    className={
                      level.side === "below"
                        ? tones.upStroke
                        : level.side === "above"
                          ? tones.downStroke
                          : "stroke-indigo-500"
                    }
                  />
                </g>
              ))}

              {/* Bollinger band fill under everything it frames. */}
              {on("boll") && (
                <>
                  <path
                    d={seriesPath(computed.boll.map((point) => point?.upper ?? null), layout, price)}
                    fill="none"
                    stroke={OVERLAY_COLOR.boll}
                    strokeWidth="1"
                    strokeOpacity="0.8"
                  />
                  <path
                    d={seriesPath(computed.boll.map((point) => point?.middle ?? null), layout, price)}
                    fill="none"
                    stroke={OVERLAY_COLOR.boll}
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <path
                    d={seriesPath(computed.boll.map((point) => point?.lower ?? null), layout, price)}
                    fill="none"
                    stroke={OVERLAY_COLOR.boll}
                    strokeWidth="1"
                    strokeOpacity="0.8"
                  />
                </>
              )}

              {paths ? (
                <>
                  <path d={paths.upWicks} className={tones.upStroke} strokeWidth="1" />
                  <path d={paths.downWicks} className={tones.downStroke} strokeWidth="1" />
                  <path d={paths.upBodies} className={tones.upFill} />
                  <path d={paths.downBodies} className={tones.downFill} />
                </>
              ) : (
                <g className={lineTone}>
                  <path
                    d={`${closePath}L${layout.x(visible.length - 1)} ${pricePane.height}L${layout.x(0)} ${pricePane.height}Z`}
                    fill={`url(#${gradientId})`}
                  />
                  <path d={closePath} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                </g>
              )}

              {(["sma20", "sma50", "sma200", "ema20"] as const)
                .filter(on)
                .map((id) => (
                  <path
                    key={id}
                    d={seriesPath(computed[id], layout, price)}
                    fill="none"
                    stroke={OVERLAY_COLOR[id]}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                ))}
              {showVwap && (
                <path
                  d={seriesPath(computed.vwap, layout, price)}
                  fill="none"
                  className="stroke-zinc-500 dark:stroke-zinc-400"
                  strokeWidth="1.5"
                  strokeDasharray="5 3"
                />
              )}

              {/* Corporate actions along the bottom of the price pane. A split
                  always gets its badge — it is why an old level stopped
                  meaning anything. Dividends shrink to dots once there are
                  enough of them to crowd the axis. */}
              {series.events.map((event) => {
                const index = visible.findIndex((candle) => candle.t.slice(0, 10) >= event.date);
                if (index === -1) return null;
                const x = layout.x(index);
                const y = pricePane.height - 8;
                const split = event.kind === "split";
                const compact = !split && dividendCount > 8;
                return (
                  <g key={`${event.kind}-${event.date}`}>
                    <title>
                      {split
                        ? `Split ${event.factor ?? ""}:1 on ${event.date}`
                        : `Dividend ${event.amount ?? ""} on ${event.date}`}
                    </title>
                    <circle
                      cx={x}
                      cy={y}
                      r={compact ? 2.5 : 5}
                      className={split ? "fill-amber-500" : "fill-zinc-400 dark:fill-zinc-500"}
                    />
                    {!compact && (
                      <text x={x} y={y + 3} textAnchor="middle" className="fill-white text-[8px] font-bold">
                        {split ? "S" : "D"}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Volume */}
              {volumePane && volumeBars && (
                <g opacity="0.55">
                  <path d={volumeBars.up} className={tones.upFill} />
                  <path d={volumeBars.down} className={tones.downFill} />
                </g>
              )}

              {/* MACD */}
              {macdPane && macdScale && (
                <>
                  <line
                    x1="0"
                    x2={plotWidth}
                    y1={macdScale.y(0)}
                    y2={macdScale.y(0)}
                    className="stroke-zinc-300 dark:stroke-zinc-700"
                  />
                  {(() => {
                    const hist = macdValues.map((point) => point?.histogram ?? null);
                    const bars = barPaths(hist, hist.map((value) => (value ?? 0) >= 0), layout, macdScale, 0);
                    return (
                      <g opacity="0.6">
                        <path d={bars.up} className={tones.upFill} />
                        <path d={bars.down} className={tones.downFill} />
                      </g>
                    );
                  })()}
                  <path d={seriesPath(macdValues.map((point) => point?.macd ?? null), layout, macdScale)} fill="none" stroke="var(--viz-1)" strokeWidth="1.5" />
                  <path d={seriesPath(macdValues.map((point) => point?.signal ?? null), layout, macdScale)} fill="none" stroke="var(--viz-2)" strokeWidth="1.5" />
                </>
              )}

              {/* RSI */}
              {rsiPane && rsiScale && (
                <>
                  <rect
                    x="0"
                    width={plotWidth}
                    y={rsiScale.y(70)}
                    height={rsiScale.y(30) - rsiScale.y(70)}
                    className="fill-zinc-100 dark:fill-zinc-800/50"
                  />
                  {[30, 70].map((guide) => (
                    <line
                      key={`rsi-${guide}`}
                      x1="0"
                      x2={plotWidth}
                      y1={rsiScale.y(guide)}
                      y2={rsiScale.y(guide)}
                      className="stroke-zinc-300 dark:stroke-zinc-600"
                      strokeDasharray="3 3"
                    />
                  ))}
                  <path d={seriesPath(computed.rsi, layout, rsiScale)} fill="none" stroke="var(--viz-3)" strokeWidth="1.5" />
                </>
              )}

              {/* Crosshair */}
              {crosshairX !== null && (
                <line
                  x1={Math.round(crosshairX) + 0.5}
                  x2={Math.round(crosshairX) + 0.5}
                  y1="0"
                  y2={totalHeight - TIME_AXIS}
                  className="stroke-zinc-400 dark:stroke-zinc-500"
                  strokeDasharray="3 3"
                />
              )}
              {pointerY !== null && (
                <line x1="0" x2={plotWidth} y1={pointerY} y2={pointerY} className="stroke-zinc-400 dark:stroke-zinc-500" strokeDasharray="3 3" />
              )}
            </g>

            {/* Sub-pane axis labels. */}
            {volumePane && (
              <text x={plotWidth + 6} y={volumePane.top + 11} className="fill-zinc-400 text-[10px] tabular-nums">
                {formatCompact(volumeMax)}
              </text>
            )}
            {rsiPane && rsiScale &&
              [30, 70].map((guide) => (
                <text key={`rsi-label-${guide}`} x={plotWidth + 6} y={rsiScale.y(guide) + 3.5} className="fill-zinc-400 text-[10px]">
                  {guide}
                </text>
              ))}

            {/* Level labels inside the plot's right edge, haloed against the
                candles and nudged apart so two close levels stay readable. */}
            {spreadLabels(
              [
                ...activeLevels.map((level) => ({
                  key: `level-${level.id}`,
                  y: price.y(level.price),
                  text: level.label ?? formatPrice(level.price),
                })),
                ...guides
                  .filter((guide) => !domain.clamped.includes(guide.price))
                  .map((guide) => ({ key: `guide-${guide.label}`, y: price.y(guide.price), text: guide.label })),
              ],
              pricePane.top + 10,
              pricePane.top + pricePane.height - 4,
            ).map((label) => {
              const chip = label.text.length * 5.6 + 8;
              return (
                <g key={`label-${label.key}`}>
                  <rect
                    x={plotWidth - chip - 3}
                    y={label.y - 7}
                    width={chip}
                    height="14"
                    rx="3"
                    className="fill-white/90 stroke-zinc-200 dark:fill-zinc-900/90 dark:stroke-zinc-700"
                  />
                  <text
                    x={plotWidth - 7}
                    y={label.y + 3.5}
                    textAnchor="end"
                    className="fill-zinc-600 text-[10px] font-medium tabular-nums dark:fill-zinc-300"
                  >
                    {label.text}
                  </text>
                </g>
              );
            })}

            {/* Last price tag, then the crosshair's own tags on top of it. */}
            {last && (
              <g>
                <rect
                  x={plotWidth + 1}
                  y={price.y(last.c) - 8}
                  width={AXIS - 2}
                  height="16"
                  rx="3"
                  className={lastUp ? tones.upFill : tones.downFill}
                />
                <text x={plotWidth + 6} y={price.y(last.c) + 3.5} className="fill-white text-[10px] font-semibold tabular-nums">
                  {formatPrice(last.c)}
                </text>
              </g>
            )}
            {pointerY !== null && (
              <g>
                <rect x={plotWidth + 1} y={pointerY - 8} width={AXIS - 2} height="16" rx="3" className="fill-zinc-800 dark:fill-zinc-200" />
                <text x={plotWidth + 6} y={pointerY + 3.5} className="fill-white text-[10px] tabular-nums dark:fill-zinc-900">
                  {formatPrice(price.invert(pointerY))}
                </text>
              </g>
            )}
            {active && crosshairX !== null && (
              <g>
                {(() => {
                  const label = candleLabel(active, series.intraday, series.timezone);
                  const boxWidth = Math.min(plotWidth, label.length * 5.8 + 12);
                  const x = Math.min(Math.max(crosshairX - boxWidth / 2, 0), plotWidth - boxWidth);
                  return (
                    <>
                      <rect x={x} y={totalHeight - TIME_AXIS + 2} width={boxWidth} height="17" rx="3" className="fill-zinc-800 dark:fill-zinc-200" />
                      <text x={x + boxWidth / 2} y={totalHeight - 7} textAnchor="middle" className="fill-white text-[10px] dark:fill-zinc-900">
                        {label}
                      </text>
                    </>
                  );
                })()}
              </g>
            )}

            {/* The hit area covers every pane, so the crosshair works anywhere. */}
            <rect
              x="0"
              y="0"
              width={plotWidth}
              height={totalHeight - TIME_AXIS}
              fill="transparent"
              onPointerMove={onPointer}
              onPointerDown={onPointer}
              onPointerLeave={() => {
                setHover(null);
                setPointerY(null);
              }}
              style={{ touchAction: "pan-y" }}
            />
          </svg>

          {/* Sub-pane legends, positioned over their panes. */}
          {volumePane && (
            <PaneLegend top={volumePane.top}>
              Volume <span className="text-zinc-800 dark:text-zinc-200">{formatCompact(shown?.v ?? null)}</span>
            </PaneLegend>
          )}
          {macdPane && (
            <PaneLegend top={macdPane.top}>
              MACD 12 26 9{" "}
              <Swatch color="var(--viz-1)" /> <span className="text-zinc-800 dark:text-zinc-200">{fmt(macdShown?.macd)}</span>{" "}
              <Swatch color="var(--viz-2)" /> <span className="text-zinc-800 dark:text-zinc-200">{fmt(macdShown?.signal)}</span>{" "}
              hist <span className="text-zinc-800 dark:text-zinc-200">{fmt(macdShown?.histogram)}</span>
            </PaneLegend>
          )}
          {rsiPane && (
            <PaneLegend top={rsiPane.top}>
              <Swatch color="var(--viz-3)" /> RSI 14{" "}
              <span className="text-zinc-800 dark:text-zinc-200">{rsiShown === null ? "—" : rsiShown.toFixed(1)}</span>
            </PaneLegend>
          )}

          </div>

          <p aria-live="polite" className="sr-only">
            {active
              ? `${candleLabel(active, series.intraday, series.timezone)}: open ${formatPrice(active.o)}, high ${formatPrice(active.h)}, low ${formatPrice(active.l)}, close ${formatPrice(active.c)}${active.v === null ? "" : `, volume ${formatCompact(active.v)}`}`
              : ""}
          </p>
        </>
      )}
      {width === 0 && <div style={{ height: 340 }} />}
      {domain.clamped.some((price) => levelPrices.includes(price)) && (
        <p className="mt-1 text-[10px] text-zinc-400">
          Some of your levels are too far from this window to draw — widen the range to see them.
        </p>
      )}
      {dense && style === "candle" && (
        <p className="mt-1 text-[10px] text-zinc-400">
          Too many candles to draw at this width, so closes are shown as a line. Pick a wider interval for candles.
        </p>
      )}
    </div>
  );
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  return value.toFixed(abs >= 100 ? 1 : abs >= 1 ? 2 : 3);
}

function Swatch({ color }: { color: string }) {
  return (
    <svg width="10" height="4" aria-hidden="true" className="inline-block align-middle">
      <line x1="0" y1="2" x2="10" y2="2" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function PaneLegend({ top, children }: { top: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute left-1 z-10 rounded bg-white/80 px-1.5 text-[10px] leading-4 text-zinc-500 tabular-nums dark:bg-zinc-900/80"
      style={{ top: top + 2 }}
    >
      {children}
    </div>
  );
}

