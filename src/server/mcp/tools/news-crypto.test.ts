import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import type { CoinGeckoClient, CoinMarket } from "../../crypto/coingecko.js";
import type { McpAuth } from "../../lib/http.js";
import type { YahooFinanceClient } from "../client.js";
import { buildMcpServer } from "../server.js";

const auth = {
  user: {
    id: "user-1",
    email: "investor@example.com",
    googleSub: null,
    name: "Investor",
    displayName: "Test Investor",
    avatarUrl: null,
    role: "user",
    status: "active",
    preferences: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastLoginAt: null,
  },
  method: "pat",
  sourceId: "token-1",
  label: "Test token",
} satisfies McpAuth;

function newsItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    uuid: "id-1",
    title: "Nvidia beats expectations",
    publisher: "Reuters",
    link: "https://example.test/a",
    providerPublishTime: new Date("2026-08-19T12:00:00Z"),
    type: "STORY",
    thumbnail: { resolutions: [{ url: "https://example.test/i.png", width: 1, height: 1, tag: "o" }] },
    relatedTickers: ["NVDA"],
    ...overrides,
  };
}

function coin(overrides: Partial<CoinMarket> = {}): CoinMarket {
  return {
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
    ...overrides,
  };
}

async function connect(deps: { search?: unknown; markets?: CoinMarket[] } = {}) {
  const search = vi.fn().mockResolvedValue(deps.search ?? { quotes: [], news: [] });
  const fetchMarkets = vi.fn().mockResolvedValue(deps.markets ?? []);
  const server = buildMcpServer(auth, {
    client: { search } as unknown as YahooFinanceClient,
    crypto: { fetchMarkets } as unknown as CoinGeckoClient,
  });
  const mcpClient = new Client({ name: "news-crypto-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  return {
    search,
    fetchMarkets,
    async call(name: string, args: Record<string, unknown>) {
      return CallToolResultSchema.parse(await mcpClient.callTool({ name, arguments: args }));
    },
    async close() {
      await mcpClient.close();
      await server.close();
    },
  };
}

describe("companyNews", () => {
  it("normalizes timestamps, drops thumbnails, and reports what the query resolved to", async () => {
    const harness = await connect({
      search: { quotes: [{ symbol: "NVDA" }, { name: "no symbol" }], news: [newsItem()] },
    });

    try {
      const result = await harness.call("companyNews", { query: "Nvidia" });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        result: {
          query: "Nvidia",
          resolvedSymbols: ["NVDA"],
          count: 1,
          articles: [
            {
              uuid: "id-1",
              title: "Nvidia beats expectations",
              publisher: "Reuters",
              link: "https://example.test/a",
              publishedAt: "2026-08-19T12:00:00.000Z",
              type: "STORY",
              relatedTickers: ["NVDA"],
            },
          ],
        },
      });
    } finally {
      await harness.close();
    }
  });

  it("orders newest first and honours the `since` cutoff", async () => {
    const harness = await connect({
      search: {
        quotes: [],
        news: [
          newsItem({ uuid: "old", providerPublishTime: new Date("2026-01-01T00:00:00Z") }),
          newsItem({ uuid: "new", providerPublishTime: new Date("2026-08-19T12:00:00Z") }),
          newsItem({ uuid: "mid", providerPublishTime: new Date("2026-06-01T00:00:00Z") }),
        ],
      },
    });

    try {
      const all = await harness.call("companyNews", { query: "NVDA" });
      const structured = all.structuredContent as { result: { articles: { uuid: string }[] } };
      expect(structured.result.articles.map((a) => a.uuid)).toEqual(["new", "mid", "old"]);

      const recent = await harness.call("companyNews", { query: "NVDA", since: "2026-05-01" });
      const filtered = recent.structuredContent as {
        result: { count: number; articles: { uuid: string }[] };
      };
      expect(filtered.result.articles.map((a) => a.uuid)).toEqual(["new", "mid"]);
      expect(filtered.result.count).toBe(2);
    } finally {
      await harness.close();
    }
  });

  it("asks Yahoo for news rather than a quote list", async () => {
    const harness = await connect();

    try {
      await harness.call("companyNews", { query: "AAPL", count: 5, region: "us" });
      expect(harness.search).toHaveBeenCalledWith(
        "AAPL",
        { quotesCount: 2, newsCount: 5, region: "US" },
        { fetchOptions: { signal: expect.any(AbortSignal) } },
      );
    } finally {
      await harness.close();
    }
  });

  it("rejects an unparseable `since` before calling Yahoo", async () => {
    const harness = await connect();

    try {
      const result = await harness.call("companyNews", { query: "AAPL", since: "last tuesday" });
      expect(result.isError).toBe(true);
      expect(harness.search).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
});

describe("cryptoTickers", () => {
  it("returns the ranking page it was asked for", async () => {
    const harness = await connect({
      markets: [coin(), coin({ id: "ethereum", symbol: "ETH", yahooSymbol: "ETH-USD" })],
    });

    try {
      const result = await harness.call("cryptoTickers", { count: 2, page: 3 });
      expect(result.isError).not.toBe(true);
      expect(harness.fetchMarkets).toHaveBeenCalledWith({
        vsCurrency: "usd",
        perPage: 2,
        page: 3,
      });
      const structured = result.structuredContent as {
        result: { page: number; matched: number; assets: { yahooSymbol: string }[] };
      };
      expect(structured.result.page).toBe(3);
      expect(structured.result.assets.map((a) => a.yahooSymbol)).toEqual(["BTC-USD", "ETH-USD"]);
    } finally {
      await harness.close();
    }
  });

  it("scans the top slice once when filtering, matching id, ticker or name", async () => {
    const harness = await connect({
      markets: [
        coin(),
        coin({ id: "ethereum", symbol: "ETH", name: "Ethereum", yahooSymbol: "ETH-USD" }),
        coin({ id: "solana", symbol: "SOL", name: "Solana", yahooSymbol: "SOL-USD" }),
      ],
    });

    try {
      const result = await harness.call("cryptoTickers", { q: "sol" });
      expect(harness.fetchMarkets).toHaveBeenCalledTimes(1);
      expect(harness.fetchMarkets).toHaveBeenCalledWith({
        vsCurrency: "usd",
        perPage: 250,
        page: 1,
      });
      const structured = result.structuredContent as {
        result: { matched: number; assets: { id: string }[] };
      };
      expect(structured.result.assets.map((a) => a.id)).toEqual(["solana"]);
      expect(structured.result.matched).toBe(1);
    } finally {
      await harness.close();
    }
  });

  it("caps the returned rows at `count` even when more matched", async () => {
    const harness = await connect({
      markets: [
        coin({ id: "bitcoin", name: "Bitcoin" }),
        coin({ id: "bitcoin-cash", name: "Bitcoin Cash", symbol: "BCH" }),
      ],
    });

    try {
      const result = await harness.call("cryptoTickers", { q: "bitcoin", count: 1 });
      const structured = result.structuredContent as {
        result: { matched: number; assets: unknown[] };
      };
      expect(structured.result.matched).toBe(2);
      expect(structured.result.assets).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("lower-cases the pricing currency Yahoo would upper-case", async () => {
    const harness = await connect({ markets: [] });

    try {
      await harness.call("cryptoTickers", { vsCurrency: "EUR" });
      expect(harness.fetchMarkets).toHaveBeenCalledWith({
        vsCurrency: "eur",
        perPage: 25,
        page: 1,
      });
    } finally {
      await harness.close();
    }
  });

  it("surfaces an upstream failure as a tool error, not a transport failure", async () => {
    const harness = await connect();
    harness.fetchMarkets.mockRejectedValue(new Error("CoinGecko rate-limited this server (429)."));

    try {
      const result = await harness.call("cryptoTickers", {});
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining("rate-limited") });
    } finally {
      await harness.close();
    }
  });
});
