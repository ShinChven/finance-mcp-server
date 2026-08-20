import { describe, expect, it, vi } from "vitest";
import {
  CoinGeckoClient,
  CoinGeckoError,
  parseMarkets,
  toYahooSymbol,
  type Fetcher,
} from "./coingecko.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const bitcoin = {
  id: "bitcoin",
  symbol: "btc",
  name: "Bitcoin",
  current_price: 91_000,
  market_cap: 1_800_000_000_000,
  market_cap_rank: 1,
  total_volume: 40_000_000_000,
  price_change_percentage_24h: -1.25,
  last_updated: "2026-08-20T10:00:00.000Z",
};

describe("toYahooSymbol", () => {
  it("builds Yahoo's pair form in upper case", () => {
    expect(toYahooSymbol("btc", "usd")).toBe("BTC-USD");
    expect(toYahooSymbol("eth", "eur")).toBe("ETH-EUR");
  });
});

describe("parseMarkets", () => {
  it("reduces a market row to the fields the tool returns", () => {
    expect(parseMarkets([bitcoin], "usd")).toEqual([
      {
        id: "bitcoin",
        symbol: "BTC",
        name: "Bitcoin",
        yahooSymbol: "BTC-USD",
        price: 91_000,
        marketCap: 1_800_000_000_000,
        marketCapRank: 1,
        volume24h: 40_000_000_000,
        change24hPct: -1.25,
        lastUpdated: "2026-08-20T10:00:00.000Z",
      },
    ]);
  });

  it("nulls missing numbers instead of emitting NaN", () => {
    const [row] = parseMarkets([{ id: "x", symbol: "x", name: "X" }], "usd");
    expect(row?.price).toBeNull();
    expect(row?.marketCapRank).toBeNull();
  });

  it("skips malformed rows rather than failing the whole page", () => {
    const rows = parseMarkets([bitcoin, null, { symbol: "no-id" }, 42], "usd");
    expect(rows.map((row) => row.id)).toEqual(["bitcoin"]);
  });

  it("rejects a payload that is not a list", () => {
    expect(() => parseMarkets({ error: "nope" }, "usd")).toThrow(CoinGeckoError);
  });
});

describe("CoinGeckoClient", () => {
  it("requests the market-cap ranking and caches the page", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([bitcoin])) as unknown as Fetcher;
    const client = new CoinGeckoClient({
      fetchImpl,
      baseUrl: "https://example.test/api/v3",
      minIntervalMs: 0,
    });

    const first = await client.fetchMarkets({ vsCurrency: "usd", perPage: 10, page: 1 });
    const second = await client.fetchMarkets({ vsCurrency: "usd", perPage: 10, page: 1 });

    expect(first).toEqual(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = vi.mocked(fetchImpl).mock.calls[0]?.[0];
    expect(String(url)).toBe(
      "https://example.test/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc" +
        "&per_page=10&page=1&sparkline=false",
    );
  });

  it("treats a different page as a different cache entry", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([bitcoin])) as unknown as Fetcher;
    const client = new CoinGeckoClient({ fetchImpl, minIntervalMs: 0 });

    await client.fetchMarkets({ vsCurrency: "usd", perPage: 10, page: 1 });
    await client.fetchMarkets({ vsCurrency: "usd", perPage: 10, page: 2 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends no key header when none is configured", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([bitcoin])) as unknown as Fetcher;
    const client = new CoinGeckoClient({ fetchImpl, minIntervalMs: 0, apiKey: undefined });
    // The public tier is keyless; an env-provided key must not leak in here.
    vi.stubEnv("COINGECKO_API_KEY", "");

    await client.fetchMarkets({ vsCurrency: "usd", perPage: 5, page: 1 });

    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(init?.headers).not.toHaveProperty("x-cg-demo-api-key");
    vi.unstubAllEnvs();
  });

  it("explains a rate-limit rejection instead of surfacing a bare 429", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429)) as unknown as Fetcher;
    const client = new CoinGeckoClient({ fetchImpl, minIntervalMs: 0 });

    await expect(
      client.fetchMarkets({ vsCurrency: "usd", perPage: 5, page: 1 }),
    ).rejects.toThrow(/rate-limited/);
  });
});
