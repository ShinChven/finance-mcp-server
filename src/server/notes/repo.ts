/**
 * Read/write model for notes.
 *
 * The MCP tools depend on the `NotesRepo` interface rather than on Drizzle, so
 * they stay unit-testable without a database — the same arrangement as
 * `watchlist/repo.ts`.
 *
 * Every method takes `userId` and filters on it. Ownership is enforced here,
 * not only in the route layer, because two callers reach these rows: the
 * dashboard API and the MCP tools. Notes hold whatever a conversation was
 * about, which makes a leak across accounts worse here than almost anywhere
 * else in this codebase.
 */

import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { db as Database } from "../db/index.js";
import {
  noteCollections,
  noteSymbols,
  noteTags,
  notes,
  type Note,
  type NoteCollection,
} from "../db/schema.js";
import { escapeLike } from "../lib/listing.js";
import {
  MAX_COLLECTIONS_PER_USER,
  MAX_NOTES_PER_USER,
  MAX_SEARCH_RESULTS,
  type NoteSort,
  type NoteSource,
  type NoteStatus,
  type NoteSymbolRef,
} from "../../shared/notes.js";

/** The stored vector is an implementation detail of search; nothing reads it. */
export type NoteColumns = Omit<Note, "searchVector">;

export interface NoteRecord extends NoteColumns {
  tags: string[];
  symbols: NoteSymbolRef[];
  /** Denormalized for display; the notes table only stores the id. */
  collectionName: string | null;
  /** Full-text rank, present only on a search with a query. */
  score?: number;
}

export interface NoteCollectionSummary extends NoteCollection {
  noteCount: number;
}

export interface NoteQuery {
  q?: string;
  /** Collection id, or `"none"` for notes filed nowhere. */
  collectionId?: string;
  /** A note must carry every tag listed — tags narrow. */
  tags?: string[];
  /** A note matches if it references any symbol listed — symbols widen. */
  symbols?: string[];
  status?: NoteStatus | "any";
  pinnedOnly?: boolean;
  updatedSince?: Date;
  updatedUntil?: Date;
  sort?: NoteSort;
  limit?: number;
  offset?: number;
}

export interface CreateNoteInput {
  title: string;
  summary?: string | null;
  body?: string;
  collectionId?: string | null;
  tags?: string[];
  symbols?: NoteSymbolRef[];
  pinned?: boolean;
  status?: NoteStatus;
  source: NoteSource;
  sourceRef?: string | null;
}

export interface UpdateNotePatch {
  title?: string;
  summary?: string | null;
  body?: string;
  collectionId?: string | null;
  /** Replaces the set. `addTags` adds to it; passing both replaces, then adds. */
  tags?: string[];
  addTags?: string[];
  symbols?: NoteSymbolRef[];
  addSymbols?: NoteSymbolRef[];
  pinned?: boolean;
  status?: NoteStatus;
}

export interface TagFacet {
  tag: string;
  count: number;
}

export interface SymbolFacet extends NoteSymbolRef {
  count: number;
}

/** Thrown for the caps in `shared/notes.ts`; routes map it to 409. */
export class NoteLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoteLimitError";
  }
}

/** Thrown when a collection name collides for the same user. */
export class CollectionNameTakenError extends Error {
  constructor(readonly name: string) {
    super(`A collection named "${name}" already exists.`);
    this.name = "CollectionNameTakenError";
  }
}

export interface NotesRepo {
  listCollections(userId: string): Promise<NoteCollectionSummary[]>;
  getCollection(userId: string, id: string): Promise<NoteCollectionSummary | null>;
  /** Case-insensitive; the unique index is on `lower(name)`. */
  findCollectionByName(userId: string, name: string): Promise<NoteCollectionSummary | null>;
  createCollection(
    userId: string,
    input: { name: string; description?: string | null },
  ): Promise<NoteCollectionSummary>;
  updateCollection(
    userId: string,
    id: string,
    patch: { name?: string; description?: string | null },
  ): Promise<NoteCollectionSummary | null>;
  /** Notes in the collection are kept and fall back to uncollected. */
  deleteCollection(userId: string, id: string): Promise<boolean>;

  searchNotes(userId: string, query?: NoteQuery): Promise<{ items: NoteRecord[]; total: number }>;
  getNote(userId: string, id: string): Promise<NoteRecord | null>;
  getNotes(userId: string, ids: string[]): Promise<NoteRecord[]>;
  createNote(userId: string, input: CreateNoteInput): Promise<NoteRecord>;
  updateNote(userId: string, id: string, patch: UpdateNotePatch): Promise<NoteRecord | null>;
  deleteNote(userId: string, id: string): Promise<boolean>;

