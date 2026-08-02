import { describe, expect, it } from "vitest";
import {
  parseFundCodeList,
  parseFundProfileJs,
  parseHoldings,
  parseNavHistory,
} from "./parse.js";

/**
 * Fixtures reproduce the documented shape of each Eastmoney endpoint. They are
 * the contract: when an endpoint changes, update the fixture here first and the
 * parser follows — nothing downstream needs to know.
 */

describe("parseFundCodeList", () => {
  it("extracts codes, names and types from the JS array", () => {
    const source =
      'var r = [["000001","HXCZHH","华夏成长混合","混合型","HUAXIACHENGZHANGHUNHE"],' +
      '["162411","HBYQLOF","华宝标普石油天然气上游LOF","QDII","HUABAO"]];';

    expect(parseFundCodeList(source)).toEqual([
      { code: "000001", name: "华夏成长混合", fundType: "混合型", pinyin: "HXCZHH" },
      {
        code: "162411",
        name: "华宝标普石油天然气上游LOF",
        fundType: "QDII",
        pinyin: "HBYQLOF",
      },
    ]);
  });

  it("skips malformed rows instead of throwing", () => {
    const source = 'var r = [["bad"],["000002","X","名称","股票型","P"],null];';
    expect(parseFundCodeList(source).map((entry) => entry.code)).toEqual(["000002"]);
  });

  it("returns an empty list when the payload is not parseable", () => {
    expect(parseFundCodeList("<html>blocked</html>")).toEqual([]);
  });
});

describe("parseNavHistory", () => {
  it("reads NAV points and coerces numeric strings", () => {
    const payload = JSON.stringify({
      Data: {
        LSJZList: [
          { FSRQ: "2026-07-31", DWJZ: "1.2340", LJJZ: "3.4560", JZZZL: "0.53" },
          { FSRQ: "2026-07-30", DWJZ: "1.2275", LJJZ: "3.4495", JZZZL: "-1.02" },
        ],
      },
    });

    expect(parseNavHistory(payload)).toEqual([
      { navDate: "2026-07-31", nav: 1.234, accNav: 3.456, dailyReturn: 0.53 },
      { navDate: "2026-07-30", nav: 1.2275, accNav: 3.4495, dailyReturn: -1.02 },
    ]);
  });

  it("treats placeholder values as null rather than zero", () => {
    const payload = JSON.stringify({
      Data: { LSJZList: [{ FSRQ: "2026-07-31", DWJZ: "1.10", LJJZ: "1.10", JZZZL: "---" }] },
    });
    // A missing daily return is unknown, not a flat day.
    expect(parseNavHistory(payload)[0]?.dailyReturn).toBeNull();
  });

  it("tolerates an unexpected payload", () => {
    expect(parseNavHistory("not json")).toEqual([]);
    expect(parseNavHistory({ Data: {} })).toEqual([]);
  });
});

describe("parseHoldings", () => {
  const jsonp =
    'var apidata={ content:"' +
    '<div><h4><label>2026年第一季度股票投资明细</label><label>截止至：2026-03-31</label></h4>' +
    "<table class='w782'><thead><tr><th>序号</th><th>股票代码</th><th>股票名称</th><th>占净值比例</th></tr></thead>" +
    "<tbody>" +
    "<tr><td>1</td><td>NVDA</td><td>英伟达</td><td>9.85%</td></tr>" +
    "<tr><td>2</td><td>600519</td><td>贵州茅台</td><td>7.20%</td></tr>" +
    "<tr><td>3</td><td>00700</td><td>腾讯控股</td><td>5.10%</td></tr>" +
    "</tbody></table></div>" +
    '",arryear:[2026],curyear:2026};';

  it("parses holdings with the report date and canonical symbols", () => {
    expect(parseHoldings(jsonp)).toEqual([
      { symbol: "NVDA", name: "英伟达", weight: 9.85, reportDate: "2026-03-31" },
      { symbol: "600519.SS", name: "贵州茅台", weight: 7.2, reportDate: "2026-03-31" },
      { symbol: "0700.HK", name: "腾讯控股", weight: 5.1, reportDate: "2026-03-31" },
    ]);
  });

  it("returns nothing when no report date can be established", () => {
    const undated =
      'var apidata={ content:"<table><tr><td>1</td><td>NVDA</td><td>英伟达</td><td>9.85%</td></tr></table>",arryear:[]};';
    // Holdings without a period are unusable — dropping them beats guessing.
    expect(parseHoldings(undated)).toEqual([]);
  });

  it("deduplicates a symbol repeated within one report", () => {
    const duplicated = jsonp.replace(
      "<tr><td>3</td><td>00700</td><td>腾讯控股</td><td>5.10%</td></tr>",
      "<tr><td>3</td><td>NVDA</td><td>英伟达</td><td>9.85%</td></tr>",
    );
    expect(parseHoldings(duplicated).filter((row) => row.symbol === "NVDA")).toHaveLength(1);
  });
});

describe("parseFundProfileJs", () => {
  it("reads the name, fee and portfolio codes", () => {
    const source = [
      'var fS_name = "华宝标普石油天然气上游LOF";',
      'var fS_code = "162411";',
      'var fund_Rate = "1.20";',
      'var stockCodesNew = ["6005191","0000022","AAPL"];',
    ].join("\n");

    const profile = parseFundProfileJs("162411", source);
    expect(profile.name).toBe("华宝标普石油天然气上游LOF");
    expect(profile.feeRate).toBe(1.2);
    // `stockCodesNew` appends a market digit that must be stripped.
    expect(profile.stockSymbols).toEqual(["600519.SS", "000002.SZ", "AAPL"]);
  });

  it("degrades to empty fields on an unexpected body", () => {
    const profile = parseFundProfileJs("162411", "");
    expect(profile).toEqual({ code: "162411", name: null, feeRate: null, stockSymbols: [] });
  });
});
