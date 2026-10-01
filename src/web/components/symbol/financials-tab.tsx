/**
 * Income statement, balance sheet and cash flow, annual or quarterly.
 *
 * The table is the statement as printed — newest period first, subtotals in
 * bold — and above it one chart of the two lines a reader compares most on
 * that statement: revenue against net income, assets against liabilities,
 * operating cash against free cash. Which statement and which period are URL
 * params.
 */

import {
  STATEMENT_LABELS,
  STATEMENT_PERIODS,
  STATEMENTS,
  type Statement,
  type StatementView,
  type SymbolPageParams,
} from "../../../shared/symbol.js";
import { formatCompact } from "../../lib/format.js";
import { useProfile, useStatement } from "../../lib/symbol-queries.js";
import { Empty, Loading, Section, Segmented, Unavailable } from "./parts.js";

const HEADLINE: Record<Statement, [string, string]> = {
  income: ["totalRevenue", "netIncome"],
  balance: ["totalAssets", "totalLiabilitiesNetMinorityInterest"],
  cashflow: ["operatingCashFlow", "freeCashFlow"],
};

function cell(value: number | null, unit: StatementView["rows"][number]["unit"]): string {
  if (value === null) return "—";
  if (unit === "perShare") return value.toFixed(2);
  return formatCompact(value);
}

/** Change from the previous period of the same kind, for the newest column. */
function growth(values: (number | null)[]): number | null {
  const [latest, prior] = values;
  if (latest === null || latest === undefined || prior === null || prior === undefined || prior === 0) return null;
  return ((latest - prior) / Math.abs(prior)) * 100;
}

export function FinancialsTab({
  symbol,
  params,
  update,
}: {
  symbol: string;
  params: SymbolPageParams;
  update: (patch: Partial<SymbolPageParams>) => void;
}) {
  const statement = useStatement(symbol, params.statement, params.period, true);
  const profile = useProfile(symbol);
  const currency = profile.data?.financialCurrency ?? profile.data?.currency ?? null;
  const view = statement.data;

  return (
    <Section
      title={`${STATEMENT_LABELS[params.statement]}${currency ? ` · ${currency}` : ""}`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Statement"
            options={STATEMENTS.map((id) => ({ id, label: STATEMENT_LABELS[id] }))}
            value={params.statement}
            onChange={(next) => update({ statement: next })}
          />
          <Segmented
            label="Period"
            options={STATEMENT_PERIODS.map((id) => ({ id, label: id === "annual" ? "Annual" : "Quarterly" }))}
            value={params.period}
            onChange={(next) => update({ period: next })}
          />
        </div>
      }
    >
      {statement.isPending ? (
        <Loading />
      ) : statement.isError ? (
        <Unavailable error={statement.error} what="Statements are" />
      ) : view === undefined || view.rows.length === 0 ? (
        <Empty>Yahoo publishes no {params.period} {STATEMENT_LABELS[params.statement].toLowerCase()} for this listing.</Empty>
      ) : (
        <div className={statement.isPlaceholderData ? "opacity-60 transition-opacity" : ""}>
          <HeadlineChart view={view} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="sticky left-0 bg-white py-2 pr-3 text-left font-medium dark:bg-zinc-900">
                    Period ending
                  </th>
                  {view.columns.map((column) => (
                    <th key={column} className="py-2 pl-3 text-right font-medium tabular-nums">
                      {column}
                    </th>
                  ))}
                  <th className="py-2 pl-3 text-right font-medium" title="Newest period against the one before it">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => {
                  const change = row.unit === "shares" ? null : growth(row.values);
                  return (
                    <tr key={row.key} className="border-b border-zinc-100 dark:border-zinc-800/70">
                      <td
                        className={`sticky left-0 bg-white py-1.5 pr-3 dark:bg-zinc-900 ${row.emphasis ? "font-semibold" : "text-zinc-600 dark:text-zinc-300"}`}
                      >
                        {row.label}
                      </td>
                      {row.values.map((value, index) => (
                        <td
                          key={view.columns[index]}
                          className={`py-1.5 pl-3 text-right tabular-nums ${row.emphasis ? "font-semibold" : ""} ${value !== null && value < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                        >
                          {cell(value, row.unit)}
                        </td>
                      ))}
                      <td className="py-1.5 pl-3 text-right text-xs text-zinc-500 tabular-nums">
                        {change === null ? "" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-zinc-400">
            As reported to Yahoo Finance. For US filers the SEC filings tab links the documents themselves.
          </p>
        </div>
      )}
    </Section>
  );
}

/**
 * Two lines of the statement as grouped bars, oldest period on the left.
 *
 * Bars rather than lines because periods are discrete reports, not a
 * continuous series; one shared zero baseline because net income can be
 * negative and a bar that hangs below zero is the honest picture of a loss.
 */
function HeadlineChart({ view }: { view: StatementView }) {
  const [firstKey, secondKey] = HEADLINE[view.statement];
  const first = view.rows.find((row) => row.key === firstKey);
  const second = view.rows.find((row) => row.key === secondKey);
  const series = [first, second].filter((row): row is NonNullable<typeof row> => row !== undefined);
  if (series.length === 0) return null;

  const columns = [...view.columns].reverse();
  const values = series.map((row) => [...row.values].reverse());
  const all = values.flat().filter((value): value is number => value !== null);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;

  const width = 640;
  const height = 160;
  const top = 8;
  const bottom = 22;
  const plot = height - top - bottom;
  const y = (value: number) => top + ((max - value) / span) * plot;
  const group = width / columns.length;
  const barWidth = Math.min(28, (group * 0.7) / series.length);
  const colors = ["var(--viz-1)", "var(--viz-2)"];

  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-3 text-[11px] text-zinc-500">
        {series.map((row, index) => (
          <span key={row.key} className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm" style={{ background: colors[index] }} />
            {row.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`${series.map((row) => row.label).join(" and ")} by period`}>
        <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="stroke-zinc-300 dark:stroke-zinc-700" />
        {columns.map((column, columnIndex) => {
          const center = group * columnIndex + group / 2;
          return (
            <g key={column}>
              {series.map((row, seriesIndex) => {
                const value = values[seriesIndex]![columnIndex];
                if (value === null || value === undefined) return null;
                const x = center - (barWidth * series.length + 2 * (series.length - 1)) / 2 + seriesIndex * (barWidth + 2);
                const top = Math.min(y(value), y(0));
                return (
                  <rect
                    key={row.key}
                    x={x}
                    y={top}
                    width={barWidth}
                    height={Math.max(1, Math.abs(y(value) - y(0)))}
                    rx="2"
                    fill={colors[seriesIndex]}
                  >
                    <title>{`${row.label} · ${column}: ${formatCompact(value)}`}</title>
                  </rect>
                );
              })}
              <text x={center} y={height - 6} textAnchor="middle" className="fill-zinc-400 text-[11px]">
                {view.period === "annual" ? column.slice(0, 4) : column.slice(0, 7)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
