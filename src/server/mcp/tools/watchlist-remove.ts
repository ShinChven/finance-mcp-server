import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import { itemRefSchema, MAX_ITEMS_PER_ADD } from "../../../shared/watchlist.js";
import type { WatchlistRepo } from "../../watchlist/repo.js";
import { resolveWatchlist } from "../../watchlist/resolve.js";
import { destructiveToolAnnotations, runTool } from "./runtime.js";
import { listReferenceSchema, requireWatchlistUser } from "./watchlist-runtime.js";

/**
 * Removes items from a list.
 *
 * Deliberately cannot delete a watchlist itself. Dropping one item is a small,
 * obvious correction; dropping a list discards someone's accumulated notes and
 * targets, and an agent that misreads "clear out my watchlist" should not be
 * able to do that. Deletion lives on the dashboard, where it is confirmed.
 */
export function registerWatchlistRemoveTool(
  server: McpServer,
  repo: WatchlistRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "watchlistRemove",
    {
      title: "Remove from Watchlist",
      description:
        "Remove instruments or funds from one of the user's watchlists, by symbol or fund code. " +
        "Removing something that is not on the list is reported, not an error. This cannot delete a " +
        "watchlist itself — that is done from the dashboard.",
      inputSchema: {
        list: listReferenceSchema.optional(),
        refs: z
          .array(itemRefSchema)
          .min(1)
          .max(MAX_ITEMS_PER_ADD)
          .describe('Symbols or fund codes to drop, e.g. ["NVDA", "161125"].'),
      },
      annotations: destructiveToolAnnotations,
    },
    async ({ list, refs }) =>
      runTool(async () => {
        const userId = requireWatchlistUser(auth);
        const target = await resolveWatchlist(repo, userId, list);

        // Symbols are stored upper-cased; fund codes are digits, so upper-casing
        // is a no-op for them and one normalization covers both.
        const wanted = refs.map((ref) => ref.trim().toUpperCase());
        const removed = await repo.removeItems(userId, target.id, { refs: wanted });
        const removedRefs = new Set(removed.map((item) => item.ref));

        return {
          watchlist: { id: target.id, name: target.name },
          removed: removed.map((item) => ({ kind: item.kind, ref: item.ref, name: item.name })),
          notFound: wanted.filter((ref) => !removedRefs.has(ref)),
        };
      }),
  );
}
