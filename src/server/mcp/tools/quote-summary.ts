import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { QuoteSummaryOptions } from "yahoo-finance2/modules/quoteSummary";
import type { YahooFinanceClient } from "../client.js";
import {
  readOnlyToolAnnotations,
  runYahooFinanceTool,
  symbolSchema,
  yahooRequestOptions,
} from "./runtime.js";

export const QUOTE_SUMMARY_MODULES = [
  "assetProfile",
  "balanceSheetHistory",
  "balanceSheetHistoryQuarterly",
  "calendarEvents",
  "cashflowStatementHistory",
  "cashflowStatementHistoryQuarterly",
  "defaultKeyStatistics",
  "earnings",
  "earningsHistory",
  "earningsTrend",
  "financialData",
  "fundOwnership",
  "fundPerformance",
  "fundProfile",
  "incomeStatementHistory",
  "incomeStatementHistoryQuarterly",
  "indexTrend",
  "industryTrend",
  "insiderHolders",
  "insiderTransactions",
  "institutionOwnership",
  "majorDirectHolders",
  "majorHoldersBreakdown",
  "netSharePurchaseActivity",
  "price",
  "quoteType",
  "recommendationTrend",
  "secFilings",
  "sectorTrend",
  "summaryDetail",
  "summaryProfile",
  "topHoldings",
  "upgradeDowngradeHistory",
] as const;

export function registerQuoteSummaryTool(server: McpServer, client: YahooFinanceClient): void {
  server.registerTool(
    "quoteSummary",
    {
      title: "Quote Summary",
      description:
        "Get selected company, price, ownership, earnings, filing, or fund summary modules for a symbol.",
      inputSchema: {
        symbol: symbolSchema,
        modules: z.array(z.enum(QUOTE_SUMMARY_MODULES)).min(1).max(16).optional(),
        formatted: z.boolean().optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ symbol, modules, formatted }) => {
      const options: QuoteSummaryOptions = {
        ...(modules !== undefined && { modules }),
        ...(formatted !== undefined && { formatted }),
      };
      return runYahooFinanceTool(() =>
        client.quoteSummary(symbol, options, yahooRequestOptions()),
      );
    },
  );
}
