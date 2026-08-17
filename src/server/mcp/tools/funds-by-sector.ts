import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findTheme, listThemeIds } from "../../china/crosswalk.js";
import type { FundRepo } from "../../china/repo.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";

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
        "Find China public funds ranked by measured exposure to a sector or theme (\"半导体\", \"semiconductors\", " +
        '"healthcare"). Theme names resolve through a CN↔GICS crosswalk, so one query returns both onshore ' +
        "sector funds and QDII funds holding the same sector offshore.",
      inputSchema: {
        sector: z.string().trim().min(1).max(64),
        markets: z.array(z.string().trim().min(1).max(8)).max(10).optional(),
        qdiiOnly: z.boolean().optional(),
        minCoverage: z.number().min(0).max(1).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ sector, markets, qdiiOnly, minCoverage, limit }) =>
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
          ...(qdiiOnly !== undefined ? { qdiiOnly } : {}),
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
            code: match.fund.code,
            name: match.fund.name,
            isQdii: match.fund.isQdii,
            isIndexFund: match.fund.isIndexFund,
            trackingIndex: match.fund.trackingIndex,
            sector: match.label ?? match.key,
            weightPercent: match.weight,
            coverage: match.coverage,
            reportDate: match.reportDate,
          })),
          note:
            "coverage is the share of the fund's disclosed weight that could be classified. " +
            "A high sector weight at low coverage is a weak signal — prefer funds with coverage above 0.8.",
        };
      }),
  );
}
