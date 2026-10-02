/**
 * The watchlist, as a rail beside the symbol page.
 *
 * Watching a market is moving between names, not reading one: the rail keeps
 * a list priced and one click (or `j` / `k`) away while the page shows the
 * selected symbol in depth. It reads the watchlist's own items endpoint under
 * the watchlist page's own query key, so the two pages share one cache and one
 * minute-by-minute refresh rather than polling the same list twice.
 *
 * Which list is shown lives in `?list=`, like everywhere else.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { formatPercent, signClass } from "../../lib/format.js";
import { api } from "../../lib/api.js";
import type { WatchlistItem, WatchlistItemsResult, WatchlistSummary } from "../../lib/types.js";
import { symbolPath } from "../../../shared/symbol.js";
import { Sparkline } from "../instrument-stats.js";
import { formatPrice } from "../../lib/candles.js";

const QUOTE_REFRESH_MS = 60_000;

export function useRailItems(listParam: string) {
  const lists = useQuery({
    queryKey: ["watchlists"],
    queryFn: () => api<{ items: WatchlistSummary[] }>("/api/watchlists"),
  });
  const listId = listParam || lists.data?.items[0]?.id || "";
  const items = useQuery({
    // The watchlist page's key with no filters applied — the same cache entry.
    queryKey: ["watchlist-items", listId, ""],
    queryFn: () => api<WatchlistItemsResult>(`/api/watchlists/${listId}/items?`),
    enabled: listId !== "",
    refetchInterval: QUOTE_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  return { lists, items, listId };
}

export function WatchRail({
  current,
  listParam,
  carried,
  onList,
  className = "",
}: {
  current: string;
  listParam: string;
  /** Query string carried onto the next symbol's page (`?range=…`). */
  carried: string;
  onList: (listId: string) => void;
  className?: string;
}) {
  const { lists, items, listId } = useRailItems(listParam);
  const all = lists.data?.items ?? [];

  return (
    <nav aria-label="Watchlist" className={`flex min-h-0 flex-col ${className}`}>
      <div className="mb-2 flex items-center gap-2">
        {all.length > 1 ? (
          <select
            value={listId}
            onChange={(event) => onList(event.target.value)}
            aria-label="Watchlist shown in the rail"
            className="w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm font-medium outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {all.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.itemCount})
              </option>
            ))}
          </select>
        ) : (
          <div className="px-1 text-sm font-semibold">{all[0]?.name ?? "Watchlist"}</div>
        )}
      </div>

      {lists.isPending || (listId !== "" && items.isPending) ? (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <p className="px-1 text-xs text-zinc-500">
          No watchlists yet. Star a symbol to start one, or create one on the{" "}
          <Link to="/watchlist" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Watchlists
          </Link>{" "}
          page.
        </p>
      ) : (items.data?.items.length ?? 0) === 0 ? (
        <p className="px-1 text-xs text-zinc-500">This list is empty. Star the symbol you are looking at to add it.</p>
      ) : (
        <ul className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {items.data!.items.map((item) => (
            <RailRow key={item.id} item={item} active={item.kind === "symbol" && item.ref.toUpperCase() === current} carried={carried} />
          ))}
        </ul>
      )}

      {(items.data?.items.length ?? 0) > 1 && (
        <p className="mt-2 hidden px-1 text-[10px] text-zinc-400 lg:block">
          <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-700">j</kbd> /{" "}
          <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-700">k</kbd> to step through this list
        </p>
      )}
    </nav>
  );
}

function RailRow({ item, active, carried }: { item: WatchlistItem; active: boolean; carried: string }) {
  // A China fund has no listing to chart; its own page is the Funds view.
  const to = item.kind === "fund" ? `/funds?fund=${encodeURIComponent(item.ref)}` : `${symbolPath(item.ref)}${carried}`;
  const live = item.live;
  return (
    <li>
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg px-2 py-1.5 transition-colors ${
          active
            ? "bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:ring-indigo-500/30"
            : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate font-mono text-xs font-semibold">{item.ref}</span>
          <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{item.name ?? "—"}</span>
        </span>
        <span className="flex items-center gap-2">
          {item.spark && item.spark.length > 1 && (
            <span className="hidden w-12 xl:block">
              <Sparkline values={item.spark} label={item.ref} />
            </span>
          )}
          <span className="text-right">
            <span className="block text-xs tabular-nums">{live.price === null ? "—" : formatPrice(live.price)}</span>
            <span className={`block text-[11px] tabular-nums ${signClass(live.changePercent)}`}>
              {live.changePercent === null ? "" : formatPercent(live.changePercent)}
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}
