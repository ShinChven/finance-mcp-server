import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  QuoteOptions,
  QuoteOptionsWithReturnArray,
} from "yahoo-finance2/modules/quote";
import type { YahooFinanceClient } from "../client.js";
import {
  languageSchema,
  readOnlyToolAnnotations,
  regionSchema,
  runYahooFinanceTool,
  symbolSchema,
  symbolsSchema,
  yahooRequestOptions,
} from "./runtime.js";

export function registerQuoteTool(server: McpServer, client: YahooFinanceClient): void {
  server.registerTool(
    "quote",
    {
      title: "Market Quote",
      description: "Get real-time or near-real-time quote data for one or more symbols.",
      inputSchema: {
        query: z.union([symbolSchema, symbolsSchema]),
        fields: z.array(z.string().trim().min(1).max(80)).min(1).max(50).optional(),
        region: regionSchema.optional(),
        lang: languageSchema.optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ query, fields, region, lang }) => {
      const options: QuoteOptionsWithReturnArray = {
        ...(fields !== undefined && { fields: fields as QuoteOptions["fields"] }),
        ...(region !== undefined && { region }),
        ...(lang !== undefined && { lang }),
      };
      const operation = Array.isArray(query)
        ? () => client.quote(query, options, yahooRequestOptions())
        : () => client.quote(query, options, yahooRequestOptions());
      return runYahooFinanceTool(operation);
    },
  );
}
