import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { computePerformance } from "../../china/performance.js";
import type { FundRepo } from "../../china/repo.js";
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
export function registerFundPerformanceTool(server: McpServer, repo: FundRepo): void {
  server.registerTool(
    "fundPerformance",
    {
      title: "Fund Performance",
      description:
        "Cumulative and annualized return, maximum drawdown and volatility for a China public fund over a " +
        "date window, computed from its ingested NAV history. Optionally returns the NAV series itself.",
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
        const fund = await repo.getFund(code);
        if (fund === null) {
          throw new Error(`Fund ${code} is not in the local index. Run the ingest job first.`);
        }

        const series = await repo.getNavSeries(code, {
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
        });

        const performance = computePerformance(series);
        if (performance === null) {
          throw new Error(
            `Fund ${code} has fewer than two NAV observations in this window. Run the ingest job, or widen the range.`,
          );
        }

        return {
          fund: {
            code: fund.code,
            name: fund.name,
            isQdii: fund.isQdii,
            trackingIndex: fund.trackingIndex,
            currency: fund.currency,
          },
          performance,
          ...(includeSeries === true ? { series } : {}),
          note:
            performance.basis === "accNav"
              ? "Measured from cumulative NAV, so distributions are included in the return."
              : "Measured from unit NAV because cumulative NAV was unavailable — returns exclude distributions and understate the fund.",
        };
      }),
  );
}
