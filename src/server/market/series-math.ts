/**
 * Series arithmetic — pure functions over dated values, no market knowledge.
 *
 * Lifted out of `funds/performance.ts` unchanged, because none of it was ever
 * about funds: a drawdown is a drawdown whether the series is a net asset value
 * or a closing price, and having two copies of largest-triangle decimation
 * would mean two chances to get a crash-swallowing bug wrong.
 *
 * Everything here works on `ValuePoint` — a date and a positive number — so a
 * caller decides for itself what the number means and says so in its own
 * result. Nothing in this module knows what an exchange is, and nothing in it
 * may learn.
 */

/** One observation: an ISO date and the value on that date. */
export interface ValuePoint {
  date: string;
  value: number;
}

/** Rounds to a fixed number of decimals — enough to keep payloads honest. */
export function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Whole days between two ISO dates, measured in UTC so DST cannot shift it. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * `date` shifted back by whole months, clamped to the end of the target month.
 *
 * Without the clamp the platform's own rollover turns 31 March minus one month
 * into 3 March, quietly measuring a two-month window as 1M.
 */
export function monthsBefore(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const daysInMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const clamped = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, daysInMonth)),
  );
  return clamped.toISOString().slice(0, 10);
}

/** The last observation on or before `date`, or null if the series starts later. */
export function lastAtOrBefore(series: ValuePoint[], date: string): ValuePoint | null {
  let found: ValuePoint | null = null;
  for (const point of series) {
    if (point.date > date) break;
    found = point;
  }
  return found;
}

/**
 * What a window of observations did, with no opinion about what they measure.
 *
 * `annualizedReturnPercent` is null under 30 days: annualizing a fortnight
 * turns noise into a forecast. Volatility needs 20 daily returns before it
 * means anything and is null below that rather than being estimated from five.
 */
export interface SeriesStats {
  startDate: string;
  endDate: string;
  days: number;
  points: number;
  cumulativeReturnPercent: number;
  annualizedReturnPercent: number | null;
  maxDrawdownPercent: number;
  annualizedVolatilityPercent: number | null;
}

/**
 * Return, drawdown and volatility over a series already sorted and cleaned.
 *
 * @param series Ascending by date, every value finite and positive.
 */
export function computeSeriesStats(series: ValuePoint[]): SeriesStats | null {
  if (series.length < 2) return null;

  const first = series[0];
  const last = series.at(-1);
  if (first === undefined || last === undefined) return null;

  const cumulative = last.value / first.value - 1;
  const days = daysBetween(first.date, last.date);

  let peak = first.value;
  let maxDrawdown = 0;
  const dailyReturns: number[] = [];

  for (let i = 0; i < series.length; i++) {
    const point = series[i];
    if (point === undefined) continue;
    if (point.value > peak) peak = point.value;
    const drawdown = (peak - point.value) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    const previous = series[i - 1];
    if (previous !== undefined) dailyReturns.push(point.value / previous.value - 1);
  }

  let volatility: number | null = null;
  if (dailyReturns.length >= 20) {
    const mean = dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (dailyReturns.length - 1);
    volatility = Math.sqrt(variance) * Math.sqrt(252);
  }

  const annualized = days >= 30 ? (1 + cumulative) ** (365 / days) - 1 : null;

  return {
    startDate: first.date,
    endDate: last.date,
    days,
    points: series.length,
    cumulativeReturnPercent: round(cumulative * 100, 2),
    annualizedReturnPercent: annualized === null ? null : round(annualized * 100, 2),
    maxDrawdownPercent: round(maxDrawdown * 100, 2),
    annualizedVolatilityPercent: volatility === null ? null : round(volatility * 100, 2),
  };
}

/**
 * How far past the calendar target a series' first observation may sit and
 * still anchor the window.
 *
 * A holding that began 51 weeks ago has no observation a year back and
 * genuinely cannot quote 1Y. But one whose history begins three days after the
 * target — because it listed mid-week, or because the target fell inside a
 * holiday cluster — would report nothing at all under an exact rule, which
 * reads as missing data rather than as the near-complete year it is. Anything
 * longer than a week of slack would start quoting eleven months as 1Y.
 */
export const START_GRACE_DAYS = 7;

/** One window's return, measured between two observations that really exist. */
export interface TrailingWindow<Id extends string> {
  period: Id;
  from: string;
  to: string;
  days: number;
  returnPercent: number;
  /** Null under a year: annualizing a short window turns noise into a forecast. */
  annualizedPercent: number | null;
}

/**
 * Return over each requested window, ending at the series' last observation.
 *
 * Every window is anchored to an observation that exists rather than to the
 * calendar date, and reports the pair it actually used — a 1Y return measured
 * from 361 days back is the honest answer for a series with no observation on
 * the anniversary, and saying so is what lets a reader tell it apart from one
 * measured over a stale two-year gap.
 *
 * A period with `months: null` is either the whole series (`whole: true`) or
 * the step to the previous observation (`previous: true`); anything else is
 * skipped, so a caller cannot silently get a window it did not describe.
 */
