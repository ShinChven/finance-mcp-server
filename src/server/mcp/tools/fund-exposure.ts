import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { holdingStability } from "../../china/exposure.js";
import type { FundCache } from "../../china/ondemand.js";
import type { FundRepo } from "../../china/repo.js";
import { cacheNote, ensureHoldings } from "./ensure-cached.js";
import { fundCodeSchema, readOnlyToolAnnotations, runTool } from "./runtime.js";

/**
 * Translates a fund into what it actually holds.
 *
 * Fund names do not describe their portfolios, so this is the entry point for
 * almost every question: it returns sector and market exposure plus the
 * stability of the holdings the exposure was derived from.
 */
export function registerFundExposureTool(
  server: McpServer,
  repo: FundRepo,
  cache: FundCache,
): void {
  server.registerTool(
    "fundExposure",
    {
      title: "Fund Exposure",
      description:
        "Break a China public fund down into sector and market exposure derived from its disclosed holdings. " +
        "Returns coverage (how much of the portfolio could be classified) and holdings stability " +
        "(how much of the previous report is still held), so exposure from a drifting active fund is not " +
        "mistaken for an index fund's.",
      inputSchema: {
        code: fundCodeSchema,
        includeHoldings: z.boolean().optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ code, includeHoldings }) =>
      runTool(async () => {
        // Nothing cached for this fund yet? Fetch it now — the caller named it,
        // which is request enough — instead of returning an empty breakdown.
        const ensured = await ensureHoldings(cache, repo, code);

        const fund = await repo.getFund(code);
        if (fund === null) {
          throw new Error(`Fund ${code} is not in the local index. Run the ingest job first.`);
        }

        const [exposure, reportDates] = await Promise.all([
          repo.getExposure(code),
          repo.listReportDates(code),
        ]);

        const latest = reportDates[0];
        const previous = reportDates[1];
        const [current, prior] = await Promise.all([
          latest === undefined ? Promise.resolve([]) : repo.getHoldings(code, latest),
          previous === undefined ? Promise.resolve([]) : repo.getHoldings(code, previous),
        ]);

        const stability =
          prior.length > 0 && current.length > 0 ? holdingStability(prior, current) : null;

        return {
          fund: {
            code: fund.code,
            name: fund.name,
            type: fund.fundType,
            isQdii: fund.isQdii,
            isIndexFund: fund.isIndexFund,
            trackingIndex: fund.trackingIndex,
            currency: fund.currency,
            listedSymbol: fund.listedSymbol,
            feeRate: fund.feeRate,
            fundSize: fund.fundSize,
          },
          reportDate: latest ?? null,
          sectors: exposure.filter((row) => row.dimension === "sector"),
          markets: exposure.filter((row) => row.dimension === "market"),
          holdingsStability: stability && {
            score: stability.stability,
            interpretation:
              stability.stability >= 0.9
                ? "stable — exposure derived from these holdings is reliable"
                : stability.stability >= 0.6
                  ? "moderate drift — treat exposure as approximate"
                  : "heavy drift — last report no longer describes this fund",
            dropped: stability.dropped,
            added: stability.added,
          },
          ...(includeHoldings === true ? { holdings: current } : {}),
          // Present only when this call did the fetching, so the model can say
          // why it was slow and that coverage may still be settling.
          ...(cacheNote(ensured) === undefined ? {} : { cacheNote: cacheNote(ensured) }),
        };
      }),
  );
}
