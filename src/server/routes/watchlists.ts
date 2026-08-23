/**
 * The watchlist dashboard's API.
 *
 * Every route is scoped to the signed-in user and every repo call takes that
 * user id, so an id guessed from another account resolves to nothing rather
 * than to someone else's list. Item reads come back priced, because the page
 * has no use for a bare list of symbols.
 *
 * Audit rows are written for creating, renaming and deleting a list — the
 * actions that are hard to undo — but not for individual item edits, which
 * would bury the log under routine curation.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  addItemsSchema,
  addLevelsSchema,
  createWatchlistSchema,
  detectItemKind,
  normalizeRef,
  updateItemSchema,
  updateLevelSchema,
  updateWatchlistSchema,
  WATCHLIST_ITEM_KINDS,
} from "../../shared/watchlist.js";
import { yahooFinanceClient } from "../mcp/client.js";
import { audit } from "../lib/audit.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { requireAuth } from "../middleware/session.js";
import { enrichItems, isApproaching, summarize, withEntryPrices } from "../watchlist/live.js";
import {
  createLazyWatchlistRepo,
  WatchlistLimitError,
  WatchlistNameTakenError,
  WatchlistValidationError,
} from "../watchlist/repo.js";

const repo = createLazyWatchlistRepo();

const itemQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(WATCHLIST_ITEM_KINDS).optional(),
  sort: z.enum(["added", "ref"]).optional(),
  /**
   * Level facet. `near` is the "what should I look at today" view; both it and
   * `hit` are applied after pricing, because neither is knowable from the
   * stored rows alone.
   */
  level: z.enum(["near", "hit", "none"]).optional(),
  /** Quotes are the point of the page, so opting out is explicit. */
  quotes: z.enum(["true", "false"]).optional(),
});

/** Maps the repo's typed failures onto the status codes the SPA expects. */
function errorStatus(error: unknown): 400 | 404 | 409 | null {
  if (error instanceof WatchlistValidationError) return 400;
  if (error instanceof WatchlistNameTakenError) return 409;
  if (error instanceof WatchlistLimitError) return 409;
  if (error instanceof Error && error.message === "Watchlist not found.") return 404;
  if (error instanceof Error && error.message === "Watchlist item not found.") return 404;
  return null;
}

function matchesLevel(
  item: Awaited<ReturnType<typeof enrichItems>>[number],
  facet: "near" | "hit" | "none",
): boolean {
  if (facet === "none") return item.levels.length === 0;
  if (facet === "hit") return item.levels.some((level) => level.status === "hit");
  return isApproaching(item);
}

