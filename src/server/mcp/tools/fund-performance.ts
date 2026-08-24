import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { computePerformance, computeTrailingReturns } from "../../funds/performance.js";
import type { FundCache } from "../../funds/ondemand.js";
import { describeFundBrief } from "../../funds/present.js";
import type { FundRepo } from "../../funds/repo.js";
import { ensureNav } from "./ensure-cached.js";
import { fundCodeSchema, readOnlyToolAnnotations, runTool } from "./runtime.js";

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");

/**
 * Long-horizon NAV statistics for a fund.
 *
 * Returns are measured from cumulative NAV where available, so distributions do
 * not read as losses — the difference compounds badly over the multi-year
 * horizons this tool exists to serve.
 */
export function registerFundPerformanceTool(
  server: McpServer,
  repo: FundRepo,
  cache: FundCache,
): void {
  server.registerTool(
    "fundPerformance",
    {
      title: "Fund Performance",
      description:
        "Cumulative and annualized return, maximum drawdown and volatility for a fund over a date window, " +
        "computed from its ingested NAV history, plus its trailing returns over the standard windows " +
        "(1D, 1M, 3M, 6M, 1Y, 3Y, 5Y and since the earliest NAV on record). Optionally returns the NAV " +
        "series itself.",
      inputSchema: {
        code: fundCodeSchema,
        from: isoDate.optional(),
        to: isoDate.optional(),
        includeSeries: z.boolean().optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ code, from, to, includeSeries }) =>
      runTool(async () => {
        // NAV is what this tool measures, so that is what gets fetched.
        await ensureNav(cache, repo, code);

        const fund = await repo.getFund(code);
        if (fund === null) {
          throw new Error(`Fund ${code} is not in the local index. Run the ingest job first.`);
        }

        // The whole history in one query, narrowed in memory: the trailing
        // windows reach back years further than `from` does, and asking the
        // database twice for overlapping slices of a few thousand rows buys
        // nothing. Both figures then end on the same observation.
        const history = await repo.getNavSeries(code);
        const series = history.filter(
          (point) =>
            (from === undefined || point.navDate >= from) &&
            (to === undefined || point.navDate <= to),
        );

        const performance = computePerformance(series);
        if (performance === null) {
          throw new Error(
            `Fund ${code} has fewer than two NAV observations in this window. Run the ingest job, or widen the range.`,
          );
        }

        // Measured over the full history rather than the requested window, so a
        // narrow `from` still gets a real 5Y figure instead of a truncated one.
        const trailingReturns = computeTrailingReturns(
          history,
          to !== undefined ? { asOf: to } : {},
        );

        return {
          fund: { ...describeFundBrief(fund), currency: fund.currency },
          performance,
          // Absent periods are periods the NAV history does not reach back to,
          // not zeros: a fund listed last year cannot quote 5Y.
          ...(trailingReturns !== null ? { trailingReturns } : {}),
          ...(includeSeries === true ? { series } : {}),
          note:
            performance.basis === "accNav"
              ? "Measured from cumulative NAV, so distributions are included in the return."
              : "Measured from unit NAV because cumulative NAV was unavailable — returns exclude distributions and understate the fund.",
        };
      }),
  );
}
