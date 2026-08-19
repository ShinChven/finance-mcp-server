import { describe, expect, it } from "vitest";
import {
  parseFundBasics,
  parseFundCodeList,
  parseFundProfileJs,
  parseHoldings,
  parseHoldingsWithStats,
  parseNavHistory,
  totalDrops,
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

  it("keeps holdings whose code is a Tokyo alphanumeric ticker", () => {
    // Regression: `285A` (Kioxia) matched neither the code pattern nor the
    // canonical-symbol rules, so a QDII's Japanese positions vanished silently.
    const withTokyo = jsonp.replace(
      "<tr><td>3</td><td>00700</td><td>腾讯控股</td><td>5.10%</td></tr>",
      "<tr><td>3</td><td>285A</td><td>KIOXIA</td><td>5.89%</td></tr>",
    );
    expect(parseHoldings(withTokyo)).toContainEqual({
      symbol: "285A.T",
      name: "KIOXIA",
      weight: 5.89,
      reportDate: "2026-03-31",
    });
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

  describe("drop counting", () => {
    it("reports nothing dropped for a clean table", () => {
      const { entries, stats } = parseHoldingsWithStats(jsonp);
      expect(entries).toHaveLength(3);
      expect(stats).toEqual({ noCode: 0, unmappedSymbol: 0, noWeight: 0 });
      expect(totalDrops(stats)).toBe(0);
    });

    it("counts a row whose code shape is unrecognised", () => {
      // The shape of the `285A` bug: a real holding the code pattern misses.
      // Before the counter this returned two rows and said nothing.
      const unknownCode = jsonp.replace(
        "<tr><td>3</td><td>00700</td><td>腾讯控股</td><td>5.10%</td></tr>",
        "<tr><td>3</td><td>12345678</td><td>某新市场</td><td>5.10%</td></tr>",
      );
      const { entries, stats } = parseHoldingsWithStats(unknownCode);
      expect(entries).toHaveLength(2);
      expect(stats.noCode).toBe(1);
      expect(totalDrops(stats)).toBe(1);
    });

    it("counts a row with a code but no readable weight", () => {
      const noWeight = jsonp.replace(
        "<tr><td>3</td><td>00700</td><td>腾讯控股</td><td>5.10%</td></tr>",
        "<tr><td>3</td><td>00700</td><td>腾讯控股</td><td>---</td></tr>",
      );
      const { entries, stats } = parseHoldingsWithStats(noWeight);
      expect(entries).toHaveLength(2);
      expect(stats.noWeight).toBe(1);
    });

    it("does not count header or subtotal rows as drops", () => {
      // Both carry no usable code; neither is missing data. Counting them would
      // make every healthy table report drops and train the reader to ignore it.
      const withSubtotal = jsonp.replace(
        "</tbody>",
        "<tr><td></td><td>股票投资合计</td><td></td><td>22.15%</td></tr></tbody>",
      );
      const { entries, stats } = parseHoldingsWithStats(withSubtotal);
      expect(entries).toHaveLength(3);
      expect(totalDrops(stats)).toBe(0);
    });
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

describe("parseFundBasics", () => {
  const html = `
    <table class="info w790">
      <tr><th>基金全称</th><td>国泰纳斯达克100交易型开放式指数证券投资基金</td>
          <th>基金简称</th><td>国泰纳斯达克100ETF</td></tr>
      <tr><th>基金代码</th><td>513100</td><th>基金类型</th><td>国际(QDII)</td></tr>
      <tr><th>跟踪标的</th><td>纳斯达克100指数</td><th>基金管理人</th><td>国泰基金</td></tr>
      <tr><th>管理费率</th><td>0.80%（每年）</td><th>资产规模</th><td>123.45亿元（截止至：2026-03-31）</td></tr>
      <tr><th>基金经理人</th><td>某某某</td><th>成立日期</th><td>2013-04-25</td></tr>
    </table>`;

  it("reads the tracking index and profile fields", () => {
    expect(parseFundBasics("513100", html)).toEqual({
      code: "513100",
      name: "国泰纳斯达克100交易型开放式指数证券投资基金",
      fundType: "国际(QDII)",
      trackingIndex: "纳斯达克100指数",
      company: "国泰基金",
      manager: "某某某",
      feeRate: 0.8,
      fundSize: 123.45,
    });
  });

  it("treats an absent mandate as null", () => {
    const active = html.replace("<td>纳斯达克100指数</td>", "<td>该基金无跟踪标的</td>");
    expect(parseFundBasics("513100", active).trackingIndex).toBeNull();
  });

  it("does not borrow 业绩比较基准 as a tracking index", () => {
    const active = html.replace(
      "<th>跟踪标的</th><td>纳斯达克100指数</td>",
      "<th>业绩比较基准</th><td>沪深300指数收益率×80%+中债总指数×20%</td>",
    );
    // An active fund's blended benchmark is not a mandate — filling trackingIndex
    // from it would make every active fund look like an index fund.
    expect(parseFundBasics("513100", active).trackingIndex).toBeNull();
  });

  it("degrades to nulls on an unexpected page", () => {
    const basics = parseFundBasics("513100", "<html>404</html>");
    expect(basics.trackingIndex).toBeNull();
    expect(basics.name).toBeNull();
    expect(basics.feeRate).toBeNull();
  });
});
