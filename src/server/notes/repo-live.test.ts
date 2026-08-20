import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { db as Database } from "../db/index.js";
import * as schema from "../db/schema.js";
import { createNotesRepo } from "./repo.js";

/**
 * Runs the notes queries against a real Postgres.
 *
 * The search path is hand-written SQL — a generated `tsvector`, a
 * `websearch_to_tsquery` match OR-ed with substring matching, `exists`
 * subqueries per tag — and none of that is checked by the type system. The tool
 * tests mock the repo away, so without this the first thing to discover a
 * malformed predicate would be a user's search box.
 *
 * Skipped unless `DATABASE_URL` is set, so the default suite stays offline.
 * Everything runs inside a transaction that is always rolled back, so pointing
 * it at a populated database is safe.
 */

const connectionString = process.env.DATABASE_URL;

class Rollback extends Error {}

describe.skipIf(connectionString === undefined)("notes repo against Postgres", () => {
  it("stores, searches and edits notes without a SQL error", async () => {
    const pool = new pg.Pool({ connectionString });
    const db = drizzle(pool, { schema });

    try {
      await expect(
        db.transaction(async (tx) => {
          const repo = createNotesRepo(tx as unknown as typeof Database);
          const [user] = await tx
            .insert(schema.users)
            .values({ email: `notes-${crypto.randomUUID()}@example.com` })
            .returning();
          const [other] = await tx
            .insert(schema.users)
            .values({ email: `other-${crypto.randomUUID()}@example.com` })
            .returning();
          const userId = user!.id;
          const otherId = other!.id;

          const macro = await repo.createCollection(userId, {
            name: "Macro",
            description: "Rates and policy",
          });
          expect(macro.noteCount).toBe(0);
          expect(await repo.findCollectionByName(userId, "macro")).not.toBeNull();

          const fed = await repo.createNote(userId, {
            title: "Fed pivot expectations",
            summary: "Market prices two cuts by June; positioning still short duration.",
            body: "Powell's press conference kept the door open. 市场对降息的预期明显升温，尤其是六月会议。",
            collectionId: macro.id,
            tags: ["macro", "rate-cut"],
            symbols: [{ kind: "symbol", ref: "TLT" }],
            source: "agent",
            sourceRef: "chat:abc123",
          });
          expect(fed.tags).toEqual(["macro", "rate-cut"]);
          expect(fed.collectionName).toBe("Macro");

          const nvda = await repo.createNote(userId, {
            title: "NVDA datacenter thesis",
            summary: "Supply constraints ease in H2; watch hyperscaler capex guidance.",
            body: "Blackwell ramp is the swing factor for the datacenter line.",
            tags: ["ai", "macro"],
            symbols: [
              { kind: "symbol", ref: "NVDA" },
              { kind: "fund", ref: "000834" },
            ],
            source: "web",
          });

          const archived = await repo.createNote(userId, {
            title: "Old China property note",
            body: "Superseded by the 2026 stimulus package.",
            status: "archived",
            tags: ["china"],
            source: "web",
          });

          // A note that belongs to somebody else, to prove the filters exclude it.
          await repo.createNote(otherId, {
            title: "Fed pivot expectations",
            body: "Another account's note about 降息.",
            tags: ["macro"],
            source: "web",
          });

          // Full-text: an English word from the body, via the stored vector.
          const powell = await repo.searchNotes(userId, { q: "Powell" });
          expect(powell.items.map((note) => note.id)).toEqual([fed.id]);
          expect(powell.items[0]!.score).toBeGreaterThan(0);

          // The substring branch: Chinese inside a sentence, which no stock
          // text-search parser tokenizes apart.
          const cjk = await repo.searchNotes(userId, { q: "降息" });
          expect(cjk.items.map((note) => note.id)).toEqual([fed.id]);
          expect(cjk.total).toBe(1);

          // A title hit outranks a body-only hit.
          const datacenter = await repo.searchNotes(userId, { q: "datacenter" });
          expect(datacenter.items[0]!.id).toBe(nvda.id);

          // Tags narrow: both must be present.
          expect(
            (await repo.searchNotes(userId, { tags: ["macro", "rate-cut"] })).items.map((n) => n.id),
          ).toEqual([fed.id]);
          expect((await repo.searchNotes(userId, { tags: ["macro"] })).total).toBe(2);

          // Symbols widen: any of them matches.
          const bySymbol = await repo.searchNotes(userId, { symbols: ["NVDA", "TLT"] });
          expect(new Set(bySymbol.items.map((n) => n.id))).toEqual(new Set([fed.id, nvda.id]));
          expect((await repo.searchNotes(userId, { symbols: ["000834"] })).total).toBe(1);

          // Archived rows are out of the default listing and back in on request.
          expect((await repo.searchNotes(userId, {})).total).toBe(2);
          expect((await repo.searchNotes(userId, { status: "any" })).total).toBe(3);
          expect((await repo.searchNotes(userId, { status: "archived" })).items[0]!.id).toBe(
            archived.id,
          );

          // Collections, pinning, dates, sorts and paging all compile and run.
          expect((await repo.searchNotes(userId, { collectionId: macro.id })).total).toBe(1);
          expect((await repo.searchNotes(userId, { collectionId: "none" })).total).toBe(1);
          expect((await repo.searchNotes(userId, { pinnedOnly: true })).total).toBe(0);
          for (const sort of ["relevance", "updated", "created", "title"] as const) {
            await repo.searchNotes(userId, { q: "note", sort, limit: 5, offset: 0 });
          }
          await repo.searchNotes(userId, {
            updatedSince: new Date(Date.now() - 60_000),
            updatedUntil: new Date(Date.now() + 60_000),
          });

          // Ownership: the other account's identical title is never reachable.
          expect(await repo.getNote(otherId, fed.id)).toBeNull();
          expect((await repo.searchNotes(otherId, { q: "Powell" })).total).toBe(0);

          // Patch semantics: replace, add, append, move, pin.
          const updated = await repo.updateNote(userId, nvda.id, {
            summary: "Updated view: capex guidance is the tell.",
            addTags: ["semis"],
            addSymbols: [{ kind: "symbol", ref: "AMD" }],
            collectionId: macro.id,
            pinned: true,
          });
          expect(updated!.tags).toEqual(["ai", "macro", "semis"]);
          expect(updated!.symbols.map((s) => s.ref)).toEqual(["000834", "AMD", "NVDA"]);
          expect(updated!.collectionName).toBe("Macro");

          const replaced = await repo.updateNote(userId, nvda.id, { tags: ["ai"], symbols: [] });
          expect(replaced!.tags).toEqual(["ai"]);
          expect(replaced!.symbols).toEqual([]);

          // Pinned notes lead the default ordering.
          expect((await repo.searchNotes(userId, {})).items[0]!.id).toBe(nvda.id);

          // The edited body is searchable immediately — the vector is generated,
          // not maintained by application code.
          await repo.updateNote(userId, nvda.id, { body: "Rewritten: 光刻机 supply chain." });
          expect((await repo.searchNotes(userId, { q: "光刻机" })).total).toBe(1);
          expect((await repo.searchNotes(userId, { q: "Blackwell" })).total).toBe(0);

          expect((await repo.getNotes(userId, [nvda.id, fed.id])).map((n) => n.id)).toEqual([
            nvda.id,
            fed.id,
          ]);

          const facets = await repo.facets(userId);
          expect(facets.tags.find((t) => t.tag === "macro")?.count).toBe(1);
          expect(facets.symbols.find((s) => s.ref === "TLT")).toEqual({
            kind: "symbol",
            ref: "TLT",
            count: 1,
          });

          // Deleting a collection keeps its notes, unfiled.
          expect(await repo.deleteCollection(userId, macro.id)).toBe(true);
          expect((await repo.getNote(userId, fed.id))!.collectionId).toBeNull();

          expect(await repo.deleteNote(userId, archived.id)).toBe(true);
          expect(await repo.deleteNote(otherId, fed.id)).toBe(false);
          expect((await repo.searchNotes(userId, { status: "any" })).total).toBe(2);

          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
    } finally {
      await pool.end();
    }
  });
});
