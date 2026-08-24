/**
 * A fund's NAV over time, as a line.
 *
 * The trailing-returns strip above it answers "what did it return"; this
 * answers "how did it get there", which is the part a table cannot show — two
 * funds can post the same 1Y figure with one of them having halved on the way.
 *
 * The line is rebased to the window's first observation, so the axis is percent
 * from the left edge rather than an absolute NAV. That is what makes it
 * readable at all: a fund priced at 1.03 and one at 4.82 have the same shape
 * and wildly different numbers.
 *
 * The window lives in `?range=`, per the project's URL-state rule — a reader
 * who sends someone the link to a fund at 5Y sends the chart they were looking
 * at, and the browser's back button steps through the ranges they tried.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_NAV_RANGE,
  isNavRange,
  NAV_RANGES,
  type NavRangeId,
} from "../../shared/funds.js";
import { api } from "../lib/api.js";
import {
  areaPath,
  linePath,
  nearestIndex,
  plotSeries,
  plotValue,
  type ChartBox,
} from "../lib/chart.js";
import { formatPercent, signClass } from "../lib/format.js";
import { useListParams } from "../lib/params.js";
import type { FundNavResult, NavChartSeries } from "../lib/types.js";
import { Spinner } from "./ui.js";

/**
 * The chart's own coordinate space.
 *
 * Fixed, with the SVG scaling to its container through the viewBox: the dialog
 * is resizable and its width is not known until layout, and measuring it would
 * mean a ResizeObserver and a re-render per frame to draw the same line. The
 * stroke is pinned with `vector-effect` so scaling cannot thicken it.
 */
const BOX: ChartBox = { width: 720, height: 190, padTop: 10, padBottom: 10 };

export function NavChart({ code }: { code: string }) {
  const params = useListParams();
  const range: NavRangeId = isNavRange(params.range) ? params.range : DEFAULT_NAV_RANGE;

  const query = useQuery({
    queryKey: ["fund-nav", code, range],
    queryFn: () => api<FundNavResult>(`/api/funds/${code}/nav?range=${range}`),
  });

  // A fund with no NAV at all is already explained by the returns strip above;
  // repeating it here as a second empty box says nothing new.
  if (query.data?.historyPoints === 0) return null;

  const setRange = (next: NavRangeId) => {
    // Discrete choice, so it pushes history rather than replacing it, and the
    // default is cleared from the URL rather than spelled out.
    params.update({ range: next === DEFAULT_NAV_RANGE ? "" : next });
  };

  return (
    <div className="mb-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-zinc-500 uppercase">Net asset value</h3>
        <div className="flex flex-wrap gap-1">
          {NAV_RANGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setRange(entry.id)}
              title={entry.title}
              aria-pressed={entry.id === range}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                entry.id === range
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {query.isPending ? (
        <div className="py-12">
          <Spinner />
        </div>
      ) : query.isError ? (
        <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
          {(query.error as Error).message}
        </p>
      ) : query.data.series === null ? (
        <p className="py-8 text-center text-xs text-zinc-400">
          The cached NAV history does not cover{" "}
          {NAV_RANGES.find((entry) => entry.id === range)?.title.toLowerCase() ?? range} — try a
          longer window.
        </p>
      ) : (
        <NavPlot series={query.data.series} />
      )}
    </div>
  );
}

