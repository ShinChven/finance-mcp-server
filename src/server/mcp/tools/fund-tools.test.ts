import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import type { EnsureResult, FundCache } from "../../china/ondemand.js";
import type { ExposureRow, FundMatch, FundRepo, HoldingRow } from "../../china/repo.js";
import type { Fund } from "../../db/schema.js";
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

function fund(code: string, overrides: Partial<Fund> = {}): Fund {
  return {
    code,
    name: `Fund ${code}`,
    fundType: "QDII",
    isQdii: true,
    isIndexFund: true,
    trackingIndex: "纳斯达克100",
    trackingIndexCode: null,
    company: null,
    manager: null,
    feeRate: 0.6,
    fundSize: 1200,
    currency: "CNY",
    listedSymbol: null,
    purchaseStatus: "限购",
    purchaseLimit: 1000,
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    detailsSyncedAt: null,
    holdingsSyncedAt: null,
    navSyncedAt: null,
    lastSyncError: null,
    ...overrides,
  };
}

const exposure: ExposureRow[] = [
  {
    dimension: "sector",
    taxonomy: "gics",
    key: "Technology",
    label: "Semiconductors",
    weight: 62.5,
    coverage: 0.95,
    reportDate: "2026-03-31",
  },
  {
    dimension: "market",
    taxonomy: "",
    key: "US",
    label: "US",
    weight: 88,
    coverage: 0.95,
    reportDate: "2026-03-31",
  },
];

function mockRepo(overrides: Partial<FundRepo> = {}) {
  const holdingsByDate: Record<string, HoldingRow[]> = {
    "2026-03-31": [
      { symbol: "NVDA", name: "英伟达", weight: 12, reportDate: "2026-03-31" },
      { symbol: "AAPL", name: "苹果", weight: 8, reportDate: "2026-03-31" },
    ],
    "2025-12-31": [
      { symbol: "NVDA", name: "英伟达", weight: 10, reportDate: "2025-12-31" },
      { symbol: "MSFT", name: "微软", weight: 6, reportDate: "2025-12-31" },
    ],
  };

  const repo: FundRepo = {
    getFund: vi.fn(async (code: string) => (code === "999999" ? null : fund(code))),
    getNavSeries: vi.fn(async () => [
      { navDate: "2025-07-01", nav: 1, accNav: 1 },
      { navDate: "2026-01-01", nav: 1.3, accNav: 1.3 },
      { navDate: "2026-07-01", nav: 1.2, accNav: 1.2 },
    ]),
    getExposure: vi.fn(async () => exposure),
    getHoldings: vi.fn(
      async (_code: string, reportDate?: string) => holdingsByDate[reportDate ?? "2026-03-31"] ?? [],
    ),
    listReportDates: vi.fn(async () => ["2026-03-31", "2025-12-31"]),
    findFundsByStock: vi.fn(
      async (): Promise<FundMatch[]> => [
        { fund: fund("270042"), weight: 9.4, reportDate: "2026-03-31" },
      ],
    ),
    findFundsBySector: vi.fn(
      async (): Promise<FundMatch[]> => [
        {
          fund: fund("161128"),
          weight: 55,
          coverage: 0.9,
          key: "Technology",
          label: "Semiconductors",
          reportDate: "2026-03-31",
        },
        {
          fund: fund("501225"),
          weight: 40,
          coverage: 0.3,
          key: "Technology",
          label: "Semiconductors",
          reportDate: "2026-03-31",
        },
      ],
    ),
    findFundsByTrackingIndex: vi.fn(async () => [fund("270042")]),
    findFundsByMarketExposure: vi.fn(
      async (): Promise<FundMatch[]> => [
        { fund: fund("270042"), weight: 92, key: "US", reportDate: "2026-03-31" },
      ],
    ),
    getExposureVectors: vi.fn(
      async (codes: string[]) =>
        new Map(codes.map((code) => [code, new Map([["gics:Technology", code === "162411" ? 60 : 55]])])),
    ),
    similarityCandidates: vi.fn(async () => ["270042", "161128"]),
    resolveSymbol: vi.fn(async (query: string) =>
      query === "英伟达" ? { symbol: "NVDA", name: "英伟达" } : null,
    ),
    ...overrides,
  };
  return repo;
}

/**
 * Records on-demand fetches without performing any. The fund tools now reach
 * for this whenever a fund has never been synced, so a test that did not inject
 * one would fall through to the real lazy cache and try to open a database.
 */
function stubCache(result: Partial<EnsureResult> = {}) {
  const calls: { code: string; steps?: string[] }[] = [];
  const cache: FundCache = {
    ensure: async (code, options) => {
      calls.push({ code, ...(options?.steps ? { steps: options.steps } : {}) });
      return {
        code,
        status: "cached",
        fetched: options?.steps ?? ["details", "holdings", "nav"],
        symbolsClassified: 0,
        unclassified: 0,
        message: `Cached fund ${code} on demand.`,
        ...result,
      } as EnsureResult;
    },
  };
  return { cache, calls };
}

