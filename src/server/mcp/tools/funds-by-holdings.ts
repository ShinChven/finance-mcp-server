import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findTheme } from "../../funds/crosswalk.js";
import { describeFundBrief, disclosureNote } from "../../funds/present.js";
import type { HoldingCriteria, FundRepo } from "../../funds/repo.js";
import { toCanonicalSymbol } from "../../funds/symbols.js";
import { domicileSchema, readOnlyToolAnnotations, runTool } from "./runtime.js";

/**
 * The federated query: funds ranked by how much of their book sits in
 * positions matching instrument-level criteria.
 *
 * `fundsBySector` reads precomputed exposure and is the right tool for a plain
 * "who is heavy in semiconductors". This one goes back to the raw positions and
 * joins them against the enriched instrument table, so criteria that were never
 * precomputed — company size, country of domicile, an explicit basket of
 * symbols — can be combined. The instrument attributes come from Yahoo, the
 * weights from each fund's own provider, and because both are cached locally
 * the whole thing is one statement rather than a fan-out.
 *
 * `shareOfDisclosed` is the figure to compare across funds: a matched weight of
 * 30% means something different in a book that discloses 62% of itself than in
 * one that publishes all of it.
 */
export function registerFundsByHoldingsTool(server: McpServer, repo: FundRepo): void {
  server.registerTool(
    "fundsByHoldings",
    {
      title: "Funds by Holding Criteria",
      description:
        "Rank funds by how much of their disclosed portfolio sits in positions matching instrument-level " +
        'criteria: a basket of symbols, a sector or theme, a country of domicile, a listing market, or a ' +
        "market-cap range in USD. Use when the question combines criteria or involves company size — for a " +
        "plain sector ranking prefer fundsBySector, which reads precomputed exposure and is cheaper. At " +
        "least one criterion is required.",
      inputSchema: {
        symbols: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
        sector: z.string().trim().min(1).max(64).optional(),
        country: z.array(z.string().trim().min(2).max(64)).max(10).optional(),
        holdingMarket: z
          .array(z.string().trim().min(2).max(8).transform((market) => market.toUpperCase()))
          .max(10)
          .optional()
          .describe('Markets the positions are listed in, e.g. ["US", "HK"].'),
        minMarketCapUsd: z.number().min(0).optional(),
        maxMarketCapUsd: z.number().min(0).optional(),
        domicile: domicileSchema.optional(),
        offshoreOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async (input) =>
      runTool(async () => {
        const {
          symbols,
          sector,
          country,
          holdingMarket,
          minMarketCapUsd,
          maxMarketCapUsd,
          domicile,
          offshoreOnly,
          limit,
        } = input;

        // Resolve each symbol the same way fundsByStock does: a canonical or raw
        // exchange code normalizes directly, anything else goes through the
        // instruments table, which also accepts an ISIN.
        const resolved: string[] = [];
        const unresolved: string[] = [];
        for (const raw of symbols ?? []) {
          const target = toCanonicalSymbol(raw) ?? (await repo.resolveSymbol(raw))?.symbol;
          if (target === undefined) unresolved.push(raw);
          else resolved.push(target);
        }

        const theme = sector === undefined ? undefined : findTheme(sector);
        const sectors =
          sector === undefined
            ? undefined
            : theme
              ? theme.gicsSectors
              : [sector];
        const industries =
          sector === undefined
            ? undefined
            : theme
              ? [...theme.cnSectorNames, ...(theme.gicsIndustries ?? [])]
              : [sector];

        const criteria: HoldingCriteria = {
          limit: limit ?? 20,
          ...(resolved.length > 0 ? { symbols: resolved } : {}),
          ...(sectors !== undefined ? { sectors } : {}),
          ...(industries !== undefined ? { industries } : {}),
          ...(country !== undefined ? { countries: country } : {}),
          ...(holdingMarket !== undefined ? { holdingMarkets: holdingMarket } : {}),
          ...(minMarketCapUsd !== undefined ? { minMarketCapUsd } : {}),
          ...(maxMarketCapUsd !== undefined ? { maxMarketCapUsd } : {}),
          ...(domicile !== undefined ? { domiciles: domicile } : {}),
          ...(offshoreOnly !== undefined ? { offshoreOnly } : {}),
        };

        // Without a predicate this ranks funds by how much they disclose, which
        // is a property of their regulator rather than of their portfolio.
        const hasCriterion =
          criteria.symbols !== undefined ||
          criteria.sectors !== undefined ||
          criteria.countries !== undefined ||
          criteria.holdingMarkets !== undefined ||
          criteria.minMarketCapUsd !== undefined ||
          criteria.maxMarketCapUsd !== undefined;
        if (!hasCriterion) {
          throw new Error(
            "Give at least one criterion (symbols, sector, country, holdingMarket, or a market-cap bound). " +
              (unresolved.length > 0
                ? `None of these resolved to a symbol in the local index: ${unresolved.join(", ")}.`
                : "Without one this would rank funds by how much they disclose, not by what they hold."),
          );
        }

        const matches = await repo.findFundsByHoldingCriteria(criteria);
        const round = (value: number) => Math.round(value * 100) / 100;

        return {
          criteria: {
            symbols: resolved,
            ...(unresolved.length > 0 ? { unresolvedSymbols: unresolved } : {}),
            ...(sector !== undefined ? { sector, resolvedTheme: theme?.id ?? null } : {}),
            ...(country !== undefined ? { country } : {}),
            ...(holdingMarket !== undefined ? { holdingMarket } : {}),
            ...(minMarketCapUsd !== undefined ? { minMarketCapUsd } : {}),
            ...(maxMarketCapUsd !== undefined ? { maxMarketCapUsd } : {}),
          },
          matchCount: matches.length,
          funds: matches.map((match) => ({
            ...describeFundBrief(match.fund),
            matchedWeightPercent: round(match.matchedWeight),
            positions: match.positions,
            disclosedWeightPercent: round(match.disclosedWeight),
            // The comparable number: matched weight as a share of what this
            // fund actually discloses, so a top-holdings book and a full one
            // can be ranked against each other.
            shareOfDisclosedPercent:
              match.disclosedWeight > 0
                ? round((match.matchedWeight / match.disclosedWeight) * 100)
                : null,
            reportDate: match.reportDate,
          })),
          note:
            "Rank by shareOfDisclosedPercent, not matchedWeightPercent: the latter is a share of net " +
            "assets and is structurally smaller for a fund that discloses only its largest positions. " +
            "Market-cap bounds are matched against a USD-converted weekly snapshot, so treat them as a " +
            "size band rather than a live figure, and note that a position whose market cap Yahoo does " +
            "not carry is excluded by any bound. " +
            disclosureNote(matches.map((match) => match.fund)),
        };
      }),
  );
}
