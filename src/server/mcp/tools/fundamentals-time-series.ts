import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FundamentalsTimeSeriesOptions } from "yahoo-finance2/modules/fundamentalsTimeSeries";
import type { YahooFinanceClient } from "../client.js";
import {
  dateSchema,
  languageSchema,
  readOnlyToolAnnotations,
  regionSchema,
  runYahooFinanceTool,
  symbolSchema,
  yahooRequestOptions,
} from "./runtime.js";

const statementTypes = ["quarterly", "annual", "trailing"] as const;
const statementModules = ["financials", "balance-sheet", "cash-flow", "all"] as const;

export function registerFundamentalsTimeSeriesTool(
  server: McpServer,
  client: YahooFinanceClient,
): void {
  server.registerTool(
    "fundamentalsTimeSeries",
    {
      title: "Fundamentals Time Series",
      description:
        "Get annual, quarterly, or trailing income statement, balance sheet, and cash flow data over time.",
      inputSchema: {
        symbol: symbolSchema,
        period1: dateSchema,
        period2: dateSchema.optional(),
        type: z.enum(statementTypes).optional(),
        module: z.enum(statementModules),
        merge: z.boolean().optional(),
        padTimeSeries: z.boolean().optional(),
        region: regionSchema.optional(),
        lang: languageSchema.optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({
      symbol,
      period1,
      period2,
      type,
      module,
      merge,
      padTimeSeries,
      region,
      lang,
    }) => {
      const queryOptions: FundamentalsTimeSeriesOptions = {
        period1,
        module,
        ...(period2 !== undefined && { period2 }),
        ...(type !== undefined && { type }),
        ...(merge !== undefined && { merge }),
        ...(padTimeSeries !== undefined && { padTimeSeries }),
        ...(region !== undefined && { region }),
        ...(lang !== undefined && { lang }),
      };
      return runYahooFinanceTool(() =>
        client.fundamentalsTimeSeries(symbol, queryOptions, yahooRequestOptions()),
      );
    },
  );
}
