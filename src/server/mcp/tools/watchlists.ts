import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuth } from "../../lib/http.js";
import type { WatchlistRepo } from "../../watchlist/repo.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";
import { requireWatchlistUser } from "./watchlist-runtime.js";

/**
 * The index of what this user tracks.
 *
 * Cheap and item-free on purpose: it is the call an agent makes to find out
 * which lists exist before reading or writing one, so it must not pull every
 * item and quote along the way.
 */
export function registerWatchlistsTool(
  server: McpServer,
  repo: WatchlistRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "watchlists",
    {
      title: "Watchlists",
      description:
        "List the watchlists belonging to the authenticated user, with item counts. " +
        "Start here when you need to know which lists exist; use `watchlist` to read one.",
      annotations: readOnlyToolAnnotations,
    },
    async () =>
      runTool(async () => {
        const userId = requireWatchlistUser(auth);
        const lists = await repo.listWatchlists(userId);
        return {
          count: lists.length,
          watchlists: lists.map((list) => ({
            id: list.id,
            name: list.name,
            description: list.description,
            items: list.itemCount,
            updatedAt: list.updatedAt.toISOString(),
          })),
          note:
            lists.length === 0
              ? "No watchlists yet. watchlistAdd creates the first one automatically."
              : "Tools accept either the name or the id wherever a list is named.",
        };
      }),
  );
}