  /** Tag and symbol vocabulary with counts — what the agent browses by. */
  facets(userId: string, options?: { limit?: number }): Promise<{
    tags: TagFacet[];
    symbols: SymbolFacet[];
  }>;
}

type Db = typeof Database;
/** The handle drizzle hands a `db.transaction` callback. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

/** Everything but `search_vector`, which is large and never read. */
const noteColumns = {
  id: notes.id,
  userId: notes.userId,
  collectionId: notes.collectionId,
  title: notes.title,
  summary: notes.summary,
  body: notes.body,
  status: notes.status,
  source: notes.source,
  sourceRef: notes.sourceRef,
  pinned: notes.pinned,
  createdAt: notes.createdAt,
  updatedAt: notes.updatedAt,
};

export function createNotesRepo(db: Db): NotesRepo {
  const ownedNote = (userId: string, id: string): SQL =>
    and(eq(notes.id, id), eq(notes.userId, userId))!;

  const ownedCollection = (userId: string, id: string): SQL =>
    and(eq(noteCollections.id, id), eq(noteCollections.userId, userId))!;

  const collectionCounts = db
    .select({
      collectionId: notes.collectionId,
      n: sql<number>`count(*)`.as("n"),
    })
    .from(notes)
    .where(eq(notes.status, "active"))
    .groupBy(notes.collectionId)
    .as("note_counts");

  const collectionSummary = (where: SQL) =>
    db
      .select({
        id: noteCollections.id,
        userId: noteCollections.userId,
        name: noteCollections.name,
        description: noteCollections.description,
        createdAt: noteCollections.createdAt,
        updatedAt: noteCollections.updatedAt,
        noteCount: sql<number>`coalesce(${collectionCounts.n}, 0)`.mapWith(Number),
      })
      .from(noteCollections)
      .leftJoin(collectionCounts, eq(collectionCounts.collectionId, noteCollections.id))
      .where(where);

  /**
   * Attaches tags, symbols and the collection name to a page of rows.
   *
   * Two extra queries for the whole page rather than a join: joining both child
   * tables at once multiplies rows by tags × symbols, and de-duplicating that
   * in SQL costs more than fetching the children by id.
   */
  async function hydrate(rows: (NoteColumns & { score?: number })[]): Promise<NoteRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const [tagRows, symbolRows, collectionRows] = await Promise.all([
      db
        .select({ noteId: noteTags.noteId, tag: noteTags.tag })
        .from(noteTags)
        .where(inArray(noteTags.noteId, ids))
        .orderBy(asc(noteTags.tag)),
      db
        .select({ noteId: noteSymbols.noteId, kind: noteSymbols.kind, ref: noteSymbols.ref })
        .from(noteSymbols)
        .where(inArray(noteSymbols.noteId, ids))
        .orderBy(asc(noteSymbols.ref)),
      (async () => {
        const collectionIds = [
          ...new Set(rows.map((row) => row.collectionId).filter((id): id is string => id !== null)),
        ];
        if (collectionIds.length === 0) return [];
        return db
          .select({ id: noteCollections.id, name: noteCollections.name })
          .from(noteCollections)
          .where(inArray(noteCollections.id, collectionIds));
      })(),
    ]);

    const tagsByNote = new Map<string, string[]>();
    for (const row of tagRows) {
      const list = tagsByNote.get(row.noteId) ?? [];
      list.push(row.tag);
      tagsByNote.set(row.noteId, list);
    }
    const symbolsByNote = new Map<string, NoteSymbolRef[]>();
    for (const row of symbolRows) {
      const list = symbolsByNote.get(row.noteId) ?? [];
      list.push({ kind: row.kind, ref: row.ref });
      symbolsByNote.set(row.noteId, list);
    }
    const collectionNames = new Map(collectionRows.map((row) => [row.id, row.name]));

    return rows.map((row) => ({
      ...row,
      tags: tagsByNote.get(row.id) ?? [],
      symbols: symbolsByNote.get(row.id) ?? [],
      collectionName: row.collectionId === null ? null : (collectionNames.get(row.collectionId) ?? null),
    }));
  }

  /**
   * The filter half of a search, shared by the page query and its count.
   *
   * Tags are conjunctive and symbols disjunctive on purpose: adding a tag is how
   * a caller narrows a result set, while "notes about NVDA or AMD" is the
   * question people actually ask about tickers — a note is rarely about every
   * symbol in a basket.
   */
  function filters(userId: string, query: NoteQuery): SQL {
    const clauses: SQL[] = [eq(notes.userId, userId)];

    const status = query.status ?? "active";
    if (status !== "any") clauses.push(eq(notes.status, status));
    if (query.pinnedOnly === true) clauses.push(eq(notes.pinned, true));

    if (query.collectionId === "none") clauses.push(sql`${notes.collectionId} is null`);
    else if (query.collectionId !== undefined) clauses.push(eq(notes.collectionId, query.collectionId));

    for (const tag of query.tags ?? []) {
      clauses.push(
        sql`exists (select 1 from ${noteTags} where ${noteTags.noteId} = ${notes.id} and ${noteTags.tag} = ${tag})`,
      );
    }

    const symbols = query.symbols ?? [];
    if (symbols.length > 0) {
      clauses.push(
        sql`exists (select 1 from ${noteSymbols} where ${noteSymbols.noteId} = ${notes.id} and ${noteSymbols.ref} in ${symbols})`,
      );
    }

    if (query.updatedSince !== undefined) clauses.push(sql`${notes.updatedAt} >= ${query.updatedSince}`);
    if (query.updatedUntil !== undefined) clauses.push(sql`${notes.updatedAt} <= ${query.updatedUntil}`);

    const text = query.q?.trim();
    if (text !== undefined && text !== "") {
      const like = `%${escapeLike(text)}%`;
      // Two matchers, because neither covers the corpus alone. The vector finds
      // whole words anywhere in a long body and is index-backed; the substring
      // match is what finds 降息 inside a Chinese sentence, which no
      // stock text-search parser will tokenize apart, and also catches partial
      // words a person half-remembers.
      clauses.push(
        sql`(${notes.searchVector} @@ websearch_to_tsquery('simple', ${text})
             or ${notes.title} ilike ${like}
             or coalesce(${notes.summary}, '') ilike ${like}
             or ${notes.body} ilike ${like}
             or exists (select 1 from ${noteTags} where ${noteTags.noteId} = ${notes.id} and ${noteTags.tag} ilike ${like})
             or exists (select 1 from ${noteSymbols} where ${noteSymbols.noteId} = ${notes.id} and ${noteSymbols.ref} ilike ${like}))`,
      );
    }

    return and(...clauses)!;
  }

  /**
   * Relevance: the vector's own rank, plus a bump for a substring hit in the
   * title or summary. The bump matters because the substring branch scores zero
   * from `ts_rank_cd` — without it, a Chinese title match would sort below every
   * incidental body match.
   */
  function relevance(text: string): SQL<number> {
    const like = `%${escapeLike(text)}%`;
    return sql<number>`(
      ts_rank_cd(${notes.searchVector}, websearch_to_tsquery('simple', ${text}))
      + case when ${notes.title} ilike ${like} then 0.5 else 0 end
      + case when coalesce(${notes.summary}, '') ilike ${like} then 0.25 else 0 end
    )`.mapWith(Number);
  }

  function ordering(query: NoteQuery, hasText: boolean): SQL[] {
    const pinnedFirst = desc(notes.pinned);
    switch (query.sort ?? (hasText ? "relevance" : "updated")) {
      case "relevance":
        // Falls back to recency when there is nothing to rank against.
        return hasText
          ? [desc(relevance(query.q!.trim())), desc(notes.updatedAt)]
          : [pinnedFirst, desc(notes.updatedAt)];
      case "created":
        return [pinnedFirst, desc(notes.createdAt)];
      case "title":
        return [pinnedFirst, asc(sql`lower(${notes.title})`)];
      default:
        return [pinnedFirst, desc(notes.updatedAt)];
    }
  }

  async function replaceTags(tx: Tx, noteId: string, tags: string[]): Promise<void> {
    await tx.delete(noteTags).where(eq(noteTags.noteId, noteId));
    if (tags.length > 0) {
      await tx
        .insert(noteTags)
        .values(tags.map((tag) => ({ noteId, tag })))
        .onConflictDoNothing();
    }
  }

  async function addTags(tx: Tx, noteId: string, tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    await tx
      .insert(noteTags)
      .values(tags.map((tag) => ({ noteId, tag })))
      .onConflictDoNothing();
  }

  async function replaceSymbols(tx: Tx, noteId: string, symbols: NoteSymbolRef[]): Promise<void> {
    await tx.delete(noteSymbols).where(eq(noteSymbols.noteId, noteId));
    if (symbols.length > 0) {
      await tx
        .insert(noteSymbols)
        .values(symbols.map((symbol) => ({ noteId, kind: symbol.kind, ref: symbol.ref })))
        .onConflictDoNothing();
    }
  }

  async function addSymbols(tx: Tx, noteId: string, symbols: NoteSymbolRef[]): Promise<void> {
    if (symbols.length === 0) return;
    await tx
      .insert(noteSymbols)
      .values(symbols.map((symbol) => ({ noteId, kind: symbol.kind, ref: symbol.ref })))
      .onConflictDoNothing();
  }

  /** A collection id from another account must not become a filing target. */
  async function assertCollection(userId: string, collectionId: string | null): Promise<void> {
    if (collectionId === null) return;
    const [row] = await db
      .select({ id: noteCollections.id })
      .from(noteCollections)
      .where(ownedCollection(userId, collectionId))
      .limit(1);
    if (!row) throw new Error("Collection not found.");
  }

  async function loadOne(userId: string, id: string): Promise<NoteRecord | null> {
    const [row] = await db.select(noteColumns).from(notes).where(ownedNote(userId, id)).limit(1);
    if (!row) return null;
    const [record] = await hydrate([row]);
    return record ?? null;
  }

  return {
    async listCollections(userId) {
      return collectionSummary(eq(noteCollections.userId, userId)).orderBy(asc(noteCollections.name));
    },

    async getCollection(userId, id) {
      const [row] = await collectionSummary(ownedCollection(userId, id)).limit(1);
      return row ?? null;
    },

    async findCollectionByName(userId, name) {
      const [row] = await collectionSummary(
        and(
          eq(noteCollections.userId, userId),
          sql`lower(${noteCollections.name}) = lower(${name})`,
        )!,
      ).limit(1);
      return row ?? null;
    },

    async createCollection(userId, input) {
      const [existing] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(noteCollections)
        .where(eq(noteCollections.userId, userId));
      if ((existing?.n ?? 0) >= MAX_COLLECTIONS_PER_USER) {
        throw new NoteLimitError(
          `You already have ${MAX_COLLECTIONS_PER_USER} collections. Delete one before creating another.`,
        );
      }

      try {
        const [row] = await db
          .insert(noteCollections)
          .values({ userId, name: input.name, description: input.description ?? null })
          .returning();
        return { ...row!, noteCount: 0 };
      } catch (error) {
        if (isUniqueViolation(error)) throw new CollectionNameTakenError(input.name);
        throw error;
      }
    },

    async updateCollection(userId, id, patch) {
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.name !== undefined) values["name"] = patch.name;
      if (patch.description !== undefined) values["description"] = patch.description;

      try {
        const [row] = await db
          .update(noteCollections)
          .set(values)
          .where(ownedCollection(userId, id))
          .returning({ id: noteCollections.id });
        if (!row) return null;
        const [summary] = await collectionSummary(ownedCollection(userId, id)).limit(1);
        return summary ?? null;
      } catch (error) {
        if (isUniqueViolation(error) && patch.name !== undefined) {
          throw new CollectionNameTakenError(patch.name);
        }
        throw error;
      }
    },

    async deleteCollection(userId, id) {
      // The notes survive: `collection_id` is ON DELETE SET NULL, so they fall
      // back to uncollected rather than disappearing with the folder.
      const rows = await db
        .delete(noteCollections)
        .where(ownedCollection(userId, id))
        .returning({ id: noteCollections.id });
      return rows.length > 0;
    },

    async searchNotes(userId, query = {}) {
      const where = filters(userId, query);
      const text = query.q?.trim() ?? "";
      const hasText = text !== "";

      const [totalRow] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(notes)
        .where(where);

      const limit = Math.min(query.limit ?? MAX_SEARCH_RESULTS, MAX_SEARCH_RESULTS);
      const rows = await db
        .select(hasText ? { ...noteColumns, score: relevance(text) } : noteColumns)
        .from(notes)
        .where(where)
        .orderBy(...ordering(query, hasText))
        .limit(limit)
        .offset(query.offset ?? 0);

      return { items: await hydrate(rows), total: totalRow?.n ?? 0 };
    },

    async getNote(userId, id) {
      return loadOne(userId, id);
    },

    async getNotes(userId, ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .select(noteColumns)
        .from(notes)
        .where(and(eq(notes.userId, userId), inArray(notes.id, ids))!);
      const records = await hydrate(rows);
      // Returned in the order asked for, so a caller reading three ids gets
      // them back the way it listed them.
      const byId = new Map(records.map((record) => [record.id, record]));
      return ids.map((id) => byId.get(id)).filter((record): record is NoteRecord => record !== undefined);
    },

    async createNote(userId, input) {
      const [countRow] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(notes)
        .where(eq(notes.userId, userId));
      if ((countRow?.n ?? 0) >= MAX_NOTES_PER_USER) {
        throw new NoteLimitError(
          `You already have ${MAX_NOTES_PER_USER} notes. Delete or archive some before adding more.`,
        );
      }
      await assertCollection(userId, input.collectionId ?? null);

      const id = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(notes)
          .values({
            userId,
            collectionId: input.collectionId ?? null,
            title: input.title,
            summary: input.summary ?? null,
            body: input.body ?? "",
            status: input.status ?? "active",
            source: input.source,
            sourceRef: input.sourceRef ?? null,
            pinned: input.pinned ?? false,
          })
          .returning({ id: notes.id });
        const noteId = row!.id;
        await addTags(tx, noteId, input.tags ?? []);
        await addSymbols(tx, noteId, input.symbols ?? []);
        return noteId;
      });

      const record = await loadOne(userId, id);
      if (record === null) throw new Error("Note vanished immediately after creation.");
      return record;
    },

    async updateNote(userId, id, patch) {
      if (patch.collectionId !== undefined) await assertCollection(userId, patch.collectionId);

      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.title !== undefined) values["title"] = patch.title;
      if (patch.summary !== undefined) values["summary"] = patch.summary;
      if (patch.body !== undefined) values["body"] = patch.body;
      if (patch.collectionId !== undefined) values["collectionId"] = patch.collectionId;
      if (patch.pinned !== undefined) values["pinned"] = patch.pinned;
      if (patch.status !== undefined) values["status"] = patch.status;

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(notes)
          .set(values)
          .where(ownedNote(userId, id))
          .returning({ id: notes.id });
        if (!row) return false;
        if (patch.tags !== undefined) await replaceTags(tx, id, patch.tags);
        if (patch.addTags !== undefined) await addTags(tx, id, patch.addTags);
        if (patch.symbols !== undefined) await replaceSymbols(tx, id, patch.symbols);
        if (patch.addSymbols !== undefined) await addSymbols(tx, id, patch.addSymbols);
        return true;
      });

      return updated ? loadOne(userId, id) : null;
    },

    async deleteNote(userId, id) {
      const rows = await db.delete(notes).where(ownedNote(userId, id)).returning({ id: notes.id });
      return rows.length > 0;
    },

    async facets(userId, options = {}) {
      const limit = options.limit ?? 100;
      const [tagRows, symbolRows] = await Promise.all([
        db
          .select({ tag: noteTags.tag, count: sql<number>`count(*)`.mapWith(Number) })
          .from(noteTags)
          .innerJoin(notes, eq(notes.id, noteTags.noteId))
          .where(and(eq(notes.userId, userId), eq(notes.status, "active"))!)
          .groupBy(noteTags.tag)
          .orderBy(desc(sql`count(*)`), asc(noteTags.tag))
          .limit(limit),
        db
          .select({
            kind: noteSymbols.kind,
            ref: noteSymbols.ref,
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(noteSymbols)
          .innerJoin(notes, eq(notes.id, noteSymbols.noteId))
          .where(and(eq(notes.userId, userId), eq(notes.status, "active"))!)
          .groupBy(noteSymbols.kind, noteSymbols.ref)
          .orderBy(desc(sql`count(*)`), asc(noteSymbols.ref))
          .limit(limit),
      ]);

      return { tags: tagRows, symbols: symbolRows };
    },
  };
}

/**
 * Defers the database import until a tool actually calls, so building an MCP
 * server — as the unit tests do — never requires a configured database.
 */
export function createLazyNotesRepo(): NotesRepo {
  let cached: Promise<NotesRepo> | undefined;

  const load = (): Promise<NotesRepo> => {
    cached ??= import("../db/index.js").then((module) => createNotesRepo(module.db));
    return cached;
  };

  return new Proxy({} as NotesRepo, {
    get(_target, property) {
      return async (...args: unknown[]) => {
        const repo = await load();
        const method = repo[property as keyof NotesRepo] as (...inner: unknown[]) => unknown;
        return method.apply(repo, args);
      };
    },
  });
}
