import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildSeries } from "../../sec/analysis.js";
import type { EdgarClient } from "../../sec/edgar.js";
import { METRIC_KEYS } from "../../sec/metrics.js";
import { readOnlyToolAnnotations, runTool, symbolSchema } from "./runtime.js";

/**
 * As-reported financials, with the filing each number came from.
 *
 * The Yahoo statement tools return a vendor-normalised view with no provenance;
 * this returns the XBRL the company actually filed, deduplicated to the latest
 * restatement of each period, so a figure can be traced to an accession number.
 */
export function registerSecFinancialsTool(server: McpServer, client: EdgarClient): void {
  server.registerTool(
    "secFinancials",
    {
      title: "SEC Financials",
      description:
        "Get a US issuer's as-reported financials from SEC XBRL filings — revenue, margins, " +
        "earnings, cash flow, and balance sheet — as a time series with year-over-year growth and " +
        "the accession number behind every value. Prefer this over the Yahoo statement tools when " +
        "provenance or restatement-accurate history matters. SEC registrants only.",
      inputSchema: {
        symbol: symbolSchema,
        metrics: z
          .array(z.enum(METRIC_KEYS))
          .min(1)
          .max(METRIC_KEYS.length)
          .optional()
          .describe("Subset of metrics to return. Omit for all."),
        period: z.enum(["annual", "quarterly"]).optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(40)
          .optional()
          .describe("Number of periods per metric, newest first. Defaults to 8."),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ symbol, metrics, period, limit }) =>
      runTool(async () => {
        const entry = await client.resolveTicker(symbol);
        const [company, allSeries] = await Promise.all([
          client.fetchCompanyInfo(entry.cik),
          client.fetchMetrics(entry.cik),
        ]);

        const periodType = period ?? "annual";
        const wanted = metrics === undefined ? null : new Set<string>(metrics);
        const selected = allSeries.filter(
          (series) => wanted === null || wanted.has(series.key),
        );

        const built = selected.map((series) => buildSeries(series, periodType, limit ?? 8));
        const missing = built.filter((series) => series.points.length === 0).map((s) => s.key);

        return {
          company: {
            cik: company.cik,
            name: company.name,
            tickers: company.tickers,
            industry: company.sicDescription,
            fiscalYearEnd: company.fiscalYearEnd,
          },
          period: periodType,
          series: built.filter((series) => series.points.length > 0),
          ...(missing.length > 0 && { unavailable: missing }),
          note:
            "Values are as-reported XBRL, deduplicated to the latest restatement of each period. " +
            "`concept` is the us-gaap tag the filer used and `accession` identifies the source filing. " +
            "Balance-sheet metrics are point-in-time, so their 'quarterly' series covers Q1-Q3 and the " +
            "fiscal year-end snapshot appears under 'annual'.",
        };
      }),
  );
}
