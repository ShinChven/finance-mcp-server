/**
 * One listing, in depth — the API behind the symbol page and the market board.
 *
 * Almost everything here was already reachable over MCP: the quote, the
 * chart, the profile modules, statements, earnings, insights, options, news,
 * the reverse holdings index and EDGAR. What this adds is the shape a page
 * needs — normalised, unit-labelled, and split along the page's tabs so that
 * only the tab being looked at costs a request.
 *
 * Cost discipline, because every route but two is an upstream call made on a
 * reader's behalf against a throttled source:
 *
 * - Each upstream read is cached in-process for as long as its data plausibly
 *   stays the same — ten seconds for a quote, a minute for an options chain,
 *   half an hour for a profile, six hours for statements — and concurrent
 *   readers of the same key share one fetch. Two tabs on NVDA cost one
 *   request, not two.
 * - A per-user token bucket is charged only on a cache miss, before the fetch:
 *   reading what is already in memory is free, and a refusal must be cheaper
 *   than the request it refuses.
 * - Candles go through the shared bar store and the shared series budget, so
 *   the watchlist chart and this one draw on one allowance and one copy of
 *   each symbol's history.
 *
 * An upstream failure is a 502 with a sentence the page can show, never a 500:
 * one tab being unavailable must not read as the whole page being broken.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  BOARD_GROUPS,
  boardQuerySchema,
  candleQuerySchema,
  filingsQuerySchema,
  financialsQuerySchema,
  optionsQuerySchema,
  symbolParamSchema,
  type FilingView,
  type FundHolderView,
  type SymbolIdentity,
} from "../../shared/symbol.js";
import { seriesRange } from "../../shared/series.js";
import type { DiscoverIdea } from "../../shared/discover.js";
import { ideaFromQuote, trackedIndex, type QuoteLike } from "../discover/ideas.js";
import { describeFundBrief, disclosureNote } from "../funds/present.js";
import { createLazyFundRepo } from "../funds/repo.js";
import { toCanonicalSymbol } from "../funds/symbols.js";
import type { AppEnv } from "../lib/http.js";
import { createTtlCache } from "../lib/ttl-cache.js";
import { BarFetchRefused } from "../market/bars.js";
import { createTokenBucket } from "../market/budget.js";
import { symbolCandles } from "../market/candles.js";
import { loadSeriesDeps, seriesBudget } from "../market/deps.js";
import { yahooFinanceClient } from "../mcp/client.js";
import { yahooRequestOptions } from "../mcp/tools/runtime.js";
import { requireAuth } from "../middleware/session.js";
import { EdgarError, getEdgarClient } from "../sec/edgar.js";
import { buildAnalysis } from "../symbols/analysis.js";
import { buildEarningsView, EARNINGS_MODULES } from "../symbols/earnings.js";
import { buildNews } from "../symbols/news.js";
import { buildOptionChain } from "../symbols/options.js";
import { buildProfile, MINIMAL_MODULES, profileModules } from "../symbols/profile.js";
import { quoteMany, type SymbolQuote } from "../symbols/quote.js";
import { buildStatement, STATEMENT_MODULE, statementStart } from "../symbols/statements.js";
import { enrichItems, type LiveValue } from "../watchlist/live.js";
import { createLazyWatchlistRepo } from "../watchlist/repo.js";

const repo = createLazyWatchlistRepo();
const fundRepo = createLazyFundRepo();

/** Seconds a cached read stays fresh, by what it is. */
const TTL = {
  quote: 10_000,
  board: 15_000,
  intraday: 30_000,
  options: 60_000,
  news: 5 * 60_000,
  related: 10 * 60_000,
  profile: 30 * 60_000,
  earnings: 30 * 60_000,
  analysis: 60 * 60_000,
  statements: 6 * 60 * 60_000,
} as const;

const quoteCache = createTtlCache<SymbolQuote | null>({ maxEntries: 2_000 });
const detailCache = createTtlCache<unknown>({ maxEntries: 1_000 });

/**
 * The allowance for detail reads. Wider than the series budget because a
 * symbol page opens with three or four of these at once and a reader clicking
 * through tabs is not a loop — but still per user, and still finite.
 */
const detailBudget = createTokenBucket({ ratePerMinute: 120, burst: 40 });

const symbolParam = zValidator("param", z.object({ symbol: symbolParamSchema }));

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "Yahoo Finance did not answer in time.";
  }
  return message;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /not found|no fundamentals data|no data found/i.test(error.message);
}

