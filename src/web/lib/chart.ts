/**
 * Line-chart geometry — pure functions, no DOM.
 *
 * Split out of the chart component so the arithmetic that decides where a point
 * lands can be tested: the suite runs in node, where a `.tsx` component cannot
 * be rendered, and every bug worth catching here (a flat series dividing by
 * zero, a hover picking the wrong observation) is arithmetic rather than
 * markup.
 *
 * Coordinates are the SVG user space of a fixed `viewBox`, not pixels. The
 * chart scales to its container through the viewBox, so nothing here needs to
 * know how wide the dialog is.
 */

export interface ChartBox {
  width: number;
  height: number;
  /** Room above the line for the highest point's marker and label. */
  padTop: number;
  padBottom: number;
}

export interface PlotPoint {
  x: number;
  y: number;
}

/**
 * Map a series onto the box: `xs` along the width, `values` down the height.
 *
 * `xs` are arbitrary increasing numbers — day offsets, so a gap in the NAV
 * history shows as a gap rather than being closed up by even spacing.
 *
 * A series whose values are all equal is drawn down the middle instead of
 * against the top edge: with a zero span the normalized value is 0/0, and the
 * honest picture of "nothing moved" is a rule through the centre.
 */
export function plotSeries(xs: number[], values: number[], box: ChartBox): PlotPoint[] {
  const xMin = xs[0] ?? 0;
  const xMax = xs.at(-1) ?? 0;
  const xSpan = xMax - xMin;

  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const ySpan = high - low;

  const usable = box.height - box.padTop - box.padBottom;

  return values.map((value, index) => {
    const x = xSpan === 0 ? box.width / 2 : (((xs[index] ?? xMin) - xMin) / xSpan) * box.width;
    const normalized = ySpan === 0 ? 0.5 : (value - low) / ySpan;
    // SVG y grows downward, so the highest value gets the smallest y.
    return { x, y: box.padTop + (1 - normalized) * usable };
  });
}

/** Where a given value sits vertically on the same scale — for the baseline rule. */
export function plotValue(value: number, values: number[], box: ChartBox): number {
  let low = Infinity;
  let high = -Infinity;
  for (const entry of values) {
    if (entry < low) low = entry;
    if (entry > high) high = entry;
  }
  const ySpan = high - low;
  const usable = box.height - box.padTop - box.padBottom;
  const normalized = ySpan === 0 ? 0.5 : (value - low) / ySpan;
  return box.padTop + (1 - normalized) * usable;
}

/** `M x y L x y …` — a polyline as a path, so the area can reuse the same points. */
export function linePath(points: PlotPoint[]): string {
  if (points.length === 0) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`)
    .join(" ");
}

/** The line closed down to `baseY`, for the gradient fill under it. */
export function areaPath(points: PlotPoint[], baseY: number): string {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return "";
  return `${linePath(points)} L${round(last.x)} ${round(baseY)} L${round(first.x)} ${round(baseY)} Z`;
}

/**
 * The point nearest a cursor at `x`.
 *
 * Nearest rather than "the last one at or before", so the reader who hovers
 * just past the final observation still gets it, and so the marker on a sparse
 * series does not lag a whole bucket behind the pointer.
 */
export function nearestIndex(points: PlotPoint[], x: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point === undefined) continue;
    const distance = Math.abs(point.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Two decimals is under a thousandth of a pixel once scaled, and halves the markup. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A vertical scale that is guaranteed to contain the marks drawn on it.
 *
 * A watchlist chart draws the reader's own levels across the price line, and a
 * scale fitted to the prices alone would put a stop 20% below the window
 * somewhere off the bottom of the box — the one level most worth seeing.
 *
 * The clamp is what stops the opposite failure. A level far outside the
 * window's own span would compress the price line into a flat rule to make room
 * for it, destroying the shape to show one number. Past `maxSpanMultiple` times
 * the price span, the level is left outside the domain and the caller draws it
 * as an edge marker instead.
 */
export interface Domain {
  low: number;
  high: number;
  /** Values that did not fit, for the caller to render against an edge. */
  clamped: number[];
}

export function domainWithLevels(
  values: number[],
  levels: number[],
  options: { maxSpanMultiple?: number; padding?: number } = {},
): Domain {
  const maxSpanMultiple = options.maxSpanMultiple ?? 3;
  const padding = options.padding ?? 0.04;

  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { low: 0, high: 1, clamped: [] };

  // A flat series has no span of its own to measure a level against, so the
  // reach is taken from the level of the price itself.
  const span = high - low || Math.abs(high) * 0.02 || 1;
  const reach = span * maxSpanMultiple;

  const clamped: number[] = [];
  for (const level of levels) {
    if (level < low - reach || level > high + reach) {
      clamped.push(level);
      continue;
    }
    if (level < low) low = level;
    if (level > high) high = level;
  }

  const pad = (high - low || span) * padding;
  return { low: low - pad, high: high + pad, clamped };
}

/** Maps a value onto the box through an explicit domain. */
export function plotInDomain(value: number, domain: Domain, box: ChartBox): number {
  const span = domain.high - domain.low;
  const usable = box.height - box.padTop - box.padBottom;
  const normalized = span === 0 ? 0.5 : (value - domain.low) / span;
  return box.padTop + (1 - normalized) * usable;
}

/** The same mapping for a whole series, with x spread over real elapsed time. */
export function plotInDomainSeries(
  xs: number[],
  values: number[],
  domain: Domain,
  box: ChartBox,
): PlotPoint[] {
  const xMin = xs[0] ?? 0;
  const xMax = xs.at(-1) ?? 0;
  const xSpan = xMax - xMin;
  return values.map((value, index) => ({
    x: xSpan === 0 ? box.width / 2 : (((xs[index] ?? xMin) - xMin) / xSpan) * box.width,
    y: plotInDomain(value, domain, box),
  }));
}
