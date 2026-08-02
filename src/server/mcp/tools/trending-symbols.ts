import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TrendingSymbolsOptions } from "yahoo-finance2/modules/trendingSymbols";
import type { YahooFinanceClient } from "../client.js";
import {
  languageSchema,
  readOnlyToolAnnotations,
  regionSchema,
  runYahooFinanceTool,
  yahooRequestOptions,
} from "./runtime.js";

export function registerTrendingSymbolsTool(
  server: McpServer,
  client: YahooFinanceClient,
): void {
  server.registerTool(
    "trendingSymbols",
    {
      title: "Trending Symbols",
      description: "Get symbols currently trending in a geographic market.",
      inputSchema: {
        region: regionSchema,
        count: z.number().int().min(1).max(50).optional(),
        lang: languageSchema.optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ region, count, lang }) => {
      const options: TrendingSymbolsOptions = {
        region,
        ...(count !== undefined && { count }),
        ...(lang !== undefined && { lang }),
      };
      return runYahooFinanceTool(() =>
        client.trendingSymbols(region, options, yahooRequestOptions()),
      );
    },
  );
}
