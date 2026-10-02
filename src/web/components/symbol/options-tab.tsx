/**
 * The options chain as a straddle: calls left, strike in the middle, puts right.
 *
 * In-the-money cells are shaded, the strike nearest the underlying is marked
 * and scrolled into view, and the expiry is a URL param. Above the table sit
 * the figures a chain is usually opened for — put/call ratios and max pain —
 * computed on the server so every reader sees the same ones.
 */

import { useEffect, useRef } from "react";
import type { OptionChainView, OptionQuote, SymbolPageParams } from "../../../shared/symbol.js";
import { formatPrice } from "../../lib/candles.js";
import { formatCompact } from "../../lib/format.js";
import { useOptions } from "../../lib/symbol-queries.js";
import { day, Empty, Loading, Section, Unavailable } from "./parts.js";

/** Strikes shown either side of the money; the rest are a scroll away. */
const STRIKES_AROUND_ATM = 15;

export function OptionsTab({
  symbol,
  params,
  update,
}: {
  symbol: string;
  params: SymbolPageParams;
  update: (patch: Partial<SymbolPageParams>) => void;
}) {
  const chain = useOptions(symbol, params.expiry, true);
  const data = chain.data;

  if (chain.isPending) return <Loading />;
  if (chain.isError) return <Unavailable error={chain.error} what="The options chain is" />;
  if (data === undefined || data.expirations.length === 0) {
    return <Empty>No listed options for {symbol}.</Empty>;
  }

  return (
    <div className={`flex flex-col gap-4 ${chain.isPlaceholderData ? "opacity-60 transition-opacity" : ""}`}>
      <Section
        title="Options chain"
        action={
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Expiry
            <select
              value={data.expiry ?? ""}
              onChange={(event) =>
                update({ expiry: event.target.value === data.expirations[0] ? "" : event.target.value })
              }
              className="cursor-pointer rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {data.expirations.map((expiry) => (
                <option key={expiry} value={expiry}>
                  {day(expiry)} ({daysUntil(expiry)}d)
                </option>
              ))}
            </select>
          </label>
        }
      >
        <Summary chain={data} />
        <Chain chain={data} />
      </Section>
    </div>
  );
}

function daysUntil(date: string): number {
  return Math.max(0, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.now()) / 86_400_000));
}