/** The drawn line, its statistics and the hover readout. */
function NavPlot({ series }: { series: NavChartSeries }) {
  const [hover, setHover] = useState<number | null>(null);

  const values = series.points.map((point) => point.value);
  // Day offsets rather than positions in the array: a suspended fund that
  // published nothing for a month should show that month as a straight run,
  // not as one evenly spaced step like any other.
  const start = Date.parse(`${series.startDate}T00:00:00Z`);
  const xs = series.points.map(
    (point) => (Date.parse(`${point.date}T00:00:00Z`) - start) / 86_400_000,
  );
  const plot = plotSeries(xs, values, BOX);
  const first = series.points[0];
  const last = series.points.at(-1);
  const baseY = first === undefined ? BOX.height / 2 : plotValue(first.value, values, BOX);

  const change = last?.changePercent ?? 0;
  // One tone for the whole picture — line, fill and the figure beside it — so
  // the shape and the number cannot be read as saying different things.
  const tone =
    change > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : change < 0
        ? "text-red-600 dark:text-red-400"
        : "text-zinc-500";

  const active = hover === null ? null : series.points[hover];
  const activePlot = hover === null ? null : plot[hover];
  const gradientId = `nav-fill-${series.range}`;

  return (
    <>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className={`text-xl font-semibold tabular-nums ${tone}`}>
          {formatPercent(change)}
        </span>
        {series.performance && (
          <>
            <Stat
              label="Max drawdown"
              value={`-${series.performance.maxDrawdownPercent.toFixed(2)}%`}
              title="The deepest peak-to-trough fall inside this window."
            />
            <Stat
              label="Volatility"
              value={
                series.performance.annualizedVolatilityPercent === null
                  ? "—"
                  : `${series.performance.annualizedVolatilityPercent.toFixed(1)}%`
              }
              title="Annualized standard deviation of daily returns; needs at least 20 observations."
            />
            {series.performance.annualizedReturnPercent !== null && (
              <Stat
                label="Annualized"
                value={formatPercent(series.performance.annualizedReturnPercent)}
                title="The window's return expressed as a yearly rate."
                className={signClass(series.performance.annualizedReturnPercent)}
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
          aria-label={`Net asset value from ${series.startDate} to ${series.endDate}, ${formatPercent(change)}`}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            if (rect.width === 0) return;
            setHover(nearestIndex(plot, ((event.clientX - rect.left) / rect.width) * BOX.width));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Where the window started: every point above this line is a gain on
              the left edge, every point below it a loss. */}
          <line
            x1="0"
            y1={baseY}
            x2={BOX.width}
            y2={baseY}
            className="stroke-zinc-300 dark:stroke-zinc-700"
            strokeDasharray="4 4"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

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
              {/* A ring rather than a plain dot: on a line that doubles back
                  through its own gradient, a filled marker in the same colour
                  disappears into it. */}
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

        {active && activePlot && (
          <div
            className="pointer-events-none absolute top-0 rounded border border-zinc-200 bg-white/95 px-2 py-1 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95"
            style={{
              left: `${(activePlot.x / BOX.width) * 100}%`,
              // Pinned inside the box at the edges rather than centred
              // everywhere: a centred label on the last observation would hang
              // half outside the dialog.
              transform: `translateX(${
                activePlot.x < BOX.width * 0.15
                  ? "0"
                  : activePlot.x > BOX.width * 0.85
                    ? "-100%"
                    : "-50%"
              })`,
            }}
          >
            <div className="text-zinc-500">{active.date}</div>
            <div className="tabular-nums">
              <span className="font-medium">{active.value.toFixed(4)}</span>{" "}
              <span className={signClass(active.changePercent)}>
                {formatPercent(active.changePercent)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* The window that was actually drawn, which is not always the one that
          was asked for: a fund younger than the range shows its whole life, and
          saying so is what stops that from reading as a five-year record. */}
      <p className="mt-2 text-xs text-zinc-400">
        {series.startDate} → {series.endDate} · {series.observations} observation
        {series.observations === 1 ? "" : "s"}
        {series.downsampled && ` (${series.points.length} plotted)`} ·{" "}
        {series.basis === "accNav"
          ? "cumulative NAV, so distributions do not read as losses"
          : "unit NAV — this fund publishes no cumulative series, so any distribution shows as a fall"}
      </p>
    </>
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
      <span className={`font-medium tabular-nums ${className ?? "text-zinc-700 dark:text-zinc-300"}`}>
        {value}
      </span>
    </span>
  );
}
