import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findTheme, listThemeIds } from "../../funds/crosswalk.js";
import { describeFundBrief, disclosureNote } from "../../funds/present.js";
import type { FundMatch, FundRepo } from "../../funds/repo.js";
import { domicileSchema, readOnlyToolAnnotations, runTool } from "./runtime.js";

/**
 * The full chain in one call: theme → sectors / indices / markets → funds.
 *
 * Index-tracking funds are reported separately from holdings-derived matches
 * because they are the higher-confidence route: a fund that declares it tracks
 * an index will still track it next quarter, while holdings-derived exposure is
 * a snapshot that can drift.
 */
export function registerThemeToFundsTool(server: McpServer, repo: FundRepo): void {
  server.registerTool(
    "themeToFunds",
    {
      title: "Theme to Funds",
      description:
        "Resolve an investment theme (\"半导体\", \"纳斯达克\", \"越南\", \"new energy\") into funds by three routes at " +
        "once: funds tracking a matching index, funds with measured sector exposure, and funds with " +
        "exposure to the theme's markets. Returns the resolution chain so the reasoning is auditable.",
      inputSchema: {
        theme: z.string().trim().min(1).max(64),
        domicile: domicileSchema.optional(),
        offshoreOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(30).optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ theme, domicile, offshoreOnly, limit }) =>
      runTool(async () => {
        const definition = findTheme(theme);
        if (definition === undefined) {
          return {
            query: theme,
            resolved: false,
            knownThemes: listThemeIds(),
            hint: "No theme matched. Use fundsBySector for a literal sector name, or pick a known theme.",
          };
        }

        const cap = limit ?? 15;
        const filter = {
          ...(domicile !== undefined ? { domiciles: domicile } : {}),
          ...(offshoreOnly !== undefined ? { offshoreOnly } : {}),
        };

        const [byIndex, bySector, byMarket] = await Promise.all([
          repo.findFundsByTrackingIndex(definition.indices, { limit: cap, ...filter }),
          definition.gicsSectors.length > 0 || definition.cnSectorNames.length > 0
            ? repo.findFundsBySector({
                keys: [...definition.gicsSectors, ...(definition.gicsIndustries ?? [])],
                labels: [...definition.cnSectorNames, ...(definition.gicsIndustries ?? [])],
                limit: cap,
                ...(definition.markets !== undefined ? { markets: definition.markets } : {}),
                ...filter,
              })
            : Promise.resolve([] as FundMatch[]),
          definition.markets !== undefined
            ? repo.findFundsByMarketExposure(definition.markets, { limit: cap, ...filter })
            : Promise.resolve([] as FundMatch[]),
        ]);

        return {
          query: theme,
          resolved: true,
          chain: {
            themeId: definition.id,
            indices: definition.indices,
            gicsSectors: definition.gicsSectors,
            cnSectorNames: definition.cnSectorNames,
            markets: definition.markets ?? null,
          },
          ...(definition.note !== undefined ? { themeNote: definition.note } : {}),
          trackingIndexFunds: byIndex.map((fund) => ({
            ...describeFundBrief(fund),
            feeRate: fund.feeRate,
            listedSymbol: fund.listedSymbol,
          })),
          sectorExposureFunds: bySector.map((match) => ({
            ...describeFundBrief(match.fund),
            sector: match.label ?? match.key,
            weightPercent: match.weight,
            coverage: match.coverage,
          })),
          marketExposureFunds: byMarket.map((match) => ({
            ...describeFundBrief(match.fund),
            market: match.key,
            weightPercent: match.weight,
          })),
          note:
            "trackingIndexFunds is the highest-confidence route — a declared mandate does not drift. " +
            "sectorExposureFunds is inferred from the latest disclosed holdings; check fundExposure for its stability. " +
            disclosureNote([...byIndex, ...bySector.map((m) => m.fund), ...byMarket.map((m) => m.fund)]),
        };
      }),
  );
}
