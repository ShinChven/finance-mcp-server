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
