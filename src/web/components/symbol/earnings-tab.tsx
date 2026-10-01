/**
 * Earnings: the track record, then the expectations, then how they are moving.
 *
 * The surprise chart puts estimate and actual on one axis per quarter — a hit
 * or a miss is the gap between two dots, which reads faster than a column of
 * percentages. The revision table is the part most readers skip and most
 * should not: a consensus that has been rising into a report says more than
 * its level does.
 */

import { formatCompact, formatPercent, signClass } from "../../lib/format.js";
import { useEarnings } from "../../lib/symbol-queries.js";
import type { EarningsView } from "../../../shared/symbol.js";
import { day, Empty, Loading, Section, Unavailable } from "./parts.js";

const PERIOD_LABELS: Record<string, string> = {
  "0q": "Current quarter",
  "+1q": "Next quarter",
  "0y": "Current year",
  "+1y": "Next year",
};

export function EarningsTab({ symbol }: { symbol: string }) {
  const earnings = useEarnings(symbol, true);
  const data = earnings.data;

  if (earnings.isPending) return <Loading />;
  if (earnings.isError) return <Unavailable error={earnings.error} what="Earnings data is" />;
  if (data === undefined) return null;

  const empty =
    data.surprises.length === 0 && data.estimates.length === 0 && data.quarterly.length === 0;
  if (empty) return <Empty>No earnings history or estimates published for this listing.</Empty>;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section
        title="EPS: estimate vs actual"
        action={
          <span className="text-xs text-zinc-500">
            {data.nextEarningsDate && <>Next report {day(data.nextEarningsDate)} · </>}
            {data.beatStreak > 0 ? `${data.beatStreak} beat${data.beatStreak === 1 ? "" : "s"} in a row` : "no current beat streak"}
          </span>
        }
      >
        {data.surprises.length === 0 ? <Empty>No reported quarters.</Empty> : <SurpriseChart view={data} />}
      </Section>

      <Section title={`Revenue and earnings${data.financialCurrency ? ` · ${data.financialCurrency}` : ""}`}>
        {data.quarterly.length === 0 ? <Empty>No reported figures.</Empty> : <ReportedBars rows={data.quarterly} />}
      </Section>

      {data.estimates.length > 0 && (
        <Section title="Consensus estimates" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-3 text-left font-medium">Period</th>
                  <th className="py-2 pl-3 text-right font-medium">EPS (avg)</th>
                  <th className="py-2 pl-3 text-right font-medium">Low – high</th>
                  <th className="py-2 pl-3 text-right font-medium">Year ago</th>
                  <th className="py-2 pl-3 text-right font-medium">Revenue (avg)</th>
                  <th className="py-2 pl-3 text-right font-medium">Rev. growth</th>
                  <th className="py-2 pl-3 text-right font-medium">Analysts</th>
                </tr>
              </thead>
              <tbody>
                {data.estimates.map((row) => (
                  <tr key={row.period ?? row.endDate} className="border-b border-zinc-100 dark:border-zinc-800/70">
                    <td className="py-1.5 pr-3">
                      {PERIOD_LABELS[row.period ?? ""] ?? row.period}
                      {row.endDate && <span className="text-xs text-zinc-400"> · {day(row.endDate)}</span>}
                    </td>
                    <td className="py-1.5 pl-3 text-right font-medium tabular-nums">{row.epsAvg?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 pl-3 text-right text-zinc-500 tabular-nums">
                      {row.epsLow !== null && row.epsHigh !== null ? `${row.epsLow.toFixed(2)} – ${row.epsHigh.toFixed(2)}` : "—"}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{row.yearAgoEps?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{row.revenueAvg === null ? "—" : formatCompact(row.revenueAvg)}</td>
                    <td className={`py-1.5 pl-3 text-right tabular-nums ${signClass(row.revenueGrowth)}`}>
                      {row.revenueGrowth === null ? "—" : formatPercent(row.revenueGrowth * 100)}
                    </td>
                    <td className="py-1.5 pl-3 text-right text-zinc-500 tabular-nums">{row.analysts ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {data.revisions.length > 0 && (
        <Section title="Estimate revisions" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-3 text-left font-medium">Period</th>
                  <th className="py-2 pl-3 text-right font-medium">Now</th>
                  <th className="py-2 pl-3 text-right font-medium">7d ago</th>
                  <th className="py-2 pl-3 text-right font-medium">30d ago</th>
                  <th className="py-2 pl-3 text-right font-medium">90d ago</th>
                  <th className="py-2 pl-3 text-right font-medium">30d move</th>
                  <th className="py-2 pl-3 text-right font-medium">Revising ↑ / ↓</th>
                </tr>
              </thead>
              <tbody>
                {data.revisions.map((row) => (
                  <tr key={row.period ?? row.endDate} className="border-b border-zinc-100 dark:border-zinc-800/70">
                    <td className="py-1.5 pr-3">{PERIOD_LABELS[row.period ?? ""] ?? row.period}</td>
                    <td className="py-1.5 pl-3 text-right font-medium tabular-nums">{row.epsCurrent?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{row.eps7DaysAgo?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{row.eps30DaysAgo?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{row.eps90DaysAgo?.toFixed(2) ?? "—"}</td>
                    <td className={`py-1.5 pl-3 text-right tabular-nums ${signClass(row.revision30dPercent)}`}>
                      {row.revision30dPercent === null ? "—" : formatPercent(row.revision30dPercent)}
                    </td>
                    <td className="py-1.5 pl-3 text-right text-zinc-500 tabular-nums">
                      {row.analystsRevisingUp30d ?? "—"} / {row.analystsRevisingDown30d ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

/** Estimate and actual per quarter on one shared axis; the gap is the surprise. */
function SurpriseChart({ view }: { view: EarningsView }) {
  const rows = [...view.surprises].reverse().slice(-8);
  const values = rows.flatMap((row) => [row.epsActual, row.epsEstimate]).filter((v): v is number => v !== null);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || Math.abs(max) || 1;
  const width = 480;
  const height = 170;
  const top = 14;
  const bottom = 34;
  const y = (value: number) => top + ((max + span * 0.1 - value) / (span * 1.2)) * (height - top - bottom);
  const step = width / rows.length;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Quarterly EPS, estimate against actual">
        {rows.map((row, index) => {
          const x = step * index + step / 2;
          const quarter = row.quarter ? row.quarter.slice(0, 7) : "";
          return (
            <g key={row.quarter ?? index}>
              {row.epsEstimate !== null && row.epsActual !== null && (
                <line x1={x} x2={x} y1={y(row.epsEstimate)} y2={y(row.epsActual)} className="stroke-zinc-300 dark:stroke-zinc-600" strokeWidth="2" />
              )}
              {row.epsEstimate !== null && (
                <circle cx={x} cy={y(row.epsEstimate)} r="6" className="fill-white stroke-zinc-400 dark:fill-zinc-900" strokeWidth="2">
                  <title>{`Estimate ${row.epsEstimate.toFixed(2)}`}</title>
                </circle>
              )}
              {row.epsActual !== null && (
                <circle
                  cx={x}
                  cy={y(row.epsActual)}
                  r="6"
                  className={`stroke-white dark:stroke-zinc-900 ${row.beat === false ? "fill-red-600" : "fill-blue-600"}`}
                  strokeWidth="2"
                >
                  <title>{`Actual ${row.epsActual.toFixed(2)}`}</title>
                </circle>
              )}
              {row.epsActual !== null && (
                <text
                  x={x + 10}
                  y={y(row.epsActual) + 4}
                  className="fill-zinc-700 text-[11px] font-medium tabular-nums dark:fill-zinc-200"
                >
                  {row.epsActual.toFixed(2)}
                </text>
              )}
              <text x={x} y={height - 18} textAnchor="middle" className="fill-zinc-400 text-[11px]">
                {quarter}
              </text>
              <text
                x={x}
                y={height - 4}
                textAnchor="middle"
                className={`text-[11px] font-medium ${row.beat === false ? "fill-red-600" : "fill-blue-700 dark:fill-blue-400"}`}
              >
                {row.surprisePercent === null ? "" : formatPercent(row.surprisePercent)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-3 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-full border-2 border-zinc-400" /> Estimate
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-blue-600" /> Beat
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-red-600" /> Miss
        </span>
      </div>
    </div>
  );
}

function ReportedBars({ rows }: { rows: EarningsView["quarterly"] }) {
  const all = rows.flatMap((row) => [row.revenue, row.earnings]).filter((v): v is number => v !== null);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const width = 480;
  const height = 170;
  const top = 8;
  const bottom = 22;
  const y = (value: number) => top + ((max - value) / span) * (height - top - bottom);
  const group = width / rows.length;
  const bar = Math.min(26, group * 0.32);
  const colors = ["var(--viz-1)", "var(--viz-2)"];

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Quarterly revenue and earnings">
        <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="stroke-zinc-300 dark:stroke-zinc-700" />
        {rows.map((row, index) => {
          const center = group * index + group / 2;
          return (
            <g key={row.label}>
              {[row.revenue, row.earnings].map((value, seriesIndex) =>
                value === null ? null : (
                  <rect
                    key={seriesIndex}
                    x={center - bar - 1 + seriesIndex * (bar + 2)}
                    y={Math.min(y(value), y(0))}
                    width={bar}
                    height={Math.max(1, Math.abs(y(value) - y(0)))}
                    rx="2"
                    fill={colors[seriesIndex]}
                  >
                    <title>{`${seriesIndex === 0 ? "Revenue" : "Earnings"} ${row.label}: ${formatCompact(value)}`}</title>
                  </rect>
                ),
              )}
              <text x={center} y={height - 6} textAnchor="middle" className="fill-zinc-400 text-[11px]">
                {row.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-3 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm" style={{ background: colors[0] }} /> Revenue
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm" style={{ background: colors[1] }} /> Earnings
        </span>
      </div>
    </div>
  );
}
