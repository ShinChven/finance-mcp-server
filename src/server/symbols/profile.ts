/**
 * The quote-summary modules, read into one profile.
 *
 * `quoteSummary` is the richest single call Yahoo offers and the least uniform
 * one: margins arrive as fractions, one dividend yield as a fraction and the
 * five-year one as a percentage, dates as `Date`s or epoch seconds depending on
 * the module. Everything is normalised here, once, so the page never has to
 * know which field came in which unit — every ratio leaves this file as a
 * percentage and says so in its name.
 *
 * Which modules are asked for depends on what the listing is. A stock's
 * ownership tables mean nothing on an index, and a fund's holdings mean nothing
 * on a stock; asking for both everywhere would only make the payload larger
 * and the failure surface wider.
 */

import type {
  AnalystTrendRow,
  HolderRow,
  InsiderTransactionRow,
  SymbolProfile,
  UpgradeRow,
} from "../../shared/symbol.js";
import { isoDate, num, pct, record, records, round, str } from "./read.js";

const EQUITY_MODULES = [
  "price",
  "quoteType",
  "assetProfile",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "calendarEvents",
  "recommendationTrend",
  "upgradeDowngradeHistory",
  "majorHoldersBreakdown",
  "institutionOwnership",
  "fundOwnership",
  "insiderTransactions",
] as const;

const FUND_MODULES = [
  "price",
  "quoteType",
  "summaryProfile",
  "summaryDetail",
  "defaultKeyStatistics",
  "fundProfile",
  "topHoldings",
  "fundPerformance",
] as const;

const OTHER_MODULES = ["price", "quoteType", "summaryProfile", "summaryDetail"] as const;

/** What is retried when the full set fails validation upstream. */
export const MINIMAL_MODULES = ["price", "summaryDetail"] as const;

export type ProfileModule =
  | (typeof EQUITY_MODULES)[number]
  | (typeof FUND_MODULES)[number]
  | (typeof OTHER_MODULES)[number];

export function profileModules(quoteType: string | null): ProfileModule[] {
  const type = (quoteType ?? "").toUpperCase();
  if (type === "EQUITY") return [...EQUITY_MODULES];
  if (type === "ETF" || type === "MUTUALFUND") return [...FUND_MODULES];
  return [...OTHER_MODULES];
}

function holders(value: unknown, limit: number): HolderRow[] {
  return records(record(value)["ownershipList"])
    .map((row) => ({
      organization: str(row["organization"]) ?? "—",
      percentHeld: pct(row["pctHeld"]),
      position: num(row["position"]),
      value: num(row["value"]),
      percentChange: pct(row["pctChange"]),
      reportDate: isoDate(row["reportDate"]),
    }))
    .sort((a, b) => (b.percentHeld ?? 0) - (a.percentHeld ?? 0))
    .slice(0, limit);
}