export function computeTrailingWindows<Id extends string>(
  series: ValuePoint[],
  periods: readonly { id: Id; months: number | null; whole?: boolean; previous?: boolean }[],
  options: { asOf?: string } = {},
): { asOf: string; periods: TrailingWindow<Id>[] } | null {
  if (series.length < 2) return null;

  const asOf = options.asOf;
  const endIndex =
    asOf === undefined ? series.length - 1 : series.findLastIndex((point) => point.date <= asOf);
  if (endIndex < 1) return null;

  const window = series.slice(0, endIndex + 1);
  const end = window[endIndex];
  const first = window[0];
  if (end === undefined || first === undefined) return null;

  const windows: TrailingWindow<Id>[] = [];
  for (const period of periods) {
    let start: ValuePoint | null;
    if (period.whole === true) {
      start = first;
    } else if (period.previous === true) {
      // The previous observation, not yesterday: values are published on
      // trading days, so a fixed one-day step lands on a weekend two times in
      // seven.
      start = window[endIndex - 1] ?? null;
    } else if (period.months !== null) {
      const target = monthsBefore(end.date, period.months);
      start = lastAtOrBefore(window, target);
      if (start === null && daysBetween(target, first.date) <= START_GRACE_DAYS) start = first;
    } else {
      start = null;
    }

    if (start === null || start.date === end.date) continue;

    const days = daysBetween(start.date, end.date);
    const cumulative = end.value / start.value - 1;
    windows.push({
      period: period.id,
      from: start.date,
      to: end.date,
      days,
      returnPercent: round(cumulative * 100, 2),
      annualizedPercent:
        days >= 365 ? round(((1 + cumulative) ** (365 / days) - 1) * 100, 2) : null,
    });
  }

  return { asOf: end.date, periods: windows };
}

/**
 * How many points a chart is drawn from at most.
 *
 * A twenty-year daily series has ~5,000 observations and a chart is a few
 * hundred pixels wide, so most of them would land on a pixel already occupied.
 * The cap is well above that width so the decimation never becomes visible; it
 * exists to keep the payload proportional to what can be seen.
 */
export const DEFAULT_MAX_POINTS = 600;

/**
 * Largest-Triangle-Three-Buckets decimation.
 *
 * Plain every-nth sampling is what makes a decimated line lie: a crash that
 * happens between two kept observations disappears entirely, and the drawdown
 * the eye measures off the chart stops matching the drawdown printed beside it.
 * LTTB keeps the point in each bucket that spans the largest area with its
 * neighbours, which is exactly the turning points, and always keeps the first
 * and last.
 *
 * `x` is the day offset rather than the array index, so a series with gaps — a
 * suspended fund, a provider that skips holidays — is weighted by real time.
 */
export function decimate(series: ValuePoint[], threshold: number): ValuePoint[] {
  if (threshold < 3 || series.length <= threshold) return series;

  const first = series[0];
  const last = series.at(-1);
  if (first === undefined || last === undefined) return series;

  const x = series.map((point) => daysBetween(first.date, point.date));
  const sampled: ValuePoint[] = [first];
  const bucketSize = (series.length - 2) / (threshold - 2);
  let anchor = 0;

  for (let i = 0; i < threshold - 2; i++) {
    // The averaged point of the *next* bucket forms the far vertex of the
    // triangle; for the final bucket that is the last observation itself.
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, series.length - 1);
    let avgX = x[series.length - 1] ?? 0;
    let avgY = last.value;
    if (nextEnd > nextStart) {
      let sumX = 0;
      let sumY = 0;
      for (let j = nextStart; j < nextEnd; j++) {
        sumX += x[j] ?? 0;
        sumY += series[j]?.value ?? 0;
      }
      avgX = sumX / (nextEnd - nextStart);
      avgY = sumY / (nextEnd - nextStart);
    }

    const anchorX = x[anchor] ?? 0;
    const anchorY = series[anchor]?.value ?? 0;
    const start = Math.floor(i * bucketSize) + 1;
    const end = Math.min(Math.floor((i + 1) * bucketSize) + 1, series.length - 1);

    let bestArea = -1;
    let bestIndex = start;
    for (let j = start; j < end; j++) {
      const point = series[j];
      if (point === undefined) continue;
      const area = Math.abs(
        (anchorX - avgX) * (point.value - anchorY) - (anchorX - (x[j] ?? 0)) * (avgY - anchorY),
      );
      if (area > bestArea) {
        bestArea = area;
        bestIndex = j;
      }
    }

    const chosen = series[bestIndex];
    if (chosen !== undefined) sampled.push(chosen);
    anchor = bestIndex;
  }

  sampled.push(last);
  return sampled;
}
