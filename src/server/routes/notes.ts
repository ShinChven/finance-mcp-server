/**
 * The notes dashboard API.
 *
 * Every route is scoped to the signed-in user and every repo call takes that
 * user id, so an id guessed from another account resolves to nothing rather
 * than to someone else's notes.
 *
 * Query parameter names match the SPA's URL search params 1:1 — `q`, `page`,
 * `per_page`, `sort`, `collection`, `tag`, `symbol`, `status` — which is the
 * project rule that lets a shared link reproduce a page exactly.
 *
 * Audit rows are written for the collection lifecycle and for deleting a note:
 * the actions that cannot be undone. Ordinary edits are not audited, which
 * would bury the log under routine writing.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  buildSnippet,
  createCollectionSchema,
  createNoteSchema,
  normalizeSymbolList,
  normalizeTagList,
  NOTE_SORTS,
  NOTE_STATUSES,
  appendToBody,
  updateCollectionSchema,
  updateNoteSchema,
} from "../../shared/notes.js";
import { audit } from "../lib/audit.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { listResponse } from "../lib/listing.js";
import { requireAuth } from "../middleware/session.js";
import {
  CollectionNameTakenError,
  createLazyNotesRepo,
  NoteLimitError,
  type NoteRecord,
} from "../notes/repo.js";

const repo = createLazyNotesRepo();

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(NOTE_SORTS).optional(),
  /** Collection id, or `none` for notes filed nowhere. */
  collection: z.string().trim().max(64).optional(),
  tag: z.string().trim().max(50).optional(),
  symbol: z.string().trim().max(32).optional(),
  status: z.enum([...NOTE_STATUSES, "any"]).optional(),
  pinned: z.enum(["true", "false"]).optional(),
});

/** Maps the repo's typed failures onto the status codes the SPA expects. */
function errorStatus(error: unknown): 404 | 409 | null {
  if (error instanceof CollectionNameTakenError) return 409;
  if (error instanceof NoteLimitError) return 409;
  if (error instanceof Error && error.message === "Collection not found.") return 404;
  return null;
}

/**
 * Listings carry the summary and a snippet, never the body.
 *
 * The page renders a card per note; shipping every body would send megabytes to
 * draw a list, and the detail pane fetches the one note that is actually open.
 */
