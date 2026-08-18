import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLazyFundRepo, type FundRepo } from "../china/repo.js";
import type { McpAuth } from "../lib/http.js";
import { getEdgarClient, type EdgarClient } from "../sec/edgar.js";
import { createLazyWatchlistRepo, type WatchlistRepo } from "../watchlist/repo.js";
import { yahooFinanceClient, type YahooFinanceClient } from "./client.js";
import { registerCompareFundsTool } from "./tools/compare-funds.js";
import { registerFundExposureTool } from "./tools/fund-exposure.js";
import { registerFundPerformanceTool } from "./tools/fund-performance.js";
import { registerFundsBySectorTool } from "./tools/funds-by-sector.js";
import { registerFundsByStockTool } from "./tools/funds-by-stock.js";
import { registerSimilarFundsTool } from "./tools/similar-funds.js";
import { registerThemeToFundsTool } from "./tools/theme-to-funds.js";
import { registerChartTool } from "./tools/chart.js";
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
  edgar?: EdgarClient;
  watchlists?: WatchlistRepo;
}

/**
 * Builds a per-request MCP server while reusing the process-level Yahoo client.
 * Pass `auth: null` to build a metadata-only server for tool introspection —
 * the watchlist tools refuse to run without an identity.
 */
export function buildMcpServer(auth: McpAuth | null, deps: McpDeps = {}): McpServer {
  const client = deps.client ?? yahooFinanceClient;
  const repo = deps.funds ?? createLazyFundRepo();
  const edgar = deps.edgar ?? getEdgarClient();
  const watchlists = deps.watchlists ?? createLazyWatchlistRepo();

  const server = new McpServer(
    { name: "finance-mcp-server", version: "0.1.0" },
    {
      instructions:
        "Four tool families. Yahoo Finance tools return global market data for stocks, ETFs, and indices " +
        "(CN and HK listings included, via suffixes like 600519.SS and 0700.HK); search for a symbol first " +
        "when it is uncertain, and expect delayed or missing data for delisted symbols. " +
        "Fund relationship tools (fundExposure, fundsByStock, fundsBySector, similarFunds, themeToFunds, " +
        "compareFunds, fundPerformance) answer which China public fund gives exposure to a stock, sector, or theme. They read " +
        "a locally ingested index of disclosed holdings — prefer them over keyword search, because fund names " +
        "do not describe their portfolios. " +
        "Earnings tools cover company reporting: earningsAnalysis works for any Yahoo-covered symbol and is " +
        "the fastest way to see surprises, estimate revisions, and the next report date; secFilings and " +
        "secFinancials read SEC EDGAR directly and are the right choice for US issuers when you need " +
        "as-reported figures, restatement-accurate history, or a citable filing URL. " +
        "Watchlist tools (watchlists, watchlist, watchlistAdd, watchlistRemove) read and edit the " +
        "signed-in user's own saved lists, which span both families — Yahoo symbols and China fund " +
        "codes in one list — and are shared with the web dashboard. Read a watchlist before answering " +
        "questions about what this user is tracking, rather than assuming from the conversation.",
    },
  );

  registerWhoamiTool(server, auth);
  registerSearchTool(server, client);
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

  registerSecFilingsTool(server, edgar);
  registerSecFinancialsTool(server, edgar);

  registerWatchlistsTool(server, watchlists, auth);
  registerWatchlistTool(server, watchlists, client, auth);
  registerWatchlistAddTool(server, watchlists, auth);
  registerWatchlistRemoveTool(server, watchlists, auth);

  registerFundExposureTool(server, repo);
  registerFundsByStockTool(server, repo);
  registerFundsBySectorTool(server, repo);
  registerSimilarFundsTool(server, repo);
  registerThemeToFundsTool(server, repo);
  registerCompareFundsTool(server, repo);
  registerFundPerformanceTool(server, repo);

  return server;
}
