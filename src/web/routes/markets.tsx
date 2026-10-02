/**
 * Markets — the board a reader glances at before looking at anything of theirs.
 *
 * Benchmarks first, grouped by what they measure, then the reader's own
 * watchlist priced beside them. Every tile opens that symbol's page. One
 * batched quote prices the whole board, refreshed every thirty seconds while
 * the tab is visible; it is the cheapest page in the app for what it shows.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { ArrowRight, Compass } from "lucide-react";
import { normalizeSymbol, symbolPath } from "../../shared/symbol.js";
import { RangeMeter } from "../components/instrument-stats.js";
import { WatchRail } from "../components/symbol/watch-rail.js";
import { Button, Card, Input, PageHeader, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { formatPrice } from "../lib/candles.js";
import { formatPercent, signClass } from "../lib/format.js";
import { useSymbolParams } from "../lib/symbol-params.js";
import { isTrading } from "../lib/symbol-queries.js";
import type { BoardResult } from "../lib/types.js";

const BOARD_REFRESH_MS = 30_000;

/** Short names for benchmarks whose official ones do not fit a tile. */
const SHORT_NAMES: Record<string, string> = {
  "^GSPC": "S&P 500",
  "^IXIC": "Nasdaq Composite",
  "^DJI": "Dow Jones",
  "^RUT": "Russell 2000",
  "^VIX": "VIX",
  "000001.SS": "SSE Composite",
  "399001.SZ": "SZSE Component",
  "000300.SS": "CSI 300",
  "^HSI": "Hang Seng",
  "^N225": "Nikkei 225",
  "^STOXX50E": "Euro Stoxx 50",
  "^FTSE": "FTSE 100",
  "^GDAXI": "DAX",
  "^TNX": "US 10Y yield",
  "DX-Y.NYB": "US dollar index",
  "CNY=X": "USD/CNY",
  "GC=F": "Gold",
  "CL=F": "WTI crude",
  "BTC-USD": "Bitcoin",
  "ETH-USD": "Ether",
  "SOL-USD": "Solana",
};

export default function MarketsPage() {
  const navigate = useNavigate();
  const params = useSymbolParams();
  const [go, setGo] = useState("");

  const board = useQuery({
    queryKey: ["symbols", "board"],
    queryFn: () => api<BoardResult>("/api/symbols/board"),
    refetchInterval: BOARD_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const target = normalizeSymbol(go);

  return (
    <>
      <PageHeader
        title="Markets"
        description="Benchmarks across regions and your own watchlist, priced live. Open any symbol for candles, indicators, statements, earnings, options and news."
        actions={
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (target !== null) navigate(symbolPath(target));
            }}
          >
            <Input
              value={go}
              onChange={(event) => setGo(event.target.value)}
              placeholder="Symbol, e.g. NVDA or 0700.HK"
              aria-label="Go to symbol"
              className="w-60"
            />
            <Button type="submit" disabled={target === null}>
              Open <ArrowRight className="size-4" />
            </Button>
          </form>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {board.isPending ? (
            <Spinner />
          ) : board.isError ? (
            <Card className="p-6 text-sm text-amber-600 dark:text-amber-400">{(board.error as Error).message}</Card>
          ) : (
            board.data.groups.map((group) => (
              <section key={group.id}>
                <h2 className="mb-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">{group.label}</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                  {group.items.map(({ identity, live }) => {
                    const stats = live.stats;
                    const dayPosition =
                      stats?.dayLow != null && stats.dayHigh != null && live.price !== null && stats.dayHigh > stats.dayLow
                        ? Math.min(1, Math.max(0, (live.price - stats.dayLow) / (stats.dayHigh - stats.dayLow)))
                        : null;
                    return (
                      <Link
                        key={identity.symbol}
                        to={symbolPath(identity.symbol)}
                        className="group rounded-xl border border-zinc-200 bg-white p-3 shadow-sm transition-colors hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-500/50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {SHORT_NAMES[identity.symbol] ?? identity.name ?? identity.symbol}
                            </div>
                            <div className="font-mono text-[11px] text-zinc-400">{identity.symbol}</div>
                          </div>
                          {isTrading(live.marketState) && (
                            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500" title="Trading now" />
                          )}
                        </div>
                        <div className="mt-2 flex items-baseline justify-between gap-2">
                          <span className="text-lg font-semibold tabular-nums">
                            {live.price === null ? "—" : formatPrice(live.price)}
                          </span>
                          <span className={`text-sm font-medium tabular-nums ${signClass(live.changePercent)}`}>
                            {live.changePercent === null ? "" : formatPercent(live.changePercent)}
                          </span>
                        </div>
                        {dayPosition !== null && stats?.dayLow != null && stats.dayHigh != null && (
                          <div className="mt-2">
                            <RangeMeter low={stats.dayLow} high={stats.dayHigh} position={dayPosition} label="Day range" compact />
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))
          )}
          {board.data && board.data.missing.length > 0 && (
            <p className="text-[11px] text-zinc-400">Not quoted right now: {board.data.missing.join(", ")}.</p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <WatchRail
              current=""
              listParam={params.list}
              carried=""
              onList={(list) => params.update({ list }, { replace: true })}
            />
          </Card>
          <Card className="p-4">
            <Link to="/discover" className="flex items-center gap-2 text-sm text-indigo-600 hover:underline dark:text-indigo-400">
              <Compass className="size-4" /> Trending, movers and themes on Discover
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