function toCard(note: NoteRecord, q: string | undefined) {
  const snippet = q === undefined || q === "" ? null : buildSnippet(note.body, q);
  return {
    id: note.id,
    title: note.title,
    summary: note.summary,
    collectionId: note.collectionId,
    collectionName: note.collectionName,
    tags: note.tags,
    symbols: note.symbols,
    status: note.status,
    source: note.source,
    pinned: note.pinned,
    bodyChars: note.body.length,
    snippet:
      snippet === null || snippet.text === ""
        ? null
        : `${snippet.truncatedStart ? "…" : ""}${snippet.text}${snippet.truncatedEnd ? "…" : ""}`,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function toDetail(note: NoteRecord) {
  return { ...toCard(note, undefined), body: note.body, sourceRef: note.sourceRef };
}

export const noteRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  // Declared before `/:id`, which would otherwise swallow it.
  .get("/facets", async (c) => {
    const facets = await repo.facets(c.get("user").id, { limit: 200 });
    return c.json(facets);
  })

  .get("/", zValidator("query", listQuerySchema), async (c) => {
    const user = c.get("user");
    const query = c.req.valid("query");

    const { items, total } = await repo.searchNotes(user.id, {
      ...(query.q !== undefined && { q: query.q }),
      ...(query.collection !== undefined && { collectionId: query.collection }),
      ...(query.tag !== undefined && { tags: normalizeTagList([query.tag]) ?? [] }),
      ...(query.symbol !== undefined && { symbols: [query.symbol.toUpperCase()] }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.pinned === "true" && { pinnedOnly: true }),
      ...(query.sort !== undefined && { sort: query.sort }),
      limit: query.per_page,
      offset: (query.page - 1) * query.per_page,
    });

    return c.json(
      listResponse(
        items.map((note) => toCard(note, query.q)),
        total,
        { ...query, page: query.page, per_page: query.per_page },
      ),
    );
  })

  .post("/", zValidator("json", createNoteSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    try {
      const note = await repo.createNote(user.id, {
        title: body.title,
        summary: body.summary ?? null,
        body: body.body ?? "",
        collectionId: body.collectionId ?? null,
        tags: normalizeTagList(body.tags) ?? [],
        symbols: normalizeSymbolList(body.symbols) ?? [],
        ...(body.pinned !== undefined && { pinned: body.pinned }),
        ...(body.status !== undefined && { status: body.status }),
        source: "web",
        sourceRef: body.sourceRef ?? null,
      });
      return c.json(toDetail(note), 201);
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  .get("/:id", async (c) => {
    const note = await repo.getNote(c.get("user").id, c.req.param("id"));
    if (note === null) return c.json({ error: "note not found" }, 404);
    return c.json(toDetail(note));
  })

  .patch("/:id", zValidator("json", updateNoteSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    try {
      // Resolved against the stored row, so an append never depends on what the
      // client last loaded.
      let text = body.body;
      if (body.appendBody !== undefined) {
        const existing = await repo.getNote(user.id, id);
        if (existing === null) return c.json({ error: "note not found" }, 404);
        text = appendToBody(body.body ?? existing.body, body.appendBody);
      }

      const note = await repo.updateNote(user.id, id, {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.summary !== undefined && { summary: body.summary }),
        ...(text !== undefined && { body: text }),
        ...(body.collectionId !== undefined && { collectionId: body.collectionId }),
        ...(body.tags !== undefined && { tags: normalizeTagList(body.tags) ?? [] }),
        ...(body.addTags !== undefined && { addTags: normalizeTagList(body.addTags) ?? [] }),
        ...(body.symbols !== undefined && { symbols: normalizeSymbolList(body.symbols) ?? [] }),
        ...(body.addSymbols !== undefined && {
          addSymbols: normalizeSymbolList(body.addSymbols) ?? [],
        }),
        ...(body.pinned !== undefined && { pinned: body.pinned }),
        ...(body.status !== undefined && { status: body.status }),
      });
      if (note === null) return c.json({ error: "note not found" }, 404);
      return c.json(toDetail(note));
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const deleted = await repo.deleteNote(user.id, id);
    if (!deleted) return c.json({ error: "note not found" }, 404);
    await audit({
      actorUserId: user.id,
      action: "note.delete",
      targetType: "note",
      targetId: id,
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  });

export const noteCollectionRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/", async (c) => {
    const items = await repo.listCollections(c.get("user").id);
    return c.json({ items });
  })

  .post("/", zValidator("json", createCollectionSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    try {
      const collection = await repo.createCollection(user.id, body);
      await audit({
        actorUserId: user.id,
        action: "note_collection.create",
        targetType: "note_collection",
        targetId: collection.id,
        meta: { name: collection.name },
        ip: clientIp(c),
      });
      return c.json(collection, 201);
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  .patch("/:id", zValidator("json", updateCollectionSchema), async (c) => {
    const user = c.get("user");
    try {
      const collection = await repo.updateCollection(user.id, c.req.param("id"), c.req.valid("json"));
      if (collection === null) return c.json({ error: "collection not found" }, 404);
      await audit({
        actorUserId: user.id,
        action: "note_collection.update",
        targetType: "note_collection",
        targetId: collection.id,
        meta: { name: collection.name },
        ip: clientIp(c),
      });
      return c.json(collection);
    } catch (error) {
      const status = errorStatus(error);
      if (status !== null) return c.json({ error: (error as Error).message }, status);
      throw error;
    }
  })

  /** The notes survive as unfiled; only the folder goes. */
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const deleted = await repo.deleteCollection(user.id, id);
    if (!deleted) return c.json({ error: "collection not found" }, 404);
    await audit({
      actorUserId: user.id,
      action: "note_collection.delete",
      targetType: "note_collection",
      targetId: id,
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  });
