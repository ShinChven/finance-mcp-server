import { describe, expect, it } from "vitest";
import {
  fundSizeToMillions,
  looksLikeIndexFund,
  looksLikeOffshoreMandate,
  trackingIndexFromName,
} from "./classify.js";
import type { IsharesProduct } from "./parse.js";

function product(overrides: Partial<IsharesProduct> = {}): IsharesProduct {
  return {
    productId: "239726",
    ticker: "IVV",
    name: "iShares Core S&P 500 ETF",
    assetClass: "Equity",
    subAssetClass: null,
    country: "United States",
    totalNetAssets: 550_000_000_000,
    productPageUrl: "/us/products/239726/ishares-core-sp-500-etf",
    ...overrides,
  };
}

describe("looksLikeOffshoreMandate", () => {
  it("trusts the country field where it is populated", () => {
    expect(looksLikeOffshoreMandate(product())).toBe(false);
    expect(looksLikeOffshoreMandate(product({ country: "Emerging Markets" }))).toBe(true);
  });

  it("falls back to the name when no country is given", () => {
    const named = (name: string) => looksLikeOffshoreMandate(product({ country: null, name }));
    expect(named("iShares MSCI EAFE ETF")).toBe(true);
    expect(named("iShares Core MSCI Total International Stock ETF")).toBe(true);
    expect(named("iShares Core S&P Total U.S. Stock Market ETF")).toBe(false);
  });
});

describe("looksLikeIndexFund", () => {
  it("treats the lineup as index-tracking unless the name says otherwise", () => {
    expect(looksLikeIndexFund(product())).toBe(true);
    expect(looksLikeIndexFund(product({ name: "iShares Flexible Income Active ETF" }))).toBe(false);
  });
});

describe("trackingIndexFromName", () => {
  it("recovers the benchmark the name carries", () => {
    // The screener has no benchmark field, so this is the only route to the
    // index-tracking lookup — the same route a China fund gets from 跟踪标的.
    expect(trackingIndexFromName("iShares Core S&P 500 ETF")).toBe("S&P 500");
    expect(trackingIndexFromName("iShares MSCI Emerging Markets ETF")).toBe(
      "MSCI Emerging Markets",
    );
  });
});

describe("fundSizeToMillions", () => {
  it("converts USD total net assets to the millions the column stores", () => {
    expect(fundSizeToMillions(550_000_000_000)).toBe(550_000);
    expect(fundSizeToMillions(null)).toBeNull();
  });
});
