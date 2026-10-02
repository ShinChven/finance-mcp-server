/**
 * Candlestick-chart geometry — pure functions, no DOM.
 *
 * The line chart beside the watchlist works in a fixed viewBox and scales to
 * fit. A trading chart cannot: candle bodies need whole-pixel widths to stay
 * crisp, axis labels must not grow with the container, and the crosshair has to
 * land on a candle the reader can see. So this chart is laid out in real pixels
 * against a measured width, and everything that decides where a mark lands is
 * here, where the suite can test it.
 *
 * x is by candle index, not by time. Markets close at night and at weekends,
 * and a time axis would draw every weekend as an empty gap two candles wide;
 * every charting package a reader has used spaces candles evenly for that
 * reason. The real time is on the axis labels and in the crosshair readout.
 */

import type { Candle } from "../../shared/symbol.js";

export interface Scale {
  /** Value → pixel. */
  y(value: number): number;
  /** Pixel → value, for the crosshair's price label. */
  invert(pixel: number): number;
  min: number;
  max: number;
}

/**
 * A linear scale from [min, max] onto [bottom, top] in pixels.
 *
 * A zero span — a series that never moved — is opened symmetrically so the
 * line sits in the middle of the pane instead of dividing by zero.
 */
export function linearScale(min: number, max: number, top: number, bottom: number): Scale {
  let low = min;
  let high = max;
  if (!(high > low)) {
    const pad = Math.abs(low) * 0.01 || 1;
    low -= pad;
    high += pad;
  }
  const span = high - low;
  const height = bottom - top;
  return {
    min: low,
    max: high,
    y: (value) => top + (1 - (value - low) / span) * height,
    invert: (pixel) => low + (1 - (pixel - top) / height) * span,
  };
}

/** Extent of the finite values among any number of series. */
export function extent(...series: (number | null | undefined)[][]): [number, number] | null {
  let low = Infinity;
  let high = -Infinity;
  for (const values of series) {
    for (const value of values) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  return Number.isFinite(low) ? [low, high] : null;
}

/** Pads an extent by a fraction of its span so marks never touch the pane edge. */
export function padExtent([low, high]: [number, number], fraction = 0.06): [number, number] {
  const span = high - low || Math.abs(high) * 0.02 || 1;
  return [low - span * fraction, high + span * fraction];
}

/**
 * Round-number gridlines across a span: steps of 1, 2, 2.5 or 5 × 10ⁿ.
 *
 * Gridlines at 123.47 and 131.29 are noise; at 125 and 130 they are a ruler.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  const raw = (max - min) / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= raw) ??
    10 * magnitude;
  const out: number[] = [];
  const first = Math.ceil(min / step) * step;
  for (let value = first; value <= max + step * 1e-9; value += step) {
    // Repeated addition drifts (0.1 + 0.2); snap back onto the step.
    out.push(Number((Math.round(value / step) * step).toPrecision(12)));
  }
  return out;
}

/** Decimal places that keep a price readable at its magnitude. */
export function priceDigits(value: number): number {
  const abs = Math.abs(value);
  if (abs >= 1000) return 2;
  if (abs >= 10) return 2;
  if (abs >= 1) return 3;
  if (abs >= 0.01) return 4;
  return 6;
}

export function formatPrice(value: number | null | undefined, digits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const places = digits ?? priceDigits(value);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

export interface Slots {
  /** Width of one candle's slot. */
  step: number;
  /** Width of a candle body: most of the slot, a whole pixel, at least one. */
  body: number;
  /** Centre of slot `i`. */
  x(index: number): number;
  /** The slot under a pixel, clamped to the series. */
  index(pixel: number): number;
}

export function slots(count: number, width: number): Slots {
  const step = count > 0 ? width / count : width;
  const body = Math.max(1, Math.floor(step * 0.7));
  return {
    step,
    body: body >= 3 && body % 2 === 0 ? body - 1 : body,
    x: (index) => (index + 0.5) * step,
    index: (pixel) => Math.max(0, Math.min(count - 1, Math.floor(pixel / step))),
  };
}

/** Below this many pixels a candle is a smear, and the chart draws a line instead. */
export const MIN_CANDLE_STEP = 2.5;

/** Whether a candle closed at or above where it opened. */
export function isUp(candle: Candle): boolean {
  return candle.c >= candle.o;
}

function r(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Bodies and wicks as four paths — up and down, body and wick — however many
 * candles there are. Five hundred `<rect>`s per redraw is what makes a
 * crosshair stutter; four paths is not.
 */
export function candlePaths(
  candles: Candle[],
  layout: Slots,
  scale: Scale,
): { upBodies: string; downBodies: string; upWicks: string; downWicks: string } {
  const parts = { upBodies: [] as string[], downBodies: [] as string[], upWicks: [] as string[], downWicks: [] as string[] };
  const half = layout.body / 2;
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    const up = isUp(candle);
    // Snapped to the half pixel so a one-pixel wick renders as one pixel.
    const cx = Math.round(layout.x(i)) + 0.5;
    const top = scale.y(Math.max(candle.o, candle.c));
    const bottom = scale.y(Math.min(candle.o, candle.c));
    const height = Math.max(1, bottom - top);
    (up ? parts.upWicks : parts.downWicks).push(
      `M${cx} ${r(scale.y(candle.h))}V${r(scale.y(candle.l))}`,
    );
    (up ? parts.upBodies : parts.downBodies).push(
      `M${r(cx - half)} ${r(top)}h${layout.body}v${r(height)}h${-layout.body}Z`,
    );
  }
  return {
    upBodies: parts.upBodies.join(""),
    downBodies: parts.downBodies.join(""),
    upWicks: parts.upWicks.join(""),
    downWicks: parts.downWicks.join(""),
  };
}

/**
 * A polyline through the defined values, lifting the pen at every gap.
 *
 * An indicator is null until it is warm and wherever its input was missing;
 * joining across those would draw a value nobody computed.
 */
export function seriesPath(values: (number | null)[], layout: Slots, scale: Scale): string {
  let out = "";
  let drawing = false;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null || value === undefined || !Number.isFinite(value)) {
      drawing = false;
      continue;
    }
    out += `${drawing ? "L" : "M"}${r(layout.x(i))} ${r(scale.y(value))}`;
    drawing = true;
  }
  return out;
}

