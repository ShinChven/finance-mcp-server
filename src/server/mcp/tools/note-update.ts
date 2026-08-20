import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import {
  appendToBody,
  noteBodySchema,
  noteSummarySchema,
  noteTitleSchema,
  normalizeSymbolList,
  normalizeTagList,
} from "../../../shared/notes.js";
import type { NotesRepo } from "../../notes/repo.js";
import { resolveOrCreateCollection } from "../../notes/resolve.js";
import { runTool, writeToolAnnotations } from "./runtime.js";
import {
  collectionReferenceSchema,
  noteHeader,
  noteIdSchema,
  requireNotesUser,
  statusArgSchema,
  symbolsArgSchema,
  tagsArgSchema,
} from "./note-runtime.js";

/**
 * Editing what is already there.
 *
 * `appendBody` is the field that makes a note survive a long conversation: the
 * alternative is reading the note, concatenating in the model, and writing the
 * whole body back — three times the tokens, and a lost paragraph whenever the
 * read and the write straddle an edit from the dashboard.
 *
 * Tags and symbols come in two flavours for the same reason. `addTags` is
 * additive and safe from a partial view of the note; `tags` replaces the set and
 * is how a caller removes one.
 */
export function registerNoteUpdateTool(
  server: McpServer,
  repo: NotesRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "noteUpdate",
    {
      title: "Update Note",
      description:
        "Edit an existing note. Use `appendBody` to add to a running note without resending what is " +
        "already in it, and `addTags`/`addSymbols` to extend those sets — `tags`/`symbols` replace " +
        "them outright, which is how you remove one. Set `status: \"archived\"` for something no longer " +
        "current: it stays searchable but leaves the listing. Keep `summary` true to the note as it " +
        "stands after your edit.",
      inputSchema: {
        id: noteIdSchema,
        title: noteTitleSchema.optional(),
        summary: noteSummarySchema.optional(),
        body: noteBodySchema.optional().describe("Replaces the body outright."),
        appendBody: noteBodySchema
          .optional()
          .describe("Appended after a blank line. Preferred for adding to a note."),
        collection: collectionReferenceSchema
          .optional()
          .describe('Move to a collection, by name or id. Pass "none" to unfile it.'),
        createCollection: z.boolean().optional(),
        tags: tagsArgSchema.optional().describe("Replaces every tag on the note."),
        addTags: tagsArgSchema.optional().describe("Adds to the tags already there."),
        symbols: symbolsArgSchema.optional().describe("Replaces every symbol on the note."),
        addSymbols: symbolsArgSchema.optional().describe("Adds to the symbols already there."),
        pinned: z.boolean().optional(),
        status: statusArgSchema.optional(),
      },
      annotations: writeToolAnnotations,
    },
    async (args) =>
      runTool(async () => {
        const userId = requireNotesUser(auth);
        const existing = await repo.getNote(userId, args.id);
        if (existing === null) throw new Error(`No note with id ${args.id}.`);

        let collectionId: string | null | undefined;
        if (args.collection !== undefined) {
          if (args.collection.trim().toLowerCase() === "none") collectionId = null;
          else {
            const { collection } = await resolveOrCreateCollection(repo, userId, {
              reference: args.collection,
              ...(args.createCollection !== undefined && { create: args.createCollection }),
            });
            collectionId = collection?.id ?? null;
          }
        }

        // Append is resolved against the row as it stands, not against whatever
        // the caller last saw.
        const body =
          args.appendBody !== undefined
            ? appendToBody(args.body ?? existing.body, args.appendBody)
            : args.body;

        const updated = await repo.updateNote(userId, args.id, {
          ...(args.title !== undefined && { title: args.title }),
          ...(args.summary !== undefined && { summary: args.summary }),
          ...(body !== undefined && { body }),
          ...(collectionId !== undefined && { collectionId }),
          ...(args.tags !== undefined && { tags: normalizeTagList(args.tags) ?? [] }),
          ...(args.addTags !== undefined && { addTags: normalizeTagList(args.addTags) ?? [] }),
          ...(args.symbols !== undefined && { symbols: normalizeSymbolList(args.symbols) ?? [] }),
          ...(args.addSymbols !== undefined && {
            addSymbols: normalizeSymbolList(args.addSymbols) ?? [],
          }),
          ...(args.pinned !== undefined && { pinned: args.pinned }),
          ...(args.status !== undefined && { status: args.status }),
        });
        if (updated === null) throw new Error(`No note with id ${args.id}.`);

        return { note: noteHeader(updated) };
      }),
  );
}
