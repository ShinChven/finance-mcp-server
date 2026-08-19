import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeFundBrief, disclosureNote } from "../../funds/present.js";
import type { FundRepo } from "../../funds/repo.js";
import { toCanonicalSymbol } from "../../funds/symbols.js";
import { domicileSchema, readOnlyToolAnnotations, runTool } from "./runtime.js";

/**
 * Reverse holdings index: stock → funds.
 *
 * This is the query keyword search cannot answer — no fund name mentions the
 * positions it holds. It spans every cached provider in one scan, which is the
 * whole reason holdings live in one table: NVDA is held by both a China QDII
 * and a US ETF, and "which of those can I buy" is the follow-up question, not
 * the query itself.
 */
export function registerFundsByStockTool(server: McpServer, repo: FundRepo): void {
  server.registerTool(
    "fundsByStock",
    {
      title: "Funds Holding a Stock",
      description:
        "Find funds that hold a given stock, ranked by position weight, across every cached market. " +
        'Accepts a canonical symbol ("NVDA", "600519.SS", "0700.HK"), a raw exchange code, or a company ' +
        'name. Filter with domicile ("CN", "US") to get only funds tradable in one market. Uses each ' +
        "fund's most recent disclosed report only.",
      inputSchema: {
        symbol: z.string().trim().min(1).max(64),
        domicile: domicileSchema.optional(),
        offshoreOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ symbol, domicile, offshoreOnly, limit }) =>
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
          ...(domicile !== undefined ? { domiciles: domicile } : {}),
          ...(offshoreOnly !== undefined ? { offshoreOnly } : {}),
        });

        return {
          symbol: target,
          matchCount: matches.length,
          funds: matches.map((match) => ({
            ...describeFundBrief(match.fund),
            weightPercent: match.weight,
            reportDate: match.reportDate,
          })),
          note: disclosureNote(matches.map((match) => match.fund)),
        };
      }),
  );
}
