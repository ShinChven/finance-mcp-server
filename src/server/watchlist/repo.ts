/**
 * Read/write model for watchlists.
 *
 * The MCP tools depend on the `WatchlistRepo` interface rather than on Drizzle,
 * so they stay unit-testable without a database — the same arrangement as
 * `funds/repo.ts` and the injected Yahoo client.
 *
 * Every method takes `userId` and filters on it. Ownership is enforced here,
 * not only in the route layer, because two callers reach these rows: the
 * dashboard API and the MCP tools. A repo that trusted its caller would leave
 * one of them a lookup away from another account's list.
 */

import { and, asc, desc, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import type { db as Database } from "../db/index.js";
import { isUniqueViolation } from "../lib/pg-errors.js";
import {
  fundNav,
  funds,
  watchlistItems,
  watchlistLevels,
  watchlists,
  type Watchlist,
  type WatchlistItem,
  type WatchlistLevel,
} from "../db/schema.js";
import {
  MAX_ITEMS_PER_WATCHLIST,
  MAX_LEVELS_PER_ITEM,
  MAX_WATCHLISTS_PER_USER,
  type WatchlistItemKind,
  type WatchlistLevelKind,
  type WatchlistLevelSource,
  type WatchlistLevelStatus,
} from "../../shared/watchlist.js";
import type { NavSeriesPoint } from "../funds/performance.js";
import { watchlistRepoWithEvents } from "../realtime/repo-events.js";

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

export interface AddLevelRow {
  kind: WatchlistLevelKind;
  price: number;
  priceHigh?: number | null;
  label?: string | null;
  note?: string | null;
  validUntil?: string | null;
  source?: WatchlistLevelSource;
}

export interface UpdateLevelPatch {
  kind?: WatchlistLevelKind;
  price?: number;
  priceHigh?: number | null;
  label?: string | null;
  note?: string | null;
  validUntil?: string | null;
  status?: WatchlistLevelStatus;
}

export interface AddItemRow {
  kind: WatchlistItemKind;
  ref: string;
  name?: string | null;
  note?: string | null;
  entryPrice?: number | null;
  entryAt?: Date | null;
  /** The unit the entry price and every level are in; see the schema. */
  currency?: string | null;
  /** Written only for items that were actually inserted. */
  levels?: AddLevelRow[];
}

export interface UpdateItemPatch {
  note?: string | null;
  entryPrice?: number | null;
  entryAt?: Date | null;
}

/**
 * An item always travels with its levels.
 *
 * They are fetched in one `in (…)` query per listing rather than left to the
 * caller, because every caller there is — the dashboard API and the MCP read
 * tool — needs them, and the one that forgot would silently render an item as
 * having no levels at all.
 */
export interface WatchlistItemRow extends WatchlistItem {
  levels: WatchlistLevel[];
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

/** Thrown for input the schema cannot check alone; routes map it to 400. */
export class WatchlistValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchlistValidationError";
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
  ): Promise<{ items: WatchlistItemRow[]; total: number }>;
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

  /** Duplicates — same item, same kind, same price — are skipped, not stacked. */
  addLevels(
    userId: string,
    watchlistId: string,
    itemId: string,
    rows: AddLevelRow[],
  ): Promise<{ added: WatchlistLevel[]; skipped: number }>;
  updateLevel(
    userId: string,
    watchlistId: string,
    levelId: string,
    patch: UpdateLevelPatch,
  ): Promise<WatchlistLevel | null>;
  removeLevel(userId: string, watchlistId: string, levelId: string): Promise<boolean>;

  /** Latest cached NAV per fund code, for `fund` items. */
  getFundSnapshots(codes: string[]): Promise<Map<string, FundSnapshot>>;

  /**
   * NAV observations per fund over a bounded window, for trailing returns.
   *
   * Bounded rather than complete: a list of fifty funds against full histories
   * is a five-figure row count on every load, and the windows a row quotes stop
   * at a year. `since` is the earliest date to read, and the caller is expected
   * to drop any period the window cannot honestly cover.
   */
  getFundNavWindows(codes: string[], since: string): Promise<Map<string, NavSeriesPoint[]>>;

  /** One item by id, scoped to its owner — for the per-item detail routes. */
  getItem(userId: string, watchlistId: string, itemId: string): Promise<WatchlistItem | null>;
}

