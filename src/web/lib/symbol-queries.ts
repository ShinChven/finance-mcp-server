/**
 * Every read the symbol page makes, with its query key in one place.
 *
 * Keys are derived from exactly the params that change the response, so back,
 * forward and a shared link all land on the same cache entries — and two
 * components asking for the same thing (the summary's headlines and the news
 * tab, the analysis tab and the chart's support lines) share one request.
 *
 * Refresh cadence follows the market rather than a fixed clock: a quote is
 * worth re-reading every fifteen seconds while its exchange is trading and
 * every two minutes when it is not.
 */

import { useQuery } from "@tanstack/react-query";
import type { IdeaListResult } from "../../shared/discover.js";
import type {
  AnalysisView,
  CandleInterval,
  CandleSeries,
  EarningsView,
  FilingView,
  FundHolderView,
  NewsArticle,
  OptionChainView,
  Statement,
  StatementPeriod,
  StatementView,
  SymbolProfile,
} from "../../shared/symbol.js";
import type { SeriesRangeId } from "../../shared/series.js";
import { api } from "./api.js";
import type { NoteCard, SymbolQuoteResult, SymbolTrackingResult } from "./types.js";

const base = (symbol: string) => `/api/symbols/${encodeURIComponent(symbol)}`;

/** Whether an exchange is printing prices right now, by Yahoo's own word for it. */
export function isTrading(marketState: string | null | undefined): boolean {
  const state = (marketState ?? "").toUpperCase();
  return state === "REGULAR" || state.startsWith("PRE") || state.startsWith("POST");
}

export function useSymbolQuote(symbol: string) {
  return useQuery({
    queryKey: ["symbol", symbol, "quote"],
    queryFn: () => api<SymbolQuoteResult>(`${base(symbol)}/quote`),
    refetchInterval: (query) => (isTrading(query.state.data?.live.marketState) ? 15_000 : 120_000),
    // A quote page left in a background tab should not keep polling.
    refetchIntervalInBackground: false,
    retry: (count, error) => (error as { status?: number }).status !== 404 && count < 1,
  });
}

export function useCandles(
  symbol: string,
  range: SeriesRangeId,
  interval: CandleInterval,
  options: { live: boolean },
) {
  const intraday = range === "1d" || range === "5d";
  return useQuery({
    queryKey: ["symbol", symbol, "candles", range, intraday ? "auto" : interval],
    queryFn: () =>
      api<{ series: CandleSeries | null }>(`${base(symbol)}/candles?range=${range}&interval=${interval}`),
    // Intraday candles move every minute while the session is open; daily
    // ones are kept current by patching the last candle from the quote.
    refetchInterval: intraday && options.live ? 60_000 : false,
    refetchIntervalInBackground: false,
    staleTime: intraday ? 30_000 : 5 * 60_000,
    placeholderData: (previous) => previous,
    retry: false,
  });
}

export function useProfile(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ["symbol", symbol, "profile"],
    queryFn: () => api<SymbolProfile>(`${base(symbol)}/profile`),
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
  });
}

export function useEarnings(symbol: string, enabled: boolean) {
  return useQuery({
    queryKey: ["symbol", symbol, "earnings"],
    queryFn: () => api<EarningsView>(`${base(symbol)}/earnings`),
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
  });
}

export function useStatement(
  symbol: string,
  statement: Statement,
  period: StatementPeriod,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["symbol", symbol, "financials", statement, period],
    queryFn: () =>
      api<StatementView>(`${base(symbol)}/financials?statement=${statement}&period=${period}`),
    enabled,
    staleTime: 60 * 60_000,
    placeholderData: (previous) => previous,
    retry: false,
  });
}

export function useAnalysis(symbol: string, enabled: boolean) {
  return useQuery({
    queryKey: ["symbol", symbol, "analysis"],
    queryFn: () => api<AnalysisView>(`${base(symbol)}/analysis`),
    enabled,
    staleTime: 60 * 60_000,
    retry: false,
  });
}

export function useOptions(symbol: string, expiry: string, enabled: boolean) {
  return useQuery({
    queryKey: ["symbol", symbol, "options", expiry],
    queryFn: () =>
      api<OptionChainView>(
        `${base(symbol)}/options${expiry === "" ? "" : `?expiry=${encodeURIComponent(expiry)}`}`,
      ),
    enabled,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    retry: false,
  });
}

export function useNews(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ["symbol", symbol, "news"],
    queryFn: () => api<{ symbol: string; articles: NewsArticle[] }>(`${base(symbol)}/news`),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useRelated(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ["symbol", symbol, "related"],
    queryFn: () => api<IdeaListResult>(`${base(symbol)}/related`),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useFundHolders(symbol: string, enabled: boolean) {
  return useQuery({
    queryKey: ["symbol", symbol, "funds"],
    queryFn: () => api<FundHolderView>(`${base(symbol)}/funds`),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useFilings(symbol: string, form: string, enabled: boolean) {
  return useQuery({
    queryKey: ["symbol", symbol, "filings", form],
    queryFn: () =>
      api<FilingView>(`${base(symbol)}/filings${form === "" ? "" : `?form=${encodeURIComponent(form)}`}`),
    enabled,
    staleTime: 15 * 60_000,
    placeholderData: (previous) => previous,
    retry: false,
  });
}

/**
 * Keyed under `watchlist-items` on purpose: every watchlist mutation and every
 * realtime watchlist event already invalidates that prefix, so a level added
 * here, on the watchlist page or by an assistant over MCP redraws on this
 * chart without this page knowing any of them exist.
 */
export function useTracking(symbol: string) {
  return useQuery({
    queryKey: ["watchlist-items", "symbol", symbol],
    queryFn: () => api<SymbolTrackingResult>(`${base(symbol)}/tracking`),
  });
}

/** Notes that mention this symbol — the reader's own research beside the market's. */
export function useSymbolNotes(symbol: string) {
  return useQuery({
    queryKey: ["notes", "symbol", symbol],
    queryFn: () =>
      api<{ items: NoteCard[]; total: number }>(
        `/api/notes?symbol=${encodeURIComponent(symbol)}&per_page=5&sort=updated`,
      ),
    retry: false,
  });
}
