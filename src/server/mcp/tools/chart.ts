import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ChartOptionsWithReturnArray } from "yahoo-finance2/modules/chart";
import type { YahooFinanceClient } from "../client.js";
import {
  dateSchema,
  languageSchema,
  readOnlyToolAnnotations,
  runYahooFinanceTool,
  symbolSchema,
  yahooRequestOptions,
} from "./runtime.js";

const intervals = [
  "1m",
  "2m",
  "5m",
  "15m",
  "30m",
  "60m",
  "90m",
  "1h",
  "1d",
  "5d",
  "1wk",
  "1mo",
  "3mo",
] as const;

export function registerChartTool(server: McpServer, client: YahooFinanceClient): void {
  server.registerTool(
    "chart",
    {
      title: "Price Chart",
      description:
        "Get historical or intraday OHLCV data plus optional dividend, split, and earnings events.",
      inputSchema: {
        symbol: symbolSchema,
        period1: dateSchema,
        period2: dateSchema.optional(),
        interval: z.enum(intervals).optional(),
        includePrePost: z.boolean().optional(),
        events: z.string().trim().min(1).max(40).optional(),
        lang: languageSchema.optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ symbol, period1, period2, interval, includePrePost, events, lang }) => {
      const options: ChartOptionsWithReturnArray = {
        period1,
        return: "array",
        ...(period2 !== undefined && { period2 }),
        ...(interval !== undefined && { interval }),
        ...(includePrePost !== undefined && { includePrePost }),
        ...(events !== undefined && { events }),
        ...(lang !== undefined && { lang }),
      };
      return runYahooFinanceTool(() => client.chart(symbol, options, yahooRequestOptions()));
    },
  );
}
