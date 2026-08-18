import { describe, expect, it } from "vitest";
import { attachYoY, buildSeries } from "./analysis.js";
import { EdgarClient, type Fetcher } from "./edgar.js";
import type { MetricDef } from "./metrics.js";
import {
  extractMetrics,
  normalizeTicker,
  parseCompanyInfo,
  parseFilings,
  parseTickerMap,
  type MetricPoint,
} from "./parse.js";

const revenueDef: MetricDef = {
  key: "revenue",
  label: "Revenue",
  concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"],
  unit: "USD",
  kind: "duration",
};

const assetsDef: MetricDef = {
  key: "assets",
  label: "Total assets",
  concepts: ["Assets"],
  unit: "USD",
  kind: "instant",
};

describe("normalizeTicker", () => {
  it("upper-cases and converts the dotted share-class form EDGAR does not use", () => {
    expect(normalizeTicker(" brk.b ")).toBe("BRK-B");
    expect(normalizeTicker("aapl")).toBe("AAPL");
  });
});

describe("parseTickerMap", () => {
  it("zero-pads CIKs to the 10 digits the data.sec.gov paths require", () => {
    const map = parseTickerMap(
      JSON.stringify({
        "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
        "1": { cik_str: 1652044, ticker: "GOOGL", title: "Alphabet Inc." },
      }),
    );
    expect(map.get("AAPL")?.cik).toBe("0000320193");
    expect(map.get("GOOGL")?.cik).toBe("0001652044");
  });

  it("skips malformed rows instead of failing the whole map", () => {
    const map = parseTickerMap(
      JSON.stringify({
        "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
        "1": { ticker: "NOCIK" },
        "2": "not an object",
      }),
    );
    expect(map.size).toBe(1);
  });

  it("throws when nothing usable is present", () => {
    expect(() => parseTickerMap(JSON.stringify({ "0": { ticker: "X" } }))).toThrow(
      /no usable rows/,
    );
  });
});

const submissions = {
  cik: "320193",
  name: "Apple Inc.",
  tickers: ["AAPL"],
  exchanges: ["Nasdaq"],
  sic: "3571",
  sicDescription: "Electronic Computers",
  fiscalYearEnd: "0926",
  filings: {
    recent: {
      accessionNumber: ["0000320193-26-000020", "0001140361-26-032884", "0000320193-25-000100"],
      filingDate: ["2026-07-31", "2026-08-13", "2025-11-01"],
      reportDate: ["2026-06-27", "2026-08-11", "2025-09-27"],
      form: ["10-Q", "4", "10-K"],
      primaryDocument: ["aapl-20260627.htm", "xslF345X06/form4.xml", "aapl-20250927.htm"],
      primaryDocDescription: ["10-Q", "FORM 4", "10-K"],
      items: ["", "", ""],
    },
  },
};

describe("parseCompanyInfo", () => {
  it("pads the CIK returned in the submissions body", () => {
    expect(parseCompanyInfo(submissions).cik).toBe("0000320193");
    expect(parseCompanyInfo(submissions).name).toBe("Apple Inc.");
  });
});

describe("parseFilings", () => {
  it("zips the columnar table into rows", () => {
    const rows = parseFilings(submissions, "0000320193");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      form: "10-Q",
      filingDate: "2026-07-31",
      reportDate: "2026-06-27",
      accessionNumber: "0000320193-26-000020",
    });
  });

  it("builds an Archives URL with an unpadded CIK and dashless accession", () => {
    const rows = parseFilings(submissions, "0000320193");
    expect(rows[0]?.url).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm",
    );
  });

  it("filters by form and honours the limit", () => {
    expect(parseFilings(submissions, "0000320193", { forms: ["10-K"] })).toHaveLength(1);
    expect(parseFilings(submissions, "0000320193", { limit: 2 })).toHaveLength(2);
  });

  it("returns nothing rather than throwing when the filings table is absent", () => {
    expect(parseFilings({ cik: "1" }, "0000000001")).toEqual([]);
  });
});

