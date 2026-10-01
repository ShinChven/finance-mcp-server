/**
 * Candles for the symbol page: OHLCV over a window, with history in front of it.
 *
 * `series.ts` draws one line per item and is shaped for that — decimated
 * closes, rebased to the window's first observation, small enough for a pane
 * beside a table. A trading chart needs the opposite: every candle with its
 * open, high, low and volume, at a width chosen for the window, and enough
 * candles *before* the window that a 200-period average is already defined at
 * its left edge rather than starting two hundred candles in.
 *
 * It reads the same bar store the line chart does, so opening a symbol here
 * warms the watchlist's chart and vice versa — there is one copy of a symbol's
 * history in the database, not one per view.
 *
 * Weekly and monthly candles are built here from stored daily bars rather than
 * requested from the upstream at that width. One request per symbol fills every
 * width the page offers, and an aggregate computed from the same bars can never
 * disagree with the daily view of the same week.
 */

import { MAX_WARMUP } from "../../shared/indicators.js";
import {
  resolveInterval,
  type Candle,
  type CandleInterval,
  type CandleSeries,
  type ResolvedInterval,
} from "../../shared/symbol.js";
import { seriesRange, type SeriesRangeId } from "../../shared/series.js";
import { barStaleness, type BarStore } from "./bars.js";
import type { DailyBar, IntradayPoint, MarketDataProvider } from "./provider.js";
import { computeSeriesStats, round, type ValuePoint } from "./series-math.js";
import { windowStart } from "./series.js";
import { toExchangeDate, zoneLabel } from "./timezone.js";

export interface CandleDeps {
  bars: BarStore;
  provider: MarketDataProvider;
}

/**
 * A price at the precision a chart can use.
 *
 * Yahoo serves single-precision floats widened to doubles — 229.95000457763672
 * — and the trailing digits are noise that multiplies the payload size. Four
 * decimals above one, eight significant digits below it (a sub-penny listing
 * or a crypto pair still keeps its resolution).
 */
export function tidy(value: number): number {
  if (Math.abs(value) >= 1) return Math.round(value * 10_000) / 10_000;
  return Number(value.toPrecision(8));
}

/**
 * Stored daily bars as candles.
 *
 * A bar without a close is no candle at all and is dropped. One with a close
 * but a missing open, high or low — indices and thin listings do publish
 * those — is drawn as a flat candle at the close rather than dropped, because
 * a gap in the axis would claim the market was shut that day.
 */
export function barsToCandles(bars: DailyBar[]): Candle[] {
  const out: Candle[] = [];
  for (const bar of bars) {
    if (bar.close === null || !(bar.close > 0)) continue;
    const close = tidy(bar.close);
    const open = tidy(bar.open ?? close);
    out.push({
      t: bar.date,
      o: open,
      h: Math.max(tidy(bar.high ?? close), open, close),
      l: Math.min(tidy(bar.low ?? close), open, close),
      c: close,
      v: bar.volume,
      session: bar.date,
    });
  }
  return out;
}

