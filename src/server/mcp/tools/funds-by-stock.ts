import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FundRepo } from "../../china/repo.js";
import { toCanonicalSymbol } from "../../china/symbols.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";

/**
 * Reverse holdings index: stock → funds.
 *
 * This is the query keyword search cannot answer — no fund name mentions the
 * positions it holds.
 */
export function registerFundsByStockTool(server: McpServer, repo: FundRepo): void {
  server.registerTool(
    "fundsByStock",
    {
      title: "Funds Holding a Stock",
      description:
        "Find China public funds that hold a given stock, ranked by position weight. Accepts a canonical " +
        'symbol ("NVDA", "600519.SS", "0700.HK"), a raw exchange code, or a company name. Uses each fund\'s ' +
        "most recent disclosed report only.",
      inputSchema: {
        symbol: z.string().trim().min(1).max(64),
        qdiiOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ symbol, qdiiOnly, limit }) =>
      runTool(async () => {
        // A canonical or raw exchange code normalizes directly; anything else
        // (a company name) goes through the instruments table.
        const target = toCanonicalSymbol(symbol) ?? (await repo.resolveSymbol(symbol))?.symbol;

        if (target === undefined) {
          throw new Error(
            `Could not resolve "${symbol}" to a symbol in the local index. Try a canonical symbol such as NVDA or 600519.SS.`,
          );
        }

        const matches = await repo.findFundsByStock(target, {
          limit: limit ?? 20,
          ...(qdiiOnly !== undefined ? { qdiiOnly } : {}),
        });

        return {
          symbol: target,
          matchCount: matches.length,
          funds: matches.map((match) => ({
            code: match.fund.code,
            name: match.fund.name,
            isQdii: match.fund.isQdii,
            isIndexFund: match.fund.isIndexFund,
            trackingIndex: match.fund.trackingIndex,
            weightPercent: match.weight,
            reportDate: match.reportDate,
          })),
          note:
            "Weights are percent of net asset value as of each fund's latest disclosed report; " +
            "quarterly reports only cover the top holdings, so a small position may be missing rather than absent.",
        };
      }),
  );
}