function refused(c: Context<AppEnv>, retryAfterSeconds: number) {
  return c.json(
    {
      error: "Too many market-data requests. Give it a moment and try again.",
      retryAfterSeconds,
    },
    429,
    { "Retry-After": String(retryAfterSeconds) },
  );
}

/**
 * Reads through the detail cache, charging the reader's budget only on a miss.
 *
 * Returns the response to send, so each route stays a description of *what*
 * it reads rather than a repetition of how failures are reported.
 */
async function serve<T>(
  c: Context<AppEnv>,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  options: { source?: string } = {},
): Promise<Response> {
  if (!detailCache.has(key)) {
    const allowed = detailBudget.take(c.get("user").id);
    if (!allowed.ok) return refused(c, allowed.retryAfterSeconds);
  }
  try {
    const value = await detailCache.get(key, ttlMs, load);
    return c.json(value as object);
  } catch (error) {
    const source = options.source ?? "Yahoo Finance";
    if (isNotFound(error)) {
      return c.json({ error: `${source} has no data for this symbol.` }, 404);
    }
    return c.json({ error: `${source} did not answer: ${failureMessage(error)}` }, 502);
  }
}

async function cachedQuote(symbol: string): Promise<SymbolQuote | null> {
  return quoteCache.get(symbol, TTL.quote, async () => {
    const quotes = await quoteMany(yahooFinanceClient, [symbol]);
    return quotes.get(symbol) ?? null;
  });
}

export interface BoardItem {
  identity: SymbolIdentity;
  live: LiveValue;
}

