/**
 * Read/write model for watchlists.
 *
 * The MCP tools depend on the `WatchlistRepo` interface rather than on Drizzle,
 * so they stay unit-testable without a database — the same arrangement as
 * `china/repo.ts` and the injected Yahoo client.
 *
 * Every method takes `userId` and filters on it. Ownership is enforced here,
 * not only in the route layer, because two callers reach these rows: the
 * dashboard API and the MCP tools. A repo that trusted its caller would leave
 * one of them a lookup away from another account's list.
 */

import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { db as Database } from "../db/index.js";
import {
  fundNav,
  funds,
  watchlistItems,
  watchlists,
  type Watchlist,
  type WatchlistItem,
} from "../db/schema.js";
import {
  MAX_ITEMS_PER_WATCHLIST,
  MAX_WATCHLISTS_PER_USER,
  type WatchlistItemKind,
} from "../../shared/watchlist.js";

export interface WatchlistSummary extends Watchlist {
  itemCount: number;
}

/** What the fund cache knows about a `fund` item, if it has been ingested. */
export interface FundSnapshot {
  code: string;
  name: string;
  nav: number | null;
  accNav: number | null;
  dailyReturn: number | null;
  navDate: string | null;
}

export interface AddItemRow {
  kind: WatchlistItemKind;
  ref: string;
  name?: string | null;
  note?: string | null;
  targetPrice?: number | null;
}

export interface UpdateItemPatch {
  note?: string | null;
  targetPrice?: number | null;
}

export interface ItemQuery {
  q?: string;
  kind?: WatchlistItemKind;
  sort?: "added" | "ref";
  limit?: number;
  offset?: number;
}

/** Thrown for the caps in `shared/watchlist.ts`; routes map it to 409. */
export class WatchlistLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchlistLimitError";
  }
}

/** Thrown when a name collides with an existing list for the same user. */
export class WatchlistNameTakenError extends Error {
  constructor(readonly name: string) {
    super(`A watchlist named "${name}" already exists.`);
    this.name = "WatchlistNameTakenError";
  }
}

export interface WatchlistRepo {
  listWatchlists(userId: string): Promise<WatchlistSummary[]>;
  getWatchlist(userId: string, id: string): Promise<WatchlistSummary | null>;
  /** Case-insensitive; the unique index is on `lower(name)`. */
  findWatchlistByName(userId: string, name: string): Promise<WatchlistSummary | null>;
  createWatchlist(
    userId: string,
    input: { name: string; description?: string | null },
  ): Promise<WatchlistSummary>;
  updateWatchlist(
    userId: string,
    id: string,
    patch: { name?: string; description?: string | null },
  ): Promise<WatchlistSummary | null>;
  deleteWatchlist(userId: string, id: string): Promise<boolean>;

  listItems(
    userId: string,
    watchlistId: string,
    query?: ItemQuery,
  ): Promise<{ items: WatchlistItem[]; total: number }>;
  addItems(
    userId: string,
    watchlistId: string,
    rows: AddItemRow[],
  ): Promise<{ added: WatchlistItem[]; skipped: string[] }>;
  updateItem(
    userId: string,
    watchlistId: string,
    itemId: string,
    patch: UpdateItemPatch,
  ): Promise<WatchlistItem | null>;
  /** Removes by item id or by `ref`; returns what actually went away. */
  removeItems(
    userId: string,
    watchlistId: string,
    selector: { ids?: string[]; refs?: string[] },
  ): Promise<WatchlistItem[]>;

  /** Latest cached NAV per fund code, for `fund` items. */
  getFundSnapshots(codes: string[]): Promise<Map<string, FundSnapshot>>;
}

type Db = typeof Database;

