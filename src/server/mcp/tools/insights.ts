import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InsightsOptions } from "yahoo-finance2/modules/insights";
import type { YahooFinanceClient } from "../client.js";
import {
  languageSchema,
  readOnlyToolAnnotations,
  regionSchema,
  runYahooFinanceTool,
  symbolSchema,
  yahooRequestOptions,
} from "./runtime.js";

export function registerInsightsTool(server: McpServer, client: YahooFinanceClient): void {
  server.registerTool(
    "insights",
    {
      title: "Analyst Insights",
      description:
        "Get analyst recommendations, research reports, significant developments, and technical outlooks.",
      inputSchema: {
        symbol: symbolSchema,
        reportsCount: z.number().int().min(0).max(10).optional(),
        region: regionSchema.optional(),
        lang: languageSchema.optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ symbol, reportsCount, region, lang }) => {
      const queryOptions: InsightsOptions = {
        ...(reportsCount !== undefined && { reportsCount }),
        ...(region !== undefined && { region }),
        ...(lang !== undefined && { lang }),
      };
      return runYahooFinanceTool(() =>
        client.insights(symbol, queryOptions, yahooRequestOptions()),
      );
    },
  );
}