async function connect(repo: FundRepo, cache: FundCache = stubCache().cache) {
  const yahoo = {} as YahooFinanceClient;
  const server = buildMcpServer(auth, { client: yahoo, funds: repo, fundCache: cache });
  const mcpClient = new Client({ name: "fund-tools-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return { server, mcpClient };
}

async function call(
  repo: FundRepo,
  name: string,
  args: Record<string, unknown>,
  cache?: FundCache,
) {
  const { server, mcpClient } = await connect(repo, cache);
  try {
    return CallToolResultSchema.parse(await mcpClient.callTool({ name, arguments: args }));
  } finally {
    await mcpClient.close();
    await server.close();
  }
}

function structured(result: { structuredContent?: unknown }): Record<string, unknown> {
  const wrapper = result.structuredContent as { result?: Record<string, unknown> } | undefined;
  if (wrapper?.result === undefined) throw new Error("Expected structured tool output");
  return wrapper.result;
}

describe("fundExposure", () => {
  it("returns sector and market breakdown with a stability reading", async () => {
    const result = await call(mockRepo(), "fundExposure", { code: "162411" });
    expect(result.isError).not.toBe(true);

    const body = structured(result);
    expect(body.reportDate).toBe("2026-03-31");
    expect(body.sectors).toHaveLength(1);
    expect(body.markets).toHaveLength(1);

    // NVDA (10 of 16 prior weight) survived; MSFT did not.
    expect(body.holdingsStability).toMatchObject({ score: 0.625, dropped: ["MSFT"], added: ["AAPL"] });
  });

  it("omits holdings unless asked", async () => {
    const without = structured(await call(mockRepo(), "fundExposure", { code: "162411" }));
    expect(without.holdings).toBeUndefined();

    const withHoldings = structured(
      await call(mockRepo(), "fundExposure", { code: "162411", includeHoldings: true }),
    );
    expect(withHoldings.holdings).toHaveLength(2);
  });

  it("reports an un-ingested fund as an error result", async () => {
    const result = await call(mockRepo(), "fundExposure", { code: "999999" });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("not in the local index") });
  });

  it("rejects a non-fund code before touching the repo", async () => {
    const repo = mockRepo();
    const result = await call(repo, "fundExposure", { code: "NVDA" });
    expect(result.isError).toBe(true);
    expect(repo.getFund).not.toHaveBeenCalled();
  });
});

describe("fundsByStock", () => {
  it("normalizes an exchange code before the lookup", async () => {
    const repo = mockRepo();
    const body = structured(await call(repo, "fundsByStock", { symbol: "600519" }));

    expect(body.symbol).toBe("600519.SS");
    expect(repo.findFundsByStock).toHaveBeenCalledWith("600519.SS", expect.objectContaining({ limit: 20 }));
  });

  it("falls back to name resolution for non-symbol input", async () => {
    const repo = mockRepo();
    const body = structured(await call(repo, "fundsByStock", { symbol: "英伟达" }));

    expect(repo.resolveSymbol).toHaveBeenCalledWith("英伟达");
    expect(body.symbol).toBe("NVDA");
  });

  it("errors when the name cannot be resolved", async () => {
    const result = await call(mockRepo(), "fundsByStock", { symbol: "不存在的公司" });
    expect(result.isError).toBe(true);
  });
});

describe("fundsBySector", () => {
  it("resolves a Chinese theme name through the crosswalk", async () => {
    const repo = mockRepo();
    const body = structured(await call(repo, "fundsBySector", { sector: "半导体" }));

    expect(body.resolvedTheme).toBe("semiconductors");
    expect(repo.findFundsBySector).toHaveBeenCalledWith(
      expect.objectContaining({ keys: expect.arrayContaining(["Technology"]) }),
    );
  });

  it("filters out matches below the requested coverage", async () => {
    const body = structured(
      await call(mockRepo(), "fundsBySector", { sector: "半导体", minCoverage: 0.8 }),
    );
    // The 0.3-coverage fund is a weak signal and must not be presented alongside a real one.
    expect(body.matchCount).toBe(1);
  });

  it("hints at known themes when nothing matches", async () => {
    const body = structured(await call(mockRepo(), "fundsBySector", { sector: "zzz-unknown" }));
    expect(body.resolvedTheme).toBeNull();
    expect(body.hint).toContain("semiconductors");
  });
});

describe("similarFunds", () => {
  it("ranks candidates by exposure similarity", async () => {
    const body = structured(await call(mockRepo(), "similarFunds", { code: "162411" }));
    const list = body.funds as { code: string; similarity: number }[];

    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.similarity).toBe(1);
  });

  it("applies the similarity floor", async () => {
    const repo = mockRepo({
      getExposureVectors: vi.fn(
        async () =>
          new Map([
            ["162411", new Map([["gics:Technology", 60]])],
            ["270042", new Map([["gics:Energy", 60]])],
            ["161128", new Map([["gics:Energy", 60]])],
          ]),
      ),
    });
    const body = structured(await call(repo, "similarFunds", { code: "162411" }));
    expect(body.matchCount).toBe(0);
  });
});

