/**
 * The top of the symbol page: what it is, what it costs, and the session.
 *
 * The price is the one number on the page read from across the room, so it is
 * the largest thing here and it flashes briefly when a refresh moves it — the
 * cue that the page is live without anyone needing to read a timestamp.
 * The timestamp is there too, because "live" on a delayed feed needs saying.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { DiscoverIdea } from "../../../shared/discover.js";
import { formatCompact, formatPercent, formatRelative, signClass } from "../../lib/format.js";
import { formatPrice } from "../../lib/candles.js";
import { isTrading } from "../../lib/symbol-queries.js";
import type { SymbolQuoteResult, SymbolTrackingResult } from "../../lib/types.js";
import { TrackButton } from "../ideas.js";
import { ExtendedPrint, RangeMeter } from "../instrument-stats.js";

const STATE_LABELS: Record<string, string> = {
  REGULAR: "Market open",
  PRE: "Pre-market",
  PREPRE: "Pre-market",
  POST: "After hours",
  POSTPOST: "After hours",
  CLOSED: "Market closed",
};

function MarketState({ state }: { state: string | null }) {
  if (state === null) return null;
  const trading = isTrading(state);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        trading
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      <span className={`size-1.5 rounded-full ${trading ? "animate-pulse bg-emerald-500" : "bg-zinc-400"}`} />
      {STATE_LABELS[state] ?? state.toLowerCase()}
    </span>
  );
}

/** Briefly marks a value that just moved, in the direction it moved. */
function useFlash(value: number | null): "up" | "down" | null {
  const previous = useRef<number | null>(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (before === null || value === null || before === value) return;
    setFlash(value > before ? "up" : "down");
    const handle = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(handle);
  }, [value]);
  return flash;
}

export function SymbolHeader({
  quote,
  tracking,
  updatedAt,
  fetching,
}: {
  quote: SymbolQuoteResult;
  tracking: SymbolTrackingResult | undefined;
  updatedAt: number;
  fetching: boolean;
}) {
  const { identity, live, session } = quote;
  const stats = live.stats;
  const flash = useFlash(live.price);

  const idea: DiscoverIdea = {
    kind: "symbol",
    ref: identity.symbol,
    name: identity.name,
    exchange: identity.exchange,
    quoteType: identity.quoteType,
    currency: identity.currency,
    price: live.price,
    changePercent: live.changePercent,
    source: "search",
    tracked: tracking?.lists ?? [],
  };

  const facts: { label: string; value: string | null; title?: string }[] = [
    { label: "Open", value: session.open === null ? null : formatPrice(session.open) },
    { label: "Prev close", value: stats?.previousClose == null ? null : formatPrice(stats.previousClose) },
    {
      label: "Volume",
      value: stats?.volume == null ? null : formatCompact(stats.volume),
      ...(stats?.volume != null && stats.averageVolume3Month
        ? { title: `${(stats.volume / stats.averageVolume3Month).toFixed(2)}× the 3-month average of ${formatCompact(stats.averageVolume3Month)}` }
        : {}),
    },
    { label: "Avg vol (3M)", value: stats?.averageVolume3Month == null ? null : formatCompact(stats.averageVolume3Month) },
    { label: "Market cap", value: stats?.marketCap == null ? null : formatCompact(stats.marketCap) },
    { label: "P/E (TTM)", value: stats?.trailingPe == null ? null : stats.trailingPe.toFixed(2) },
    { label: "Fwd P/E", value: session.forwardPe === null ? null : session.forwardPe.toFixed(2) },
    { label: "EPS (TTM)", value: session.epsTrailing === null ? null : session.epsTrailing.toFixed(2) },
    { label: "Yield", value: stats?.dividendYieldPercent == null ? null : `${stats.dividendYieldPercent.toFixed(2)}%` },
    {
      label: "Bid × Ask",
      value:
        session.bid && session.ask
          ? `${formatPrice(session.bid)} × ${formatPrice(session.ask)}`
          : null,
    },
    {
      label: "Next earnings",
      value:
        session.earningsAt === null || Date.parse(session.earningsAt) < Date.now() - 86_400_000
          ? null
          : new Date(session.earningsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    },
  ];
  const shown = facts.filter((fact) => fact.value !== null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{identity.symbol}</h1>
            {identity.quoteType && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {identity.quoteType}
              </span>
            )}
            <MarketState state={live.marketState} />
            <TrackButton idea={idea} compact />
            {tracking?.listId && (
              <Link
                to={`/watchlist?list=${tracking.listId}${tracking.item ? `&item=${tracking.item.id}` : ""}`}
                className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              >
                On {tracking.lists.map((list) => list.listName).join(", ")}
              </Link>
            )}
          </div>
          <div className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
            {[identity.name, identity.exchange, identity.currency].filter(Boolean).join(" · ")}
          </div>
        </div>

        <div className="text-right">
          <div className="flex items-baseline justify-end gap-3">
            <span
              className={`rounded px-1 text-3xl font-semibold tabular-nums transition-colors duration-700 ${
                flash === "up"
                  ? "bg-emerald-100 dark:bg-emerald-500/20"
                  : flash === "down"
                    ? "bg-red-100 dark:bg-red-500/20"
                    : "bg-transparent"
              }`}
            >
              {live.price === null ? "—" : formatPrice(live.price)}
            </span>
            <span className={`text-base font-medium tabular-nums ${signClass(live.changePercent)}`}>
              {live.change === null ? "" : `${live.change > 0 ? "+" : ""}${formatPrice(live.change)}`}{" "}
              {live.changePercent === null ? "" : `(${formatPercent(live.changePercent)})`}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-end gap-3 text-xs text-zinc-400">
            {live.extended && <ExtendedPrint quote={live.extended} />}
            <span title={live.asOf ?? undefined}>
              {live.available
                ? `As of ${formatRelative(live.asOf)} · refreshed ${formatRelative(new Date(updatedAt).toISOString())}`
                : (live.unavailableReason ?? "No price available.")}
            </span>
            {fetching && <span className="size-1.5 animate-pulse rounded-full bg-indigo-500" aria-label="Refreshing" />}
          </div>
        </div>
      </div>

      {(shown.length > 0 || stats) && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {shown.map((fact) => (
              <div key={fact.label} title={fact.title}>
                <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">{fact.label}</dt>
                <dd className="text-sm font-medium whitespace-nowrap tabular-nums">{fact.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-2">
            {stats?.dayLow != null && stats.dayHigh != null && live.price !== null && stats.dayHigh > stats.dayLow && (
              <div>
                <div className="mb-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">Day range</div>
                <RangeMeter
                  low={stats.dayLow}
                  high={stats.dayHigh}
                  position={Math.min(1, Math.max(0, (live.price - stats.dayLow) / (stats.dayHigh - stats.dayLow)))}
                  label="Day range"
                  compact
                />
              </div>
            )}
            {stats?.fiftyTwoWeekPosition != null && stats.fiftyTwoWeekLow != null && stats.fiftyTwoWeekHigh != null && (
              <div>
                <div className="mb-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">52-week range</div>
                <RangeMeter
                  low={stats.fiftyTwoWeekLow}
                  high={stats.fiftyTwoWeekHigh}
                  position={stats.fiftyTwoWeekPosition}
                  label="52-week range"
                  compact
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
