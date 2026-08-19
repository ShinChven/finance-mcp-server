import { describe, expect, it } from "vitest";
import { fundSizeToMillions, looksLikeIndexFund, looksLikeOffshoreMandate } from "./classify.js";

describe("looksLikeOffshoreMandate", () => {
  it("detects the explicit type and offshore mandates in the name", () => {
    expect(looksLikeOffshoreMandate("QDII", "华宝油气")).toBe(true);
    expect(looksLikeOffshoreMandate("指数型", "国泰纳斯达克100ETF")).toBe(true);
    expect(looksLikeOffshoreMandate("股票型", "易方达消费行业")).toBe(false);
  });
});

describe("looksLikeIndexFund", () => {
  it("reads the mandate out of the type and the name", () => {
    expect(looksLikeIndexFund("股票指数", "沪深300ETF")).toBe(true);
    expect(looksLikeIndexFund("混合型", "易方达蓝筹精选")).toBe(false);
  });
});

describe("fundSizeToMillions", () => {
  it("converts 亿元 to the millions the column stores", () => {
    // Without this the column mixes units across providers: a 50亿 China fund
    // would sort above a $400bn US ETF.
    expect(fundSizeToMillions(50)).toBe(5000);
    expect(fundSizeToMillions(null)).toBeNull();
  });
});
