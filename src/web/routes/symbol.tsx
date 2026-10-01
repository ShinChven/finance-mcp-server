/**
 * One symbol, in depth — the page for watching a market name by name.
 *
 * Layout, top to bottom: the quote and its session, the chart, then tabs for
 * everything else the sources know. The reader's watchlist rides along the
 * left so moving to the next name is one click or one keystroke (`j` / `k`),
 * carrying the chart settings and the open tab with it.
 *
 * Every piece of state is a URL param (see `shared/symbol.ts`), so any view of
 * any symbol is a link. Only the tab being looked at fetches; the quote
 * refreshes on the market's clock — every fifteen seconds while its exchange
 * trades, every two minutes when it does not.
 */

import { useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { ChevronRight } from "lucide-react";
import {
  normalizeSymbol,
  symbolPath,
  SYMBOL_TAB_LABELS,
  tabsFor,
  type SymbolTab,
} from "../../shared/symbol.js";
import { detectItemKind } from "../../shared/watchlist.js";
import { ChartPanel } from "../components/symbol/chart-panel.js";
import { EarningsTab } from "../components/symbol/earnings-tab.js";
import { FinancialsTab } from "../components/symbol/financials-tab.js";
import { FilingsTab, FundsTab } from "../components/symbol/holders-tabs.js";
import { NewsTab } from "../components/symbol/news-tab.js";
import { OptionsTab } from "../components/symbol/options-tab.js";
import { AnalysisTab } from "../components/symbol/analysis-tab.js";
import { SummaryTab } from "../components/symbol/summary-tab.js";
import { SymbolHeader } from "../components/symbol/symbol-header.js";
import { useRailItems, WatchRail } from "../components/symbol/watch-rail.js";
import { useToast } from "../components/toast.js";
import { Card, EmptyState, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { formatPercent } from "../lib/format.js";
import { formatPrice } from "../lib/candles.js";
import type { LevelDraft, LevelPatch } from "../lib/levels.js";
import { carriedQuery, useSymbolParams } from "../lib/symbol-params.js";
import { useAnalysis, useSymbolQuote, useTracking } from "../lib/symbol-queries.js";
import { useMe } from "./shell.js";

export default function SymbolPage() {
  const { symbol: raw = "" } = useParams();
  const symbol = normalizeSymbol(raw);

  if (symbol === null) {
    return (
      <Card>
        <EmptyState
          title="That is not a symbol"
          description="Symbols look like NVDA, 0700.HK, 600519.SS, BTC-USD or ^GSPC. Search for the one you mean with ⌘K."
        />
      </Card>
    );
  }

  // A bare six-digit code is a China fund, which has a NAV rather than a
  // listing; its own view lives on the Funds page.
  if (detectItemKind(symbol) === "fund") {
    return (
      <Card>
        <EmptyState
          title={`${symbol} is a fund code`}
          description="China funds publish a daily NAV rather than trading on an exchange. Open it on the Funds page, or add an exchange suffix (600519.SS) for a listed share."
        />
        <div className="pb-8 text-center">
          <Link to={`/funds?fund=${symbol}`} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
            Open {symbol} on the Funds page →
          </Link>
        </div>
      </Card>
    );
  }

  // Keyed so every per-symbol hook starts clean on navigation.
  return <SymbolView key={symbol} symbol={symbol} />;
}

function SymbolView({ symbol }: { symbol: string }) {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useSymbolParams();
  const carried = carriedQuery(params.search);

  const quote = useSymbolQuote(symbol);
  const tracking = useTracking(symbol);
  const rail = useRailItems(params.list);

  const identity = quote.data?.identity;
  const tabs = tabsFor(identity?.quoteType ?? null, identity?.market ?? null);
  const tab: SymbolTab = tabs.includes(params.tab) ? params.tab : "summary";

  // Read whenever it is cached, so support and resistance stay on the chart
  // after the analysis tab has been visited; only fetched from that tab.
  const analysis = useAnalysis(symbol, tab === "analysis");
  const guides = useMemo(() => {
    const key = analysis.data?.keyTechnicals;
    if (!key) return [];
    return [
      ...(key.support === null ? [] : [{ price: key.support, label: "Support" }]),
      ...(key.resistance === null ? [] : [{ price: key.resistance, label: "Resistance" }]),
    ];
  }, [analysis.data]);

  const listId = tracking.data?.listId ?? null;
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["watchlists"] });
    void queryClient.invalidateQueries({ queryKey: ["watchlist-items"] });
  };
  const addLevels = useMutation({
    mutationFn: ({ itemId, levels }: { itemId: string; levels: LevelDraft[] }) =>
      api(`/api/watchlists/${listId}/items/${itemId}/levels`, { method: "POST", body: { levels } }),
    onSuccess: invalidate,
    onError: (error: Error) => toast("error", error.message),
  });
  const updateLevel = useMutation({
    mutationFn: ({ levelId, patch }: { levelId: string; patch: LevelPatch }) =>
      api(`/api/watchlists/${listId}/levels/${levelId}`, { method: "PATCH", body: patch }),
    onSuccess: invalidate,
    onError: (error: Error) => toast("error", error.message),
  });
  const removeLevel = useMutation({
    mutationFn: (levelId: string) => api(`/api/watchlists/${listId}/levels/${levelId}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (error: Error) => toast("error", error.message),
  });

  // The tab title is what a reader sees across a row of browser tabs.
  const live = quote.data?.live;
  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);
  useEffect(() => {
    if (live?.price == null) {
      document.title = symbol;
      return;
    }
    document.title = `${symbol} ${formatPrice(live.price)} ${live.changePercent === null ? "" : formatPercent(live.changePercent)}`;
  }, [symbol, live?.price, live?.changePercent]);

  // `j` / `k` step through the rail's list, as in a mail client.
  const railSymbols = useMemo(
    () => (rail.items.data?.items ?? []).filter((item) => item.kind === "symbol").map((item) => item.ref.toUpperCase()),
    [rail.items.data],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.key !== "j" && event.key !== "k") return;
      if (railSymbols.length === 0) return;
      const index = railSymbols.indexOf(symbol);
      const next =
        index === -1
          ? railSymbols[0]
          : railSymbols[(index + (event.key === "j" ? 1 : -1) + railSymbols.length) % railSymbols.length];
      if (next !== undefined && next !== symbol) navigate(`${symbolPath(next)}${carried}`);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [railSymbols, symbol, carried, navigate]);

  const palette = me.preferences.directionPalette ?? "classic";
  const item = tracking.data?.item ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col">
          <WatchRail
            current={symbol}
            listParam={params.list}
            carried={carried}
            onList={(list) => params.update({ list }, { replace: true })}
            className="min-h-0 flex-1"
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-zinc-500">
          <Link to="/markets" className="hover:text-zinc-800 dark:hover:text-zinc-200">
            Markets
          </Link>
          <ChevronRight className="size-3" />
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{symbol}</span>
        </nav>

        {quote.isPending ? (
          <Card className="p-5">
            <Spinner />
          </Card>
        ) : quote.isError ? (
          <Card>
            <EmptyState title={`Cannot price ${symbol}`} description={(quote.error as Error).message} />
          </Card>
        ) : (
          <Card className="p-4 sm:p-5">
            <SymbolHeader
              quote={quote.data}
              tracking={tracking.data}
              updatedAt={quote.dataUpdatedAt}
              fetching={quote.isFetching}
            />
          </Card>
        )}

        {!quote.isError && (
          <ChartPanel
            symbol={symbol}
            params={params}
            update={(patch) => params.update(patch)}
            quote={quote.data}
            palette={palette}
            levels={item?.levels ?? []}
            entryPrice={item?.entryPrice ?? null}
            guides={guides}
          />
        )}

        {quote.data && (
          <>
            <div
              role="tablist"
              aria-label={`${symbol} detail`}
              className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800"
            >
              {tabs.map((entry) => (
                <button
                  key={entry}
                  role="tab"
                  aria-selected={entry === tab}
                  onClick={() => params.update({ tab: entry })}
                  className={`shrink-0 cursor-pointer border-b-2 px-3 py-2 text-sm transition-colors ${
                    entry === tab
                      ? "border-indigo-600 font-medium text-indigo-600 dark:text-indigo-400"
                      : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  {SYMBOL_TAB_LABELS[entry]}
                </button>
              ))}
            </div>

            <div role="tabpanel">
              {tab === "summary" && (
                <SummaryTab
                  symbol={symbol}
                  quote={quote.data}
                  tracking={tracking.data}
                  carried={carried}
                  levelsBusy={addLevels.isPending || updateLevel.isPending || removeLevel.isPending}
                  onAddLevels={(levels) => item && addLevels.mutate({ itemId: item.id, levels })}
                  onUpdateLevel={(levelId, patch) => updateLevel.mutate({ levelId, patch })}
                  onRemoveLevel={(levelId) => removeLevel.mutate(levelId)}
                  onTab={(next) => params.update({ tab: next })}
                />
              )}
              {tab === "financials" && <FinancialsTab symbol={symbol} params={params} update={(patch) => params.update(patch)} />}
              {tab === "earnings" && <EarningsTab symbol={symbol} />}
              {tab === "analysis" && <AnalysisTab symbol={symbol} price={quote.data.live.price} />}
              {tab === "options" && <OptionsTab symbol={symbol} params={params} update={(patch) => params.update(patch)} />}
              {tab === "news" && <NewsTab symbol={symbol} />}
              {tab === "funds" && <FundsTab symbol={symbol} />}
              {tab === "filings" && <FilingsTab symbol={symbol} params={params} update={(patch) => params.update(patch)} />}
            </div>
          </>
        )}

        {/* The rail, for screens too narrow to keep it beside the page. */}
        <Card className="p-4 lg:hidden">
          <WatchRail
            current={symbol}
            listParam={params.list}
            carried={carried}
            onList={(list) => params.update({ list }, { replace: true })}
          />
        </Card>
      </div>
    </div>
  );
}
