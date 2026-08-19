/**
 * The US ETF provider, backed by iShares' public product screener and daily
 * holdings files.
 *
 * Two things about this source shape the implementation:
 *
 * - **There is no per-fund profile endpoint.** The screener row *is* the
 *   profile, and it arrives for the whole lineup in one request, so the
 *   provider memoizes it and serves `fetchDetails` and `fetchHoldings` from
 *   that instead of issuing a request per fund. This is why `listUniverse` is
 *   not a prerequisite for the other calls — any of them will warm the memo.
 * - **There is no NAV file worth scraping.** Daily closes come from the Yahoo
 *   client the server already keeps, which is both cheaper and better data than
 *   the published NAV history: adjusted closes carry distributions, so a
 *   `fundPerformance` total-return figure is correct without extra work.
 */

import { PROVIDERS } from "../../../../shared/funds.js";
import type { YahooFinanceClient } from "../../../mcp/client.js";
import type {
  FundDetails,
  FundProvider,
  HoldingsResult,
  NavPoint,
  UniverseEntry,
} from "../../provider.js";
import { getIsharesClient, type IsharesClient } from "./client.js";
import {
  fundSizeToMillions,
  looksLikeIndexFund,
  looksLikeOffshoreMandate,
  trackingIndexFromName,
} from "./classify.js";
import type { IsharesProduct } from "./parse.js";
import { totalDrops } from "./parse.js";
import { isharesScopeFilter } from "./scope.js";

/** How long the screener snapshot is reused. The lineup changes a few times a
 *  year; a run that walks 400 funds should not refetch it 400 times. */
const PRODUCTS_TTL_MS = 60 * 60 * 1000;

/** Days of daily closes to keep, matching the depth the China NAV fetch pulls. */
const NAV_WINDOW_DAYS = 180;

interface YahooChartQuote {
  date: Date;
  close: number | null;
  adjclose?: number | null;
}

export interface IsharesProviderOptions {
  client?: IsharesClient;
  yahoo: YahooFinanceClient;
  now?: () => number;
}

export function createIsharesProvider(options: IsharesProviderOptions): FundProvider {
  const client = options.client ?? getIsharesClient();
  const now = options.now ?? (() => Date.now());

  let products: Map<string, IsharesProduct> | null = null;
  let loadedAt = 0;
  let inFlight: Promise<Map<string, IsharesProduct>> | null = null;

  async function loadProducts(): Promise<Map<string, IsharesProduct>> {
    if (products !== null && now() - loadedAt < PRODUCTS_TTL_MS) return products;
    // De-duplicated the same way the on-demand fund cache is: the first caller
    // to find the memo cold does the fetch, everyone else waits on it.
    inFlight ??= (async () => {
      const list = await client.fetchProducts();
      products = new Map(list.map((product) => [product.ticker, product]));
      loadedAt = now();
      return products;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function productFor(code: string): Promise<IsharesProduct> {
    const found = (await loadProducts()).get(code.toUpperCase());
    if (found === undefined) {
      throw new Error(`${code} is not in the iShares US lineup`);
    }
    return found;
  }

  const today = (): string => new Date(now()).toISOString().slice(0, 10);

  return {
    id: "ishares",
    descriptor: PROVIDERS.ishares,
    requestIntervalMs: 500,
    // The screener is amortized across the whole run and NAV comes from the
    // Yahoo client's own queue, so a fund costs one holdings download.
    requestsPerFund: 1,

    async listUniverse(): Promise<UniverseEntry[]> {
      const list = [...(await loadProducts()).values()];
      return list.map((product) => ({
        code: product.ticker,
        name: product.name,
        fundType: product.assetClass,
        isIndexFund: looksLikeIndexFund(product),
        investsOffshore: looksLikeOffshoreMandate(product),
        providerMeta: {
          productId: product.productId,
          ...(product.productPageUrl !== null ? { productPageUrl: product.productPageUrl } : {}),
          ...(product.subAssetClass !== null ? { subAssetClass: product.subAssetClass } : {}),
          ...(product.country !== null ? { country: product.country } : {}),
        },
      }));
    },

    async fetchDetails(code: string): Promise<FundDetails> {
      const product = await productFor(code);
      return {
        name: product.name,
        fundType: product.assetClass,
        trackingIndex: trackingIndexFromName(product.name),
        company: "BlackRock",
        manager: null,
        feeRate: null,
        fundSize: fundSizeToMillions(product.totalNetAssets),
        // The fund's own listing is a tradable symbol in the same key space its
        // holdings use, so the watchlist and the Yahoo tools can address it.
        listedSymbol: product.ticker,
        isIndexFund: looksLikeIndexFund(product),
        investsOffshore: looksLikeOffshoreMandate(product),
        providerMeta: {
          productId: product.productId,
          ...(product.productPageUrl !== null ? { productPageUrl: product.productPageUrl } : {}),
        },
      };
    },

    async fetchHoldings(code: string): Promise<HoldingsResult> {
      const product = await productFor(code);
      const { entries, stats } = await client.fetchHoldings(product, today());
      const dropped = totalDrops(stats);
      return {
        entries,
        dropped,
        ...(dropped > 0
          ? {
              dropReason:
                `no ticker ${stats.noTicker}, unmapped exchange ${stats.unmappedExchange}, ` +
                `ambiguous exchange ${stats.ambiguousExchange}, no weight ${stats.noWeight}`,
            }
          : {}),
      };
    },

    async fetchNav(code: string): Promise<NavPoint[]> {
      const period1 = new Date(now() - NAV_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const chart = (await options.yahoo.chart(code, { period1, interval: "1d" })) as {
        quotes?: YahooChartQuote[];
      };
      const quotes = (chart.quotes ?? []).filter((quote) => quote.close !== null);

      return quotes.map((quote, index) => {
        const previous = quotes[index - 1]?.close ?? null;
        const close = quote.close;
        return {
          navDate: quote.date.toISOString().slice(0, 10),
          nav: close,
          // Adjusted close carries distributions, so this column is a true
          // total-return series rather than price alone.
          accNav: quote.adjclose ?? close,
          dailyReturn:
            previous !== null && previous !== 0 && close !== null
              ? Math.round((close / previous - 1) * 1e6) / 1e4
              : null,
        };
      });
    },

    scopeFilter: isharesScopeFilter,
  };
}
