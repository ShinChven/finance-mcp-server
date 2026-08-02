import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SearchOptions } from "yahoo-finance2/modules/search";
import type { YahooFinanceClient } from "../client.js";
import {
  languageSchema,
  readOnlyToolAnnotations,
  regionSchema,
  runYahooFinanceTool,
  yahooRequestOptions,
} from "./runtime.js";

export function registerSearchTool(server: McpServer, client: YahooFinanceClient): void {
  server.registerTool(
    "search",
    {
      title: "Search Yahoo Finance",
      description:
        "Search instruments, companies, and related news by symbol, company name, or keyword.",
      inputSchema: {
        query: z.string().trim().min(1).max(200),
        quotesCount: z.number().int().min(0).max(20).optional(),
        newsCount: z.number().int().min(0).max(20).optional(),
        region: regionSchema.optional(),
        lang: languageSchema.optional(),
        enableFuzzyQuery: z.boolean().optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ query, quotesCount, newsCount, region, lang, enableFuzzyQuery }) => {
      const options: SearchOptions = {
        ...(quotesCount !== undefined && { quotesCount }),
        ...(newsCount !== undefined && { newsCount }),
        ...(region !== undefined && { region }),
        ...(lang !== undefined && { lang }),
        ...(enableFuzzyQuery !== undefined && { enableFuzzyQuery }),
      };
      return runYahooFinanceTool(() => client.search(query, options, yahooRequestOptions()));
    },
  );
}