describe("themeToFunds", () => {
  it("returns all three resolution routes with the chain", async () => {
    const body = structured(await call(mockRepo(), "themeToFunds", { theme: "纳斯达克" }));

    expect(body.resolved).toBe(true);
    expect(body.chain).toMatchObject({ themeId: "us_nasdaq", markets: ["US"] });
    expect(body.trackingIndexFunds).toHaveLength(1);
    expect(body.marketExposureFunds).toHaveLength(1);
  });

  it("lists known themes when the theme is unrecognized", async () => {
    const body = structured(await call(mockRepo(), "themeToFunds", { theme: "zzz-unknown" }));
    expect(body.resolved).toBe(false);
    expect(body.knownThemes).toContain("semiconductors");
  });
});

describe("compareFunds", () => {
  it("computes pairwise overlap", async () => {
    const body = structured(
      await call(mockRepo(), "compareFunds", { codes: ["162411", "270042"] }),
    );

    expect(body.funds).toHaveLength(2);
    // Both mock funds return the same latest holdings: 12 + 8.
    expect(body.overlaps).toEqual([{ pair: ["162411", "270042"], overlapPercent: 20 }]);
  });

  it("names the funds that are missing from the index", async () => {
    const result = await call(mockRepo(), "compareFunds", { codes: ["162411", "999999"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("999999") });
  });

  it("requires at least two codes", async () => {
    const result = await call(mockRepo(), "compareFunds", { codes: ["162411"] });
    expect(result.isError).toBe(true);
  });
});

describe("fundPerformance", () => {
  it("computes returns and drawdown over the NAV series", async () => {
    const body = structured(await call(mockRepo(), "fundPerformance", { code: "162411" }));
    const performance = body.performance as Record<string, unknown>;

    expect(performance.cumulativeReturnPercent).toBe(20);
    // Peak 1.3 → 1.2.
    expect(performance.maxDrawdownPercent).toBeCloseTo(7.69, 1);
    expect(performance.basis).toBe("accNav");
    expect(body.series).toBeUndefined();
  });

  it("passes the date window through to the repo", async () => {
    const repo = mockRepo();
    await call(repo, "fundPerformance", { code: "162411", from: "2025-07-01", to: "2026-07-01" });
    expect(repo.getNavSeries).toHaveBeenCalledWith("162411", {
      from: "2025-07-01",
      to: "2026-07-01",
    });
  });

  it("returns the series on request", async () => {
    const body = structured(
      await call(mockRepo(), "fundPerformance", { code: "162411", includeSeries: true }),
    );
    expect(body.series).toHaveLength(3);
  });

  it("errors when the window holds too few observations", async () => {
    const repo = mockRepo({ getNavSeries: vi.fn(async () => []) });
    const result = await call(repo, "fundPerformance", { code: "162411" });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("fewer than two NAV observations"),
    });
  });

  it("rejects a malformed date before querying", async () => {
    const repo = mockRepo();
    const result = await call(repo, "fundPerformance", { code: "162411", from: "2026/01/01" });
    expect(result.isError).toBe(true);
    expect(repo.getNavSeries).not.toHaveBeenCalled();
  });
});

describe("on-demand caching", () => {
  it("fetches a fund the first time a tool touches it", async () => {
    const { cache, calls } = stubCache();
    // holdingsSyncedAt null is the definition of "never cached".
    const repo = mockRepo({ getFund: async () => fund("161125", { holdingsSyncedAt: null }) });

    await call(repo, "fundExposure", { code: "161125" }, cache);

    expect(calls).toEqual([{ code: "161125", steps: ["details", "holdings"] }]);
  });

  it("does not refetch a fund that has been synced before", async () => {
    const { cache, calls } = stubCache();
    const repo = mockRepo({
      getFund: async () => fund("161125", { holdingsSyncedAt: new Date("2026-08-01T00:00:00Z") }),
    });

    await call(repo, "fundExposure", { code: "161125" }, cache);

    expect(calls).toEqual([]);
  });

  it("asks only for NAV when the tool only measures NAV", async () => {
    const { cache, calls } = stubCache();
    const repo = mockRepo({ getFund: async () => fund("161125", { navSyncedAt: null }) });

    await call(repo, "fundPerformance", { code: "161125" }, cache);

    expect(calls).toEqual([{ code: "161125", steps: ["details", "nav"] }]);
  });

  it("surfaces an on-demand failure instead of returning an empty breakdown", async () => {
    const { cache } = stubCache({
      status: "unknown",
      message: "Fund 999999 is not in the fund universe index.",
    });
    const repo = mockRepo({ getFund: async () => null });

    const result = await call(repo, "fundExposure", { code: "999999" }, cache);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("not in the fund universe index"),
    });
  });

  it("refuses rather than queueing when too many fetches are pending", async () => {
    const { cache } = stubCache({ status: "busy", message: "Too many funds are being cached right now (8)." });
    const repo = mockRepo({ getFund: async () => fund("161125", { holdingsSyncedAt: null }) });

    const result = await call(repo, "fundExposure", { code: "161125" }, cache);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Too many funds") });
  });
});
