import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SearchNews, SearchOptions } from "yahoo-finance2/modules/search";
import type { YahooFinanceClient } from "../client.js";
import {
  languageSchema,
  readOnlyToolAnnotations,
  regionSchema,
  runYahooFinanceTool,
  yahooRequestOptions,
} from "./runtime.js";

/**
 * Headlines for one company, from the free Yahoo endpoint.
 *
 * `search` already carries a `news` array, but it arrives buried next to quote
 * matches and its ranking is driven by the instrument lookup — so asking for
 * news through it means paying for symbol resolution and then digging. This
 * asks for news only, normalizes the timestamps, and drops the thumbnail
 * payloads, which are the bulk of the bytes and of no use to a reader.
 */
export function registerCompanyNewsTool(server: McpServer, client: YahooFinanceClient): void {
  server.registerTool(
    "companyNews",
    {
      title: "Company News",
      description:
        "Recent news headlines for a company, symbol, or topic, newest first, with publisher, " +
        "publication time and article URL. Accepts a symbol (\"AAPL\", \"0700.HK\") or a plain " +
        "name (\"Nvidia\"). Filter to a window with `since`. For the filings behind a story use " +
        "`secFilings`; for analyst commentary use `insights`.",
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('Symbol, company name, or keyword, e.g. "NVDA" or "semiconductor export".'),
        count: z.number().int().min(1).max(30).optional(),
        since: z
          .string()
          .trim()
          .min(1)
          .refine((value) => !Number.isNaN(Date.parse(value)), "must be a valid date string")
          .optional()
          .describe("Drop articles published before this ISO date."),
        region: regionSchema.optional(),
        lang: languageSchema.optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ query, count, since, region, lang }) => {
      const limit = count ?? 10;
      const options: SearchOptions = {
        // Yahoo ranks news against the resolved instrument, so a couple of
        // quote matches are requested: at zero the news list comes back thin.
        quotesCount: 2,
        newsCount: limit,
        ...(region !== undefined && { region }),
        ...(lang !== undefined && { lang }),
      };

      return runYahooFinanceTool(async () => {
        const result = await client.search(query, options, yahooRequestOptions());
        const cutoff = since === undefined ? null : Date.parse(since);

        const articles = result.news
          .map((item: SearchNews) => ({
            uuid: item.uuid,
            title: item.title,
            publisher: item.publisher,
            link: item.link,
            publishedAt: item.providerPublishTime.toISOString(),
            type: item.type,
            relatedTickers: item.relatedTickers ?? [],
          }))
          .filter((article) => cutoff === null || Date.parse(article.publishedAt) >= cutoff)
          .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

        return {
          query,
          // What Yahoo thought the query meant, so a caller can tell "Apple"
          // resolved to AAPL rather than to something else named Apple.
          resolvedSymbols: result.quotes
            .map((quote) => (typeof quote["symbol"] === "string" ? quote["symbol"] : null))
            .filter((symbol): symbol is string => symbol !== null),
          count: articles.length,
          articles,
        };
      });
    },
  );
}
