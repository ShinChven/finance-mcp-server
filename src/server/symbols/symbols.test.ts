import { describe, expect, it } from "vitest";
import { buildAnalysis } from "./analysis.js";
import { buildEarningsView } from "./earnings.js";
import { buildNews } from "./news.js";
import { buildOptionChain, maxPain } from "./options.js";
import { buildProfile, profileModules } from "./profile.js";
import { identityFromQuote, sessionFromQuote, symbolQuoteFrom } from "./quote.js";
import { buildStatement, statementStart } from "./statements.js";

describe("quote", () => {
  const raw = {
    symbol: "NVDA",
    longName: "NVIDIA Corporation",
    shortName: "NVIDIA Corp",
    fullExchangeName: "NasdaqGS",
    quoteType: "EQUITY",
    market: "us_market",
    currency: "USD",
    exchangeTimezoneName: "America/New_York",
    regularMarketPrice: 120,
    regularMarketChange: 2,
    regularMarketChangePercent: 1.69,
    regularMarketOpen: 118.5,
    bid: 119.9,
    ask: 120.1,
    marketState: "REGULAR",
    earningsTimestamp: new Date("2026-11-19T21:00:00Z"),
  };

  it("reads identity with the long name preferred", () => {
    expect(identityFromQuote(raw)).toEqual({
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      exchange: "NasdaqGS",
      quoteType: "EQUITY",
      market: "us_market",
      currency: "USD",
      timezone: "America/New_York",
    });
  });

  it("reads the session and prices through the watchlist's own reader", () => {
    const session = sessionFromQuote(raw);
    expect(session.open).toBe(118.5);
    expect(session.earningsAt).toBe("2026-11-19T21:00:00.000Z");
    expect(symbolQuoteFrom(raw).live).toMatchObject({ price: 120, changePercent: 1.69, available: true });
  });
});

describe("profile", () => {
  it("asks a stock, a fund and an index for different modules", () => {
    expect(profileModules("EQUITY")).toContain("institutionOwnership");
    expect(profileModules("ETF")).toContain("topHoldings");
    expect(profileModules("ETF")).not.toContain("institutionOwnership");
    expect(profileModules("INDEX")).toEqual(["price", "quoteType", "summaryProfile", "summaryDetail"]);
  });

  it("turns every fractional ratio into a percentage", () => {
    const profile = buildProfile(
      "NVDA",
      {
        price: { longName: "NVIDIA Corporation", currency: "USD", quoteType: "EQUITY", marketCap: 3e12 },
        quoteType: { quoteType: "EQUITY" },
        assetProfile: {
          sector: "Technology",
          industry: "Semiconductors",
          fullTimeEmployees: 36000,
          longBusinessSummary: "Makes GPUs.",
          companyOfficers: [{ name: "Jensen Huang", title: "CEO", age: 62 }],
        },
        summaryDetail: {
          dividendYield: 0.0003,
          payoutRatio: 0.012,
          fiveYearAvgDividendYield: 0.1,
          trailingPE: 55.2,
        },
        defaultKeyStatistics: {
          shortPercentOfFloat: 0.011,
          lastSplitFactor: "10:1",
          lastSplitDate: 1717977600,
        },
        financialData: {
          grossMargins: 0.75,
          operatingMargins: 0.62,
          targetMeanPrice: 150,
          recommendationKey: "strong_buy",
          debtToEquity: 17.2,
          financialCurrency: "USD",
        },
        calendarEvents: {
          earnings: { earningsDate: [new Date("2026-11-19T00:00:00Z")], earningsAverage: 0.9 },
          exDividendDate: new Date("2026-09-11T00:00:00Z"),
        },
        recommendationTrend: { trend: [{ period: "0m", strongBuy: 10, buy: 30, hold: 5, sell: 1, strongSell: 0 }] },
        institutionOwnership: {
          ownershipList: [
            { organization: "Small", pctHeld: 0.01, position: 1, value: 1, reportDate: new Date("2026-06-30") },
            { organization: "Vanguard", pctHeld: 0.09, position: 9, value: 9, reportDate: new Date("2026-06-30"), pctChange: 0.02 },
          ],
        },
      },
      profileModules("EQUITY"),
    );

    expect(profile.name).toBe("NVIDIA Corporation");
    expect(profile.company?.officers[0]).toMatchObject({ name: "Jensen Huang", title: "CEO" });
    expect(profile.profitability.grossMarginPercent).toBe(75);
    expect(profile.dividends.yieldPercent).toBe(0.03);
    expect(profile.dividends.payoutRatioPercent).toBe(1.2);
    // Already a percentage upstream — left as is rather than multiplied again.
    expect(profile.dividends.fiveYearAverageYieldPercent).toBe(0.1);
    expect(profile.dividends.lastSplitDate).toBe("2024-06-10");
    expect(profile.shares.shortPercentOfFloat).toBe(1.1);
    expect(profile.financials.debtToEquity).toBe(17.2);
    expect(profile.analyst?.targetMean).toBe(150);
    expect(profile.analyst?.trend[0]?.buy).toBe(30);
    expect(profile.events.nextEarnings).toBe("2026-11-19");
    expect(profile.dividends.exDividendDate).toBe("2026-09-11");
    // Largest holder first, regardless of upstream order.
    expect(profile.ownership.institutions.map((row) => row.organization)).toEqual(["Vanguard", "Small"]);
    expect(profile.ownership.institutions[0]?.percentChange).toBe(2);
    expect(profile.fund).toBeNull();
    expect(profile.degraded).toEqual(
      expect.arrayContaining(["upgradeDowngradeHistory", "fundOwnership", "insiderTransactions"]),
    );
  });

  it("reads a fund's holdings, sectors and allocation", () => {
    const profile = buildProfile(
      "QQQ",
      {
        price: { longName: "Invesco QQQ Trust", quoteType: "ETF" },
        quoteType: { quoteType: "ETF" },
        summaryDetail: { totalAssets: 3e11, yield: 0.006 },
        fundProfile: { family: "Invesco", categoryName: "Large Growth", feesExpensesInvestment: { annualReportExpenseRatio: 0.002 } },
        topHoldings: {
          stockPosition: 0.995,
          cashPosition: 0.005,
          holdings: [{ symbol: "AAPL", holdingName: "Apple Inc", holdingPercent: 0.09 }],
          sectorWeightings: [{ technology: 0.5 }, { healthcare: 0.06 }, { energy: 0 }],
        },
      },
      profileModules("ETF"),
    );
    expect(profile.fund).toMatchObject({
      family: "Invesco",
      category: "Large Growth",
      expenseRatioPercent: 0.2,
      yieldPercent: 0.6,
      holdings: [{ symbol: "AAPL", name: "Apple Inc", percent: 9 }],
      sectors: [
        { sector: "technology", percent: 50 },
        { sector: "healthcare", percent: 6 },
      ],
      allocation: { stock: 99.5, cash: 0.5, bond: null, other: null },
    });
    expect(profile.analyst).toBeNull();
  });
});