/** The Monday of the ISO week a `YYYY-MM-DD` falls in, computed in UTC. */
export function weekKey(date: string): string {
  const at = Date.parse(`${date}T00:00:00Z`);
  const weekday = (new Date(at).getUTCDay() + 6) % 7;
  return new Date(at - weekday * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Daily candles folded into weeks or months.
 *
 * Keyed on the exchange-local date each daily candle already carries, so a
 * week is the exchange's week. The candle is stamped with its first trading
 * day, which is what the axis and `firstVisible` both measure against.
 */
export function aggregateCandles(daily: Candle[], interval: "1wk" | "1mo"): Candle[] {
  const out: Candle[] = [];
  let key: string | null = null;
  let current: Candle | null = null;

  for (const candle of daily) {
    const next = interval === "1wk" ? weekKey(candle.t) : candle.t.slice(0, 7);
    if (current === null || next !== key) {
      if (current !== null) out.push(current);
      key = next;
      current = { ...candle };
      continue;
    }
    current.h = Math.max(current.h, candle.h);
    current.l = Math.min(current.l, candle.l);
    current.c = candle.c;
    current.v =
      current.v === null && candle.v === null ? null : (current.v ?? 0) + (candle.v ?? 0);
    current.session = candle.session;
  }
  if (current !== null) out.push(current);
  return out;
}

/**
 * Intraday points as candles, trimmed to the last `sessions` sessions.
 *
 * The upstream is asked for a few calendar days more than the window needs —
 * weekends and holidays make "the last five sessions" unknowable in advance —
 * so the trim happens here, on exchange dates.
 */
export function intradayToCandles(
  points: IntradayPoint[],
  timezone: string,
  sessions: number,
): { candles: Candle[]; previousSessionClose: number | null } {
  const all: Candle[] = [];
  for (const point of points) {
    if (point.close === null || !(point.close > 0)) continue;
    const close = tidy(point.close);
    const open = tidy(point.open ?? close);
    all.push({
      t: new Date(point.at).toISOString(),
      o: open,
      h: Math.max(tidy(point.high ?? close), open, close),
      l: Math.min(tidy(point.low ?? close), open, close),
      c: close,
      v: point.volume,
      session: toExchangeDate(point.at, timezone),
    });
  }

  const dates = [...new Set(all.map((candle) => candle.session))];
  const keep = new Set(dates.slice(-sessions));
  const firstKept = all.findIndex((candle) => keep.has(candle.session));
  const before = firstKept > 0 ? all[firstKept - 1] : undefined;
  return {
    candles: firstKept === -1 ? [] : all.slice(firstKept),
    previousSessionClose: before?.c ?? null,
  };
}

/**
 * How far before a window's start to read so every indicator is warm.
 *
 * In calendar days, generously: 200 daily candles is about 280 calendar days
 * once weekends and holidays are counted, and a few spare cost nothing because
 * the store already holds the whole history.
 */
export function warmupStart(from: string, interval: ResolvedInterval): string {
  if (from <= "0001-01-01") return from;
  const days =
    interval === "1mo"
      ? MAX_WARMUP * 31
      : interval === "1wk"
        ? MAX_WARMUP * 7 + 14
        : Math.ceil((MAX_WARMUP * 7) / 5) + 21;
  const at = Date.parse(`${from}T00:00:00Z`) - days * 86_400_000;
  if (!Number.isFinite(at) || at < Date.parse("0001-01-02T00:00:00Z")) return "0001-01-01";
  return new Date(at).toISOString().slice(0, 10);
}

function adjustedValues(bars: DailyBar[], from: string, to: string): ValuePoint[] {
  return bars
    .filter((bar) => bar.date >= from && bar.date <= to)
    .map((bar) => ({ date: bar.date, value: bar.adjClose ?? bar.close }))
    .filter((point): point is ValuePoint => point.value !== null && point.value > 0);
}

/** The change a header prints for this window, on the raw close. */
function windowChange(first: number | null | undefined, last: number | undefined): number | null {
  if (first === null || first === undefined || last === undefined || first <= 0) return null;
  return round((last / first - 1) * 100, 2);
}

export async function symbolCandles(
  symbol: string,
  range: SeriesRangeId,
  interval: CandleInterval,
  deps: CandleDeps,
): Promise<CandleSeries | null> {
  const descriptor = seriesRange(range);
  const resolved = resolveInterval(range, interval);

  if (descriptor.intraday) {
    const days = descriptor.days === 1 ? 1 : 5;
    const result = await deps.provider.fetchIntraday(symbol, {
      days,
      intervalMinutes: resolved === "15m" ? 15 : 5,
    });
    const { candles, previousSessionClose } = intradayToCandles(
      result.points,
      result.timezone,
      days,
    );
    if (candles.length === 0) return null;
    // The prior session's own last print where it was fetched, which is the
    // close the day's change is measured from; the upstream's figure only when
    // the window starts on the first session it returned.
    const previousClose = previousSessionClose ?? result.previousClose;
    return {
      symbol,
      range,
      interval: resolved,
      intraday: true,
      timezone: result.timezone,
      timezoneLabel: zoneLabel(result.timezone),
      currency: result.currency,
      candles,
      firstVisible: 0,
      previousClose,
      events: [],
      stats: null,
      changePercent: windowChange(previousClose ?? candles[0]?.o, candles.at(-1)?.c),
      staleness: "live",
    };
  }

  // As in `symbolSeries`: bring the tail current first, then measure the window
  // back from the series' own last bar, so a stale listing does not lose days
  // off the left edge for a reason nobody can see.
  const nominal = windowStart(range, toExchangeDate(Date.now(), "UTC"), "UTC");
  const current = await deps.bars.ensure(symbol, warmupStart(nominal, resolved));
  const anchored =
    current.lastBar === null ? nominal : windowStart(range, current.lastBar, current.timezone);
  const needed = warmupStart(anchored, resolved);
  const nominalNeeded = warmupStart(nominal, resolved);
  const stored =
    needed < nominalNeeded ? ((await deps.bars.read(symbol, needed)) ?? current) : current;

  const daily = barsToCandles(stored.bars);
  const candles = resolved === "1d" ? daily : aggregateCandles(daily, resolved as "1wk" | "1mo");
  if (candles.length < 2) return null;

  // The candle containing the window's start, so the first visible candle is
  // the one the window's change is measured from.
  const anchor = candles.findLastIndex((candle) => candle.t <= anchored);
  const firstVisible = Math.min(Math.max(anchor, 0), candles.length - 1);
  const start = candles[firstVisible]!;
  const end = candles.at(-1)!;
  const endDate = stored.lastBar ?? end.session;

  const stats = computeSeriesStats(adjustedValues(stored.bars, start.t, endDate));

  return {
    symbol,
    range,
    interval: resolved,
    intraday: false,
    timezone: stored.timezone,
    timezoneLabel: zoneLabel(stored.timezone),
    currency: stored.currency,
    candles,
    firstVisible,
    previousClose: null,
    events: stored.events.filter((event) => event.date >= start.t && event.date <= endDate),
    stats:
      stats === null
        ? null
        : {
            cumulativeReturnPercent: stats.cumulativeReturnPercent,
            annualizedReturnPercent: stats.days >= 365 ? stats.annualizedReturnPercent : null,
            maxDrawdownPercent: stats.maxDrawdownPercent,
            annualizedVolatilityPercent: stats.annualizedVolatilityPercent,
          },
    changePercent: windowChange(start.c, end.c),
    staleness: barStaleness(stored.lastBar, stored.timezone) === "live" ? "live" : "cached",
  };
}
