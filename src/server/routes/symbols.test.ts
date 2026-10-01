import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The symbol routes against fake upstreams.
 *
 * The normalisers have their own tests; what is pinned here is the routing
 * behaviour around them — that a second read is answered from memory, that a
 * stock and an ETF are asked for different modules, that an unknown symbol is
 * a 404 rather than a 500, and that a listing with no SEC registration is an
 * answer rather than a failure.
 */

const yahoo = vi.hoisted(() => ({
  quote: vi.fn(),
  quoteSummary: vi.fn(),
  options: vi.fn(),
  search: vi.fn(),
  insights: vi.fn(),
  fundamentalsTimeSeries: vi.fn(),
  recommendationsBySymbol: vi.fn(),
}));

const edgar = vi.hoisted(() => ({ resolveTicker: vi.fn(), fetchFilings: vi.fn() }));

vi.mock("../mcp/client.js", () => ({ yahooFinanceClient: yahoo }));
vi.mock("../middleware/session.js", () => ({
  requireAuth: async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("user", { id: "user-1" });
    await next();
  },
}));
vi.mock("../watchlist/repo.js", () => ({
  createLazyWatchlistRepo: () => ({
    listTrackedRefs: vi.fn(async () => []),
    listItems: vi.fn(async () => ({ items: [], total: 0 })),
  }),
}));
vi.mock("../funds/repo.js", () => ({
  createLazyFundRepo: () => ({ findFundsByStock: vi.fn(async () => []) }),
}));
vi.mock("../market/deps.js", async () => {
  const { createTokenBucket } = await import("../market/budget.js");
  return {
    seriesBudget: createTokenBucket(),
    loadSeriesDeps: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
});
vi.mock("../sec/edgar.js", async () => {
  class EdgarError extends Error {
    constructor(
      message: string,
      readonly status?: number,
    ) {
      super(message);
    }
  }
  return { EdgarError, getEdgarClient: () => edgar };
});

const { symbolRoutes } = await import("./symbols.js");
const { EdgarError } = await import("../sec/edgar.js");

function quoteRow(symbol: string, quoteType = "EQUITY") {
  return {
    symbol,
    longName: `${symbol} Inc`,
    quoteType,
    market: "us_market",
    currency: "USD",
    regularMarketPrice: 100,
    regularMarketChangePercent: 1,
  };
}

beforeEach(() => {
  for (const fn of Object.values(yahoo)) fn.mockReset();
  edgar.resolveTicker.mockReset();
  edgar.fetchFilings.mockReset();
});

describe("GET /:symbol/quote", () => {
  it("returns identity, live value and session for a known symbol", async () => {
    yahoo.quote.mockResolvedValue([quoteRow("AAA")]);
    const response = await symbolRoutes.request("/aaa/quote");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { identity: { symbol: string; name: string }; live: { price: number } };
    expect(body.identity).toMatchObject({ symbol: "AAA", name: "AAA Inc" });
    expect(body.live.price).toBe(100);
  });

  it("is a 404 when Yahoo does not know the symbol", async () => {
    yahoo.quote.mockResolvedValue([]);
    const response = await symbolRoutes.request("/NOPE1/quote");
    expect(response.status).toBe(404);
  });

  it("refuses a path segment that could not be a symbol", async () => {
    const response = await symbolRoutes.request(`/${encodeURIComponent("a b")}/quote`);
    expect(response.status).toBe(400);
    expect(yahoo.quote).not.toHaveBeenCalled();
  });

  it("decodes an encoded caret", async () => {
    yahoo.quote.mockResolvedValue([quoteRow("^GSPC", "INDEX")]);
    const response = await symbolRoutes.request("/%5EGSPC/quote");
    expect(response.status).toBe(200);
    expect(yahoo.quote).toHaveBeenCalledWith(["^GSPC"], {}, expect.anything());
  });
});

describe("GET /:symbol/profile", () => {
  it("asks a stock for ownership modules and answers a second read from memory", async () => {
    yahoo.quote.mockResolvedValue([quoteRow("BBB")]);
    yahoo.quoteSummary.mockResolvedValue({ price: { longName: "BBB Inc", quoteType: "EQUITY" } });

    const first = await symbolRoutes.request("/BBB/profile");
    expect(first.status).toBe(200);
    const modules = yahoo.quoteSummary.mock.calls[0]?.[1]?.modules as string[];
    expect(modules).toContain("institutionOwnership");
    expect(modules).not.toContain("topHoldings");

    await symbolRoutes.request("/BBB/profile");
    expect(yahoo.quoteSummary).toHaveBeenCalledTimes(1);
  });

  it("asks an ETF for its holdings instead", async () => {
    yahoo.quote.mockResolvedValue([quoteRow("CCC", "ETF")]);
    yahoo.quoteSummary.mockResolvedValue({});
    await symbolRoutes.request("/CCC/profile");
    const modules = yahoo.quoteSummary.mock.calls[0]?.[1]?.modules as string[];
    expect(modules).toContain("topHoldings");
  });

  it("falls back to the minimal module set when the full one fails", async () => {
    yahoo.quote.mockResolvedValue([quoteRow("DDD")]);
    yahoo.quoteSummary
      .mockRejectedValueOnce(new Error("Failed Yahoo Schema validation"))
      .mockResolvedValueOnce({ price: { longName: "DDD Inc" } });
    const response = await symbolRoutes.request("/DDD/profile");
    expect(response.status).toBe(200);
    expect(yahoo.quoteSummary.mock.calls[1]?.[1]?.modules).toEqual(["price", "summaryDetail"]);
    const body = (await response.json()) as { name: string; degraded: string[] };
    expect(body.name).toBe("DDD Inc");
    expect(body.degraded).toContain("financialData");
  });

  it("is a 502 with a readable sentence when the upstream is down", async () => {
    yahoo.quote.mockResolvedValue([quoteRow("EEE")]);
    yahoo.quoteSummary.mockRejectedValue(new Error("socket hang up"));
    const response = await symbolRoutes.request("/EEE/profile");
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain("socket hang up");
  });
});

describe("GET /:symbol/options", () => {
  it("passes the requested expiry as a UTC date", async () => {
    yahoo.options.mockResolvedValue({ expirationDates: [], quote: {}, options: [] });
    const response = await symbolRoutes.request("/FFF/options?expiry=2026-12-18");
    expect(response.status).toBe(200);
    expect(yahoo.options).toHaveBeenCalledWith(
      "FFF",
      { date: new Date("2026-12-18T00:00:00Z") },
      expect.anything(),
    );
  });

  it("rejects an expiry that is not a date", async () => {
    const response = await symbolRoutes.request("/FFF/options?expiry=soon");
    expect(response.status).toBe(400);
  });
});

describe("GET /:symbol/filings", () => {
  it("answers a non-filer with the reason rather than an error", async () => {
    edgar.resolveTicker.mockRejectedValue(new EdgarError("No SEC filer matches"));
    const response = await symbolRoutes.request("/0700.HK/filings");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { unsupported: string; filings: unknown[] };
    expect(body.unsupported).toContain("No SEC filer");
    expect(body.filings).toEqual([]);
  });

  it("filters by form when one is asked for", async () => {
    edgar.resolveTicker.mockResolvedValue({ cik: "0001045810" });
    edgar.fetchFilings.mockResolvedValue({
      company: { cik: "0001045810", name: "NVIDIA", sicDescription: "Semis", fiscalYearEnd: "0126" },
      filings: [],
    });
    await symbolRoutes.request("/NVDA/filings?form=10-K");
    expect(edgar.fetchFilings).toHaveBeenCalledWith("0001045810", { forms: ["10-K"], limit: 40 });
  });
});

describe("GET /board", () => {
  it("prices every tile in one batched quote", async () => {
    yahoo.quote.mockImplementation(async (symbols: string[]) => symbols.map((symbol) => quoteRow(symbol, "INDEX")));
    const response = await symbolRoutes.request("/board");
    expect(response.status).toBe(200);
    expect(yahoo.quote).toHaveBeenCalledTimes(1);
    const body = (await response.json()) as { groups: { items: unknown[] }[]; missing: string[] };
    expect(body.groups.length).toBeGreaterThan(1);
    expect(body.missing).toEqual([]);
  });

  it("prices a caller's own strip when given one", async () => {
    yahoo.quote.mockImplementation(async (symbols: string[]) => symbols.slice(0, 1).map((s) => quoteRow(s)));
    const response = await symbolRoutes.request("/board?symbols=zzz1,zzz2");
    const body = (await response.json()) as { groups: { id: string; items: unknown[] }[]; missing: string[] };
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]?.id).toBe("custom");
    expect(body.missing).toEqual(["ZZZ2"]);
  });
});

describe("GET /:symbol/related", () => {
  it("caches which names are related separately from their prices", async () => {
    yahoo.recommendationsBySymbol.mockResolvedValue([
      { symbol: "RRR", recommendedSymbols: [{ symbol: "AAA" }, { symbol: "RRR" }, { symbol: "BBB" }] },
    ]);
    yahoo.quote.mockImplementation(async (symbols: string[]) => symbols.map((s) => quoteRow(s)));

    const response = await symbolRoutes.request("/RRR/related");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { ref: string; price: number }[] };
    // The symbol itself is never "related to" itself.
    expect(body.items.map((item) => item.ref)).toEqual(["AAA", "BBB"]);
    expect(yahoo.quote).toHaveBeenCalledWith(["AAA", "BBB"], {}, expect.anything());

    await symbolRoutes.request("/RRR/related");
    expect(yahoo.recommendationsBySymbol).toHaveBeenCalledTimes(1);
  });
});
