import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { holdingsOverlap } from "../../china/exposure.js";
import type { FundRepo } from "../../china/repo.js";
import { fundCodesSchema, readOnlyToolAnnotations, runTool } from "./runtime.js";

/**
 * Side-by-side comparison, with pairwise portfolio overlap.
 *
 * Overlap is the number that decides whether a second fund diversifies or just
 * duplicates — two funds with different names and the same 80% overlap are one
 * position, not two.
 */
export function registerCompareFundsTool(server: McpServer, repo: FundRepo): void {
  server.registerTool(
    "compareFunds",
    {
      title: "Compare Funds",
      description:
        "Compare 2-10 China public funds: fees, size, tracking index, top sector exposure, and pairwise " +
        "portfolio overlap (the share of net asset value invested in the same positions). Use before " +
        "holding several funds in one theme.",
      inputSchema: { codes: fundCodesSchema },
      annotations: readOnlyToolAnnotations,
    },
    async ({ codes }) =>
      runTool(async () => {
        const unique = [...new Set(codes)];
        const entries = await Promise.all(
          unique.map(async (code) => {
            const [fund, exposure, holdings] = await Promise.all([
              repo.getFund(code),
              repo.getExposure(code),
              repo.getHoldings(code),
            ]);
            return { code, fund, exposure, holdings };
          }),
        );

        const missing = entries.filter((entry) => entry.fund === null).map((entry) => entry.code);
        if (missing.length > 0) {
          throw new Error(
            `Not in the local index: ${missing.join(", ")}. Run the ingest job for these funds first.`,
          );
        }

        const overlaps: { pair: [string, string]; overlapPercent: number }[] = [];
        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const left = entries[i];
            const right = entries[j];
            if (left === undefined || right === undefined) continue;
            overlaps.push({
              pair: [left.code, right.code],
              overlapPercent: holdingsOverlap(left.holdings, right.holdings),
            });
          }
        }

        return {
          funds: entries.map((entry) => ({
            code: entry.code,
            name: entry.fund?.name ?? null,
            type: entry.fund?.fundType ?? null,
            isQdii: entry.fund?.isQdii ?? null,
            isIndexFund: entry.fund?.isIndexFund ?? null,
            trackingIndex: entry.fund?.trackingIndex ?? null,
            feeRate: entry.fund?.feeRate ?? null,
            fundSize: entry.fund?.fundSize ?? null,
            currency: entry.fund?.currency ?? null,
            listedSymbol: entry.fund?.listedSymbol ?? null,
            purchaseStatus: entry.fund?.purchaseStatus ?? null,
            reportDate: entry.holdings[0]?.reportDate ?? null,
            topSectors: entry.exposure
              .filter((row) => row.dimension === "sector")
              .slice(0, 5)
              .map((row) => ({ sector: row.label ?? row.key, weightPercent: row.weight })),
            markets: entry.exposure
              .filter((row) => row.dimension === "market")
              .map((row) => ({ market: row.key, weightPercent: row.weight })),
          })),
          overlaps: overlaps.sort((a, b) => b.overlapPercent - a.overlapPercent),
          note:
            "Overlap is computed from disclosed top holdings only, so it is a lower bound — the true " +
            "overlap of two index funds tracking the same index approaches 100% even if this reports less.",
        };
      }),
  );
}
