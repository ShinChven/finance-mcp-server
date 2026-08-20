import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLazyFundCache, type FundCache } from "../funds/ondemand.js";
import { createLazyFundRepo, type FundRepo } from "../funds/repo.js";
import { getCoinGeckoClient, type CoinGeckoClient } from "../crypto/coingecko.js";
import type { McpAuth } from "../lib/http.js";
import { createLazyNotesRepo, type NotesRepo } from "../notes/repo.js";
import { getEdgarClient, type EdgarClient } from "../sec/edgar.js";
import { createLazyWatchlistRepo, type WatchlistRepo } from "../watchlist/repo.js";
import { yahooFinanceClient, type YahooFinanceClient } from "./client.js";
import { registerCompareFundsTool } from "./tools/compare-funds.js";
import { registerFundExposureTool } from "./tools/fund-exposure.js";
import { registerFundPerformanceTool } from "./tools/fund-performance.js";
import { registerFundsByHoldingsTool } from "./tools/funds-by-holdings.js";
import { registerFundsBySectorTool } from "./tools/funds-by-sector.js";
import { registerFundsByStockTool } from "./tools/funds-by-stock.js";
import { registerSimilarFundsTool } from "./tools/similar-funds.js";
import { registerThemeToFundsTool } from "./tools/theme-to-funds.js";
import { registerChartTool } from "./tools/chart.js";
import { registerCompanyNewsTool } from "./tools/company-news.js";
import { registerCryptoTickersTool } from "./tools/crypto-tickers.js";
import { registerEarningsAnalysisTool } from "./tools/earnings-analysis.js";
import { registerFundamentalsTimeSeriesTool } from "./tools/fundamentals-time-series.js";
import { registerInsightsTool } from "./tools/insights.js";
import { registerOptionsTool } from "./tools/options.js";
import { registerQuoteSummaryTool } from "./tools/quote-summary.js";
import { registerQuoteTool } from "./tools/quote.js";
import { registerRecommendationsBySymbolTool } from "./tools/recommendations-by-symbol.js";
import { registerScreenerTool } from "./tools/screener.js";
import { registerSearchTool } from "./tools/search.js";
import { registerSecFilingsTool } from "./tools/sec-filings.js";
import { registerSecFinancialsTool } from "./tools/sec-financials.js";
import { registerNoteCollectionsTool } from "./tools/note-collections.js";
import { registerNoteCreateTool } from "./tools/note-create.js";
import { registerNoteDeleteTool } from "./tools/note-delete.js";
import { registerNoteReadTool } from "./tools/note-read.js";
import { registerNoteUpdateTool } from "./tools/note-update.js";
import { registerNotesSearchTool } from "./tools/notes-search.js";
import { registerWatchlistTool } from "./tools/watchlist.js";
import { registerWatchlistAddTool } from "./tools/watchlist-add.js";
import { registerWatchlistRemoveTool } from "./tools/watchlist-remove.js";
import { registerWatchlistsTool } from "./tools/watchlists.js";
import { registerTrendingSymbolsTool } from "./tools/trending-symbols.js";
import { registerWhoamiTool } from "./tools/whoami.js";

/**
 * Injectable dependencies. An object rather than positional parameters: every
 * new data source added one more argument that every call site had to skip
 * past, and tests only ever override one of them.
 */
export interface McpDeps {
  client?: YahooFinanceClient;
  funds?: FundRepo;
  /** Fetches a fund on first touch; see `funds/ondemand.ts`. */
  fundCache?: FundCache;
  edgar?: EdgarClient;
  crypto?: CoinGeckoClient;
  watchlists?: WatchlistRepo;
  notes?: NotesRepo;
}

/**
 * Builds a per-request MCP server while reusing the process-level Yahoo client.
 * Pass `auth: null` to build a metadata-only server for tool introspection —
 * the watchlist and note tools refuse to run without an identity.
 */
