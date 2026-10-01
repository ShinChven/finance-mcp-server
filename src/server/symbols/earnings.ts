/**
 * The earnings tab: the MCP tool's analysis plus the reported history behind it.
 *
 * The surprise, estimate and revision arithmetic is exactly what the
 * `earningsAnalysis` tool already does, and is reused rather than repeated —
 * an assistant and a reader looking at the same symbol should see the same
 * beat streak. What the page adds is the `earnings` module's reported revenue
 * and earnings by quarter and year, which is what the bar charts are drawn
 * from.
 */

import type { EarningsView } from "../../shared/symbol.js";
import { buildEarningsAnalysis } from "../mcp/tools/earnings-analysis.js";
import { num, record, records, str } from "./read.js";

export const EARNINGS_MODULES = [
  "earningsHistory",
  "earningsTrend",
  "calendarEvents",
  "financialData",
  "earnings",
] as const;

function bars(rows: unknown, labelKey: string): EarningsView["quarterly"] {
  return records(rows).map((row) => ({
    label: String(row[labelKey] ?? ""),
    revenue: num(row["revenue"]),
    earnings: num(row["earnings"]),
  }));
}

export function buildEarningsView(symbol: string, summary: unknown): EarningsView {
  const analysis = buildEarningsAnalysis(symbol, summary) as Omit<
    EarningsView,
    "quarterly" | "yearly" | "financialCurrency"
  > & { trailing?: unknown; note?: unknown };
  const earnings = record(record(summary)["earnings"]);
  const chart = record(earnings["financialsChart"]);

  return {
    symbol,
    nextEarningsDate: analysis.nextEarningsDate,
    surprises: analysis.surprises,
    beatStreak: analysis.beatStreak,
    estimates: analysis.estimates,
    revisions: analysis.revisions,
    // Yahoo labels quarters "3Q2025" and years 2025; both are kept verbatim.
    quarterly: bars(chart["quarterly"], "date"),
    yearly: bars(chart["yearly"], "date"),
    financialCurrency:
      str(earnings["financialCurrency"]) ?? str(record(record(summary)["financialData"])["financialCurrency"]),
  };
}
