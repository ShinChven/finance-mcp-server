import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLazyFundRepo, type FundRepo } from "../china/repo.js";
import type { McpAuth } from "../lib/http.js";
import { getEdgarClient, type EdgarClient } from "../sec/edgar.js";
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
import { registerTrendingSymbolsTool } from "./tools/trending-symbols.js";
import { registerWhoamiTool } from "./tools/whoami.js";

/**
 * Builds a per-request MCP server while reusing the process-level Yahoo client.
 * Pass `auth: null` to build a metadata-only server for tool introspection.
 */
export function buildMcpServer(
  auth: McpAuth | null,
  client: YahooFinanceClient = yahooFinanceClient,
  repo: FundRepo = createLazyFundRepo(),
  edgar: EdgarClient = getEdgarClient(),
): McpServer {
  const server = new McpServer(
    { name: "finance-mcp-server", version: "0.1.0" },
    {
      instructions:
        "Three tool families. Yahoo Finance tools return global market data for stocks, ETFs, and indices " +
        "(CN and HK listings included, via suffixes like 600519.SS and 0700.HK); search for a symbol first " +
        "when it is uncertain, and expect delayed or missing data for delisted symbols. " +
        "Fund relationship tools (fundExposure, fundsByStock, fundsBySector, similarFunds, themeToFunds, " +
        "compareFunds, fundPerformance) answer which China public fund gives exposure to a stock, sector, or theme. They read " +
        "a locally ingested index of disclosed holdings — prefer them over keyword search, because fund names " +
        "do not describe their portfolios. " +
        "Earnings tools cover company reporting: earningsAnalysis works for any Yahoo-covered symbol and is " +
        "the fastest way to see surprises, estimate revisions, and the next report date; secFilings and " +
        "secFinancials read SEC EDGAR directly and are the right choice for US issuers when you need " +
        "as-reported figures, restatement-accurate history, or a citable filing URL.",
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

  registerFundExposureTool(server, repo);
  registerFundsByStockTool(server, repo);
  registerFundsBySectorTool(server, repo);
  registerSimilarFundsTool(server, repo);
  registerThemeToFundsTool(server, repo);
  registerCompareFundsTool(server, repo);
  registerFundPerformanceTool(server, repo);

  return server;
}
