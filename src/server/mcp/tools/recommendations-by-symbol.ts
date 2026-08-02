import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YahooFinanceClient } from "../client.js";
import {
  readOnlyToolAnnotations,
  runYahooFinanceTool,
  symbolSchema,
  symbolsSchema,
  yahooRequestOptions,
} from "./runtime.js";

export function registerRecommendationsBySymbolTool(
  server: McpServer,
  client: YahooFinanceClient,
): void {
  server.registerTool(
    "recommendationsBySymbol",
    {
      title: "Related Symbols",
      description: "Find related and similar stocks for one or more symbols.",
      inputSchema: { query: z.union([symbolSchema, symbolsSchema]) },
      annotations: readOnlyToolAnnotations,
    },
    async ({ query }) =>
      runYahooFinanceTool(() =>
        client.recommendationsBySymbol(query, undefined, yahooRequestOptions()),
      ),
  );
}
