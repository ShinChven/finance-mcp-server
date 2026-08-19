import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findTheme, listThemeIds } from "../../funds/crosswalk.js";
import { describeFundBrief, disclosureNote } from "../../funds/present.js";
import type { FundRepo } from "../../funds/repo.js";
import { domicileSchema, readOnlyToolAnnotations, runTool } from "./runtime.js";

/**
 * Sector → funds, ranked by how much of the portfolio is actually in that
 * sector rather than by how the fund is named.
 */
export function registerFundsBySectorTool(server: McpServer, repo: FundRepo): void {
  server.registerTool(
    "fundsBySector",
    {
      title: "Funds by Sector Exposure",
      description:
        "Find funds ranked by measured exposure to a sector or theme (\"半导体\", \"semiconductors\", " +
        '"healthcare"), across every cached market. Theme names resolve through a CN↔GICS crosswalk, so ' +
        "one query returns onshore sector funds, QDII funds holding the same sector offshore, and US ETFs " +
        "alike. `markets` filters where the holdings are; `domicile` filters where the fund trades.",
      inputSchema: {
        sector: z.string().trim().min(1).max(64),
        markets: z.array(z.string().trim().min(1).max(8)).max(10).optional(),
        domicile: domicileSchema.optional(),
        offshoreOnly: z.boolean().optional(),
        minCoverage: z.number().min(0).max(1).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ sector, markets, domicile, offshoreOnly, minCoverage, limit }) =>
      runTool(async () => {
        const theme = findTheme(sector);
        const keys = theme ? [...theme.gicsSectors, ...(theme.gicsIndustries ?? [])] : [sector];
        const labels = theme ? [...theme.cnSectorNames, ...(theme.gicsIndustries ?? [])] : [sector];
        const requestedMarkets = markets ?? theme?.markets;

        const matches = await repo.findFundsBySector({
          keys,
          labels,
          limit: limit ?? 20,
          ...(requestedMarkets !== undefined ? { markets: requestedMarkets } : {}),
          ...(domicile !== undefined ? { domiciles: domicile } : {}),
          ...(offshoreOnly !== undefined ? { offshoreOnly } : {}),
        });

        const floor = minCoverage ?? 0;
        const filtered = matches.filter((match) => (match.coverage ?? 0) >= floor);

        return {
          query: sector,
          resolvedTheme: theme?.id ?? null,
          ...(theme === undefined
            ? { hint: `No theme matched "${sector}"; matched sector names literally. Known themes: ${listThemeIds().join(", ")}` }
            : {}),
          ...(theme?.note !== undefined ? { themeNote: theme.note } : {}),
          matchCount: filtered.length,
          funds: filtered.map((match) => ({
            ...describeFundBrief(match.fund),
            sector: match.label ?? match.key,
            weightPercent: match.weight,
            coverage: match.coverage,
            reportDate: match.reportDate,
          })),
          note:
            "coverage is the share of the fund's disclosed weight that could be classified. " +
            "A high sector weight at low coverage is a weak signal — prefer funds with coverage above 0.8. " +
            disclosureNote(filtered.map((match) => match.fund)),
        };
      }),
  );
}
