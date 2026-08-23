import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import {
  itemRefSchema,
  MAX_LEVELS_PER_ITEM,
  WATCHLIST_LEVEL_STATUSES,
} from "../../../shared/watchlist.js";
import type { WatchlistRepo } from "../../watchlist/repo.js";
import { resolveWatchlist } from "../../watchlist/resolve.js";
import { runTool, writeToolAnnotations } from "./runtime.js";
import { levelInputShape, listReferenceSchema, requireWatchlistUser } from "./watchlist-runtime.js";

/**
 * Records what analysis concluded about where the prices are.
 *
 * This is the tool that makes a watchlist worth re-reading: a symbol on its own
 * says only that someone was interested once, while "resistance at 185, thesis
 * breaks under 152" is the part of a conversation that is otherwise lost when
 * it ends.
 *
 * It addresses an item by ref rather than by id because that is what a
 * conversation has — the model is talking about NVDA, not about a row id it
 * would have to look up first. Adding is separate from revising on purpose:
 * an agent re-running its analysis converges on the same levels (duplicates
 * are skipped) instead of quietly rewriting a level the user typed.
 */
export function registerWatchlistLevelsTool(
  server: McpServer,
  repo: WatchlistRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "watchlistLevels",
    {
      title: "Record Watchlist Price Levels",
      description:
        "Attach price levels — support, resistance, targets, stops, entry zones — to an item already " +
        "on one of the user's watchlists, or revise levels already recorded. Levels are what makes a " +
        "watchlist re-readable later: record the ones your analysis actually concluded, with a label " +
        "saying where each number came from. Adding a level that already exists at the same price and " +
        "kind is skipped, so re-running an analysis converges rather than duplicating. Read the list " +
        "with `watchlist` first to see current levels and their ids.",
      inputSchema: {
        list: listReferenceSchema.optional(),
        ref: itemRefSchema.describe('The item to annotate, e.g. "NVDA" or "161125".'),
        add: z
          .array(z.object(levelInputShape))
          .max(MAX_LEVELS_PER_ITEM)
          .optional()
          .describe("Levels to record."),
        update: z
          .array(
            z.object({
              id: z.string().min(1).describe("Level id, as returned by `watchlist`."),
              price: levelInputShape.price.optional(),
              priceHigh: levelInputShape.priceHigh,
              label: levelInputShape.label,
              note: levelInputShape.note,
              status: z
                .enum(WATCHLIST_LEVEL_STATUSES)
                .optional()
                .describe(
                  "`hit` when the price reached it, `invalidated` when the reasoning no longer holds.",
                ),
            }),
          )
          .max(MAX_LEVELS_PER_ITEM)
          .optional()
          .describe("Revisions to levels already recorded."),
        remove: z
          .array(z.string().min(1))
          .max(MAX_LEVELS_PER_ITEM)
          .optional()
          .describe("Level ids to delete. Prefer `status: invalidated` when the level was simply wrong."),
      },
      annotations: writeToolAnnotations,
    },
    async ({ list, ref, add, update, remove }) =>
      runTool(async () => {
        const userId = requireWatchlistUser(auth);
        const target = await resolveWatchlist(repo, userId, list);

        // Symbols are stored upper-cased and fund codes are digits, so one
        // normalization matches both — the same rule watchlistRemove uses.
        const wanted = ref.trim().toUpperCase();
        const { items } = await repo.listItems(userId, target.id, { sort: "added" });
        const item = items.find((candidate) => candidate.ref === wanted);
        if (item === undefined) {
          throw new Error(
            `"${ref}" is not on the list "${target.name}". Add it with watchlistAdd first.`,
          );
        }

        const added =
          add === undefined || add.length === 0
            ? { added: [], skipped: 0 }
            : await repo.addLevels(
                userId,
                target.id,
                item.id,
                add.map((level) => ({ ...level, source: "agent" as const })),
              );

        const updated = [];
        const missing: string[] = [];
        for (const { id, ...patch } of update ?? []) {
          const row = await repo.updateLevel(userId, target.id, id, patch);
          if (row === null) missing.push(id);
          else updated.push(row);
        }

        const removed: string[] = [];
        for (const id of remove ?? []) {
          if (await repo.removeLevel(userId, target.id, id)) removed.push(id);
          else missing.push(id);
        }

        return {
          watchlist: { id: target.id, name: target.name },
          item: { ref: item.ref, kind: item.kind, name: item.name },
          added: added.added.map((level) => ({
            id: level.id,
            kind: level.kind,
            price: level.price,
            priceHigh: level.priceHigh,
            label: level.label,
          })),
          skipped: added.skipped,
          updated: updated.map((level) => ({ id: level.id, kind: level.kind, price: level.price, status: level.status })),
          removed,
          notFound: missing,
          note:
            added.skipped > 0
              ? "Skipped levels were already recorded at that price and kind; nothing was duplicated."
              : undefined,
        };
      }),
  );
}