export const watchlistRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/", async (c) => {
    const lists = await repo.listWatchlists(c.get("user").id);
    return c.json({ items: lists });
  })

  .post("/", zValidator("json", createWatchlistSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    try {
      const list = await repo.createWatchlist(user.id, body);
      await audit({
        actorUserId: user.id,
        action: "watchlist.create",
        targetType: "watchlist",
        targetId: list.id,
        meta: { name: list.name },
        ip: clientIp(c),
      });
      return c.json(list, 201);
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  .patch("/:id", zValidator("json", updateWatchlistSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    try {
      const list = await repo.updateWatchlist(user.id, c.req.param("id"), body);
      if (list === null) return c.json({ error: "watchlist not found" }, 404);
      await audit({
        actorUserId: user.id,
        action: "watchlist.update",
        targetType: "watchlist",
        targetId: list.id,
        meta: { name: list.name },
        ip: clientIp(c),
      });
      return c.json(list);
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const deleted = await repo.deleteWatchlist(user.id, id);
    if (!deleted) return c.json({ error: "watchlist not found" }, 404);
    await audit({
      actorUserId: user.id,
      action: "watchlist.delete",
      targetType: "watchlist",
      targetId: id,
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  })

  /**
   * The list body, priced.
   *
   * Unpaginated by design: a watchlist is capped at 500 items and the page
   * ranks by live change, which it can only do over the whole list. Search and
   * the kind filter still narrow it server-side so the URL stays the source of
   * truth.
   */
  .get("/:id/items", zValidator("query", itemQuerySchema), async (c) => {
    const user = c.get("user");
    const query = c.req.valid("query");
    const id = c.req.param("id");

    const list = await repo.getWatchlist(user.id, id);
    if (list === null) return c.json({ error: "watchlist not found" }, 404);

    const { items, total } = await repo.listItems(user.id, id, {
      ...(query.q !== undefined && { q: query.q }),
      ...(query.kind !== undefined && { kind: query.kind }),
      sort: query.sort ?? "added",
    });

    if (query.quotes === "false") {
      return c.json({ watchlist: list, total, items, summary: null });
    }

    const enriched = await enrichItems(items, { client: yahooFinanceClient, repo });
    // The summary describes the whole list, not the level facet: "3 of 40
    // approaching" is the number that makes the filter worth clicking.
    const summary = summarize(enriched);
    const shown =
      query.level === undefined ? enriched : enriched.filter((item) => matchesLevel(item, query.level!));

    return c.json({
      watchlist: list,
      total: shown.length,
      items: shown,
      summary,
    });
  })

  .post("/:id/items", zValidator("json", addItemsSchema), async (c) => {
    const user = c.get("user");
    const { items } = c.req.valid("json");
    try {
      const rows = items.map((item) => {
        const kind = item.kind ?? detectItemKind(item.ref);
        return {
          kind,
          ref: normalizeRef(item.ref, kind),
          note: item.note ?? null,
          ...(item.entryPrice !== undefined && { entryPrice: item.entryPrice }),
          ...(item.entryAt !== undefined && { entryAt: new Date(item.entryAt) }),
          ...(item.levels !== undefined && { levels: item.levels }),
        };
      });
      const priced = await withEntryPrices(rows, { client: yahooFinanceClient, repo });
      const result = await repo.addItems(user.id, c.req.param("id"), priced);
      return c.json(result, 201);
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  .patch("/:id/items/:itemId", zValidator("json", updateItemSchema), async (c) => {
    const user = c.get("user");
    try {
      const { entryAt, ...patch } = c.req.valid("json");
      const item = await repo.updateItem(user.id, c.req.param("id"), c.req.param("itemId"), {
        ...patch,
        ...(entryAt !== undefined && { entryAt: entryAt === null ? null : new Date(entryAt) }),
      });
      if (item === null) return c.json({ error: "item not found" }, 404);
      return c.json(item);
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  /**
   * Levels are addressed under their item, not at the top level: a level id
   * alone carries no ownership, and routing through the list keeps the same
   * check every other route here makes.
   */
  .post("/:id/items/:itemId/levels", zValidator("json", addLevelsSchema), async (c) => {
    const user = c.get("user");
    try {
      const result = await repo.addLevels(
        user.id,
        c.req.param("id"),
        c.req.param("itemId"),
        c.req.valid("json").levels,
      );
      return c.json(result, 201);
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  .patch("/:id/levels/:levelId", zValidator("json", updateLevelSchema), async (c) => {
    const user = c.get("user");
    try {
      const level = await repo.updateLevel(
        user.id,
        c.req.param("id"),
        c.req.param("levelId"),
        c.req.valid("json"),
      );
      if (level === null) return c.json({ error: "level not found" }, 404);
      return c.json(level);
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  .delete("/:id/levels/:levelId", async (c) => {
    const user = c.get("user");
    try {
      const removed = await repo.removeLevel(user.id, c.req.param("id"), c.req.param("levelId"));
      if (!removed) return c.json({ error: "level not found" }, 404);
      return c.json({ ok: true });
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  .delete("/:id/items/:itemId", async (c) => {
    const user = c.get("user");
    try {
      const removed = await repo.removeItems(user.id, c.req.param("id"), {
        ids: [c.req.param("itemId")],
      });
      if (removed.length === 0) return c.json({ error: "item not found" }, 404);
      return c.json({ ok: true, removed: removed.length });
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  });
