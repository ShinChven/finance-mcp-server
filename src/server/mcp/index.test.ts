import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import type { McpAuth } from "../lib/http.js";
import type { YahooFinanceClient } from "./client.js";
import { buildMcpServer } from "./server.js";

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

function mockYahooClient() {
  const methods = {
    chart: vi.fn(),
    fundamentalsTimeSeries: vi.fn(),
    insights: vi.fn(),
    options: vi.fn(),
    quote: vi.fn(),
    quoteSummary: vi.fn(),
    recommendationsBySymbol: vi.fn(),
    screener: vi.fn(),
    search: vi.fn(),
    trendingSymbols: vi.fn(),
  };
  return { methods, client: methods as unknown as YahooFinanceClient };
}

async function connect(client: YahooFinanceClient) {
  const server = buildMcpServer(auth, { client });
  const mcpClient = new Client({ name: "finance-mcp-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return { server, mcpClient };
}

describe("finance MCP server", () => {
  it("exposes the Yahoo and fund-relationship tools plus whoami, without echo", async () => {
    const { client } = mockYahooClient();
    const { server, mcpClient } = await connect(client);

    try {
      const result = await mcpClient.listTools();
      expect(result.tools.map((tool) => tool.name)).toEqual([
        "whoami",
        "search",
      "companyNews",
        "quote",
        "quoteSummary",
        "chart",
        "screener",
        "trendingSymbols",
        "options",
        "insights",
        "recommendationsBySymbol",
        "fundamentalsTimeSeries",
        "earningsAnalysis",
      "cryptoTickers",
        "secFilings",
        "secFinancials",
        "watchlists",
        "watchlist",
        "watchlistAdd",
        "watchlistRemove",
        "noteCollections",
        "notesSearch",
        "noteRead",
        "noteCreate",
        "noteUpdate",
        "noteDelete",
        "skills",
        "skillRead",
        "skillSave",
        "fundExposure",
        "fundsByStock",
        "fundsBySector",
        "fundsByHoldings",
        "similarFunds",
        "themeToFunds",
        "compareFunds",
        "fundPerformance",
      ]);
      // Watchlist, note and skill writes are the only mutating tools; everything
      // else reads. skillSave is here and skillRead is not, which is the split
      // the draft gate depends on.
      const mutating = result.tools
        .filter((tool) => tool.annotations?.readOnlyHint !== true)
        .map((tool) => tool.name);
      expect(mutating).toEqual([
        "watchlistAdd",
        "watchlistRemove",
        "noteCreate",
        "noteUpdate",
        "noteDelete",
        "skillSave",
      ]);
    } finally {
      await mcpClient.close();
      await server.close();
    }
  });

  it("returns the authenticated identity and structured quote data", async () => {
    const { client, methods } = mockYahooClient();
    methods.quote.mockResolvedValue({
      symbol: "AAPL",
      currency: "USD",
      regularMarketPrice: 210.5,
    });
    const { server, mcpClient } = await connect(client);

    try {
      const identity = CallToolResultSchema.parse(
        await mcpClient.callTool({ name: "whoami" }),
      );
      const identityBlock = identity.content[0];
      expect(identityBlock?.type).toBe("text");
      if (identityBlock?.type !== "text") throw new Error("Expected whoami text output");
      expect(JSON.parse(identityBlock.text)).toMatchObject({
        userId: "user-1",
        email: "investor@example.com",
        authMethod: "personal access token",
      });

      const quote = CallToolResultSchema.parse(
        await mcpClient.callTool({
          name: "quote",
          arguments: { query: "AAPL", fields: ["regularMarketPrice", "currency"] },
        }),
      );
      expect(quote.isError).not.toBe(true);
      expect(quote.structuredContent).toEqual({
        result: { symbol: "AAPL", currency: "USD", regularMarketPrice: 210.5 },
      });
      expect(methods.quote).toHaveBeenCalledWith(
        "AAPL",
        { fields: ["regularMarketPrice", "currency"] },
        { fetchOptions: { signal: expect.any(AbortSignal) } },
      );
    } finally {
      await mcpClient.close();
      await server.close();
    }
  });

  it("rejects invalid inputs before calling Yahoo and returns provider errors safely", async () => {
    const { client, methods } = mockYahooClient();
    methods.insights.mockRejectedValue(new Error("No data found for symbol"));
    const { server, mcpClient } = await connect(client);

    try {
      const invalid = CallToolResultSchema.parse(
        await mcpClient.callTool({
          name: "screener",
          arguments: { scrId: "day_gainers", count: 500 },
        }),
      );
      expect(invalid.isError).toBe(true);
      expect(methods.screener).not.toHaveBeenCalled();

      const providerError = CallToolResultSchema.parse(
        await mcpClient.callTool({
          name: "insights",
          arguments: { symbol: "INVALID" },
        }),
      );
      expect(providerError.isError).toBe(true);
      expect(providerError.content[0]).toMatchObject({
        type: "text",
        text: "Error: No data found for symbol",
      });
    } finally {
      await mcpClient.close();
      await server.close();
    }
  });

  it("accepts representative inputs for every Yahoo Finance tool", async () => {
    const { client, methods } = mockYahooClient();
    for (const method of Object.values(methods)) method.mockResolvedValue({ ok: true });
    const { server, mcpClient } = await connect(client);

    const calls = [
      { name: "search", arguments: { query: "Apple" } },
      { name: "quote", arguments: { query: ["AAPL", "MSFT"] } },
      {
        name: "quoteSummary",
        arguments: { symbol: "AAPL", modules: ["price", "summaryDetail"] },
      },
      { name: "chart", arguments: { symbol: "AAPL", period1: "2026-01-01" } },
      { name: "screener", arguments: { scrId: "most_actives", count: 5 } },
      { name: "trendingSymbols", arguments: { region: "us", count: 5 } },
      { name: "options", arguments: { symbol: "AAPL" } },
      { name: "insights", arguments: { symbol: "AAPL", reportsCount: 2 } },
      { name: "recommendationsBySymbol", arguments: { query: "AAPL" } },
      {
        name: "fundamentalsTimeSeries",
        arguments: {
          symbol: "AAPL",
          period1: "2024-01-01",
          type: "annual",
          module: "financials",
        },
      },
    ];

    try {
      for (const call of calls) {
        const result = CallToolResultSchema.parse(await mcpClient.callTool(call));
        expect(result.isError, call.name).not.toBe(true);
      }

      expect(methods.trendingSymbols).toHaveBeenCalledWith(
        "US",
        { region: "US", count: 5 },
        { fetchOptions: { signal: expect.any(AbortSignal) } },
      );
      expect(methods.fundamentalsTimeSeries).toHaveBeenCalledWith(
        "AAPL",
        { period1: "2024-01-01", module: "financials", type: "annual" },
        { fetchOptions: { signal: expect.any(AbortSignal) } },
      );
    } finally {
      await mcpClient.close();
      await server.close();
    }
  });
});
