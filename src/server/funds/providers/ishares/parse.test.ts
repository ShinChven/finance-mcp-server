import { describe, expect, it } from "vitest";
import {
  lookupVenue,
  parseHoldingsPayload,
  parseProductScreener,
  readIsin,
  totalDrops,
  ymdToIso,
} from "./parse.js";

/**
 * Fixtures reproduce the structure these endpoints are known to return. They
 * are not captured live — the build sandbox has no egress to ishares.com — so
 * their job is to pin the parser's behaviour on the shapes it was written for,
 * and to be replaced wholesale the day a real response disagrees.
 */

const SCREENER = JSON.stringify({
  "239726": {
    fundName: "iShares Core S&P 500 ETF",
    localExchangeTicker: "IVV",
    aladdinAssetClass: "Equity",
    aladdinSubAssetClass: "Large Cap",
    aladdinCountry: "United States",
    totalNetAssets: { r: 550000000000, d: "$550,000,000,000" },
    productPageUrl: "/us/products/239726/ishares-core-sp-500-etf",
  },
  "239637": {
    fundName: "iShares MSCI Emerging Markets ETF",
    localExchangeTicker: "EEM",
    aladdinAssetClass: "Equity",
    aladdinCountry: "Emerging Markets",
    totalNetAssets: 18000000000,
    productPageUrl: "/us/products/239637/ishares-msci-emerging-markets-etf",
  },
  "999999": {
    // A share class with no listing — nothing to fetch holdings for.
    fundName: "BlackRock Somewhere Institutional Shares",
    aladdinAssetClass: "Equity",
  },
});

describe("parseProductScreener", () => {
  it("reads products keyed by id, unwrapping {r,d} cells", () => {
    const products = parseProductScreener(SCREENER);
    const ivv = products.find((product) => product.ticker === "IVV");

    expect(ivv).toMatchObject({
      productId: "239726",
      name: "iShares Core S&P 500 ETF",
      assetClass: "Equity",
      country: "United States",
      totalNetAssets: 550000000000,
      productPageUrl: "/us/products/239726/ishares-core-sp-500-etf",
    });
  });

  it("accepts a bare scalar where the screener does not wrap the value", () => {
    const eem = parseProductScreener(SCREENER).find((product) => product.ticker === "EEM");
    expect(eem?.totalNetAssets).toBe(18000000000);
  });

  it("drops rows with no listing ticker", () => {
    // They have no holdings file, so keeping them would make the universe
    // count promise data that can never be cached.
    expect(parseProductScreener(SCREENER)).toHaveLength(2);
  });

  it("returns nothing rather than throwing on a broken payload", () => {
    expect(parseProductScreener("<html>maintenance</html>")).toEqual([]);
    expect(parseProductScreener(null)).toEqual([]);
  });

  it("survives a byte-order mark", () => {
    // Served UTF-8 with a BOM, `JSON.parse` throws on the first character and
    // the whole lineup reads as empty — which the pipeline stored as an index
    // holding no funds.
    expect(parseProductScreener(`\uFEFF${SCREENER}`)).toHaveLength(2);
  });

  it("finds the rows when the payload is wrapped or listed", () => {
    // Recognized by their fields rather than by where they sit, so a container
    // key or an array is read instead of counted as "no funds published".
    const rows = JSON.parse(SCREENER) as Record<string, unknown>;
    expect(parseProductScreener(JSON.stringify({ data: rows }))).toHaveLength(2);
    expect(parseProductScreener(JSON.stringify(Object.values(rows)))).toHaveLength(2);
  });

  it("skips a sibling key that is not a product", () => {
    const rows = JSON.parse(SCREENER) as Record<string, unknown>;
    const withConfig = { config: { columns: ["fundName"] }, ...rows };
    expect(parseProductScreener(JSON.stringify(withConfig))).toHaveLength(2);
  });
});

describe("ymdToIso", () => {
  it("reads the payload's date form", () => {
    expect(ymdToIso(20260815)).toBe("2026-08-15");
    expect(ymdToIso("20260815")).toBe("2026-08-15");
    expect(ymdToIso("-")).toBeNull();
    expect(ymdToIso("not a date")).toBeNull();
  });
});

/**
 * A `holdings.all` payload the way the live plane sends one: columnar, with the
 * `i`th element of every column making up row `i`, and `"-"` where a fund has
 * no value for a field.
 */
