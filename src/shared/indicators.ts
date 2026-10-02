/**
 * Technical indicators — pure arithmetic over a series of candles.
 *
 * Shared rather than server-only because the chart computes them: toggling a
 * moving average on and off is a redraw, and a redraw that cost a request
 * would make the toggle feel broken. The server's only job is to send enough
 * history *before* the visible window that a 200-period average is already
 * warmed up at the left edge, instead of starting two hundred candles in.
 *
 * Every function returns an array aligned 1:1 with its input, holding `null`
 * wherever the indicator is not yet defined (too few observations) or the
 * input itself was missing. Aligned arrays are what a chart wants — index `i`
 * of every series belongs to candle `i` — and `null` is what an SVG path needs
 * in order to lift the pen rather than draw a line through a gap.
 *
 * The definitions are the textbook ones, chosen so the numbers agree with any
 * charting package a reader might cross-check against:
 *
 * - SMA: arithmetic mean of the last `period` values.
 * - EMA: seeded with the SMA of the first `period` values, then
 *   `α = 2 / (period + 1)`.
 * - Bollinger: SMA ± k population standard deviations (k = 2).
 * - RSI: Wilder's smoothing, seeded with simple averages of the first
 *   `period` gains and losses.
 * - MACD: EMA(fast) − EMA(slow); signal is an EMA of the MACD line; histogram
 *   is their difference.
 * - VWAP: cumulative Σ(typical price × volume) / Σ volume, reset each session.
 */

export type Series = (number | null)[];

/** An all-null series as long as the input — what every indicator starts from. */
function blank(length: number): Series {
  return Array.from({ length }, () => null);
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Simple moving average. A window containing a gap is undefined, not shortened. */
export function sma(values: Series, period: number): Series {
  const out = blank(values.length);
  if (period < 1) return out;
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (finite(value)) {
      sum += value;
      valid++;
    }
    if (i >= period) {
      const leaving = values[i - period];
      if (finite(leaving)) {
        sum -= leaving;
        valid--;
      }
    }
    if (i >= period - 1 && valid === period) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average.
 *
 * A gap does not reset the average — it is carried across, and the gap itself
 * is reported as null. Resetting would make one missing print in a ten-year
 * series restart the warm-up and blank the line for the next `period` bars.
 */
export function ema(values: Series, period: number): Series {
  const out = blank(values.length);
  if (period < 1) return out;
  const alpha = 2 / (period + 1);
  let seedSum = 0;
  let seeded = 0;
  let current: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!finite(value)) continue;
    if (current === null) {
      seedSum += value;
      seeded++;
      if (seeded === period) {
        current = seedSum / period;
        out[i] = current;
      }
      continue;
    }
    current = value * alpha + current * (1 - alpha);
    out[i] = current;
  }
  return out;
}

export interface BollingerPoint {
  upper: number;
  middle: number;
  lower: number;
}

export function bollinger(values: Series, period = 20, k = 2): (BollingerPoint | null)[] {
  const middle = sma(values, period);
  return middle.map((mean, i) => {
    if (mean === null) return null;
    let squares = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const value = values[j] as number;
      squares += (value - mean) ** 2;
    }
    const deviation = Math.sqrt(squares / period);
    return { upper: mean + k * deviation, middle: mean, lower: mean - k * deviation };
  });
}

/**
 * Relative strength index, Wilder's method.
 *
 * A flat stretch with no losses reads 100 and no gains reads 0 — the limits of
 * the formula — and a perfectly flat one reads 50 rather than dividing by zero.
 */
export function rsi(values: Series, period = 14): Series {
  const out = blank(values.length);
  if (period < 1) return out;
  let previous: number | null = null;
  let gains = 0;
  let losses = 0;
  let steps = 0;
  let avgGain: number | null = null;
  let avgLoss: number | null = null;

  const read = (gain: number, loss: number): number => {
    if (gain === 0 && loss === 0) return 50;
    if (loss === 0) return 100;
    return 100 - 100 / (1 + gain / loss);
  };

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!finite(value)) continue;
    if (previous === null) {
      previous = value;
      continue;
    }
    const change = value - previous;
    previous = value;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (avgGain === null || avgLoss === null) {
      gains += gain;
      losses += loss;
      steps++;
      if (steps === period) {
        avgGain = gains / period;
        avgLoss = losses / period;
        out[i] = read(avgGain, avgLoss);
      }
      continue;
    }
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = read(avgGain, avgLoss);
  }
  return out;
}

export interface MacdPoint {
  macd: number;
  signal: number | null;
  histogram: number | null;
}

