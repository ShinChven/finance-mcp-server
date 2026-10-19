import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import {
  itemNoteSchema,
  itemRefSchema,
  MAX_ITEMS_PER_ADD,
  priceSchema,
  watchlistDescriptionSchema,
  watchlistNameSchema,
} from "../../../shared/watchlist.js";
import type { WatchlistRepo } from "../../watchlist/repo.js";
import { resolveWatchlist } from "../../watchlist/resolve.js";
import { runTool, writeToolAnnotations } from "./runtime.js";
import { listReferenceSchema, requireWatchlistUser } from "./watchlist-runtime.js";

/**
 * Revises what a list and its items *say*, never what they contain.
 *
 * The gap this fills: once a list exists, every other watchlist write tool can
 * only add or drop rows. A list named "AI" that has become a semiconductor
 * basket, or a note that recorded a thesis the conversation has since moved
 * past, could be fixed only on the dashboard — so an agent that noticed was
 * reduced to suggesting the user go and do it.
 *
 * Membership deliberately stays out of it. `watchlistAdd` and
 * `watchlistRemove` own that, and keeping "rename and re-reason" apart from
 * "add and drop" means a rename can never take an item with it.
 *
 * Items are addressed by `ref` for the same reason `watchlistLevels` does: a
 * conversation is about NVDA, not about a row id it would have to look up
 * first. `null` clears a field; omitting it leaves the stored value alone.
 */
export function registerWatchlistUpdateTool(
  server: McpServer,
  repo: WatchlistRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "watchlistUpdate",
    {
      title: "Update Watchlist",
      description:
        "Rename one of the user's watchlists, change its description, and revise the note or entry " +
        "price of items already on it. Use this when the list's name no longer describes what it " +
        "holds, or when a tracking note is out of date — a stale `why` is worse than none, because " +
        "later reads trust it. Items are named by symbol or fund code; pass null to clear a field, " +
        "and omit a field to leave it untouched. This cannot add or remove items (use watchlistAdd " +
        "and watchlistRemove), change price levels (watchlistLevels), or delete a list.",
      inputSchema: {
        list: listReferenceSchema.optional(),
        name: watchlistNameSchema
          .optional()
          .describe("New name for the list. Must not collide with another of the user's lists."),
        description: watchlistDescriptionSchema
          .nullable()
          .optional()
          .describe("New description, or null to clear it."),
        items: z
          .array(
            z
              .object({
                ref: itemRefSchema.describe('The item to revise, e.g. "NVDA" or "161125".'),
                note: itemNoteSchema
                  .nullable()
                  .optional()
                  .describe("Why this is being tracked, rewritten. null clears it."),
                entryPrice: priceSchema
                  .nullable()
                  .optional()
                  .describe(
                    "Corrected price at which tracking started — for fixing a backfill, not for " +
                      "recording today's price. null clears it.",
                  ),
                entryAt: z
                  .string()
                  .datetime()
                  .nullable()
                  .optional()
                  .describe("When that entry price applies, ISO 8601. null clears it."),
              })
              .refine(
                (item) =>
                  item.note !== undefined ||
                  item.entryPrice !== undefined ||
                  item.entryAt !== undefined,
                { message: "Name at least one field to change for each item." },
              ),
          )
          .min(1)
          .max(MAX_ITEMS_PER_ADD)
          .optional()
          .describe("Revisions to items already on the list. Read it with `watchlist` first."),
      },
      annotations: writeToolAnnotations,
    },
    async ({ list, name, description, items }) =>
      runTool(async () => {
        const userId = requireWatchlistUser(auth);

        // Nothing to do is a mistake worth naming: the likely cause is a model
        // reaching for this tool to add or drop something, which it cannot do.
        if (name === undefined && description === undefined && items === undefined) {
          throw new Error(
            "Nothing to update. Pass `name`, `description`, or `items`. To add or remove items use " +
              "watchlistAdd and watchlistRemove; for price levels use watchlistLevels.",
          );
        }

        const target = await resolveWatchlist(repo, userId, list);

        // The list patch goes first so a rename is reported even when an item
        // ref turns out to be wrong — the two halves are independent, and
        // re-running the call with the ref fixed stays correct either way.
        let renamedTo: string | undefined;
        let describedAs: string | null | undefined;
        if (name !== undefined || description !== undefined) {
          const updated = await repo.updateWatchlist(userId, target.id, {
            ...(name !== undefined && { name }),
            ...(description !== undefined && { description }),
          });
          if (updated === null) {
            throw new Error(`The watchlist "${target.name}" no longer exists.`);
          }
          if (name !== undefined) renamedTo = updated.name;
          if (description !== undefined) describedAs = updated.description;
        }

        const revised: { ref: string; note: string | null; entryPrice: number | null }[] = [];
        const notFound: string[] = [];

        if (items !== undefined && items.length > 0) {
          // Symbols are stored upper-cased and fund codes are digits, so one
          // normalization matches both — as in watchlistRemove.
          const { items: rows } = await repo.listItems(userId, target.id, { sort: "added" });
          for (const { ref, entryAt, ...patch } of items) {
            const wanted = ref.trim().toUpperCase();
            const row = rows.find((candidate) => candidate.ref === wanted);
            if (row === undefined) {
              notFound.push(wanted);
              continue;
            }
            const updated = await repo.updateItem(userId, target.id, row.id, {
              ...patch,
              ...(entryAt !== undefined && {
                entryAt: entryAt === null ? null : new Date(entryAt),
              }),
            });
            if (updated === null) {
              notFound.push(wanted);
              continue;
            }
            revised.push({
              ref: updated.ref,
              note: updated.note,
              entryPrice: updated.entryPrice,
            });
          }
        }

        return {
          watchlist: {
            id: target.id,
            name: renamedTo ?? target.name,
            ...(renamedTo !== undefined && { previousName: target.name }),
            ...(describedAs !== undefined && { description: describedAs }),
          },
          revised,
          notFound,
          note:
            notFound.length > 0
              ? "Items reported as notFound are not on this list — add them with watchlistAdd, or " +
                "read the list with `watchlist` to see the refs it actually holds."
              : undefined,
        };
      }),
  );
}