export const symbolRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  /**
   * The market board: the benchmarks a reader glances at before their own list.
   *
   * One batched quote for every tile, however many there are. A caller may
   * pass its own `symbols` to price an arbitrary strip instead.
   */
  .get("/board", zValidator("query", boardQuerySchema), async (c) => {
    const custom = c.req.valid("query").symbols;
    const groups =
      custom === undefined
        ? BOARD_GROUPS.map((group) => ({ id: group.id, label: group.label, symbols: [...group.symbols] }))
        : [{ id: "custom", label: "Symbols", symbols: custom }];
    const all = [...new Set(groups.flatMap((group) => group.symbols))];
    const key = `board:${[...all].sort().join(",")}`;

    return serve(c, key, TTL.board, async () => {
      const quotes = await quoteMany(yahooFinanceClient, all);
      return {
        groups: groups.map((group) => ({
          id: group.id,
          label: group.label,
          items: group.symbols
            .map((symbol) => quotes.get(symbol))
            .filter((quote): quote is SymbolQuote => quote !== undefined)
            .map((quote): BoardItem => ({ identity: quote.identity, live: quote.live })),
        })),
        missing: all.filter((symbol) => !quotes.has(symbol)),
      };
    });
  })

  /** The header: identity, live price and session detail. */
  .get("/:symbol/quote", symbolParam, async (c) => {
    const { symbol } = c.req.valid("param");
    try {
      const quote = await cachedQuote(symbol);
      if (quote === null) {
        return c.json(
          { error: `Yahoo Finance has no quote for ${symbol}. Check the spelling or the exchange suffix.` },
          404,
        );
      }
      return c.json(quote);
    } catch (error) {
      return c.json({ error: `Yahoo Finance did not answer: ${failureMessage(error)}` }, 502);
    }
  })

  /**
   * OHLCV candles over a window, with warm-up history in front of it.
   *
   * Charged to the series budget on every call, as the watchlist chart is: the
   * two draw on the same bar store and the same upstream allowance.
   */
  .get("/:symbol/candles", symbolParam, zValidator("query", candleQuerySchema), async (c) => {
    const { symbol } = c.req.valid("param");
    const { range, interval } = c.req.valid("query");

    const allowed = seriesBudget.take(c.get("user").id);
    if (!allowed.ok) return refused(c, allowed.retryAfterSeconds);

    try {
      const deps = await loadSeriesDeps();
      const load = () => symbolCandles(symbol, range, interval, deps);
      // Intraday is never stored, so it is the one candle read worth a
      // short-lived cache of its own; daily reads are already answered from
      // Postgres once the tail is fresh.
      const series = seriesRange(range).intraday
        ? await detailCache.get(`candles:${symbol}:${range}`, TTL.intraday, load)
        : await load();
      return c.json({ series: series ?? null });
    } catch (error) {
      if (error instanceof BarFetchRefused) {
        return c.json({ error: error.message }, 503, { "Retry-After": "5" });
      }
      return c.json({ error: `Price history unavailable: ${failureMessage(error)}`, series: null }, 502);
    }
  })

  /**
   * The quote-summary modules, picked by what the listing is.
   *
   * The quote is read first (from cache, almost always — the page has just
   * asked for it) because a stock and an ETF want different modules, and
   * asking for both everywhere only widens what can fail. If the full set
   * fails validation upstream, the minimal one is tried before giving up.
   */
  .get("/:symbol/profile", symbolParam, async (c) => {
    const { symbol } = c.req.valid("param");
    return serve(c, `profile:${symbol}`, TTL.profile, async () => {
      const quote = await cachedQuote(symbol).catch(() => null);
      const modules = profileModules(quote?.identity.quoteType ?? null);
      try {
        const summary = await yahooFinanceClient.quoteSummary(
          symbol,
          { modules },
          yahooRequestOptions(),
        );
        return buildProfile(symbol, summary, modules);
      } catch (error) {
        if (isNotFound(error)) throw error;
        const summary = await yahooFinanceClient.quoteSummary(
          symbol,
          { modules: [...MINIMAL_MODULES] },
          yahooRequestOptions(),
        );
        return buildProfile(symbol, summary, modules);
      }
    });
  })

  .get("/:symbol/earnings", symbolParam, async (c) => {
    const { symbol } = c.req.valid("param");
    return serve(c, `earnings:${symbol}`, TTL.earnings, async () => {
      const summary = await yahooFinanceClient.quoteSummary(
        symbol,
        { modules: [...EARNINGS_MODULES] },
        yahooRequestOptions(),
      );
      return buildEarningsView(symbol, summary);
    });
  })

  .get("/:symbol/financials", symbolParam, zValidator("query", financialsQuerySchema), async (c) => {
    const { symbol } = c.req.valid("param");
    const { statement, period } = c.req.valid("query");
    return serve(c, `statement:${symbol}:${statement}:${period}`, TTL.statements, async () => {
      const rows = await yahooFinanceClient.fundamentalsTimeSeries(
        symbol,
        { period1: statementStart(period), type: period, module: STATEMENT_MODULE[statement] },
        yahooRequestOptions(),
      );
      return buildStatement(symbol, statement, period, rows);
    });
  })

  .get("/:symbol/analysis", symbolParam, async (c) => {
    const { symbol } = c.req.valid("param");
    return serve(c, `analysis:${symbol}`, TTL.analysis, async () => {
      const insights = await yahooFinanceClient.insights(
        symbol,
        { reportsCount: 5 },
        yahooRequestOptions(),
      );
      return buildAnalysis(symbol, insights);
    });
  })

  .get("/:symbol/options", symbolParam, zValidator("query", optionsQuerySchema), async (c) => {
    const { symbol } = c.req.valid("param");
    const { expiry } = c.req.valid("query");
    return serve(c, `options:${symbol}:${expiry ?? "next"}`, TTL.options, async () => {
      const result = await yahooFinanceClient.options(
        symbol,
        expiry === undefined ? {} : { date: new Date(`${expiry}T00:00:00Z`) },
        yahooRequestOptions(),
      );
      return buildOptionChain(symbol, result);
    });
  })

  .get("/:symbol/news", symbolParam, async (c) => {
    const { symbol } = c.req.valid("param");
    return serve(c, `news:${symbol}`, TTL.news, async () => {
      const result = await yahooFinanceClient.search(
        symbol,
        // A couple of quote matches are requested because Yahoo ranks news
        // against the resolved instrument; at zero the list comes back thin.
        { quotesCount: 2, newsCount: 20, enableFuzzyQuery: false },
        yahooRequestOptions(),
      );
      return { symbol, articles: buildNews(result) };
    });
  })

  /**
   * Listings Yahoo relates to this one, priced, with the reader's own stars.
   *
   * Three lifetimes, kept apart: which names are related changes slowly and is
   * cached for ten minutes; their prices are cached for thirty seconds like
   * any board; the stars are not cached at all, because they change the
   * moment the reader adds one.
   */
  .get("/:symbol/related", symbolParam, async (c) => {
    const user = c.get("user");
    const { symbol } = c.req.valid("param");
    const tracked = trackedIndex(await repo.listTrackedRefs(user.id).catch(() => []));
    const listKey = `related:${symbol}`;
    const quoteKey = `related-quotes:${symbol}`;

    if (!detailCache.has(listKey) || !detailCache.has(quoteKey)) {
      const allowed = detailBudget.take(user.id);
      if (!allowed.ok) return refused(c, allowed.retryAfterSeconds);
    }
    try {
      const symbols = (await detailCache.get(listKey, TTL.related, async () => {
        const results = await yahooFinanceClient.recommendationsBySymbol(
          symbol,
          undefined,
          yahooRequestOptions(),
        );
        return (Array.isArray(results) ? results : [results])
          .flatMap((result) => result.recommendedSymbols ?? [])
          .map((entry) => entry.symbol)
          .filter((entry) => entry.toUpperCase() !== symbol)
          .slice(0, 10);
      })) as string[];
      const quotes =
        symbols.length === 0
          ? []
          : ((await detailCache.get(quoteKey, TTL.board * 2, async () =>
              yahooFinanceClient.quote(symbols, {}, yahooRequestOptions()),
            )) as QuoteLike[]);
      const items = (Array.isArray(quotes) ? quotes : [])
        .map((quote) => ideaFromQuote(quote, "related", tracked))
        .filter((idea): idea is DiscoverIdea => idea !== null);
      return c.json({ items });
    } catch (error) {
      return c.json({ error: `Yahoo Finance did not answer: ${failureMessage(error)}`, items: [] }, 502);
    }
  })

  /**
   * Funds that hold this listing, from the local holdings index.
   *
   * No upstream and no budget: this is a query against what has already been
   * ingested, and it spans every market the index covers — the reason the
   * page can show a China QDII and a US ETF holding the same stock side by side.
   */
  .get("/:symbol/funds", symbolParam, async (c) => {
    const { symbol } = c.req.valid("param");
    const canonical = toCanonicalSymbol(symbol) ?? symbol;
    const matches = await fundRepo.findFundsByStock(canonical, { limit: 40 });
    const body: FundHolderView = {
      symbol: canonical,
      funds: matches.map((match) => ({
        ...describeFundBrief(match.fund),
        weightPercent: match.weight,
        reportDate: match.reportDate,
      })),
      note: disclosureNote(matches.map((match) => match.fund)),
    };
    return c.json(body);
  })

  /**
   * The issuer's EDGAR filings.
   *
   * A listing with no SEC registration is an answer, not an error: the tab
   * says so rather than showing a failure for something that was never going
   * to exist.
   */
  .get("/:symbol/filings", symbolParam, zValidator("query", filingsQuerySchema), async (c) => {
    const { symbol } = c.req.valid("param");
    const { form } = c.req.valid("query");
    const edgar = getEdgarClient();
    try {
      const entry = await edgar.resolveTicker(symbol);
      const { company, filings } = await edgar.fetchFilings(entry.cik, {
        ...(form !== undefined && { forms: [form] }),
        limit: 40,
      });
      const body: FilingView = {
        symbol,
        company: {
          cik: company.cik,
          name: company.name,
          industry: company.sicDescription,
          fiscalYearEnd: company.fiscalYearEnd,
        },
        filings: filings.map((filing) => ({
          form: filing.form,
          filingDate: filing.filingDate,
          reportDate: filing.reportDate,
          description: filing.description,
          items: filing.items,
          url: filing.url,
          accessionNumber: filing.accessionNumber,
        })),
        unsupported: null,
      };
      return c.json(body);
    } catch (error) {
      if (error instanceof EdgarError && error.status === undefined) {
        const body: FilingView = { symbol, company: null, filings: [], unsupported: error.message };
        return c.json(body);
      }
      return c.json({ error: `SEC EDGAR did not answer: ${failureMessage(error)}` }, 502);
    }
  })

  /**
   * Whether the reader tracks this symbol, and the tracked item if so.
   *
   * The item comes back enriched exactly as the watchlist serves it, so the
   * page can draw the reader's own levels across the chart and edit them
   * without a second notion of what a level is.
   */
  .get("/:symbol/tracking", symbolParam, async (c) => {
    const user = c.get("user");
    const { symbol } = c.req.valid("param");
    const rows = (await repo.listTrackedRefs(user.id)).filter(
      (row) => row.kind === "symbol" && row.ref.toUpperCase() === symbol,
    );
    const lists = rows.map((row) => ({ listId: row.watchlistId, listName: row.watchlistName }));
    const first = rows[0];
    if (first === undefined) return c.json({ lists, listId: null, item: null });

    const { items } = await repo.listItems(user.id, first.watchlistId, { q: symbol });
    const row = items.find((item) => item.kind === "symbol" && item.ref.toUpperCase() === symbol);
    if (row === undefined) return c.json({ lists, listId: first.watchlistId, item: null });

    const [item] = await enrichItems([row], {
      client: yahooFinanceClient,
      repo,
      bars: (await loadSeriesDeps()).bars,
    });
    return c.json({ lists, listId: first.watchlistId, item: item ?? null });
  });
