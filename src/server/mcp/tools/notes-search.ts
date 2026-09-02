import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import {
  DEFAULT_SEARCH_RESULTS,
  MAX_SEARCH_RESULTS,
  NOTE_SORTS,
  normalizeSymbolList,
  normalizeTagList,
} from "../../../shared/notes.js";
import type { NotesRepo } from "../../notes/repo.js";
import { resolveCollection } from "../../notes/resolve.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";
import {
  collectionReferenceSchema,
  noteHit,
  requireNotesUser,
  statusArgSchema,
  symbolsArgSchema,
  tagsArgSchema,
} from "./note-runtime.js";

const dateArg = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be a valid date")
  .describe("ISO date or datetime.");

/**
 * The way in.
 *
 * One tool covers browsing and searching because the two differ only by whether
 * `q` is set: an agent that has to guess between a `notesList` and a
 * `notesSearch` will pick wrong, and the filters are identical either way.
 *
 * Results carry the summary and a snippet, never the body. Reading fifty
 * summaries to find the two notes that matter is the point; `noteRead` fetches
 * the text once the ids are known.
 */
export function registerNotesSearchTool(
  server: McpServer,
  repo: NotesRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "notesSearch",
    {
      title: "Search Notes",
      description:
        "Search and browse the user's saved notes. Full-text over title, summary and body, plus " +
        "substring matching, so partial words and Chinese phrases both match. Omit `q` to browse by " +
        "filter alone. Filters combine: `tags` narrows (a note must carry every tag), while `symbols` " +
        "widens (a note matches any symbol listed). Returns summaries and a matching snippet, never " +
        "note bodies — call noteRead with the ids you want in full.",
      inputSchema: {
        q: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe('Free text. Quoted phrases stay whole: `"rate cut" powell`.'),
        collection: collectionReferenceSchema
          .optional()
          .describe('Restrict to one collection, by name or id. Pass "none" for unfiled notes.'),
        tags: tagsArgSchema.optional().describe("A note must carry every tag listed."),
        symbols: symbolsArgSchema
          .optional()
          .describe("A note matches if it references any symbol listed."),
        status: statusArgSchema
          .or(z.literal("any"))
          .optional()
          .describe("Defaults to `active`. Use `any` or `archived` to reach archived notes."),
        pinnedOnly: z.boolean().optional().describe("Only notes the user pinned."),
        updatedSince: dateArg.optional().describe("Only notes changed on or after this moment."),
        updatedUntil: dateArg.optional().describe("Only notes changed on or before this moment."),
        sort: z
          .enum(NOTE_SORTS)
          .optional()
          .describe("Defaults to `relevance` with a query, `updated` without one."),
        limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
        offset: z.number().int().min(0).max(5_000).optional(),
      },
      annotations: readOnlyToolAnnotations,
    },
    async (args) =>
      runTool(async () => {
        const userId = requireNotesUser(auth);

        let collectionId: string | undefined;
        if (args.collection !== undefined) {
          collectionId =
            args.collection.trim().toLowerCase() === "none"
              ? "none"
              : (await resolveCollection(repo, userId, args.collection)).id;
        }

        const symbols = normalizeSymbolList(args.symbols)?.map((symbol) => symbol.ref);
        const { items, total } = await repo.searchNotes(userId, {
          ...(args.q !== undefined && { q: args.q }),
          ...(collectionId !== undefined && { collectionId }),
          ...(args.tags !== undefined && { tags: normalizeTagList(args.tags) ?? [] }),
          ...(symbols !== undefined && { symbols }),
          ...(args.status !== undefined && { status: args.status }),
          ...(args.pinnedOnly !== undefined && { pinnedOnly: args.pinnedOnly }),
          ...(args.updatedSince !== undefined && { updatedSince: new Date(args.updatedSince) }),
          ...(args.updatedUntil !== undefined && { updatedUntil: new Date(args.updatedUntil) }),
          ...(args.sort !== undefined && { sort: args.sort }),
          limit: args.limit ?? DEFAULT_SEARCH_RESULTS,
          ...(args.offset !== undefined && { offset: args.offset }),
        });

        return {
          total,
          returned: items.length,
          notes: items.map((note) => noteHit(note, args.q)),
          note:
            total === 0
              ? "Nothing matched. Try noteCollections to see the tags and collections that exist."
              : total > items.length
                ? `Showing ${items.length} of ${total}; raise \`limit\` or page with \`offset\`.`
                : undefined,
        };
      }),
  );
}
