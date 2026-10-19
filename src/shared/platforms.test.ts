import { describe, expect, it } from "vitest";
import { PLATFORMS, platformLinksFor, type PlatformListing } from "./platforms.js";

function listing(overrides: Partial<PlatformListing> & { symbol: string }): PlatformListing {
  return {
    quoteType: "EQUITY",
    market: "us_market",
    exchange: "NasdaqGS",
    ...overrides,
  };
}

/** The ids a listing can be opened in, which is what the header renders. */
function ids(input: PlatformListing): string[] {
  return platformLinksFor(input).map((link) => link.id);
}

function urlsFor(input: PlatformListing): Record<string, string> {
  return Object.fromEntries(platformLinksFor(input).map((link) => [link.id, link.url]));
}

describe("platform links", () => {
  it("offers every platform for a US equity", () => {
    expect(urlsFor(listing({ symbol: "AAPL" }))).toEqual({
      yahoo: "https://finance.yahoo.com/quote/AAPL",
      tradingview: "https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL",
      moomoo: "https://www.moomoo.com/stock/AAPL-US",
      futu: "https://www.futunn.com/stock/AAPL-US",
      xueqiu: "https://xueqiu.com/S/AAPL",
      eastmoney: "https://quote.eastmoney.com/us/AAPL.html",
    });
  });

  it("respells a share-class ticker per platform", () => {
    const links = urlsFor(listing({ symbol: "BRK-B", exchange: "NYSE" }));
    expect(links.yahoo).toBe("https://finance.yahoo.com/quote/BRK-B");
    expect(links.tradingview).toBe("https://www.tradingview.com/chart/?symbol=NYSE%3ABRK.B");
    expect(links.moomoo).toBe("https://www.moomoo.com/stock/BRK.B-US");
    expect(links.xueqiu).toBe("https://xueqiu.com/S/BRK.B");
    expect(links.eastmoney).toBe("https://quote.eastmoney.com/us/BRK_B.html");
  });

  it("pads a Hong Kong code to five digits, but not for TradingView", () => {
    const links = urlsFor(listing({ symbol: "0700.HK", market: "hk_market", exchange: "HKSE" }));
    expect(links.moomoo).toBe("https://www.moomoo.com/stock/00700-HK");
    expect(links.futu).toBe("https://www.futunn.com/stock/00700-HK");
    expect(links.xueqiu).toBe("https://xueqiu.com/S/00700");
    expect(links.eastmoney).toBe("https://quote.eastmoney.com/hk/00700.html");
    expect(links.tradingview).toBe("https://www.tradingview.com/chart/?symbol=HKEX%3A700");
  });

  it("maps Shanghai and Shenzhen to each platform's own prefix", () => {
    const shanghai = urlsFor(listing({ symbol: "600519.SS", market: "cn_market", exchange: "Shanghai" }));
    expect(shanghai.tradingview).toBe("https://www.tradingview.com/chart/?symbol=SSE%3A600519");
    expect(shanghai.moomoo).toBe("https://www.moomoo.com/stock/600519-SH");
    expect(shanghai.xueqiu).toBe("https://xueqiu.com/S/SH600519");
    expect(shanghai.eastmoney).toBe("https://quote.eastmoney.com/sh600519.html");

    const shenzhen = urlsFor(listing({ symbol: "000001.SZ", market: "cn_market", exchange: "Shenzhen" }));
    expect(shenzhen.tradingview).toBe("https://www.tradingview.com/chart/?symbol=SZSE%3A000001");
    expect(shenzhen.moomoo).toBe("https://www.moomoo.com/stock/000001-SZ");
    expect(shenzhen.xueqiu).toBe("https://xueqiu.com/S/SZ000001");
    expect(shenzhen.eastmoney).toBe("https://quote.eastmoney.com/sz000001.html");
  });

  it("links an ETF like an equity", () => {
    expect(ids(listing({ symbol: "SPY", quoteType: "ETF", exchange: "NYSEArca" }))).toHaveLength(6);
    expect(urlsFor(listing({ symbol: "SPY", quoteType: "ETF", exchange: "NYSEArca" })).tradingview).toBe(
      "https://www.tradingview.com/chart/?symbol=AMEX%3ASPY",
    );
  });

  it("falls back to a bare TradingView ticker on an unfamiliar US exchange", () => {
    expect(urlsFor(listing({ symbol: "IBIT", quoteType: "ETF", exchange: "Cboe BZX" })).tradingview).toBe(
      "https://www.tradingview.com/chart/?symbol=IBIT",
    );
  });

  it("offers Yahoo alone for an index, a crypto pair and a futures contract", () => {
    expect(ids(listing({ symbol: "^GSPC", quoteType: "INDEX", market: "us_market", exchange: "SNP" }))).toEqual([
      "yahoo",
    ]);
    expect(ids(listing({ symbol: "BTC-USD", quoteType: "CRYPTOCURRENCY", market: "ccc_market", exchange: "CCC" }))).toEqual([
      "yahoo",
    ]);
    expect(ids(listing({ symbol: "GC=F", quoteType: "FUTURE", market: "us_market", exchange: "COMEX" }))).toEqual([
      "yahoo",
    ]);
  });

  it("encodes a symbol Yahoo needs escaped", () => {
    expect(PLATFORMS.yahoo.url(listing({ symbol: "^HSI", quoteType: "INDEX" }))).toBe(
      "https://finance.yahoo.com/quote/%5EHSI",
    );
  });

  it("offers Yahoo alone for a market no other platform is mapped for", () => {
    expect(ids(listing({ symbol: "7203.T", market: "jp_market", exchange: "Tokyo" }))).toEqual(["yahoo"]);
    expect(ids(listing({ symbol: "VFIAX", quoteType: "MUTUALFUND", exchange: "Nasdaq" }))).toEqual(["yahoo"]);
  });

  it("offers Yahoo alone when the quote says nothing about the market", () => {
    expect(ids({ symbol: "AAPL", quoteType: null, market: null, exchange: null })).toEqual(["yahoo"]);
  });
});