function insiders(value: unknown, limit: number): InsiderTransactionRow[] {
  return records(record(value)["transactions"])
    .map((row) => ({
      name: str(row["filerName"]) ?? "—",
      relation: str(row["filerRelation"]),
      text: str(row["transactionText"]),
      date: isoDate(row["startDate"]),
      shares: num(row["shares"]),
      value: num(row["value"]),
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, limit);
}

function trend(value: unknown): AnalystTrendRow[] {
  return records(record(value)["trend"]).map((row) => ({
    period: str(row["period"]) ?? "",
    strongBuy: num(row["strongBuy"]) ?? 0,
    buy: num(row["buy"]) ?? 0,
    hold: num(row["hold"]) ?? 0,
    sell: num(row["sell"]) ?? 0,
    strongSell: num(row["strongSell"]) ?? 0,
  }));
}

function upgrades(value: unknown, limit: number): UpgradeRow[] {
  return records(record(value)["history"])
    .map((row) => ({
      date: isoDate(row["epochGradeDate"]),
      firm: str(row["firm"]) ?? "—",
      action: str(row["action"]) ?? "",
      fromGrade: str(row["fromGrade"]),
      toGrade: str(row["toGrade"]),
      priceTargetAction: str(row["priceTargetAction"]),
      // Zero is how the feed says "no target given", never a real target.
      currentTarget: num(row["currentPriceTarget"]) || null,
      priorTarget: num(row["priorPriceTarget"]) || null,
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, limit);
}

/** `[{ technology: 0.31 }, { healthcare: 0.12 }]` → sorted, as percentages. */
function sectorWeights(value: unknown): { sector: string; percent: number }[] {
  const out: { sector: string; percent: number }[] = [];
  for (const entry of records(value)) {
    for (const [sector, weight] of Object.entries(entry)) {
      const percent = pct(weight);
      if (percent !== null && percent > 0) {
        out.push({ sector: sector.replace(/_/g, " "), percent });
      }
    }
  }
  return out.sort((a, b) => b.percent - a.percent);
}

export function buildProfile(symbol: string, summary: unknown, requested: string[]): SymbolProfile {
  const root = record(summary);
  const price = record(root["price"]);
  const quoteType = record(root["quoteType"]);
  const company = record(root["assetProfile"] ?? root["summaryProfile"]);
  const detail = record(root["summaryDetail"]);
  const stats = record(root["defaultKeyStatistics"]);
  const financial = record(root["financialData"]);
  const calendar = record(root["calendarEvents"]);
  const earnings = record(calendar["earnings"]);
  const breakdown = record(root["majorHoldersBreakdown"]);
  const fundProfile = record(root["fundProfile"]);
  const fees = record(fundProfile["feesExpensesInvestment"]);
  const top = record(root["topHoldings"]);
  const performance = record(record(root["fundPerformance"])["performanceOverview"]);

  const type = str(quoteType["quoteType"]) ?? str(price["quoteType"]);
  const isFund = type === "ETF" || type === "MUTUALFUND";
  const hasCompany = Object.keys(company).length > 0;
  const trendRows = trend(root["recommendationTrend"]);
  const upgradeRows = upgrades(root["upgradeDowngradeHistory"], 25);
  const hasAnalyst =
    num(financial["targetMeanPrice"]) !== null ||
    num(financial["recommendationMean"]) !== null ||
    trendRows.length > 0 ||
    upgradeRows.length > 0;

  const officers = records(company["companyOfficers"])
    .slice(0, 6)
    .map((officer) => ({
      name: str(officer["name"]) ?? "—",
      title: str(officer["title"]),
      age: num(officer["age"]),
      totalPay: num(officer["totalPay"]),
    }));

  const earningsDates = (Array.isArray(earnings["earningsDate"]) ? earnings["earningsDate"] : [])
    .map(isoDate)
    .filter((date): date is string => date !== null);

  return {
    symbol,
    name: str(price["longName"]) ?? str(price["shortName"]) ?? str(quoteType["longName"]),
    quoteType: type,
    currency: str(price["currency"]) ?? str(detail["currency"]),
    financialCurrency: str(financial["financialCurrency"]),
    company: hasCompany
      ? {
          sector: str(company["sectorDisp"]) ?? str(company["sector"]),
          industry: str(company["industryDisp"]) ?? str(company["industry"]),
          country: str(company["country"]),
          city: str(company["city"]),
          website: str(company["website"]),
          employees: num(company["fullTimeEmployees"]),
          summary: str(company["longBusinessSummary"]) ?? str(company["description"]),
          officers,
        }
      : null,
    valuation: {
      marketCap: num(price["marketCap"]) ?? num(detail["marketCap"]),
      enterpriseValue: num(stats["enterpriseValue"]),
      trailingPe: num(detail["trailingPE"]),
      forwardPe: num(detail["forwardPE"]) ?? num(stats["forwardPE"]),
      pegRatio: num(stats["pegRatio"]),
      priceToSales: num(detail["priceToSalesTrailing12Months"]),
      priceToBook: num(stats["priceToBook"]),
      evToRevenue: num(stats["enterpriseToRevenue"]),
      evToEbitda: num(stats["enterpriseToEbitda"]),
      bookValuePerShare: num(stats["bookValue"]),
      trailingEps: num(stats["trailingEps"]),
      forwardEps: num(stats["forwardEps"]),
    },
    profitability: {
      grossMarginPercent: pct(financial["grossMargins"]),
      operatingMarginPercent: pct(financial["operatingMargins"]),
      profitMarginPercent: pct(financial["profitMargins"] ?? stats["profitMargins"]),
      ebitdaMarginPercent: pct(financial["ebitdaMargins"]),
      returnOnAssetsPercent: pct(financial["returnOnAssets"]),
      returnOnEquityPercent: pct(financial["returnOnEquity"]),
      revenueGrowthPercent: pct(financial["revenueGrowth"]),
      earningsGrowthPercent: pct(financial["earningsGrowth"] ?? stats["earningsQuarterlyGrowth"]),
    },
    financials: {
      totalRevenue: num(financial["totalRevenue"]),
      ebitda: num(financial["ebitda"]),
      totalCash: num(financial["totalCash"]),
      totalDebt: num(financial["totalDebt"]),
      // Yahoo already serves this one as a percentage (41.2 means 41.2%).
      debtToEquity: num(financial["debtToEquity"]),
      currentRatio: num(financial["currentRatio"]),
      quickRatio: num(financial["quickRatio"]),
      operatingCashflow: num(financial["operatingCashflow"]),
      freeCashflow: num(financial["freeCashflow"]),
    },
    dividends: {
      rate: num(detail["dividendRate"]),
      yieldPercent: pct(detail["dividendYield"]),
      payoutRatioPercent: pct(detail["payoutRatio"]),
      // The one yield Yahoo already publishes as a percentage.
      fiveYearAverageYieldPercent: num(detail["fiveYearAvgDividendYield"]),
      exDividendDate: isoDate(calendar["exDividendDate"] ?? detail["exDividendDate"]),
      dividendDate: isoDate(calendar["dividendDate"]),
      lastSplitFactor: str(stats["lastSplitFactor"]),
      lastSplitDate: isoDate(stats["lastSplitDate"]),
    },
    shares: {
      beta: num(detail["beta"]) ?? num(stats["beta"]),
      sharesOutstanding: num(stats["sharesOutstanding"]),
      floatShares: num(stats["floatShares"]),
      sharesShort: num(stats["sharesShort"]),
      shortPercentOfFloat: pct(stats["shortPercentOfFloat"]),
      shortRatio: num(stats["shortRatio"]),
      insidersPercent: pct(breakdown["insidersPercentHeld"] ?? stats["heldPercentInsiders"]),
      institutionsPercent: pct(
        breakdown["institutionsPercentHeld"] ?? stats["heldPercentInstitutions"],
      ),
      institutionsCount: num(breakdown["institutionsCount"]),
    },
    analyst: hasAnalyst
      ? {
          targetLow: num(financial["targetLowPrice"]),
          targetMean: num(financial["targetMeanPrice"]),
          targetMedian: num(financial["targetMedianPrice"]),
          targetHigh: num(financial["targetHighPrice"]),
          recommendationMean: num(financial["recommendationMean"]),
          recommendationKey: str(financial["recommendationKey"]),
          analysts: num(financial["numberOfAnalystOpinions"]),
          trend: trendRows,
          upgrades: upgradeRows,
        }
      : null,
    events: {
      nextEarnings: earningsDates[0] ?? null,
      earningsRange: earningsDates,
      earningsIsEstimate:
        typeof earnings["isEarningsDateEstimate"] === "boolean"
          ? earnings["isEarningsDateEstimate"]
          : null,
      epsEstimate: num(earnings["earningsAverage"]),
      revenueEstimate: num(earnings["revenueAverage"]),
    },
    ownership: {
      institutions: holders(root["institutionOwnership"], 10),
      funds: holders(root["fundOwnership"], 10),
      insiders: insiders(root["insiderTransactions"], 15),
    },
    fund: isFund
      ? {
          family: str(fundProfile["family"]) ?? str(stats["fundFamily"]),
          category: str(fundProfile["categoryName"]) ?? str(stats["category"]),
          legalType: str(fundProfile["legalType"]) ?? str(stats["legalType"]),
          expenseRatioPercent:
            pct(fees["annualReportExpenseRatio"]) ?? pct(stats["annualReportExpenseRatio"]),
          totalAssets: num(detail["totalAssets"]) ?? num(stats["totalAssets"]),
          yieldPercent: pct(detail["yield"] ?? stats["yield"]),
          ytdReturnPercent: pct(performance["ytdReturnPct"] ?? stats["ytdReturn"]),
          threeYearReturnPercent: pct(
            performance["threeYearTotalReturn"] ?? stats["threeYearAverageReturn"],
          ),
          fiveYearReturnPercent: pct(
            performance["fiveYrAvgReturnPct"] ?? stats["fiveYearAverageReturn"],
          ),
          inceptionDate: isoDate(stats["fundInceptionDate"]),
          holdings: records(top["holdings"])
            .map((holding) => ({
              symbol: str(holding["symbol"]) ?? "",
              name: str(holding["holdingName"]) ?? str(holding["symbol"]) ?? "—",
              percent: pct(holding["holdingPercent"]) ?? 0,
            }))
            .filter((holding) => holding.percent > 0),
          sectors: sectorWeights(top["sectorWeightings"]),
          allocation: {
            stock: pct(top["stockPosition"]),
            bond: pct(top["bondPosition"]),
            cash: pct(top["cashPosition"]),
            other: (() => {
              const parts = ["otherPosition", "preferredPosition", "convertiblePosition"]
                .map((key) => num(top[key]))
                .filter((value): value is number => value !== null);
              return parts.length === 0 ? null : round(parts.reduce((a, b) => a + b, 0) * 100, 2);
            })(),
          },
        }
      : null,
    // A module that was asked for and is simply absent is reported, so the
    // page can say "Yahoo has no ownership data for this listing" instead of
    // rendering an empty table that looks like a bug.
    degraded: requested.filter((module) => !(module in root) && module !== "quoteType"),
  };
}

