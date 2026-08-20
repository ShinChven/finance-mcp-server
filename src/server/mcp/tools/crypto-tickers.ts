import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CoinGeckoClient } from "../../crypto/coingecko.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";

/** One request covers the top slice; `q` then filters it without a second call. */
const SEARCH_PAGE_SIZE = 250;

/**
 * The crypto universe, which Yahoo does not publish.
 *
 * Prices are not this tool's job: `quote` and `chart` already cover crypto
 * through Yahoo's `BTC-USD` pair symbols, which is why every row carries the
 * `yahooSymbol` to chain into them. What is missing upstream is the directory —
 * which assets exist, what their tickers are, and how large they are — and that
 * is all this returns.
 */
export function registerCryptoTickersTool(server: McpServer, client: CoinGeckoClient): void {
  server.registerTool(
    "cryptoTickers",
    {
      title: "Crypto Tickers",
      description:
        "List tradable cryptocurrencies ranked by market capitalisation, with ticker, name, " +
        "current price, 24h change, and the Yahoo Finance symbol for each. Use it to discover " +
        "what exists or to resolve a coin name to a symbol, then pass `yahooSymbol` to `quote` " +
        "for a live price or `chart` for history — this tool does not do price history. " +
        "Set `q` to search the top few hundred assets by name, ticker, or id.",
      inputSchema: {
        q: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .optional()
          .describe('Filter by name, ticker or CoinGecko id, e.g. "solana" or "SOL".'),
        count: z.number().int().min(1).max(100).optional(),
        page: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Page of the market-cap ranking. Ignored when `q` is set."),
        vsCurrency: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{2,8}$/, "must be a currency code")
          .transform((value) => value.toLowerCase())
          .optional()
          .describe('Currency to price in, default "usd".'),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ q, count, page, vsCurrency }) =>
      runTool(async () => {
        const currency = vsCurrency ?? "usd";
        const limit = count ?? 25;
        // A filtered request scans the top slice locally; an unfiltered one
        // pages the ranking directly, so neither costs more than one request.
        const requestedPage = q === undefined ? (page ?? 1) : 1;
        const assets = await client.fetchMarkets({
          vsCurrency: currency,
          perPage: q === undefined ? limit : SEARCH_PAGE_SIZE,
          page: requestedPage,
        });

        const matched =
          q === undefined
            ? assets
            : assets.filter((asset) => {
                const needle = q.toLowerCase();
                return (
                  asset.id.toLowerCase().includes(needle) ||
                  asset.symbol.toLowerCase().includes(needle) ||
                  asset.name.toLowerCase().includes(needle)
                );
              });

        return {
          vsCurrency: currency,
          page: requestedPage,
          matched: matched.length,
          assets: matched.slice(0, limit),
          note:
            "Ranked by market capitalisation from CoinGecko's free tier. `yahooSymbol` follows " +
            "Yahoo's <TICKER>-<CURRENCY> convention and is a suggestion, not a listing check — " +
            "thin assets may have no Yahoo pair. " +
            (q === undefined
              ? "Use `page` to walk further down the ranking."
              : `Searched the top ${SEARCH_PAGE_SIZE} assets by market cap.`),
        };
      }),
  );
}