describe("earnings view", () => {
  it("adds the reported bars to the tool's own analysis", () => {
    const view = buildEarningsView("NVDA", {
      earningsHistory: {
        history: [
          { quarter: new Date("2026-04-30"), epsActual: 0.9, epsEstimate: 0.8 },
          { quarter: new Date("2026-07-31"), epsActual: 1.1, epsEstimate: 1.0 },
        ],
      },
      earnings: {
        financialCurrency: "USD",
        financialsChart: {
          quarterly: [{ date: "2Q2026", revenue: 30e9, earnings: 16e9 }],
          yearly: [{ date: 2025, revenue: 100e9, earnings: 50e9 }],
        },
      },
    });
    expect(view.beatStreak).toBe(2);
    expect(view.surprises[0]?.quarter).toBe("2026-07-31");
    expect(view.quarterly).toEqual([{ label: "2Q2026", revenue: 30e9, earnings: 16e9 }]);
    expect(view.yearly[0]?.label).toBe("2025");
    expect(view.financialCurrency).toBe("USD");
  });
});

describe("statements", () => {
  it("keeps the curated lines in statement order, newest period first", () => {
    const view = buildStatement("NVDA", "income", "annual", [
      { date: new Date("2024-01-28"), totalRevenue: 60e9, netIncome: 30e9, dilutedEPS: 1.19 },
      { date: new Date("2025-01-26"), totalRevenue: 130e9, netIncome: 73e9, dilutedEPS: 2.94 },
      // A padded period with nothing in it is not a column.
      { date: new Date("2026-01-25") },
    ]);
    expect(view.columns).toEqual(["2025-01-26", "2024-01-28"]);
    expect(view.rows.map((row) => row.key)).toEqual(["totalRevenue", "netIncome", "dilutedEPS"]);
    expect(view.rows[0]).toMatchObject({ values: [130e9, 60e9], emphasis: true, unit: "money" });
    expect(view.rows[2]?.unit).toBe("perShare");
  });

  it("starts the request no further back than the columns need", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    expect(statementStart("annual", now)).toBe("2020-01-01");
    expect(statementStart("quarterly", now)).toBe("2023-01-01");
  });
});

