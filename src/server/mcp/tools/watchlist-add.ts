import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import {
  detectItemKind,
  itemNoteSchema,
  itemRefSchema,
  MAX_ITEMS_PER_ADD,
  normalizeRef,
  targetPriceSchema,
  WATCHLIST_ITEM_KINDS,
} from "../../../shared/watchlist.js";
import type { WatchlistRepo } from "../../watchlist/repo.js";
import { resolveOrCreateWatchlist } from "../../watchlist/resolve.js";
import { runTool, writeToolAnnotations } from "./runtime.js";
import { listReferenceSchema, requireWatchlistUser } from "./watchlist-runtime.js";

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
 */
export function registerWatchlistAddTool(
  server: McpServer,
  repo: WatchlistRepo,
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
        "is being tracked in `note` — that context cannot be reconstructed from market data later.",
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
              targetPrice: targetPriceSchema.optional().describe("Price level worth revisiting at."),
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
            targetPrice: item.targetPrice ?? null,
          };
        });

        const { added, skipped } = await repo.addItems(userId, target.id, rows);

        return {
          watchlist: { id: target.id, name: target.name, created },
          added: added.map((item) => ({ kind: item.kind, ref: item.ref, name: item.name })),
          // Already present, so the list already says what the caller wanted.
          skipped,
          note:
            skipped.length > 0
              ? "Skipped items were already on the list; nothing was duplicated."
              : undefined,
        };
      }),
  );
}
