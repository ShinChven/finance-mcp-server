import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import { WATCHLIST_ITEM_KINDS } from "../../../shared/watchlist.js";
import { enrichItems, summarize } from "../../watchlist/live.js";
import type { WatchlistRepo } from "../../watchlist/repo.js";
import { resolveWatchlist } from "../../watchlist/resolve.js";
import type { YahooFinanceClient } from "../client.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";
import { listReferenceSchema, requireWatchlistUser } from "./watchlist-runtime.js";

/**
 * One watchlist, priced.
 *
 * This is the tool that answers "how are my holdings doing" in a single call:
 * without it an agent would read the items, then fan out to `quote` per symbol
 * and `fundPerformance` per fund, and still have to reconcile the two.
 *
 * Quotes are on by default because a watchlist without current values rarely
 * answers anything; `quotes: false` exists for the times only the membership
 * matters, and skips the outbound request entirely.
 */
export function registerWatchlistTool(
  server: McpServer,
  repo: WatchlistRepo,
  client: YahooFinanceClient,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "watchlist",
    {
      title: "Read Watchlist",
      description:
        "Read one of the user's watchlists with current values: live Yahoo quotes for instruments and " +
        "the latest cached NAV for China funds, plus per-item notes, the price each item was added at, " +
        "its recorded price levels and a breadth summary. Names a list by name or id; omit it when the " +
        "user has only one.",
      inputSchema: {
        list: listReferenceSchema.optional(),
        kind: z
          .enum(WATCHLIST_ITEM_KINDS)
          .optional()
          .describe("Restrict to instruments (`symbol`) or China funds (`fund`)."),
        quotes: z
          .boolean()
          .optional()
          .describe("Attach current values. Defaults to true; false skips the quote lookup."),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ list, kind, quotes }) =>
      runTool(async () => {
        const userId = requireWatchlistUser(auth);
        const target = await resolveWatchlist(repo, userId, list);
        const { items } = await repo.listItems(userId, target.id, {
          ...(kind !== undefined && { kind }),
          sort: "added",
        });

        const header = {
          id: target.id,
          name: target.name,
          description: target.description,
          updatedAt: target.updatedAt.toISOString(),
        };

        if (quotes === false) {
          return {
            watchlist: header,
            count: items.length,
            items: items.map((item) => ({
              kind: item.kind,
              ref: item.ref,
              name: item.name,
              note: item.note,
              entryPrice: item.entryPrice,
              levels: item.levels.map((level) => ({
                id: level.id,
                kind: level.kind,
                price: level.price,
                priceHigh: level.priceHigh,
                label: level.label,
                status: level.status,
              })),
              addedAt: item.createdAt.toISOString(),
            })),
          };
        }

        const enriched = await enrichItems(items, { client, repo });
        return {
          watchlist: header,
          summary: summarize(enriched),
          items: enriched,
          note:
            "`live.basis` says what the number is: `market` is an intraday Yahoo quote, `nav` is a " +
            "fund's last published net asset value, which moves once per trading day. Items with " +
            "`available: false` carry the reason. The summary counts items equally — a watchlist " +
            "records no position sizes, so it cannot express a portfolio return. " +
            "On each level, `side` and `distancePercent` are computed against the current price: " +
            "`side: above` means the level is overhead, and `distancePercent` is the move needed to " +
            "reach it, as a percentage of the current price. `nearest` is the first active level in " +
            "each direction. `sinceEntryPercent` is measured from `entryPrice` instead, which is what " +
            "the item was worth when it went on the list — not a cost basis, and not a position.",
        };
      }),
  );
}