export function macd(
  values: Series,
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): (MacdPoint | null)[] {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const line: Series = fastLine.map((value, i) => {
    const other = slowLine[i];
    return value === null || other === null || other === undefined ? null : value - other;
  });
  const signal = ema(line, signalPeriod);
  return line.map((value, i) => {
    if (value === null) return null;
    const sig = signal[i] ?? null;
    return { macd: value, signal: sig, histogram: sig === null ? null : value - sig };
  });
}

export interface VwapInput {
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  /** Candles sharing a session key accumulate together; a new key resets. */
  session: string;
}

/**
 * Volume-weighted average price, per session.
 *
 * Only meaningful intraday, which is the only place the chart offers it: over
 * daily candles a "session" is one candle and VWAP collapses into the typical
 * price. Candles without volume — some indices publish none — contribute
 * nothing, and a session that has seen no volume yet has no VWAP.
 */
export function vwap(candles: VwapInput[]): Series {
  const out = blank(candles.length);
  let session: string | null = null;
  let pv = 0;
  let volume = 0;
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    if (candle.session !== session) {
      session = candle.session;
      pv = 0;
      volume = 0;
    }
    if (
      finite(candle.high) &&
      finite(candle.low) &&
      finite(candle.close) &&
      finite(candle.volume) &&
      candle.volume > 0
    ) {
      pv += ((candle.high + candle.low + candle.close) / 3) * candle.volume;
      volume += candle.volume;
    }
    if (volume > 0) out[i] = pv / volume;
  }
  return out;
}

/**
 * The indicators the chart offers, which are also the `?ind=` vocabulary.
 *
 * `pane` says where each one is drawn: over the price, or in its own strip
 * underneath. `intradayOnly` marks the one that means nothing over daily
 * candles. `warmup` is how many candles of history it needs before its first
 * defined value — the server uses the largest of them to decide how far before
 * the visible window to start reading.
 */
export const INDICATORS = [
  { id: "sma20", label: "MA 20", pane: "price", warmup: 20, intradayOnly: false },
  { id: "sma50", label: "MA 50", pane: "price", warmup: 50, intradayOnly: false },
  { id: "sma200", label: "MA 200", pane: "price", warmup: 200, intradayOnly: false },
  { id: "ema20", label: "EMA 20", pane: "price", warmup: 20, intradayOnly: false },
  { id: "boll", label: "Bollinger", pane: "price", warmup: 20, intradayOnly: false },
  { id: "vwap", label: "VWAP", pane: "price", warmup: 0, intradayOnly: true },
  { id: "vol", label: "Volume", pane: "volume", warmup: 0, intradayOnly: false },
  { id: "macd", label: "MACD", pane: "macd", warmup: 34, intradayOnly: false },
  { id: "rsi", label: "RSI 14", pane: "rsi", warmup: 15, intradayOnly: false },
] as const;

export type IndicatorId = (typeof INDICATORS)[number]["id"];

/** What a fresh chart shows: two averages and volume — the reading most people start from. */
export const DEFAULT_INDICATORS: readonly IndicatorId[] = ["sma20", "sma50", "vol"];

/** Candles of history the longest indicator needs before the window starts. */
export const MAX_WARMUP = Math.max(...INDICATORS.map((indicator) => indicator.warmup));

export function isIndicatorId(value: string): value is IndicatorId {
  return INDICATORS.some((indicator) => indicator.id === value);
}

/**
 * `?ind=` → a de-duplicated list in registry order.
 *
 * Unknown ids are dropped rather than rejected: a link from before an
 * indicator was renamed should still open the chart, just without it. An
 * absent param means the defaults; `none` is how a reader who turned
 * everything off says so in a URL.
 */
export function parseIndicators(value: string | null | undefined): IndicatorId[] {
  if (value === null || value === undefined || value === "") return [...DEFAULT_INDICATORS];
  if (value === "none") return [];
  const wanted = new Set(value.split(",").map((part) => part.trim()));
  return INDICATORS.filter((indicator) => wanted.has(indicator.id)).map((indicator) => indicator.id);
}

/** The inverse of `parseIndicators`; empty string means "the defaults". */
export function serializeIndicators(ids: readonly IndicatorId[]): string {
  const ordered = INDICATORS.filter((indicator) => ids.includes(indicator.id)).map(
    (indicator) => indicator.id,
  );
  if (ordered.length === 0) return "none";
  const isDefault =
    ordered.length === DEFAULT_INDICATORS.length &&
    ordered.every((id) => DEFAULT_INDICATORS.includes(id));
  return isDefault ? "" : ordered.join(",");
}
