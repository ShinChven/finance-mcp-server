/**
 * Thin fetch layer over the CoinGecko public API.
 *
 * Yahoo already prices any crypto you can name (`BTC-USD` works in `quote` and
 * `chart`), but it has no endpoint that enumerates the universe — so discovery
 * ("what is tradable", "the twenty largest by market cap", "what is the ticker
 * for Polkadot") needs a second source. CoinGecko's public tier answers that
 * without an API key, which keeps every upstream in this server free.
 *
 * That tier is rate-limited to a handful of requests per minute, so responses
 * are cached by URL for minutes rather than seconds: a burst of tool calls
 * about the same market must not spend the budget. Mirrors `sec/edgar.ts` —
 * HTTP, throttling and caching here, shape knowledge in `parse()` below.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const MARKETS_TTL_MS = 5 * 60 * 1_000;
/** One entry per (currency, page, ordering); a handful covers normal use. */
const MAX_CACHED_PAGES = 12;

export const DEFAULT_BASE_URL = "https://api.coingecko.com/api/v3";

export type Fetcher = typeof globalThis.fetch;

export interface CoinGeckoClientOptions {
  fetchImpl?: Fetcher;
  baseUrl?: string;
  /**
   * Optional demo key. The endpoints used here work without one; a key only
   * raises the rate limit, so nothing in this server depends on it.
   */
  apiKey?: string;
  minIntervalMs?: number;
}

export interface MarketsQuery {
  /** Fiat or crypto to price in, lowercase, e.g. "usd". */
  vsCurrency: string;
  perPage: number;
  page: number;
  /** CoinGecko ids to restrict to, e.g. ["bitcoin", "ethereum"]. */
  ids?: readonly string[];
}

/** One asset, reduced to the fields a tool answer actually uses. */
export interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  /** Yahoo Finance symbol for the same asset, so results chain into `quote`. */
  yahooSymbol: string;
  price: number | null;
  marketCap: number | null;
  marketCapRank: number | null;
  volume24h: number | null;
  change24hPct: number | null;
  lastUpdated: string | null;
}

interface Cached<T> {
  value: T;
  expiresAt: number;
}

export class CoinGeckoError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CoinGeckoError";
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Yahoo names a crypto pair `<SYMBOL>-<QUOTE>` in upper case. It is a
 * convention, not a directory: the pair may not exist on Yahoo for a thin
 * asset, which is why the tool labels this a suggestion rather than a fact.
 */
export function toYahooSymbol(symbol: string, vsCurrency: string): string {
  return `${symbol.toUpperCase()}-${vsCurrency.toUpperCase()}`;
}

/** Rows that are not objects, or carry no id, are dropped rather than failing the page. */
export function parseMarkets(body: unknown, vsCurrency: string): CoinMarket[] {
  if (!Array.isArray(body)) {
    throw new CoinGeckoError("CoinGecko returned an unexpected payload for /coins/markets.");
  }

  const rows: CoinMarket[] = [];
  for (const entry of body) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const id = stringOrNull(row["id"]);
    const symbol = stringOrNull(row["symbol"]);
    const name = stringOrNull(row["name"]);
    if (id === null || symbol === null || name === null) continue;

    rows.push({
      id,
      symbol: symbol.toUpperCase(),
      name,
      yahooSymbol: toYahooSymbol(symbol, vsCurrency),
      price: numberOrNull(row["current_price"]),
      marketCap: numberOrNull(row["market_cap"]),
      marketCapRank: numberOrNull(row["market_cap_rank"]),
      volume24h: numberOrNull(row["total_volume"]),
      change24hPct: numberOrNull(row["price_change_percentage_24h"]),
      lastUpdated: stringOrNull(row["last_updated"]),
    });
  }
  return rows;
}

export class CoinGeckoClient {
  private readonly fetchImpl: Fetcher;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private readonly markets = new Map<string, Cached<CoinMarket[]>>();

  constructor(options: CoinGeckoClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    // Read at construction, not import, for the same reason as `EdgarClient`:
    // tool modules must stay importable without a loaded environment.
    this.apiKey = options.apiKey ?? process.env["COINGECKO_API_KEY"];
    this.minIntervalMs = options.minIntervalMs ?? 250;
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }

  private async getJson(url: string): Promise<unknown> {
    await this.throttle();
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "finance-mcp-server",
        ...(this.apiKey !== undefined && { "x-cg-demo-api-key": this.apiKey }),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (response.status === 429) {
        throw new CoinGeckoError(
          "CoinGecko rate-limited this server (429). Its free tier allows only a few " +
            "requests per minute; retry shortly, or ask for a cached page again.",
          429,
        );
      }
      throw new CoinGeckoError(`CoinGecko request failed (${response.status}): ${url}`, response.status);
    }
    return response.json();
  }

  private static evict(cache: Map<string, Cached<CoinMarket[]>>): void {
    while (cache.size > MAX_CACHED_PAGES) {
      const oldest = cache.keys().next();
      if (oldest.done === true) break;
      cache.delete(oldest.value);
    }
  }

  /** Assets ordered by market capitalisation, largest first. */
  async fetchMarkets(query: MarketsQuery): Promise<CoinMarket[]> {
    const vsCurrency = query.vsCurrency.toLowerCase();
    const params = new URLSearchParams({
      vs_currency: vsCurrency,
      order: "market_cap_desc",
      per_page: String(query.perPage),
      page: String(query.page),
      sparkline: "false",
    });
    if (query.ids !== undefined && query.ids.length > 0) {
      params.set("ids", query.ids.join(","));
    }
    const url = `${this.baseUrl}/coins/markets?${params.toString()}`;

    const cached = this.markets.get(url);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value;

    const value = parseMarkets(await this.getJson(url), vsCurrency);
    this.markets.set(url, { value, expiresAt: Date.now() + MARKETS_TTL_MS });
    CoinGeckoClient.evict(this.markets);
    return value;
  }
}

let singleton: CoinGeckoClient | null = null;

/** Lazy, so importing a tool module does not construct a client. */
export function getCoinGeckoClient(): CoinGeckoClient {
  singleton ??= new CoinGeckoClient();
  return singleton;
}
