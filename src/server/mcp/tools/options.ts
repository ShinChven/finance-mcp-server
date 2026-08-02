import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OptionsOptions } from "yahoo-finance2/modules/options";
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

export function registerOptionsTool(server: McpServer, client: YahooFinanceClient): void {
  server.registerTool(
    "options",
    {
      title: "Options Chain",
      description:
        "Get an options chain, including expiration dates, calls, puts, strikes, prices, and open interest.",
      inputSchema: {
        symbol: symbolSchema,
        date: dateSchema.optional(),
        formatted: z.boolean().optional(),
        region: regionSchema.optional(),
        lang: languageSchema.optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ symbol, date, formatted, region, lang }) => {
      const queryOptions: OptionsOptions = {
        ...(date !== undefined && { date }),
        ...(formatted !== undefined && { formatted }),
        ...(region !== undefined && { region }),
        ...(lang !== undefined && { lang }),
      };
      return runYahooFinanceTool(() =>
        client.options(symbol, queryOptions, yahooRequestOptions()),
      );
    },
  );
}
