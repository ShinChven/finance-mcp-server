import { describe, expect, it } from "vitest";
import {
  parseAsOfDate,
  parseHoldingsCsv,
  parseProductScreener,
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
 
Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Shares,Price,Location,Exchange,Currency
NVDA,NVIDIA CORP,Information Technology,Equity,"41,000,000,000.00",7.45,"200,000,000.00",205.00,United States,NASDAQ,USD
AAPL,"APPLE INC, CLASS A",Information Technology,Equity,"33,000,000,000.00",6.02,"140,000,000.00",235.00,United States,New York Stock Exchange Inc.,USD
0700,TENCENT HOLDINGS LTD,Communication,Equity,"1,000,000,000.00",0.18,"20,000,000.00",50.00,China,Hong Kong Exchanges And Clearing Ltd,HKD
7203,TOYOTA MOTOR CORP,Consumer Discretionary,Equity,"900,000,000.00",0.16,"30,000,000.00",30.00,Japan,Tokyo Stock Exchange,JPY
XTSLA,BLK CSH FND TREASURY SL AGENCY,Cash and/or Derivatives,Cash and/or Derivatives,"500,000,000.00",0.09,"500,000,000.00",1.00,United States,-,USD
ZZZZ,SOMETHING ON A NEW VENUE,Industrials,Equity,"100,000,000.00",0.02,"1,000,000.00",100.00,Nowhere,Interstellar Exchange,USD
 
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
    expect(totalDrops(result.stats)).toBe(1);
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