export function buildMcpServer(auth: McpAuth | null, deps: McpDeps = {}): McpServer {
  const client = deps.client ?? yahooFinanceClient;
  const repo = deps.funds ?? createLazyFundRepo();
  const fundCache = deps.fundCache ?? createLazyFundCache();
  const edgar = deps.edgar ?? getEdgarClient();
  const crypto = deps.crypto ?? getCoinGeckoClient();
  const watchlists = deps.watchlists ?? createLazyWatchlistRepo();
  const notes = deps.notes ?? createLazyNotesRepo();

  const server = new McpServer(
    { name: "finance-mcp-server", version: "0.1.0" },
    {
      instructions:
        "Five tool families. Yahoo Finance tools return global market data for stocks, ETFs, and indices " +
        "(CN and HK listings included, via suffixes like 600519.SS and 0700.HK); search for a symbol first " +
        "when it is uncertain, and expect delayed or missing data for delisted symbols. companyNews is the " +
        "one to reach for when the question is what happened rather than what a number is. Crypto is priced " +
        "by the same quote and chart tools through pair symbols like BTC-USD; cryptoTickers exists only " +
        "because Yahoo publishes no directory, so use it to discover assets or resolve a coin name to a " +
        "symbol. " +
        "Fund relationship tools (fundExposure, fundsByStock, fundsBySector, fundsByHoldings, similarFunds, " +
        "themeToFunds, compareFunds, fundPerformance) answer which fund gives exposure to a stock, sector, " +
        "or theme. fundsByHoldings is the one that combines criteria — company size, country, an explicit " +
        "basket — because instrument attributes from Yahoo are cached next to the holdings. They " +
        "read a locally ingested index of disclosed holdings that spans markets — China public funds and US " +
        "ETFs are in one index, so fundsByStock('NVDA') returns both, and every result says which market the " +
        "fund trades in. Prefer them over keyword search, because fund names do not describe their " +
        "portfolios. Funds are addressed by code: 6 digits for China (162411), the ticker elsewhere (IVV). " +
        "Mind the `holdingsCompleteness` field before comparing weights across funds — a top_holdings fund " +
        "discloses only its largest positions, a full one publishes its whole book. " +
        "Earnings tools cover company reporting: earningsAnalysis works for any Yahoo-covered symbol and is " +
        "the fastest way to see surprises, estimate revisions, and the next report date; secFilings and " +
        "secFinancials read SEC EDGAR directly and are the right choice for US issuers when you need " +
        "as-reported figures, restatement-accurate history, or a citable filing URL. " +
        "Watchlist tools (watchlists, watchlist, watchlistAdd, watchlistRemove) read and edit the " +
        "signed-in user's own saved lists, which span both families — Yahoo symbols and fund " +
        "codes in one list — and are shared with the web dashboard. Read a watchlist before answering " +
        "questions about what this user is tracking, rather than assuming from the conversation. " +
        "Note tools (noteCollections, notesSearch, noteRead, noteCreate, noteUpdate, noteDelete) are " +
        "this user's long-term memory: theses, decisions and context saved out of earlier " +
        "conversations, organized in collections, tagged, and linked to the symbols they are about. " +
        "Search them before answering anything about what the user already thinks, decided or was " +
        "told — a note beats a guess from the current conversation. notesSearch returns summaries and " +
        "snippets; call noteRead for the bodies you actually need. When a conversation produces a " +
        "conclusion worth keeping, save it with noteCreate and write a real summary, because that is " +
        "what future searches will show. The same notes are readable and editable on the dashboard.",
    },
  );

  registerWhoamiTool(server, auth);
  registerSearchTool(server, client);
  registerCompanyNewsTool(server, client);
  registerQuoteTool(server, client);
  registerQuoteSummaryTool(server, client);
  registerChartTool(server, client);
  registerScreenerTool(server, client);
  registerTrendingSymbolsTool(server, client);
  registerOptionsTool(server, client);
  registerInsightsTool(server, client);
  registerRecommendationsBySymbolTool(server, client);
  registerFundamentalsTimeSeriesTool(server, client);
  registerEarningsAnalysisTool(server, client);
  registerCryptoTickersTool(server, crypto);

  registerSecFilingsTool(server, edgar);
  registerSecFinancialsTool(server, edgar);

  registerWatchlistsTool(server, watchlists, auth);
  registerWatchlistTool(server, watchlists, client, auth);
  registerWatchlistAddTool(server, watchlists, auth);
  registerWatchlistRemoveTool(server, watchlists, auth);

  registerNoteCollectionsTool(server, notes, auth);
  registerNotesSearchTool(server, notes, auth);
  registerNoteReadTool(server, notes, auth);
  registerNoteCreateTool(server, notes, auth);
  registerNoteUpdateTool(server, notes, auth);
  registerNoteDeleteTool(server, notes, auth);

  registerFundExposureTool(server, repo, fundCache);
  registerFundsByStockTool(server, repo);
  registerFundsBySectorTool(server, repo);
  registerFundsByHoldingsTool(server, repo);
  registerSimilarFundsTool(server, repo, fundCache);
  registerThemeToFundsTool(server, repo);
  registerCompareFundsTool(server, repo);
  registerFundPerformanceTool(server, repo, fundCache);

  return server;
}
