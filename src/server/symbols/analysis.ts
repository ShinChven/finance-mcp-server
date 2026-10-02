/**
 * The `insights` module, read for the analysis tab.
 *
 * Yahoo resells several research providers through this one payload — a
 * technical outlook over three horizons, support and resistance levels, a
 * valuation call, company scores against the sector, and the headlines of
 * significant developments. All of it is optional and coverage is patchy
 * outside large US names, so each part is independently nullable and the page
 * shows only the parts that arrived.
 */

import type { AnalysisView, TechnicalOutlook } from "../../shared/symbol.js";
import { isoDate, num, record, records, str } from "./read.js";

const HORIZONS: { key: string; horizon: TechnicalOutlook["horizon"] }[] = [
  { key: "shortTermOutlook", horizon: "short" },
  { key: "intermediateTermOutlook", horizon: "intermediate" },
  { key: "longTermOutlook", horizon: "long" },
];

const SCORES: { key: string; label: string }[] = [
  { key: "innovativeness", label: "Innovation" },
  { key: "hiring", label: "Hiring" },
  { key: "sustainability", label: "Sustainability" },
  { key: "insiderSentiments", label: "Insider sentiment" },
  { key: "earningsReports", label: "Earnings reports" },
  { key: "dividends", label: "Dividends" },
];

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
}

export function buildAnalysis(symbol: string, insights: unknown): AnalysisView {
  const root = record(insights);
  const info = record(root["instrumentInfo"]);
  const technical = record(info["technicalEvents"]);
  const key = record(info["keyTechnicals"]);
  const valuation = record(info["valuation"]);
  const recommendation = record(root["recommendation"]);
  const snapshot = record(root["companySnapshot"]);
  const company = record(snapshot["company"]);
  const sector = record(snapshot["sector"]);
  const upsell = record(root["upsell"]);
  const research = record(record(root["upsellSearchDD"])["researchReports"]);

  const outlooks: TechnicalOutlook[] = [];
  for (const { key: field, horizon } of HORIZONS) {
    const outlook = record(technical[field]);
    if (Object.keys(outlook).length === 0) continue;
    outlooks.push({
      horizon,
      direction: str(outlook["direction"]),
      score: num(outlook["score"]),
      description: str(outlook["scoreDescription"]) ?? str(outlook["stateDescription"]),
      sectorDirection: str(outlook["sectorDirection"]),
      indexDirection: str(outlook["indexDirection"]),
    });
  }

  const support = num(key["support"]);
  const resistance = num(key["resistance"]);
  const stopLoss = num(key["stopLoss"]);

  return {
    symbol,
    outlooks,
    keyTechnicals:
      support === null && resistance === null && stopLoss === null
        ? null
        : { support, resistance, stopLoss, provider: str(key["provider"]) },
    valuation:
      Object.keys(valuation).length === 0
        ? null
        : {
            description: str(valuation["description"]),
            discount: str(valuation["discount"]),
            relativeValue: str(valuation["relativeValue"]),
          },
    recommendation:
      Object.keys(recommendation).length === 0
        ? null
        : {
            rating: str(recommendation["rating"]),
            targetPrice: num(recommendation["targetPrice"]),
            provider: str(recommendation["provider"]),
          },
    scores: SCORES.map(({ key: field, label }) => ({
      label,
      company: num(company[field]),
      sector: num(sector[field]),
    })).filter((score) => score.company !== null || score.sector !== null),
    bull: strings(upsell["msBullishSummary"]),
    bear: strings(upsell["msBearishSummary"]),
    developments: records(root["sigDevs"])
      .map((entry) => ({ headline: str(entry["headline"]) ?? "", date: isoDate(entry["date"]) }))
      .filter((entry) => entry.headline !== "")
      .slice(0, 10),
    reports: [
      // The headline research note is nested apart from the list; it is the
      // one most likely to carry a rating, so it leads.
      ...(Object.keys(research).length === 0 ? [] : [research]),
      ...records(root["reports"]),
    ]
      .map((report) => ({
        id: str(report["id"]) ?? str(report["reportId"]) ?? "",
        // `title` is the headline; `reportTitle` is, despite its name, the
        // abstract — a paragraph, not a line.
        title: str(report["title"]) ?? str(report["reportTitle"]) ?? "Untitled report",
        provider: str(report["provider"]),
        date: isoDate(report["reportDate"]),
        rating: str(report["investmentRating"]),
        targetPrice: num(report["targetPrice"]),
        targetPriceStatus: str(report["targetPriceStatus"]),
      }))
      .slice(0, 10),
  };
}
