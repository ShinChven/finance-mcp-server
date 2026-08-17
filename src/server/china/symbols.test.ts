import { describe, expect, it } from "vitest";
import { currencyOf, looksLikeQdii, marketOf, toCanonicalSymbol } from "./symbols.js";

describe("toCanonicalSymbol", () => {
  it("suffixes CN exchange codes by prefix", () => {
    expect(toCanonicalSymbol("600519")).toBe("600519.SS");
    expect(toCanonicalSymbol("688981")).toBe("688981.SS");
    expect(toCanonicalSymbol("000002")).toBe("000002.SZ");
    expect(toCanonicalSymbol("300750")).toBe("300750.SZ");
    expect(toCanonicalSymbol("830799")).toBe("830799.BJ");
  });

  it("collapses HK codes to Yahoo's four-digit form", () => {
    expect(toCanonicalSymbol("00700")).toBe("0700.HK");
    expect(toCanonicalSymbol("9988")).toBe("9988.HK");
  });

  it("passes through US tickers and already-suffixed symbols", () => {
    expect(toCanonicalSymbol("NVDA")).toBe("NVDA");
    expect(toCanonicalSymbol("brk-b")).toBe("BRK-B");
    expect(toCanonicalSymbol("0700.HK")).toBe("0700.HK");
  });

  it("routes Tokyo's alphanumeric codes to .T", () => {
    // TSE started issuing these in 2024; 285A is Kioxia.
    expect(toCanonicalSymbol("285A")).toBe("285A.T");
    expect(toCanonicalSymbol("130A")).toBe("130A.T");
    expect(marketOf("285A.T")).toBe("JP");
    // Purely numeric 4-digit codes stay HK — the two forms are ambiguous and
    // Eastmoney renders HK holdings this way.
    expect(toCanonicalSymbol("9988")).toBe("9988.HK");
  });

  it("rejects input it cannot classify", () => {
    expect(toCanonicalSymbol("")).toBeUndefined();
    expect(toCanonicalSymbol("贵州茅台")).toBeUndefined();
  });
});

describe("marketOf / currencyOf", () => {
  it("derives market and currency from the suffix", () => {
    expect(marketOf("600519.SS")).toBe("CN");
    expect(marketOf("0700.HK")).toBe("HK");
    expect(marketOf("AAPL")).toBe("US");
    expect(marketOf("7203.T")).toBe("JP");

    expect(currencyOf("CN")).toBe("CNY");
    expect(currencyOf("HK")).toBe("HKD");
    expect(currencyOf("JP")).toBe("JPY");
  });
});

describe("looksLikeQdii", () => {
  it("detects the explicit type and offshore mandates in the name", () => {
    expect(looksLikeQdii("QDII", "华宝油气")).toBe(true);
    expect(looksLikeQdii("指数型", "国泰纳斯达克100ETF")).toBe(true);
    expect(looksLikeQdii("股票型", "易方达消费行业")).toBe(false);
  });
});