/** Postgres raises 23505 when a unique index rejects a write. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export function createWatchlistRepo(db: Db): WatchlistRepo {
  const owned = (userId: string, id: string): SQL =>
    and(eq(watchlists.id, id), eq(watchlists.userId, userId))!;

  const counts = db
    .select({
      watchlistId: watchlistItems.watchlistId,
      n: sql<number>`count(*)`.as("n"),
    })
    .from(watchlistItems)
    .groupBy(watchlistItems.watchlistId)
    .as("item_counts");

  const selectSummary = {
    id: watchlists.id,
    userId: watchlists.userId,
    name: watchlists.name,
    description: watchlists.description,
    createdAt: watchlists.createdAt,
    updatedAt: watchlists.updatedAt,
    itemCount: sql<number>`coalesce(${counts.n}, 0)`.mapWith(Number),
  };

  const summaryQuery = (where: SQL) =>
    db
      .select(selectSummary)
      .from(watchlists)
      .leftJoin(counts, eq(counts.watchlistId, watchlists.id))
      .where(where);

  /** Bumped whenever items change, so "recently used" ordering means something. */
  async function touch(id: string): Promise<void> {
    await db.update(watchlists).set({ updatedAt: new Date() }).where(eq(watchlists.id, id));
  }

  async function requireOwned(userId: string, watchlistId: string): Promise<void> {
    const [row] = await db
      .select({ id: watchlists.id })
      .from(watchlists)
      .where(owned(userId, watchlistId))
      .limit(1);
    if (!row) throw new Error("Watchlist not found.");
  }

  return {
    async listWatchlists(userId) {
      return summaryQuery(eq(watchlists.userId, userId)).orderBy(desc(watchlists.updatedAt));
    },

    async getWatchlist(userId, id) {
      const [row] = await summaryQuery(owned(userId, id)).limit(1);
      return row ?? null;
    },

    async findWatchlistByName(userId, name) {
      const [row] = await summaryQuery(
        and(eq(watchlists.userId, userId), sql`lower(${watchlists.name}) = lower(${name})`)!,
      ).limit(1);
      return row ?? null;
    },

    async createWatchlist(userId, input) {
      const [existing] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(watchlists)
        .where(eq(watchlists.userId, userId));
      if ((existing?.n ?? 0) >= MAX_WATCHLISTS_PER_USER) {
        throw new WatchlistLimitError(
          `You already have ${MAX_WATCHLISTS_PER_USER} watchlists. Delete one before creating another.`,
        );
      }

      try {
        const [row] = await db
          .insert(watchlists)
          .values({
            userId,
            name: input.name,
            description: input.description ?? null,
          })
          .returning();
        return { ...row!, itemCount: 0 };
      } catch (error) {
        if (isUniqueViolation(error)) throw new WatchlistNameTakenError(input.name);
        throw error;
      }
    },

    async updateWatchlist(userId, id, patch) {
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.name !== undefined) values["name"] = patch.name;
      if (patch.description !== undefined) values["description"] = patch.description;

      try {
        const [row] = await db.update(watchlists).set(values).where(owned(userId, id)).returning();
        if (!row) return null;
        const [summary] = await summaryQuery(owned(userId, id)).limit(1);
        return summary ?? null;
      } catch (error) {
        if (isUniqueViolation(error) && patch.name !== undefined) {
          throw new WatchlistNameTakenError(patch.name);
        }
        throw error;
      }
    },

    async deleteWatchlist(userId, id) {
      const rows = await db.delete(watchlists).where(owned(userId, id)).returning({ id: watchlists.id });
      return rows.length > 0;
    },

    async listItems(userId, watchlistId, query = {}) {
      await requireOwned(userId, watchlistId);

      const filters: SQL[] = [eq(watchlistItems.watchlistId, watchlistId)];
      if (query.q) {
        const like = `%${query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
        filters.push(
          sql`(${watchlistItems.ref} ilike ${like} or coalesce(${watchlistItems.name}, '') ilike ${like} or coalesce(${watchlistItems.note}, '') ilike ${like})`,
        );
      }
      if (query.kind) filters.push(eq(watchlistItems.kind, query.kind));
      const where = and(...filters)!;

      const [totalRow] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(watchlistItems)
        .where(where);

      const order =
        query.sort === "ref"
          ? [asc(watchlistItems.kind), asc(watchlistItems.ref)]
          : [desc(watchlistItems.createdAt)];

      const rows = await db
        .select()
        .from(watchlistItems)
        .where(where)
        .orderBy(...order)
        .limit(query.limit ?? MAX_ITEMS_PER_WATCHLIST)
        .offset(query.offset ?? 0);

      return { items: rows, total: totalRow?.n ?? 0 };
    },

    async addItems(userId, watchlistId, rows) {
      await requireOwned(userId, watchlistId);
      if (rows.length === 0) return { added: [], skipped: [] };

      const [countRow] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(watchlistItems)
        .where(eq(watchlistItems.watchlistId, watchlistId));
      const current = countRow?.n ?? 0;
      if (current + rows.length > MAX_ITEMS_PER_WATCHLIST) {
        throw new WatchlistLimitError(
          `A watchlist holds at most ${MAX_ITEMS_PER_WATCHLIST} items; this one already has ${current}.`,
        );
      }

      // `onConflictDoNothing` makes re-adding something already tracked a no-op
      // rather than an error — the common case when an agent re-runs a plan.
      const added = await db
        .insert(watchlistItems)
        .values(
          rows.map((row) => ({
            watchlistId,
            kind: row.kind,
            ref: row.ref,
            name: row.name ?? null,
            note: row.note ?? null,
            targetPrice: row.targetPrice ?? null,
          })),
        )
        .onConflictDoNothing({
          target: [watchlistItems.watchlistId, watchlistItems.kind, watchlistItems.ref],
        })
        .returning();

      const addedRefs = new Set(added.map((row) => row.ref));
      const skipped = rows.filter((row) => !addedRefs.has(row.ref)).map((row) => row.ref);
      if (added.length > 0) await touch(watchlistId);
      return { added, skipped };
    },

    async updateItem(userId, watchlistId, itemId, patch) {
      await requireOwned(userId, watchlistId);
      const values: Record<string, unknown> = {};
      if (patch.note !== undefined) values["note"] = patch.note;
      if (patch.targetPrice !== undefined) values["targetPrice"] = patch.targetPrice;
      if (Object.keys(values).length === 0) return null;

      const [row] = await db
        .update(watchlistItems)
        .set(values)
        .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.watchlistId, watchlistId))!)
        .returning();
      if (row) await touch(watchlistId);
      return row ?? null;
    },

    async removeItems(userId, watchlistId, selector) {
      await requireOwned(userId, watchlistId);
      const { ids = [], refs = [] } = selector;
      if (ids.length === 0 && refs.length === 0) return [];

      const match: SQL[] = [];
      if (ids.length > 0) match.push(inArray(watchlistItems.id, ids));
      // Refs are matched regardless of kind: a caller saying "drop 000001"
      // means the row it can see, and (list, kind, ref) is unique anyway.
      if (refs.length > 0) match.push(inArray(watchlistItems.ref, refs));

      const removed = await db
        .delete(watchlistItems)
        .where(and(eq(watchlistItems.watchlistId, watchlistId), or(...match))!)
        .returning();
      if (removed.length > 0) await touch(watchlistId);
      return removed;
    },

    async getFundSnapshots(codes) {
      const snapshots = new Map<string, FundSnapshot>();
      if (codes.length === 0) return snapshots;

      // One row per fund: the latest NAV date it has. DISTINCT ON is the cheap
      // way to get that against the (fund_code, nav_date) unique index.
      const latest = db
        .selectDistinctOn([fundNav.fundCode], {
          fundCode: fundNav.fundCode,
          nav: fundNav.nav,
          accNav: fundNav.accNav,
          dailyReturn: fundNav.dailyReturn,
          navDate: fundNav.navDate,
        })
        .from(fundNav)
        .where(inArray(fundNav.fundCode, codes))
        .orderBy(fundNav.fundCode, desc(fundNav.navDate))
        .as("latest_nav");

      // Left join, not inner: a fund can be in the index with no NAV history
      // yet, and the page still needs to show its name.
      const rows = await db
        .select({
          code: funds.code,
          name: funds.name,
          nav: latest.nav,
          accNav: latest.accNav,
          dailyReturn: latest.dailyReturn,
          navDate: latest.navDate,
        })
        .from(funds)
        .leftJoin(latest, eq(latest.fundCode, funds.code))
        .where(inArray(funds.code, codes));

      for (const row of rows) snapshots.set(row.code, row);
      return snapshots;
    },
  };
}

/**
 * Defers the database import until a tool actually calls, so building an MCP
 * server — as the unit tests do — never requires a configured database.
 */
export function createLazyWatchlistRepo(): WatchlistRepo {
  let cached: Promise<WatchlistRepo> | undefined;

  const load = (): Promise<WatchlistRepo> => {
    cached ??= import("../db/index.js").then((module) => createWatchlistRepo(module.db));
    return cached;
  };

  return new Proxy({} as WatchlistRepo, {
    get(_target, property) {
      return async (...args: unknown[]) => {
        const repo = await load();
        const method = repo[property as keyof WatchlistRepo] as (...inner: unknown[]) => unknown;
        return method.apply(repo, args);
      };
    },
  });
}
