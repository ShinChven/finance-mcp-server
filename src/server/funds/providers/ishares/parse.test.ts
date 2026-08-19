import { describe, expect, it } from "vitest";
import {
  lookupVenue,
  parseAsOfDate,
  parseHoldingsCsv,
  parseProductScreener,
  readIsin,
  splitCsvLine,
  totalDrops,
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
});

describe("splitCsvLine", () => {
  it("honours quoted commas and doubled quotes", () => {
    expect(splitCsvLine('AAPL,"Apple, Inc.",5.12')).toEqual(["AAPL", "Apple, Inc.", "5.12"]);
    expect(splitCsvLine('X,"He said ""hi""",1')).toEqual(["X", 'He said "hi"', "1"]);
  });
});

describe("parseAsOfDate", () => {
  it("reads the formats the preamble uses", () => {
    expect(parseAsOfDate('"Aug 15, 2026"')).toBe("2026-08-15");
    expect(parseAsOfDate("2026-08-15")).toBe("2026-08-15");
    expect(parseAsOfDate("not a date")).toBeNull();
  });
});

const HOLDINGS_CSV = `iShares Core S&P 500 ETF
Fund Holdings as of,"Aug 15, 2026"
Inception Date,"May 15, 2000"
Shares Outstanding,"1,000,000,000.00"
 
Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Shares,Price,Location,Exchange,Currency,ISIN
NVDA,NVIDIA CORP,Information Technology,Equity,"41,000,000,000.00",7.45,"200,000,000.00",205.00,United States,NASDAQ,USD,US67066G1040
AAPL,"APPLE INC, CLASS A",Information Technology,Equity,"33,000,000,000.00",6.02,"140,000,000.00",235.00,United States,New York Stock Exchange Inc.,USD,US0378331005
BRK.B,BERKSHIRE HATHAWAY INC CLASS B,Financials,Equity,"9,000,000,000.00",1.64,"20,000,000.00",450.00,United States,New York Stock Exchange Inc.,USD,US0846707026
0700,TENCENT HOLDINGS LTD,Communication,Equity,"1,000,000,000.00",0.18,"20,000,000.00",50.00,China,Hong Kong Exchanges And Clearing Ltd,HKD,KYG875721634
7203,TOYOTA MOTOR CORP,Consumer Discretionary,Equity,"900,000,000.00",0.16,"30,000,000.00",30.00,Japan,Tokyo Stock Exchange,JPY,JP3633400001
035720,KAKAO CORP,Communication,Equity,"200,000,000.00",0.04,"1,000,000.00",40.00,Korea,Korea Exchange (KOSDAQ),KRW,KR7035720002
6758,SONY GROUP CORP,Consumer Discretionary,Equity,"300,000,000.00",0.05,"2,000,000.00",25.00,Japan,Nasdaq Stockholm,SEK,
XTSLA,BLK CSH FND TREASURY SL AGENCY,Cash and/or Derivatives,Cash and/or Derivatives,"500,000,000.00",0.09,"500,000,000.00",1.00,United States,-,USD,
QQQQ,ORDINARY SHARES ON AN UNSAID BOARD,Industrials,Equity,"50,000,000.00",0.01,"500,000.00",100.00,Korea,Korea Exchange,KRW,
ZZZZ,SOMETHING ON A NEW VENUE,Industrials,Equity,"100,000,000.00",0.02,"1,000,000.00",100.00,Nowhere,Interstellar Exchange,USD,
 
The performance quoted represents past performance and does not guarantee future results.
`;

describe("parseHoldingsCsv", () => {
  const result = parseHoldingsCsv(HOLDINGS_CSV, "2026-01-01");

  it("takes the report date from the preamble rather than the fallback", () => {
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

  it("reads a quoted name containing a comma", () => {
    expect(result.entries.find((entry) => entry.symbol === "AAPL")?.name).toBe(
      "APPLE INC, CLASS A",
    );
  });

  it("excludes cash rows without counting them as drops", () => {
    // A holdings file always carries cash and derivative lines. Counting them
    // as parse failures would make the drop alarm permanently loud, and the
    // one genuine failure below invisible.
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
    // `BRK.B` in the file, `BRK-B` on Yahoo. Left alone it is not wrong so much
    // as absent: an instrument row nothing can ever classify.
    expect(result.entries.some((entry) => entry.symbol === "BRK-B")).toBe(true);
  });

  it("keeps the ISIN when the file carries one", () => {
    expect(result.entries.find((entry) => entry.symbol === "NVDA")?.isin).toBe("US67066G1040");
    // Absent, malformed or empty ISINs are simply not set.
    expect(result.entries.find((entry) => entry.symbol === "6758.ST")?.isin).toBeUndefined();
  });

  it("returns nothing when the header row is absent", () => {
    // An error page or a redirect must not be read as an empty portfolio with
    // a straight face — but it must not throw either, or one bad fund kills
    // the run.
    const empty = parseHoldingsCsv("<html>Access Denied</html>", "2026-01-01");
    expect(empty.entries).toEqual([]);
    expect(totalDrops(empty.stats)).toBe(0);
  });

  it("folds a dual-listed name into one position", () => {
    const csv = HOLDINGS_CSV.replace(
      "ZZZZ,SOMETHING ON A NEW VENUE,Industrials,Equity,\"100,000,000.00\",0.02,\"1,000,000.00\",100.00,Nowhere,Interstellar Exchange,USD",
      "NVDA,NVIDIA CORP,Information Technology,Equity,\"1,000,000.00\",0.55,\"1,000,000.00\",100.00,United States,NASDAQ,USD",
    );
    const folded = parseHoldingsCsv(csv, "2026-01-01");
    const nvda = folded.entries.filter((entry) => entry.symbol === "NVDA");
    expect(nvda).toHaveLength(1);
    expect(nvda[0]?.weight).toBeCloseTo(8.0);
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
    expect(lookupVenue("-")).toEqual({ kind: "unknown" });
    expect(lookupVenue(undefined)).toEqual({ kind: "unknown" });
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