/** Vertical bars from a baseline, split by sign — volume and the MACD histogram. */
export function barPaths(
  values: (number | null)[],
  up: boolean[],
  layout: Slots,
  scale: Scale,
  baseline: number,
): { up: string; down: string } {
  const out = { up: [] as string[], down: [] as string[] };
  const base = scale.y(baseline);
  const width = Math.max(1, layout.body);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const y = scale.y(value);
    const top = Math.min(y, base);
    const height = Math.max(0.5, Math.abs(base - y));
    const x = Math.round(layout.x(i) - width / 2);
    (up[i] ? out.up : out.down).push(`M${x} ${r(top)}h${width}v${r(height)}h${-width}Z`);
  }
  return { up: out.up.join(""), down: out.down.join("") };
}

/**
 * Label positions nudged apart so none overlap, kept inside the pane.
 *
 * A stop at 205 and a zone at 212 sit a few pixels apart on a five-year
 * chart; drawn where they fall, their labels print over each other. Sorted by
 * position, each label is pushed down until it clears the one above, then the
 * whole stack is shifted back up if that ran it off the bottom.
 */
export function spreadLabels<T extends { y: number }>(labels: T[], top: number, bottom: number, gap = 12): T[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y).map((label) => ({ ...label }));
  for (let i = 0; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const minimum = previous === undefined ? top : previous.y + gap;
    sorted[i]!.y = Math.max(sorted[i]!.y, minimum);
  }
  const overflow = (sorted.at(-1)?.y ?? 0) - bottom;
  if (overflow > 0) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const next = sorted[i + 1];
      const limit = next === undefined ? bottom : next.y - gap;
      sorted[i]!.y = Math.min(sorted[i]!.y, limit);
    }
  }
  return sorted;
}

