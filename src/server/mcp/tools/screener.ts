import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  PredefinedScreenerModules,
  ScreenerOptions,
} from "yahoo-finance2/modules/screener";
import type { YahooFinanceClient } from "../client.js";
import {
  languageSchema,
  readOnlyToolAnnotations,
  regionSchema,
  runYahooFinanceTool,
  yahooRequestOptions,
} from "./runtime.js";

export const SCREENER_IDS = [
  "aggressive_small_caps",
  "conservative_foreign_funds",
  "day_gainers",
  "day_losers",
  "growth_technology_stocks",
  "high_yield_bond",
  "most_actives",
  "most_shorted_stocks",
  "portfolio_anchors",
  "small_cap_gainers",
  "solid_large_growth_funds",
  "solid_midcap_growth_funds",
  "top_mutual_funds",
  "undervalued_growth_stocks",
  "undervalued_large_caps",
] as const satisfies readonly PredefinedScreenerModules[];

export function registerScreenerTool(server: McpServer, client: YahooFinanceClient): void {
  server.registerTool(
    "screener",
    {
      title: "Market Screener",
      description:
        "Run a predefined Yahoo Finance screener such as day gainers, day losers, or most active symbols.",
      inputSchema: {
        scrId: z.enum(SCREENER_IDS),
        count: z.number().int().min(1).max(50).optional(),
        start: z.number().int().min(0).max(500).optional(),
        region: regionSchema.optional(),
        lang: languageSchema.optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ scrId, count, start, region, lang }) => {
      const options: ScreenerOptions = {
        scrIds: scrId,
        ...(count !== undefined && { count }),
        ...(start !== undefined && { start }),
        ...(region !== undefined && { region }),
        ...(lang !== undefined && { lang }),
      };
      return runYahooFinanceTool(() =>
        client.screener(scrId, options, yahooRequestOptions()),
      );
    },
  );
}
