import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import {
  noteBodySchema,
  noteSummarySchema,
  noteTitleSchema,
  normalizeSymbolList,
  normalizeTagList,
  sourceRefSchema,
} from "../../../shared/notes.js";
import type { NotesRepo } from "../../notes/repo.js";
import { resolveOrCreateCollection } from "../../notes/resolve.js";
import { runTool, writeToolAnnotations } from "./runtime.js";
import {
  collectionReferenceSchema,
  noteHeader,
  requireNotesUser,
  symbolsArgSchema,
  tagsArgSchema,
} from "./note-runtime.js";

/**
 * Writing something down.
 *
 * `summary` is the field this whole feature turns on, so the description asks
 * for it in plain terms: it is what every later listing shows, and a note
 * without one can only be found by reading it. The body holds the captured
 * conversation; the summary is the sentence that says whether the body is worth
 * opening.
 */
export function registerNoteCreateTool(
  server: McpServer,
  repo: NotesRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "noteCreate",
    {
      title: "Create Note",
      description:
        "Save something from this conversation to the user's notes — a conclusion, a thesis, a " +
        "decision and its reasoning, a piece of context worth having next time. " +
        "Always write `summary`: one or two sentences saying what the note establishes. It is what " +
        "every later listing shows, and it is how you will find this note again. Put the substance " +
        "in `body` (markdown is fine). Link every instrument discussed via `symbols`, and reuse " +
        "existing `tags` — call noteCollections first to see them. " +
        "Prefer noteUpdate when a note on this topic already exists.",
      inputSchema: {
        title: noteTitleSchema.describe("Short, specific, and about the content — not the date."),
        summary: noteSummarySchema
          .optional()
          .describe("One or two sentences: what this note establishes. Write it every time."),
        body: noteBodySchema.optional().describe("The full content. Markdown."),
        collection: collectionReferenceSchema.optional(),
        createCollection: z
          .boolean()
          .optional()
          .describe("Create the named collection when it does not exist. Defaults to false."),
        tags: tagsArgSchema.optional(),
        symbols: symbolsArgSchema.optional(),
        pinned: z.boolean().optional().describe("Keep at the top of the user's list."),
        sourceRef: sourceRefSchema
          .optional()
          .describe("Where this came from — a conversation id, a client name, a URL."),
      },
      annotations: writeToolAnnotations,
    },
    async (args) =>
      runTool(async () => {
        const userId = requireNotesUser(auth);
        const { collection, created } = await resolveOrCreateCollection(repo, userId, {
          ...(args.collection !== undefined && { reference: args.collection }),
          ...(args.createCollection !== undefined && { create: args.createCollection }),
        });

        const note = await repo.createNote(userId, {
          title: args.title,
          summary: args.summary ?? null,
          body: args.body ?? "",
          collectionId: collection?.id ?? null,
          ...(args.tags !== undefined && { tags: normalizeTagList(args.tags) ?? [] }),
          ...(args.symbols !== undefined && { symbols: normalizeSymbolList(args.symbols) ?? [] }),
          ...(args.pinned !== undefined && { pinned: args.pinned }),
          source: "agent",
          sourceRef: args.sourceRef ?? null,
        });

        return {
          note: noteHeader(note),
          collectionCreated: created ? collection?.name : undefined,
          note_hint:
            args.summary === undefined
              ? "Saved without a summary — listings will show nothing but the title. Add one with noteUpdate."
              : undefined,
        };
      }),
  );
}
