import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YahooFinanceClient } from "../client.js";
import {
  readOnlyToolAnnotations,
  runYahooFinanceTool,
  symbolSchema,
  yahooRequestOptions,
} from "./runtime.js";

/**
 * The earnings picture in one call.
 *
 * `quoteSummary` can already return these modules, but answering "did they beat,
 * and are estimates going up or down" from the raw payload means stitching four
 * modules together and doing the arithmetic. This does that stitching, and
 * surfaces estimate *revisions* — the part callers most often miss, because a
 * single estimate snapshot says nothing about direction.
 */

const MODULES = [
  "earningsHistory",
  "earningsTrend",
  "calendarEvents",
  "financialData",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
  }
  // Yahoo hands back seconds for some date fields and milliseconds for others.
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e11 ? value : value * 1_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export interface EarningsSurprise {
  quarter: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  surprisePercent: number | null;
  beat: boolean | null;
}

/** Newest-first surprise history with a recomputed surprise percentage. */
export function buildSurprises(earningsHistory: unknown): EarningsSurprise[] {
  const history = isRecord(earningsHistory) ? earningsHistory["history"] : undefined;
  if (!Array.isArray(history)) return [];

  const rows = history.flatMap<EarningsSurprise>((entry) => {
    if (!isRecord(entry)) return [];
    const actual = num(entry["epsActual"]);
    const estimate = num(entry["epsEstimate"]);
    // Yahoo's own surprisePercent is a ratio on some symbols and a percentage
    // on others, so it is recomputed rather than passed through.
    const surprise =
      actual === null || estimate === null || estimate === 0
        ? null
        : round(((actual - estimate) / Math.abs(estimate)) * 100);
    return [
      {
        quarter: iso(entry["quarter"]),
        epsActual: actual,
        epsEstimate: estimate,
        surprisePercent: surprise,
        beat: actual === null || estimate === null ? null : actual > estimate,
      },
    ];
  });

  return rows.sort((a, b) => (a.quarter ?? "") < (b.quarter ?? "") ? 1 : -1);
}

/** Consecutive beats counting back from the most recent reported quarter. */
export function beatStreak(surprises: readonly EarningsSurprise[]): number {
  let streak = 0;
  for (const surprise of surprises) {
    if (surprise.beat !== true) break;
    streak += 1;
  }
  return streak;
}

export interface EstimateRevision {
  period: string | null;
  endDate: string | null;
  epsCurrent: number | null;
  eps7DaysAgo: number | null;
  eps30DaysAgo: number | null;
  eps60DaysAgo: number | null;
  eps90DaysAgo: number | null;
  /** Percentage move in the consensus over the last 30 days. */
  revision30dPercent: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  analystsRevisingUp30d: number | null;
  analystsRevisingDown30d: number | null;
}

function buildRevision(entry: Record<string, unknown>): EstimateRevision {
  const trend = isRecord(entry["epsTrend"]) ? entry["epsTrend"] : {};
  const revisions = isRecord(entry["epsRevisions"]) ? entry["epsRevisions"] : {};

  const current = num(trend["current"]);
  const ago30 = num(trend["30daysAgo"]);
  const revision =
    current === null || ago30 === null || ago30 === 0
      ? null
      : round(((current - ago30) / Math.abs(ago30)) * 100);

  return {
    period: typeof entry["period"] === "string" ? entry["period"] : null,
    endDate: iso(entry["endDate"]),
    epsCurrent: current,
    eps7DaysAgo: num(trend["7daysAgo"]),
    eps30DaysAgo: ago30,
    eps60DaysAgo: num(trend["60daysAgo"]),
    eps90DaysAgo: num(trend["90daysAgo"]),
    revision30dPercent: revision,
    direction:
      revision === null ? "unknown" : revision > 0.5 ? "up" : revision < -0.5 ? "down" : "flat",
    analystsRevisingUp30d: num(revisions["upLast30days"]),
    analystsRevisingDown30d: num(revisions["downLast30days"]),
  };
}