type Db = typeof Database;

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

  /**
   * Levels are addressed by their own id, but a level id says nothing about
   * who owns it, so every level write starts from the list — which is checked
   * against the user — and matches the level through its item.
   */
  const levelInList = (levelId: string, watchlistId: string): SQL =>
    and(
      eq(watchlistLevels.id, levelId),
      sql`exists (select 1 from ${watchlistItems} where ${watchlistItems.id} = ${watchlistLevels.itemId} and ${watchlistItems.watchlistId} = ${watchlistId})`,
    )!;

  async function levelsFor(itemIds: string[]): Promise<Map<string, WatchlistLevel[]>> {
    const grouped = new Map<string, WatchlistLevel[]>();
    if (itemIds.length === 0) return grouped;
    const rows = await db
      .select()
      .from(watchlistLevels)
      .where(inArray(watchlistLevels.itemId, itemIds))
      // Descending price is how a ladder reads: what is overhead comes first.
      .orderBy(desc(watchlistLevels.price));
    for (const row of rows) {
      const bucket = grouped.get(row.itemId);
      if (bucket === undefined) grouped.set(row.itemId, [row]);
      else bucket.push(row);
    }
    return grouped;
  }

  async function insertLevels(
    itemId: string,
    rows: AddLevelRow[],
  ): Promise<{ added: WatchlistLevel[]; skipped: number }> {
    if (rows.length === 0) return { added: [], skipped: 0 };

    const [countRow] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(watchlistLevels)
      .where(eq(watchlistLevels.itemId, itemId));
    const current = countRow?.n ?? 0;
    if (current + rows.length > MAX_LEVELS_PER_ITEM) {
      throw new WatchlistLimitError(
        `An item holds at most ${MAX_LEVELS_PER_ITEM} price levels; this one already has ${current}.`,
      );
    }

    const added = await db
      .insert(watchlistLevels)
      .values(
        rows.map((row) => ({
          itemId,
          kind: row.kind,
          price: row.price,
          priceHigh: row.priceHigh ?? null,
          label: row.label ?? null,
          note: row.note ?? null,
          validUntil: row.validUntil ?? null,
          source: row.source ?? "user",
        })),
      )
      .onConflictDoNothing({
        target: [watchlistLevels.itemId, watchlistLevels.kind, watchlistLevels.price],
      })
      .returning();

    return { added, skipped: rows.length - added.length };
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

      const levels = await levelsFor(rows.map((row) => row.id));
      return {
        items: rows.map((row) => ({ ...row, levels: levels.get(row.id) ?? [] })),
        total: totalRow?.n ?? 0,
      };
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
            entryPrice: row.entryPrice ?? null,
            // An entry price with no date is one captured right now; the two
            // only come apart when a caller backfills both.
            entryAt: row.entryAt ?? (typeof row.entryPrice === "number" ? new Date() : null),
            currency: row.currency ?? null,
          })),
        )
        .onConflictDoNothing({
          target: [watchlistItems.watchlistId, watchlistItems.kind, watchlistItems.ref],
        })
        .returning();

      const addedRefs = new Set(added.map((row) => row.ref));
      const skipped = rows.filter((row) => !addedRefs.has(row.ref)).map((row) => row.ref);

      // Only for items that were actually inserted: levels sent alongside a ref
      // that was already tracked belong to a row this call did not create, and
      // silently merging them into someone's existing analysis is worse than
      // reporting the ref as skipped.
      const byRef = new Map(added.map((item) => [`${item.kind}:${item.ref}`, item.id]));
      for (const row of rows) {
        const itemId = byRef.get(`${row.kind}:${row.ref}`);
        if (itemId !== undefined && row.levels !== undefined && row.levels.length > 0) {
          await insertLevels(itemId, row.levels);
        }
      }

      if (added.length > 0) await touch(watchlistId);
      return { added, skipped };
    },

    async updateItem(userId, watchlistId, itemId, patch) {
      await requireOwned(userId, watchlistId);
      const values: Record<string, unknown> = {};
      if (patch.note !== undefined) values["note"] = patch.note;
      if (patch.entryPrice !== undefined) values["entryPrice"] = patch.entryPrice;
      if (patch.entryAt !== undefined) values["entryAt"] = patch.entryAt;
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

    async addLevels(userId, watchlistId, itemId, rows) {
      await requireOwned(userId, watchlistId);
      const [item] = await db
        .select({ id: watchlistItems.id })
        .from(watchlistItems)
        .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.watchlistId, watchlistId))!)
        .limit(1);
      if (!item) throw new Error("Watchlist item not found.");

      const result = await insertLevels(itemId, rows);
      if (result.added.length > 0) await touch(watchlistId);
      return result;
    },

    async updateLevel(userId, watchlistId, levelId, patch) {
      await requireOwned(userId, watchlistId);

      const [existing] = await db
        .select()
        .from(watchlistLevels)
        .where(levelInList(levelId, watchlistId))
        .limit(1);
      if (!existing) return null;

      const values: Record<string, unknown> = {};
      if (patch.kind !== undefined) values["kind"] = patch.kind;
      if (patch.price !== undefined) values["price"] = patch.price;
      if (patch.priceHigh !== undefined) values["priceHigh"] = patch.priceHigh;
      if (patch.label !== undefined) values["label"] = patch.label;
      if (patch.note !== undefined) values["note"] = patch.note;
      if (patch.validUntil !== undefined) values["validUntil"] = patch.validUntil;
      if (patch.status !== undefined) {
        values["status"] = patch.status;
        // The moment it stopped being something to wait for. Cleared on the way
        // back to `active` so a re-armed level does not read as already hit.
        values["hitAt"] = patch.status === "hit" ? new Date() : null;
      }
      if (Object.keys(values).length === 0) return null;

      // A patch that moves one edge of a zone is only checkable here, against
      // what is already stored.
      const low = patch.price ?? existing.price;
      const high = patch.priceHigh === undefined ? existing.priceHigh : patch.priceHigh;
      if (high !== null && high <= low) {
        throw new WatchlistValidationError("priceHigh must be greater than price.");
      }

      values["updatedAt"] = new Date();
      try {
        const [row] = await db
          .update(watchlistLevels)
          .set(values)
          .where(levelInList(levelId, watchlistId))
          .returning();
        if (row) await touch(watchlistId);
        return row ?? null;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new WatchlistValidationError(
            "This item already has a level of that kind at that price.",
          );
        }
        throw error;
      }
    },

    async removeLevel(userId, watchlistId, levelId) {
      await requireOwned(userId, watchlistId);
      const removed = await db
        .delete(watchlistLevels)
        .where(levelInList(levelId, watchlistId))
        .returning({ id: watchlistLevels.id });
      if (removed.length > 0) await touch(watchlistId);
      return removed.length > 0;
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

    async getItem(userId, watchlistId, itemId) {
      await requireOwned(userId, watchlistId);
      const [row] = await db
        .select()
        .from(watchlistItems)
        .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.watchlistId, watchlistId)))
        .limit(1);
      return row ?? null;
    },

    async getFundNavWindows(codes, since) {
      const windows = new Map<string, NavSeriesPoint[]>();
      if (codes.length === 0) return windows;

      const rows = await db
        .select({
          fundCode: fundNav.fundCode,
          navDate: fundNav.navDate,
          nav: fundNav.nav,
          accNav: fundNav.accNav,
        })
        .from(fundNav)
        .where(and(inArray(fundNav.fundCode, codes), gte(fundNav.navDate, since)))
        .orderBy(fundNav.fundCode, asc(fundNav.navDate));

      for (const row of rows) {
        const series = windows.get(row.fundCode);
        const point = { navDate: row.navDate, nav: row.nav, accNav: row.accNav };
        if (series === undefined) windows.set(row.fundCode, [point]);
        else series.push(point);
      }
      return windows;
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

  const lazy = new Proxy({} as WatchlistRepo, {
    get(_target, property) {
      return async (...args: unknown[]) => {
        const repo = await load();
        const method = repo[property as keyof WatchlistRepo] as (...inner: unknown[]) => unknown;
        return method.apply(repo, args);
      };
    },
  });

  // Wrapped here rather than at each call site so both the dashboard API and
  // the MCP tools -- the two callers of this factory -- publish change events
  // without either of them having to remember to.
  return watchlistRepoWithEvents(lazy);
}