describe("analysis", () => {
  it("keeps whichever parts of the insights payload arrived", () => {
    const view = buildAnalysis("NVDA", {
      instrumentInfo: {
        technicalEvents: {
          shortTermOutlook: { direction: "Bullish", score: 3, scoreDescription: "Strong", indexDirection: "Bearish" },
        },
        keyTechnicals: { support: 110, resistance: 135, provider: "Trading Central" },
        valuation: { description: "Overvalued", discount: "-12%" },
      },
      recommendation: { rating: "BUY", targetPrice: 160, provider: "Argus" },
      companySnapshot: { company: { hiring: 0.8 }, sector: { hiring: 0.5, innovativeness: 0.6 } },
      sigDevs: [{ headline: "New chip", date: new Date("2026-09-01") }],
      upsell: { msBullishSummary: ["AI demand"], msBearishSummary: ["Valuation"] },
      upsellSearchDD: {
        researchReports: { reportId: "MS_1", provider: "Morningstar", title: "Nvidia: a note", investmentRating: "Bullish", reportDate: new Date("2026-09-03") },
      },
      reports: [{ id: "R2", title: "Weekly list", reportTitle: "A long abstract paragraph.", provider: "Argus", reportDate: new Date("2026-09-08") }],
    });
    expect(view.reports.map((report) => [report.id, report.title, report.rating])).toEqual([
      ["MS_1", "Nvidia: a note", "Bullish"],
      ["R2", "Weekly list", null],
    ]);
    expect(view.outlooks).toEqual([
      {
        horizon: "short",
        direction: "Bullish",
        score: 3,
        description: "Strong",
        sectorDirection: null,
        indexDirection: "Bearish",
      },
    ]);
    expect(view.keyTechnicals).toMatchObject({ support: 110, resistance: 135, stopLoss: null });
    expect(view.recommendation).toEqual({ rating: "BUY", targetPrice: 160, provider: "Argus" });
    expect(view.scores).toEqual([
      { label: "Innovation", company: null, sector: 0.6 },
      { label: "Hiring", company: 0.8, sector: 0.5 },
    ]);
    expect(view.developments[0]).toEqual({ headline: "New chip", date: "2026-09-01" });
    expect(view.bull).toEqual(["AI demand"]);
  });

  it("returns empty parts rather than failing on an empty payload", () => {
    const view = buildAnalysis("X", {});
    expect(view.keyTechnicals).toBeNull();
    expect(view.outlooks).toEqual([]);
    expect(view.reports).toEqual([]);
  });
});

describe("options", () => {
  it("finds the strike that pays expiring holders least", () => {
    // Calls stacked at 100, puts at 120: settling anywhere between pays
    // nobody much, and 110 pays least of the listed strikes once both sides
    // are weighed.
    expect(
      maxPain([
        { strike: 100, callOpenInterest: 50, putOpenInterest: 0 },
        { strike: 110, callOpenInterest: 10, putOpenInterest: 10 },
        { strike: 120, callOpenInterest: 0, putOpenInterest: 50 },
      ]),
    ).toBe(110);
    expect(maxPain([])).toBeNull();
  });

  it("joins calls and puts by strike and summarises the chain", () => {
    const chain = buildOptionChain("NVDA", {
      expirationDates: [new Date("2026-10-16T00:00:00Z"), new Date("2026-10-23T00:00:00Z")],
      quote: { regularMarketPrice: 118, currency: "USD" },
      options: [
        {
          expirationDate: new Date("2026-10-16T00:00:00Z"),
          calls: [
            { contractSymbol: "C110", strike: 110, lastPrice: 9, volume: 100, openInterest: 1000, impliedVolatility: 0.45, inTheMoney: true },
            { contractSymbol: "C120", strike: 120, lastPrice: 3, volume: 300, openInterest: 500, impliedVolatility: 0.42, inTheMoney: false },
          ],
          puts: [{ contractSymbol: "P120", strike: 120, lastPrice: 4, volume: 150, openInterest: 400, impliedVolatility: 0.4, inTheMoney: true }],
        },
      ],
    });
    expect(chain.expirations).toEqual(["2026-10-16", "2026-10-23"]);
    expect(chain.expiry).toBe("2026-10-16");
    expect(chain.rows.map((row) => row.strike)).toEqual([110, 120]);
    expect(chain.rows[0]?.put).toBeNull();
    expect(chain.rows[1]?.put?.impliedVolatilityPercent).toBe(40);
    expect(chain.atmStrike).toBe(120);
    expect(chain.totals).toMatchObject({
      callVolume: 400,
      putVolume: 150,
      putCallVolumeRatio: 0.38,
      putCallOpenInterestRatio: 0.27,
    });
  });
});

describe("news", () => {
  it("keeps http links only, de-duplicates and sorts newest first", () => {
    const articles = buildNews({
      news: [
        { uuid: "a", title: "Old", link: "https://example.com/a", providerPublishTime: new Date("2026-09-01T00:00:00Z") },
        { uuid: "b", title: "New", link: "https://example.com/b", providerPublishTime: new Date("2026-09-30T00:00:00Z"), relatedTickers: ["NVDA"] },
        { uuid: "b", title: "New again", link: "https://example.com/b", providerPublishTime: new Date("2026-09-30T00:00:00Z") },
        { uuid: "c", title: "Hostile", link: "javascript:alert(1)", providerPublishTime: new Date("2026-09-30T00:00:00Z") },
      ],
    });
    expect(articles.map((article) => article.id)).toEqual(["b", "a"]);
    expect(articles[0]?.relatedTickers).toEqual(["NVDA"]);
  });
});