function holdingsPayload(overrides: Record<string, unknown[]> = {}) {
  const columns: Record<string, unknown[]> = {
    issueName: [
      "NVIDIA CORP",
      "APPLE INC, CLASS A",
      "BERKSHIRE HATHAWAY INC CLASS B",
      "TENCENT HOLDINGS LTD",
      "TOYOTA MOTOR CORP",
      "KAKAO CORP",
      "SONY GROUP CORP",
      "BLK CSH FND TREASURY SL AGENCY",
      "ORDINARY SHARES ON AN UNSAID BOARD",
      "SOMETHING ON A NEW VENUE",
    ],
    ticker: ["NVDA", "AAPL", "BRK.B", "0700", "7203", "035720", "6758", "XTSLA", "QQQQ", "ZZZZ"],
    assetClass: [
      "Equity",
      "Equity",
      "Equity",
      "Equity",
      "Equity",
      "Equity",
      "Equity",
      "Cash and/or Derivatives",
      "Equity",
      "Equity",
    ],
    exchange: [
      "NASDAQ",
      "New York Stock Exchange Inc.",
      "New York Stock Exchange Inc.",
      "Hong Kong Exchanges And Clearing Ltd",
      "Tokyo Stock Exchange",
      "Korea Exchange (KOSDAQ)",
      "Nasdaq Stockholm",
      "-",
      "Korea Exchange",
      "Interstellar Exchange",
    ],
    isin: [
      "US67066G1040",
      "US0378331005",
      "US0846707026",
      "KYG875721634",
      "JP3633400001",
      "KR7035720002",
      "-",
      "-",
      "-",
      "-",
    ],
    holdingPercent: [7.45, 6.02, 1.64, 0.18, 0.16, 0.04, 0.05, 0.09, 0.01, 0.02],
    ...overrides,
  };
  return {
    fundName: "iShares Core S&P 500 ETF",
    componentsByNameMap: {
      holdings: {
        containersByNameMap: {
          all: {
            dataPointsByNameMap: Object.fromEntries([
              ...Object.entries(columns).map(([name, value]) => [name, { value }]),
              ["asOfDate", { value: 20260815 }],
            ]),
          },
        },
      },
    },
  };
}

describe("parseHoldingsPayload", () => {
  const result = parseHoldingsPayload(holdingsPayload(), "2026-01-01");

  it("takes the report date from the payload rather than the fallback", () => {
    expect(result.asOf).toBe("2026-08-15");
    expect(result.entries[0]?.reportDate).toBe("2026-08-15");
  });

  it("canonicalizes symbols using the exchange column", () => {
    // The whole point of the exchange map: `0700` is meaningless without it,
    // and would land in the same key space as a US ticker.
    const symbols = result.entries.map((entry) => entry.symbol);
    expect(symbols).toContain("NVDA");
    expect(symbols).toContain("AAPL");
    expect(symbols).toContain("0700.HK");
    expect(symbols).toContain("7203.T");
  });

  it("keeps weights as disclosed percentages", () => {
    expect(result.entries.find((entry) => entry.symbol === "NVDA")?.weight).toBeCloseTo(7.45);
  });

  it("reads a name containing a comma", () => {
    expect(result.entries.find((entry) => entry.symbol === "AAPL")?.name).toBe(
      "APPLE INC, CLASS A",
    );
  });

  it("excludes cash rows without counting them as drops", () => {
    // A holdings payload always carries cash and derivative lines. Counting
    // them as parse failures would make the drop alarm permanently loud, and
    // the one genuine failure below invisible.
    expect(result.stats.excluded).toBe(1);
    expect(result.entries.some((entry) => entry.symbol.startsWith("XTSLA"))).toBe(false);
  });

  it("counts an unknown exchange as a drop", () => {
    // This is the alarm: a venue the map does not know means real positions are
    // silently missing from the fund's stored portfolio.
    expect(result.stats.unmappedExchange).toBe(1);
  });

  it("drops an under-specified multi-board venue instead of guessing", () => {
    // "Korea Exchange" without a board could be KOSPI (.KS) or KOSDAQ (.KQ).
    // Guessing would attach the fund to a different company entirely, which no
    // coverage figure downstream would reveal — so it is counted and dropped.
    expect(result.stats.ambiguousExchange).toBe(1);
    expect(result.entries.some((entry) => entry.symbol === "QQQQ.KS")).toBe(false);
    expect(totalDrops(result.stats)).toBe(2);
  });

  it("routes KOSDAQ to .KQ rather than the exchange operator's other board", () => {
    expect(result.entries.find((entry) => entry.name === "KAKAO CORP")?.symbol).toBe("035720.KQ");
  });

  it("routes Nasdaq's Nordic venues away from the US suffix", () => {
    // Regression: the bare "nasdaq" rule sits last precisely so "Nasdaq
    // Stockholm" cannot be read as a US listing.
    expect(result.entries.find((entry) => entry.name === "SONY GROUP CORP")?.symbol).toBe(
      "6758.ST",
    );
  });

  it("spells a US share class the way Yahoo does", () => {
    // `BRK.B` upstream, `BRK-B` on Yahoo. Left alone it is not wrong so much as
    // absent: an instrument row nothing can ever classify.
    expect(result.entries.some((entry) => entry.symbol === "BRK-B")).toBe(true);
  });

  it("keeps the ISIN when the payload carries one", () => {
    expect(result.entries.find((entry) => entry.symbol === "NVDA")?.isin).toBe("US67066G1040");
    // The `"-"` sentinel is not an ISIN; absent and malformed ones stay unset.
    expect(result.entries.find((entry) => entry.symbol === "6758.ST")?.isin).toBeUndefined();
  });

  it("folds a dual-listed name into one position", () => {
    const folded = parseHoldingsPayload(
      holdingsPayload({
        ticker: ["NVDA", "AAPL", "BRK.B", "0700", "7203", "035720", "6758", "XTSLA", "QQQQ", "NVDA"],
        exchange: [
          "NASDAQ",
          "New York Stock Exchange Inc.",
          "New York Stock Exchange Inc.",
          "Hong Kong Exchanges And Clearing Ltd",
          "Tokyo Stock Exchange",
          "Korea Exchange (KOSDAQ)",
          "Nasdaq Stockholm",
          "-",
          "Korea Exchange",
          "NASDAQ",
        ],
        holdingPercent: [7.45, 6.02, 1.64, 0.18, 0.16, 0.04, 0.05, 0.09, 0.01, 0.55],
      }),
      "2026-01-01",
    );
    const nvda = folded.entries.filter((entry) => entry.symbol === "NVDA");
    expect(nvda).toHaveLength(1);
    expect(nvda[0]?.weight).toBeCloseTo(8.0);
  });

  it("counts rows off the columns every fund has, not the bond-only ones", () => {
    // An equity fund carries no `couponRate`; sizing the book by a column it
    // does not have would read a full portfolio as empty.
    const equityOnly = parseHoldingsPayload(holdingsPayload(), "2026-01-01");
    expect(equityOnly.entries.length).toBeGreaterThan(5);
  });

  it("separates a payload that is not the holdings component from an empty book", () => {
    // An unknown component answers with an empty map, and a redirect or error
    // envelope carries no components at all. Neither is "this fund holds
    // nothing" — which is a real answer, with columns of length zero.
    const missing = parseHoldingsPayload({ componentsByNameMap: {} }, "2026-01-01");
    expect(missing.holdingsFound).toBe(false);
    expect(missing.entries).toEqual([]);

    const emptyBook = parseHoldingsPayload(
      holdingsPayload({
        issueName: [],
        ticker: [],
        assetClass: [],
        exchange: [],
        isin: [],
        holdingPercent: [],
      }),
      "2026-01-01",
    );
    expect(emptyBook.holdingsFound).toBe(true);
    expect(emptyBook.entries).toEqual([]);
    expect(totalDrops(emptyBook.stats)).toBe(0);
  });
});