describe("extractMetrics", () => {
  it("falls through the alias list to the concept the filer actually reports", () => {
    const facts = {
      facts: {
        "us-gaap": {
          Revenues: {
            units: {
              USD: [
                {
                  start: "2025-01-01",
                  end: "2025-12-31",
                  val: 500,
                  fy: 2025,
                  fp: "FY",
                  form: "10-K",
                  filed: "2026-02-01",
                  accn: "acc-1",
                },
              ],
            },
          },
        },
      },
    };
    const [series] = extractMetrics(facts, [revenueDef]);
    expect(series?.concept).toBe("Revenues");
    expect(series?.points).toHaveLength(1);
  });

  it("keeps the latest restatement of a period and drops the superseded one", () => {
    const facts = {
      facts: {
        "us-gaap": {
          Revenues: {
            units: {
              USD: [
                {
                  start: "2025-01-01",
                  end: "2025-12-31",
                  val: 500,
                  fp: "FY",
                  form: "10-K",
                  filed: "2026-02-01",
                  accn: "original",
                },
                {
                  start: "2025-01-01",
                  end: "2025-12-31",
                  val: 480,
                  fp: "FY",
                  form: "10-K",
                  filed: "2027-02-01",
                  accn: "restated",
                },
              ],
            },
          },
        },
      },
    };
    const [series] = extractMetrics(facts, [revenueDef]);
    expect(series?.points).toHaveLength(1);
    expect(series?.points[0]).toMatchObject({ value: 480, accession: "restated" });
  });

  it("classifies duration facts by span, so a 10-K's quarterly comparative is not annual", () => {
    const facts = {
      facts: {
        "us-gaap": {
          Revenues: {
            units: {
              USD: [
                {
                  start: "2025-01-01",
                  end: "2025-12-31",
                  val: 500,
                  fp: "FY",
                  form: "10-K",
                  filed: "2026-02-01",
                  accn: "a",
                },
                {
                  start: "2025-10-01",
                  end: "2025-12-31",
                  val: 140,
                  fp: "FY",
                  form: "10-K",
                  filed: "2026-02-01",
                  accn: "a",
                },
              ],
            },
          },
        },
      },
    };
    const [series] = extractMetrics(facts, [revenueDef]);
    const byType = Object.fromEntries(
      (series?.points ?? []).map((point) => [point.periodType, point.value]),
    );
    expect(byType).toEqual({ annual: 500, quarterly: 140 });
  });

  it("classifies instant facts by fiscal period and dedupes on the date alone", () => {
    const facts = {
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: "2025-12-31", val: 1000, fp: "FY", form: "10-K", filed: "2026-02-01", accn: "a" },
                { end: "2025-12-31", val: 990, fp: "FY", form: "10-K", filed: "2025-12-31", accn: "old" },
                { end: "2025-06-30", val: 900, fp: "Q2", form: "10-Q", filed: "2025-08-01", accn: "b" },
              ],
            },
          },
        },
      },
    };
    const [series] = extractMetrics(facts, [assetsDef]);
    expect(series?.points).toHaveLength(2);
    expect(series?.points[0]).toMatchObject({ value: 1000, periodType: "annual" });
    expect(series?.points[1]).toMatchObject({ value: 900, periodType: "quarterly" });
  });

  it("keeps a fiscal year-end balance annual even when a later 10-Q restates it", () => {
    // The FY-end snapshot is re-reported inside the next year's 10-Q as a
    // comparative, tagged with that filing's fiscal period. Classifying on the
    // latest-filed record alone would demote it to quarterly.
    const facts = {
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: "2025-09-27", val: 365000, fp: "FY", form: "10-K", filed: "2025-10-31", accn: "10k" },
                { end: "2025-09-27", val: 365000, fp: "Q3", form: "10-Q", filed: "2026-07-31", accn: "10q" },
              ],
            },
          },
        },
      },
    };
    const [series] = extractMetrics(facts, [assetsDef]);
    expect(series?.points).toHaveLength(1);
    expect(series?.points[0]).toMatchObject({
      periodType: "annual",
      // The value still comes from the most recently filed record.
      accession: "10q",
    });
  });

  it("treats a foreign private issuer's 20-F balance as annual", () => {
    const facts = {
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: "2025-12-31", val: 900, fp: "FY", form: "20-F", filed: "2026-04-01", accn: "a" },
              ],
            },
          },
        },
      },
    };
    expect(extractMetrics(facts, [assetsDef])[0]?.points[0]?.periodType).toBe("annual");
  });

  it("reports an empty series rather than throwing when no alias is present", () => {
    const [series] = extractMetrics({ facts: { "us-gaap": {} } }, [revenueDef]);
    expect(series).toMatchObject({ key: "revenue", concept: null, points: [] });
  });

  it("survives a payload with no facts at all", () => {
    expect(extractMetrics({}, [revenueDef])[0]?.points).toEqual([]);
  });
});

function point(end: string, value: number, start: string | null = null): MetricPoint {
  return {
    end,
    start,
    value,
    fiscalYear: null,
    fiscalPeriod: null,
    periodType: "annual",
    form: "10-K",
    filed: end,
    accession: "x",
    concept: "Revenues",
  };
}

