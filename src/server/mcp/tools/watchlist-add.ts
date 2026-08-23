import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import {
  detectItemKind,
  itemNoteSchema,
  itemRefSchema,
  MAX_ITEMS_PER_ADD,
  MAX_LEVELS_PER_ITEM,
  normalizeRef,
  priceSchema,
  WATCHLIST_ITEM_KINDS,
} from "../../../shared/watchlist.js";
import type { YahooFinanceClient } from "../client.js";
import { withEntryPrices } from "../../watchlist/live.js";
import type { WatchlistRepo } from "../../watchlist/repo.js";
import { resolveOrCreateWatchlist } from "../../watchlist/resolve.js";
import { runTool, writeToolAnnotations } from "./runtime.js";
import { levelInputShape, listReferenceSchema, requireWatchlistUser } from "./watchlist-runtime.js";

/**
 * Adds instruments or funds to a list.
 *
 * Batched, because the natural request is "track these five", and re-adding
 * something already on the list is reported as skipped rather than failing the
 * whole call — an agent re-running a plan should converge, not error.
 *
 * `note` is the reason for tracking something. It is the one piece of context
 * that cannot be recovered from market data later, so the description asks for
 * it explicitly.
 *
 * The entry price is captured from the live quote unless the caller supplies
 * one, so "what was it at when we started watching" is answerable later
 * without anyone having thought to write it down.
 */
export function registerWatchlistAddTool(
  server: McpServer,
  repo: WatchlistRepo,
  client: YahooFinanceClient,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "watchlistAdd",
    {
      title: "Add to Watchlist",
      description:
        "Add instruments (Yahoo symbols) or China funds (6-digit codes) to one of the user's watchlists. " +
        "Creates the user's first watchlist automatically; naming a list that does not exist otherwise " +
        "requires create: true. Items already present are skipped, not duplicated. Record why each item " +
        "is being tracked in `note` — that context cannot be reconstructed from market data later. " +
        "The entry price is captured from the current quote automatically; pass `entryPrice` only to " +
        "backfill something acquired earlier. Price levels can be attached in the same call, and are " +
        "written only for items this call actually added.",
      inputSchema: {
        list: listReferenceSchema.optional(),
        create: z
          .boolean()
          .optional()
          .describe("Create the named list when it does not exist. Defaults to false."),
        items: z
          .array(
            z.object({
              ref: itemRefSchema.describe(
                'Yahoo symbol ("NVDA", "0700.HK") or a 6-digit China fund code ("161125").',
              ),
              kind: z
                .enum(WATCHLIST_ITEM_KINDS)
                .optional()
                .describe("Defaults to `fund` for a bare 6-digit code, `symbol` otherwise."),
              name: z.string().trim().max(120).optional().describe("Display name, when known."),
              note: itemNoteSchema.optional().describe("Why this is being tracked."),
              entryPrice: priceSchema
                .optional()
                .describe(
                  "Price when tracking started. Captured from the live quote when omitted; pass it " +
                    "only for a position taken before it went on the list.",
                ),
              entryAt: z
                .string()
                .datetime()
                .optional()
                .describe("When that entry price applies, ISO 8601. Defaults to now."),
              levels: z
                .array(z.object(levelInputShape))
                .max(MAX_LEVELS_PER_ITEM)
                .optional()
                .describe("Support, resistance, targets and stops to record alongside the item."),
            }),
          )
          .min(1)
          .max(MAX_ITEMS_PER_ADD),
      },
      annotations: writeToolAnnotations,
    },
    async ({ list, create, items }) =>
      runTool(async () => {
        const userId = requireWatchlistUser(auth);
        const { list: target, created } = await resolveOrCreateWatchlist(repo, userId, {
          ...(list !== undefined && { reference: list }),
          ...(create !== undefined && { create }),
        });

        const rows = items.map((item) => {
          const kind = item.kind ?? detectItemKind(item.ref);
          return {
            kind,
            ref: normalizeRef(item.ref, kind),
            name: item.name ?? null,
            note: item.note ?? null,
            ...(item.entryPrice !== undefined && { entryPrice: item.entryPrice }),
            ...(item.entryAt !== undefined && { entryAt: new Date(item.entryAt) }),
            ...(item.levels !== undefined && { levels: item.levels.map((level) => ({ ...level, source: "agent" as const })) }),
          };
        });

        const priced = await withEntryPrices(rows, { client, repo });
        const { added, skipped } = await repo.addItems(userId, target.id, priced);

        return {
          watchlist: { id: target.id, name: target.name, created },
          added: added.map((item) => ({
            kind: item.kind,
            ref: item.ref,
            name: item.name,
            entryPrice: item.entryPrice,
          })),
          // Already present, so the list already says what the caller wanted.
          skipped,
          note:
            skipped.length > 0
              ? "Skipped items were already on the list; nothing was duplicated, and any levels sent " +
                "with them were not written — use watchlistLevels to revise an item already tracked."
              : undefined,
        };
      }),
  );
}