function Summary({ chain }: { chain: OptionChainView }) {
  const { totals } = chain;
  const tiles = [
    { label: "Underlying", value: chain.underlyingPrice === null ? "—" : formatPrice(chain.underlyingPrice) },
    {
      label: "Max pain",
      value: totals.maxPain === null ? "—" : formatPrice(totals.maxPain),
      title: "The strike at which these contracts would pay their holders least at expiry. A reading of open interest, not a forecast.",
    },
    { label: "Put/call (volume)", value: totals.putCallVolumeRatio?.toFixed(2) ?? "—" },
    { label: "Put/call (open int.)", value: totals.putCallOpenInterestRatio?.toFixed(2) ?? "—" },
    { label: "Call volume / OI", value: `${formatCompact(totals.callVolume)} / ${formatCompact(totals.callOpenInterest)}` },
    { label: "Put volume / OI", value: `${formatCompact(totals.putVolume)} / ${formatCompact(totals.putOpenInterest)}` },
  ];
  return (
    <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50" title={tile.title}>
          <dt className="text-[11px] text-zinc-500">{tile.label}</dt>
          <dd className="text-sm font-semibold tabular-nums">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Chain({ chain }: { chain: OptionChainView }) {
  const atmRow = useRef<HTMLTableRowElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atmIndex = chain.rows.findIndex((row) => row.strike === chain.atmStrike);
  const from = atmIndex === -1 ? 0 : Math.max(0, atmIndex - STRIKES_AROUND_ATM);
  const rows = atmIndex === -1 ? chain.rows : chain.rows.slice(from, atmIndex + STRIKES_AROUND_ATM + 1);

  // The table scrolls to the money, the page does not: `scrollIntoView` would
  // move every scrollable ancestor, window included, and yank the reader down
  // past the chart the moment the tab opened.
  useEffect(() => {
    const row = atmRow.current;
    const box = scroller.current;
    if (row === null || box === null) return;
    box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2);
  }, [chain.expiry]);

  return (
    <div ref={scroller} className="relative max-h-[32rem] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[52rem] text-xs tabular-nums">
        <thead className="sticky top-0 z-10 text-zinc-500">
          <tr className="bg-zinc-50 dark:bg-zinc-900">
            {/* No borders on this row: a collapsed border between two sticky
                header rows is a seam the scrolled rows show through. */}
            <th colSpan={6} className="pt-1.5 text-center font-semibold text-zinc-700 dark:text-zinc-300">
              Calls
            </th>
            <th />
            <th colSpan={6} className="pt-1.5 text-center font-semibold text-zinc-700 dark:text-zinc-300">
              Puts
            </th>
          </tr>
          <tr className="bg-zinc-50 shadow-[0_1px_0_var(--color-zinc-200)] dark:bg-zinc-900 dark:shadow-[0_1px_0_var(--color-zinc-800)]">
            {["Last", "Chg %", "Bid", "Ask", "Vol", "OI"].map((label) => (
              <th key={`c-${label}`} className="px-2 py-1.5 text-right font-medium">
                {label}
              </th>
            ))}
            <th className="px-2 py-1.5 text-center font-semibold text-zinc-700 dark:text-zinc-300">Strike</th>
            {["Last", "Chg %", "Bid", "Ask", "Vol", "OI"].map((label) => (
              <th key={`p-${label}`} className="px-2 py-1.5 text-right font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const atm = row.strike === chain.atmStrike;
            return (
              <tr
                key={row.strike}
                ref={atm ? atmRow : undefined}
                className={`border-b border-zinc-100 dark:border-zinc-800/70 ${atm ? "outline outline-1 -outline-offset-1 outline-indigo-400" : ""}`}
              >
                <Side option={row.call} />
                <td className="bg-zinc-50 px-2 py-1 text-center font-semibold dark:bg-zinc-800/60">
                  {formatPrice(row.strike)}
                  {atm && <span className="ml-1 text-[10px] font-normal text-indigo-600 dark:text-indigo-400">ATM</span>}
                </td>
                <Side option={row.put} />
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-zinc-400">
        Shaded cells are in the money. Showing {rows.length} of {chain.rows.length} strikes around the underlying. Hover a
        price for implied volatility.
      </p>
    </div>
  );
}

function Side({ option }: { option: OptionQuote | null }) {
  if (option === null) {
    return (
      <>
        {Array.from({ length: 6 }, (_, i) => (
          <td key={i} className="px-2 py-1 text-right text-zinc-300 dark:text-zinc-700">
            —
          </td>
        ))}
      </>
    );
  }
  const shade = option.inTheMoney ? "bg-indigo-50/70 dark:bg-indigo-500/10" : "";
  const cells = [
    { key: "last", value: option.last === null ? "—" : option.last.toFixed(2), title: option.impliedVolatilityPercent === null ? undefined : `IV ${option.impliedVolatilityPercent.toFixed(1)}% · ${option.contract}` },
    {
      key: "chg",
      value: option.changePercent === null ? "—" : `${option.changePercent > 0 ? "+" : ""}${option.changePercent.toFixed(1)}%`,
      className: option.changePercent === null || option.changePercent === 0 ? "" : option.changePercent > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
    },
    { key: "bid", value: option.bid?.toFixed(2) ?? "—" },
    { key: "ask", value: option.ask?.toFixed(2) ?? "—" },
    { key: "vol", value: option.volume === null ? "—" : formatCompact(option.volume) },
    { key: "oi", value: option.openInterest === null ? "—" : formatCompact(option.openInterest) },
  ];
  return (
    <>
      {cells.map((cell) => (
        <td key={cell.key} className={`px-2 py-1 text-right ${shade} ${cell.className ?? ""}`} title={cell.title}>
          {cell.value}
        </td>
      ))}
    </>
  );
}
