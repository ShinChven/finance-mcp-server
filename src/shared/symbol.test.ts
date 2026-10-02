import { describe, expect, it } from "vitest";
import {
  boardQuerySchema,
  normalizeSymbol,
  parseSymbolParams,
  resolveInterval,
  SYMBOL_PARAM_DEFAULTS,
  symbolPath,
  tabsFor,
} from "./symbol.js";

describe("symbol addressing", () => {
  it("accepts every shape a Yahoo symbol takes and uppercases it", () => {
    for (const symbol of ["nvda", "0700.HK", "BRK-B", "^GSPC", "BTC-USD", "GC=F", "EURUSD=X"]) {
      expect(normalizeSymbol(symbol)).toBe(symbol.toUpperCase());
    }
  });

  it("refuses anything that could not be a symbol", () => {
    expect(normalizeSymbol("")).toBeNull();
    expect(normalizeSymbol("NV DA")).toBeNull();
    expect(normalizeSymbol("../etc")).toBeNull();
    expect(normalizeSymbol("x".repeat(33))).toBeNull();
  });

  it("encodes the caret so the router does not read it literally", () => {
    expect(symbolPath("^gspc")).toBe("/symbol/%5EGSPC");
  });
});

describe("parseSymbolParams", () => {
  it("defaults everything when the URL carries nothing", () => {
    expect(parseSymbolParams(new URLSearchParams())).toEqual(SYMBOL_PARAM_DEFAULTS);
  });

  it("reads every field it knows", () => {
    const params = parseSymbolParams(
      new URLSearchParams(
        "tab=options&range=5y&style=line&interval=1wk&ind=macd,rsi&statement=balance&period=quarterly&expiry=2026-12-18&form=10-K&list=abc",
      ),
    );
    expect(params).toEqual({
      tab: "options",
      range: "5y",
      style: "line",
      interval: "1wk",
      ind: ["macd", "rsi"],
      statement: "balance",
      period: "quarterly",
      expiry: "2026-12-18",
      form: "10-K",
      list: "abc",
    });
  });

  it("drops a malformed field without losing the others", () => {
    const params = parseSymbolParams(new URLSearchParams("tab=bogus&range=1m&expiry=soon"));
    expect(params.tab).toBe("summary");
    expect(params.range).toBe("1m");
    expect(params.expiry).toBe("");
  });
});

describe("resolveInterval", () => {
  it("fixes intraday granularity regardless of the requested interval", () => {
    expect(resolveInterval("1d", "1mo")).toBe("5m");
    expect(resolveInterval("5d", "auto")).toBe("15m");
  });

  it("widens candles as the window grows when left on auto", () => {
    expect(resolveInterval("6m", "auto")).toBe("1d");
    expect(resolveInterval("1y", "auto")).toBe("1d");
    expect(resolveInterval("5y", "auto")).toBe("1wk");
    expect(resolveInterval("max", "auto")).toBe("1mo");
  });

  it("honours an explicit interval on a daily range", () => {
    expect(resolveInterval("1y", "1wk")).toBe("1wk");
  });
});

describe("tabsFor", () => {
  it("offers a US stock everything", () => {
    expect(tabsFor("EQUITY", "us_market")).toHaveLength(8);
  });

  it("drops options and SEC filings for a listing outside the US", () => {
    const tabs = tabsFor("EQUITY", "cn_market");
    expect(tabs).not.toContain("options");
    expect(tabs).not.toContain("filings");
    expect(tabs).toContain("financials");
  });

  it("keeps an index or a crypto pair to what it can fill", () => {
    expect(tabsFor("INDEX", "us_market")).toEqual(["summary", "news"]);
    expect(tabsFor("CRYPTOCURRENCY", "ccc_market")).toEqual(["summary", "news"]);
    expect(tabsFor("ETF", "us_market")).toEqual(["summary", "options", "news"]);
  });
});

describe("boardQuerySchema", () => {
  it("splits, uppercases, de-duplicates and drops junk", () => {
    const parsed = boardQuerySchema.parse({ symbols: "nvda, ^gspc,NVDA,bad sym" });
    expect(parsed.symbols).toEqual(["NVDA", "^GSPC"]);
  });

  it("leaves the default board in place when nothing is asked for", () => {
    expect(boardQuerySchema.parse({}).symbols).toBeUndefined();
  });
});