describe("attachYoY", () => {
  it("matches on the date a year earlier, not on array position", () => {
    // 2024 is missing: a positional lag would wrongly compare 2025 against 2023.
    const analyzed = attachYoY([point("2025-12-31", 120), point("2023-12-31", 80)]);
    expect(analyzed[0]?.yoyPercent).toBeNull();
  });

  it("computes growth against the matching prior-year period", () => {
    const analyzed = attachYoY([point("2025-12-31", 120), point("2024-12-31", 100)]);
    expect(analyzed[0]?.yoyPercent).toBe(20);
    expect(analyzed[1]?.yoyPercent).toBeNull();
  });

  it("tolerates a fiscal calendar that shifts by a few days", () => {
    const analyzed = attachYoY([point("2025-09-27", 110), point("2024-09-28", 100)]);
    expect(analyzed[0]?.yoyPercent).toBe(10);
  });

  it("declines to express a loss-to-profit swing as a percentage", () => {
    const analyzed = attachYoY([point("2025-12-31", 50), point("2024-12-31", -25)]);
    expect(analyzed[0]?.yoyPercent).toBeNull();
  });

  it("returns null instead of dividing by a zero base", () => {
    const analyzed = attachYoY([point("2025-12-31", 10), point("2024-12-31", 0)]);
    expect(analyzed[0]?.yoyPercent).toBeNull();
  });
});

describe("buildSeries", () => {
  const series = {
    key: "revenue",
    label: "Revenue",
    unit: "USD",
    concept: "Revenues",
    points: [
      { ...point("2025-12-31", 120), periodType: "annual" as const },
      { ...point("2024-12-31", 100), periodType: "annual" as const },
      { ...point("2025-06-30", 55), periodType: "quarterly" as const },
    ],
  };

  it("keeps only the requested period type", () => {
    expect(buildSeries(series, "quarterly", 10).points).toHaveLength(1);
  });

  it("computes growth before applying the limit, so the newest point keeps its comparison", () => {
    const built = buildSeries(series, "annual", 1);
    expect(built.points).toHaveLength(1);
    expect(built.points[0]?.yoyPercent).toBe(20);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("EdgarClient", () => {
  const endpoints = {
    tickerMap: "https://ticker.test",
    submissions: (cik: string) => `https://submissions.test/${cik}`,
    companyFacts: (cik: string) => `https://facts.test/${cik}`,
  };

  function client(fetchImpl: Fetcher) {
    return new EdgarClient({
      fetchImpl,
      endpoints,
      contactEmail: "test@example.com",
      minIntervalMs: 0,
    });
  }

  it("sends the contact User-Agent EDGAR requires", async () => {
    let seen: string | undefined;
    const edgar = client(((_url: string, init?: RequestInit) => {
      seen = new Headers(init?.headers).get("User-Agent") ?? undefined;
      return Promise.resolve(jsonResponse({ "0": { cik_str: 1, ticker: "A", title: "A" } }));
    }) as Fetcher);

    await edgar.fetchTickerMap();
    expect(seen).toBe("finance-mcp-server test@example.com");
  });

  it("caches the ticker map instead of refetching it per lookup", async () => {
    let calls = 0;
    const edgar = client((() => {
      calls += 1;
      return Promise.resolve(jsonResponse({ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple" } }));
    }) as Fetcher);

    await edgar.resolveTicker("AAPL");
    await edgar.resolveTicker("aapl");
    expect(calls).toBe(1);
  });

  it("explains that a missing ticker means the issuer is not an SEC registrant", async () => {
    const edgar = client((() =>
      Promise.resolve(jsonResponse({ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple" } }))) as Fetcher);

    await expect(edgar.resolveTicker("0700.HK")).rejects.toThrow(/only covers SEC registrants/);
  });

  it("caches the extracted metric slice rather than the multi-megabyte payload", async () => {
    let factsCalls = 0;
    const edgar = client(((url: string) => {
      if (url.startsWith("https://facts.test/")) {
        factsCalls += 1;
        return Promise.resolve(
          jsonResponse({
            facts: {
              "us-gaap": {
                Revenues: {
                  units: {
                    USD: [
                      {
                        start: "2025-01-01",
                        end: "2025-12-31",
                        val: 500,
                        fp: "FY",
                        form: "10-K",
                        filed: "2026-02-01",
                        accn: "a",
                      },
                    ],
                  },
                },
              },
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    }) as Fetcher);

    const first = await edgar.fetchMetrics("0000320193");
    const second = await edgar.fetchMetrics("0000320193");
    expect(factsCalls).toBe(1);
    expect(second).toBe(first);
  });

  it("turns a 404 on company facts into an explanation, not a bare status", async () => {
    const edgar = client((() => Promise.resolve(new Response("", { status: 404 }))) as Fetcher);
    await expect(edgar.fetchMetrics("0000000001")).rejects.toThrow(/no XBRL company facts/);
  });

  it("surfaces the status for other failures", async () => {
    const edgar = client((() => Promise.resolve(new Response("", { status: 429 }))) as Fetcher);
    await expect(edgar.fetchMetrics("0000000001")).rejects.toThrow(/429/);
  });
});
