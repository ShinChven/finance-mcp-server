import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuth } from "../lib/http.js";
import { yahooFinanceClient, type YahooFinanceClient } from "./client.js";
import { registerChartTool } from "./tools/chart.js";
import { registerFundamentalsTimeSeriesTool } from "./tools/fundamentals-time-series.js";
import { registerInsightsTool } from "./tools/insights.js";
import { registerOptionsTool } from "./tools/options.js";
import { registerQuoteSummaryTool } from "./tools/quote-summary.js";
import { registerQuoteTool } from "./tools/quote.js";
import { registerRecommendationsBySymbolTool } from "./tools/recommendations-by-symbol.js";
import { registerScreenerTool } from "./tools/screener.js";
import { registerSearchTool } from "./tools/search.js";
import { registerTrendingSymbolsTool } from "./tools/trending-symbols.js";
import { registerWhoamiTool } from "./tools/whoami.js";

/**
 * Builds a per-request MCP server while reusing the process-level Yahoo client.
 * Pass `auth: null` to build a metadata-only server for tool introspection.
 */
export function buildMcpServer(
  auth: McpAuth | null,
  client: YahooFinanceClient = yahooFinanceClient,
): McpServer {
  const server = new McpServer(
    { name: "finance-mcp-server", version: "0.1.0" },
    {
      instructions:
        "Use these read-only tools to retrieve Yahoo Finance market data. Search for a symbol first when it is uncertain. Data may be delayed, unavailable, or removed for delisted symbols.",
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

  return server;
}