/* ------------------------------------------------------------------------ */
/* Time axis                                                                */
/* ------------------------------------------------------------------------ */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${zone}|${JSON.stringify(options)}`;
  let cached = partsCache.get(key);
  if (cached === undefined) {
    try {
      cached = new Intl.DateTimeFormat(undefined, { ...options, timeZone: zone });
    } catch {
      cached = new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" });
    }
    partsCache.set(key, cached);
  }
  return cached;
}

/** A daily `t` is a calendar date already; it is formatted in UTC so it stays that date. */
function dateOf(t: string): Date {
  return new Date(t.length === 10 ? `${t}T00:00:00Z` : t);
}

/** The full label a crosshair shows for one candle. */
export function candleLabel(candle: Candle, intraday: boolean, timezone: string): string {
  if (intraday) {
    return formatter(timezone, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(dateOf(candle.t));
  }
  return formatter("UTC", { year: "numeric", month: "short", day: "numeric", weekday: "short" }).format(
    dateOf(candle.t),
  );
}

export interface TimeTick {
  index: number;
  label: string;
  /** A boundary worth a stronger line: a new session intraday, a new year otherwise. */
  major: boolean;
}

/**
 * Where the time axis puts its labels.
 *
 * Labels go on boundaries a reader already counts in — a new session or hour
 * intraday, a new month or year on daily candles — rather than every n-th
 * candle, which would label 14 March and 2 April and mean nothing. Then they
 * are thinned to fit, keeping major boundaries first.
 */
export function timeTicks(
  candles: Candle[],
  options: { intraday: boolean; interval: string; timezone: string; maxTicks: number },
): TimeTick[] {
  if (candles.length === 0 || options.maxTicks < 1) return [];
  const ticks: TimeTick[] = [];

  if (options.intraday) {
    const hour = formatter(options.timezone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const day = formatter(options.timezone, { month: "short", day: "numeric" });
    const multiSession = candles[0]!.session !== candles.at(-1)!.session;
    let previousHour = "";
    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i]!;
      const newSession = i > 0 && candle.session !== candles[i - 1]!.session;
      const at = dateOf(candle.t);
      const hh = hour.format(at).slice(0, 2);
      if (newSession || (i === 0 && multiSession)) {
        ticks.push({ index: i, label: day.format(at), major: true });
      } else if (!multiSession && hh !== previousHour && i > 0) {
        ticks.push({ index: i, label: hour.format(at), major: false });
      }
      previousHour = hh;
    }
  } else {
    const month = formatter("UTC", { month: "short" });
    const year = formatter("UTC", { year: "numeric" });
    for (let i = 1; i < candles.length; i++) {
      const previous = candles[i - 1]!.t;
      const current = candles[i]!.t;
      const newYear = current.slice(0, 4) !== previous.slice(0, 4);
      const newMonth = current.slice(0, 7) !== previous.slice(0, 7);
      if (options.interval === "1mo" || options.interval === "1wk") {
        if (newYear) ticks.push({ index: i, label: year.format(dateOf(current)), major: true });
        else if (options.interval === "1wk" && newMonth && Number(current.slice(5, 7)) % 3 === 1) {
          ticks.push({ index: i, label: month.format(dateOf(current)), major: false });
        }
      } else if (newYear) {
        ticks.push({ index: i, label: year.format(dateOf(current)), major: true });
      } else if (newMonth) {
        ticks.push({ index: i, label: month.format(dateOf(current)), major: false });
      }
    }
  }

  return thin(ticks, options.maxTicks);
}

/** Keeps every major tick it can, then spaces minor ones evenly among them. */
function thin(ticks: TimeTick[], max: number): TimeTick[] {
  if (ticks.length <= max) return ticks;
  const majors = ticks.filter((tick) => tick.major);
  if (majors.length >= max) {
    const every = Math.ceil(majors.length / max);
    return majors.filter((_, i) => i % every === 0);
  }
  const room = max - majors.length;
  const minors = ticks.filter((tick) => !tick.major);
  const every = Math.ceil(minors.length / Math.max(1, room));
  const kept = new Set(room > 0 ? minors.filter((_, i) => i % every === 0) : []);
  return ticks.filter((tick) => tick.major || kept.has(tick));
}

/* ------------------------------------------------------------------------ */
/* The live candle                                                          */
/* ------------------------------------------------------------------------ */

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD` of an instant at the exchange — the same rule the server stores bars by. */
export function exchangeDate(instant: string, zone: string): string | null {
  const at = Date.parse(instant);
  if (Number.isNaN(at)) return null;
  let format = dayFormatters.get(zone);
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      format = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    }
    dayFormatters.set(zone, format);
  }
  return format.format(new Date(at));
}

export interface LiveQuote {
  price: number | null;
  asOf: string | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
}

/**
 * Daily candles with today's candle brought up to the live quote.
 *
 * The bar store re-reads a symbol's tail at most every fifteen minutes, which
 * is right for a history and wrong for the one candle that is still forming:
 * the header above the chart refreshes every few seconds, and a last candle
 * that disagreed with it would be the most visible thing on the page. So the
 * quote's session figures replace the last candle when they are for the same
 * exchange date, and start a new one when the store has not seen today yet.
 * Anything else — weekly candles, a quote older than the last bar — is left
 * exactly as the server sent it.
 */
export function withLiveCandle(candles: Candle[], quote: LiveQuote | null, timezone: string): Candle[] {
  if (quote === null || quote.price === null || quote.asOf === null) return candles;
  const last = candles.at(-1);
  if (last === undefined) return candles;
  const session = exchangeDate(quote.asOf, timezone);
  if (session === null || session < last.session) return candles;

  const price = quote.price;
  if (session === last.session) {
    const next: Candle = {
      ...last,
      c: price,
      h: Math.max(last.h, price, quote.dayHigh ?? price),
      l: Math.min(last.l, price, quote.dayLow ?? price),
      v: quote.volume ?? last.v,
    };
    return [...candles.slice(0, -1), next];
  }

  const open = quote.open ?? last.c;
  return [
    ...candles,
    {
      t: session,
      o: open,
      h: Math.max(open, price, quote.dayHigh ?? price),
      l: Math.min(open, price, quote.dayLow ?? price),
      c: price,
      v: quote.volume,
      session,
    },
  ];
}