export interface EarningsEstimate {
  period: string | null;
  endDate: string | null;
  epsAvg: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  yearAgoEps: number | null;
  analysts: number | null;
  revenueAvg: number | null;
  revenueGrowth: number | null;
}

function buildEstimate(entry: Record<string, unknown>): EarningsEstimate {
  const eps = isRecord(entry["earningsEstimate"]) ? entry["earningsEstimate"] : {};
  const revenue = isRecord(entry["revenueEstimate"]) ? entry["revenueEstimate"] : {};
  return {
    period: typeof entry["period"] === "string" ? entry["period"] : null,
    endDate: iso(entry["endDate"]),
    epsAvg: num(eps["avg"]),
    epsLow: num(eps["low"]),
    epsHigh: num(eps["high"]),
    yearAgoEps: num(eps["yearAgoEps"]),
    analysts: num(eps["numberOfAnalysts"]),
    revenueAvg: num(revenue["avg"]),
    revenueGrowth: num(revenue["growth"]),
  };
}

export function buildEarningsAnalysis(symbol: string, summary: unknown): unknown {
  const root = isRecord(summary) ? summary : {};
  const surprises = buildSurprises(root["earningsHistory"]);

  const trendEntries = (() => {
    const trend = isRecord(root["earningsTrend"]) ? root["earningsTrend"]["trend"] : undefined;
    return Array.isArray(trend) ? trend.filter(isRecord) : [];
  })();

  // Yahoo labels forward periods 0q/+1q/0y/+1y; the multi-year rows carry no
  // revision history worth reporting.
  const forward = trendEntries.filter((entry) => {
    const period = entry["period"];
    return period === "0q" || period === "+1q" || period === "0y" || period === "+1y";
  });

  const calendar = isRecord(root["calendarEvents"]) ? root["calendarEvents"] : {};
  const calendarEarnings = isRecord(calendar["earnings"]) ? calendar["earnings"] : {};
  const earningsDates = Array.isArray(calendarEarnings["earningsDate"])
    ? calendarEarnings["earningsDate"].map(iso).filter((d): d is string => d !== null)
    : [];

  const financial = isRecord(root["financialData"]) ? root["financialData"] : {};

  return {
    symbol,
    nextEarningsDate: earningsDates[0] ?? null,
    ...(earningsDates.length > 1 && { nextEarningsDateRange: earningsDates }),
    surprises,
    beatStreak: beatStreak(surprises),
    estimates: forward.map(buildEstimate),
    revisions: forward.map(buildRevision),
    trailing: {
      revenueGrowth: num(financial["revenueGrowth"]),
      earningsGrowth: num(financial["earningsGrowth"]),
      grossMargin: num(financial["grossMargins"]),
      operatingMargin: num(financial["operatingMargins"]),
      profitMargin: num(financial["profitMargins"]),
      returnOnEquity: num(financial["returnOnEquity"]),
      totalRevenue: num(financial["totalRevenue"]),
      freeCashflow: num(financial["freeCashflow"]),
    },
    note:
      "surprisePercent and revision30dPercent are computed here, not passed through. " +
      "`direction` reads the 30-day move in consensus EPS: rising estimates into a report are " +
      "a stronger signal than the level of the estimate itself. Growth and margin figures are " +
      "trailing twelve months.",
  };
}

export function registerEarningsAnalysisTool(server: McpServer, client: YahooFinanceClient): void {
  server.registerTool(
    "earningsAnalysis",
    {
      title: "Earnings Analysis",
      description:
        "Analyze a symbol's earnings track record and forward expectations in one call: " +
        "per-quarter EPS surprises and beat streak, consensus estimates, how those estimates have " +
        "been revised over the last 7/30/60/90 days, the next earnings date, and trailing growth " +
        "and margins. Works for any Yahoo-covered symbol, including non-US listings.",
      inputSchema: {
        symbol: symbolSchema,
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ symbol }) =>
      runYahooFinanceTool(async () => {
        const summary = await client.quoteSummary(
          symbol,
          { modules: [...MODULES] },
          yahooRequestOptions(),
        );
        return buildEarningsAnalysis(symbol, summary);
      }),
  );
}