describe("lookupVenue", () => {
  it("prefers the specific board over its family", () => {
    expect(lookupVenue("Korea Exchange (KOSDAQ)")).toEqual({ kind: "known", suffix: ".KQ" });
    expect(lookupVenue("Korea Exchange (Stock Market)")).toEqual({ kind: "known", suffix: ".KS" });
    expect(lookupVenue("London Stock Exchange - International Order Book")).toEqual({
      kind: "known",
      suffix: ".IL",
    });
    expect(lookupVenue("London Stock Exchange")).toEqual({ kind: "known", suffix: ".L" });
    expect(lookupVenue("TSX Venture Exchange")).toEqual({ kind: "known", suffix: ".V" });
    expect(lookupVenue("Toronto Stock Exchange")).toEqual({ kind: "known", suffix: ".TO" });
  });

  it("does not let the US rules swallow a same-brand foreign venue", () => {
    expect(lookupVenue("Nasdaq Copenhagen")).toEqual({ kind: "known", suffix: ".CO" });
    expect(lookupVenue("Nasdaq Helsinki Ltd")).toEqual({ kind: "known", suffix: ".HE" });
    expect(lookupVenue("NASDAQ/NGS (Global Select Market)")).toEqual({ kind: "known", suffix: "" });
  });

  it("separates an under-specified family from a venue it has never seen", () => {
    // The remedies differ: one means the source relabelled a board, the other
    // means the table needs a new rule.
    expect(lookupVenue("Korea Exchange")).toEqual({ kind: "ambiguous" });
    expect(lookupVenue("Interstellar Exchange")).toEqual({ kind: "unknown" });
    expect(lookupVenue(undefined)).toEqual({ kind: "unknown" });
  });

  it("reads the source saying a line trades nowhere as an exclusion", () => {
    // Rights, when-issued lines and derived entries are labelled this way and
    // are not positions in a listed instrument. Counting them as drift would
    // put a non-zero drop count on nearly every US fund, which is how a drop
    // count stops meaning anything.
    expect(lookupVenue("-")).toEqual({ kind: "none" });
    expect(lookupVenue("No Market (Derived Other)")).toEqual({ kind: "none" });
    expect(lookupVenue("Non-Nms Quotation Service (Nnqs)")).toEqual({ kind: "none" });
  });
});

describe("readIsin", () => {
  it("accepts a well-formed ISIN and rejects anything else", () => {
    expect(readIsin("US0378331005")).toBe("US0378331005");
    expect(readIsin(" kyg875721634 ")).toBe("KYG875721634");
    expect(readIsin("037833100")).toBeNull();
    expect(readIsin("")).toBeNull();
    expect(readIsin(undefined)).toBeNull();
  });
});
