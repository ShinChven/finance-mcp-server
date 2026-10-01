/**
 * The chart, its controls and the caption that says how to read it.
 *
 * Every control writes a URL param — range, candle width, style and the
 * indicator set — so a chart configuration is a link. Indicators are drawn
 * from candles already on the page, so toggling one never fetches; changing
 * the range or the candle width does, once, and the previous chart stays on
 * screen until the new one arrives instead of collapsing to a spinner.
 */

import { useMemo } from "react";
import { INDICATORS, type IndicatorId } from "../../../shared/indicators.js";
import type { DirectionPalette } from "../../../shared/preferences.js";
import { rangesFor } from "../../../shared/series.js";
import {
  CANDLE_INTERVAL_LABELS,
  CANDLE_INTERVALS,
  type CandleSeries,
  type SymbolPageParams,
} from "../../../shared/symbol.js";
import { withLiveCandle } from "../../lib/candles.js";
import { formatPercent, signClass } from "../../lib/format.js";
import { isTrading, useCandles } from "../../lib/symbol-queries.js";
import type { SymbolQuoteResult, WatchlistLevel } from "../../lib/types.js";
import { CandleChart, type ChartGuide } from "../candle-chart.js";
import { Card } from "../ui.js";
import { Segmented } from "./parts.js";

const INTERVAL_NOUN: Record<CandleSeries["interval"], string> = {
  "5m": "5-minute",
  "15m": "15-minute",
  "1d": "daily",
  "1wk": "weekly",
  "1mo": "monthly",
};

export function ChartPanel({
  symbol,
  params,
  update,
  quote,
  palette,
  levels,
  entryPrice,
  guides,
}: {
  symbol: string;
  params: SymbolPageParams;
  update: (patch: Partial<SymbolPageParams>) => void;
  quote: SymbolQuoteResult | undefined;
  palette: DirectionPalette;
  levels: WatchlistLevel[];
  entryPrice: number | null;
  guides: ChartGuide[];
}) {
  const intraday = params.range === "1d" || params.range === "5d";
  const live = isTrading(quote?.live.marketState);
  const candles = useCandles(symbol, params.range, params.interval, { live });

  const raw = candles.data?.series ?? null;
  // The forming daily candle follows the quote; see `withLiveCandle`.
  const series = useMemo(() => {
    if (raw === null || raw.interval !== "1d" || quote === undefined) return raw;
    const stats = quote.live.stats;
    const patched = withLiveCandle(
      raw.candles,
      {
        price: quote.live.price,
        asOf: quote.live.asOf,
        open: quote.session.open,
        dayHigh: stats?.dayHigh ?? null,
        dayLow: stats?.dayLow ?? null,
        volume: stats?.volume ?? null,
      },
      raw.timezone,
    );
    return patched === raw.candles ? raw : { ...raw, candles: patched };
  }, [raw, quote]);

  function toggle(id: IndicatorId) {
    const next = params.ind.includes(id) ? params.ind.filter((entry) => entry !== id) : [...params.ind, id];
    update({ ind: next });
  }

  return (
    <Card className="p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label="Range"
          options={rangesFor("symbol").map((range) => ({ id: range.id, label: range.label }))}
          value={params.range}
          onChange={(range) => update({ range })}
        />
        <Segmented
          label="Candle width"
          options={CANDLE_INTERVALS.map((id) => ({ id, label: CANDLE_INTERVAL_LABELS[id] }))}
          value={params.interval}
          onChange={(interval) => update({ interval })}
          disabled={intraday}
        />
        <Segmented
          label="Chart style"
          options={[
            { id: "candle", label: "Candles" },
            { id: "line", label: "Line" },
          ]}
          value={params.style}
          onChange={(style) => update({ style })}
        />
        {candles.isFetching && <span className="size-1.5 animate-pulse rounded-full bg-indigo-500" aria-label="Loading chart" />}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Indicators">
        {INDICATORS.map((indicator) => {
          const disabled = indicator.intradayOnly && !intraday;
          const active = params.ind.includes(indicator.id) && !disabled;
          return (
            <button
              key={indicator.id}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              title={disabled ? "VWAP resets each session, so it is only drawn on intraday ranges." : undefined}
              onClick={() => toggle(indicator.id)}
              className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? "border-indigo-500 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {indicator.label}
            </button>
          );
        })}
      </div>

      {candles.isPending ? (
        <div className="h-[420px] animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
      ) : candles.isError ? (
        <p className="py-16 text-center text-sm text-amber-600 dark:text-amber-400">
          {(candles.error as Error).message}
        </p>
      ) : series === null ? (
        <p className="py-16 text-center text-sm text-zinc-400">
          No price history for this window. Try a longer range.
        </p>
      ) : (
        <>
          <CandleChart
            series={series}
            style={params.style}
            indicators={params.ind}
            palette={palette}
            levels={levels}
            entryPrice={entryPrice}
            guides={guides}
          />
          <Caption series={series} />
        </>
      )}
    </Card>
  );
}

function Caption({ series }: { series: CandleSeries }) {
  const visible = series.candles.length - series.firstVisible;
  const first = series.candles[series.firstVisible];
  const last = series.candles.at(-1);
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-zinc-500">
      {series.changePercent !== null && (
        <span>
          Window{" "}
          <span className={`font-medium tabular-nums ${signClass(series.changePercent)}`}>
            {formatPercent(series.changePercent)}
          </span>
        </span>
      )}
      {series.stats && (
        <>
          <span title="The deepest peak-to-trough fall inside this window, on the adjusted series.">
            Max drawdown{" "}
            <span className="font-medium text-zinc-700 tabular-nums dark:text-zinc-300">
              -{series.stats.maxDrawdownPercent.toFixed(2)}%
            </span>
          </span>
          {series.stats.annualizedVolatilityPercent !== null && (
            <span title="Annualized standard deviation of daily returns.">
              Volatility{" "}
              <span className="font-medium text-zinc-700 tabular-nums dark:text-zinc-300">
                {series.stats.annualizedVolatilityPercent.toFixed(1)}%
              </span>
            </span>
          )}
          {series.stats.annualizedReturnPercent !== null && (
            <span>
              Annualized{" "}
              <span className={`font-medium tabular-nums ${signClass(series.stats.annualizedReturnPercent)}`}>
                {formatPercent(series.stats.annualizedReturnPercent)}
              </span>
            </span>
          )}
        </>
      )}
      <span className="text-[11px] text-zinc-400">
        {visible} {INTERVAL_NOUN[series.interval]} candles
        {first && last ? ` · ${first.t.slice(0, 10)} → ${last.t.slice(0, 10)}` : ""}
        {series.intraday ? ` · ${series.timezoneLabel}` : ""}
        {series.currency ? ` · ${series.currency}` : ""}
        {series.intraday ? "" : " · split-adjusted prices; statistics include dividends"} · quotes may be delayed
      </span>
    </div>
  );
}
