import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuth } from "../../lib/http.js";
import type { NotesRepo } from "../../notes/repo.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";
import { requireNotesUser } from "./note-runtime.js";

/**
 * The shape of what this user has written down.
 *
 * Collections, the tag vocabulary and the symbols with notes attached, all with
 * counts and no note bodies. It is the call to make before writing a note — so
 * a new one lands under `rate-cut` rather than inventing `rates-cut` — and
 * before searching, because the tags say what is worth searching for.
 */
export function registerNoteCollectionsTool(
  server: McpServer,
  repo: NotesRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "noteCollections",
    {
      title: "Note Collections & Tags",
      description:
        "The user's note collections, tag vocabulary and tagged symbols, with counts. " +
        "Start here: reuse an existing tag or collection instead of coining a near-duplicate, " +
        "and use the tag list to decide what to search for. Returns no note text.",
      annotations: readOnlyToolAnnotations,
    },
    async () =>
      runTool(async () => {
        const userId = requireNotesUser(auth);
        const [collections, facets, all] = await Promise.all([
          repo.listCollections(userId),
          repo.facets(userId, { limit: 60 }),
          repo.searchNotes(userId, { status: "any", limit: 1 }),
        ]);

        return {
          notes: all.total,
          collections: collections.map((collection) => ({
            id: collection.id,
            name: collection.name,
            description: collection.description,
            notes: collection.noteCount,
          })),
          tags: facets.tags,
          symbols: facets.symbols,
          note:
            all.total === 0
              ? "No notes yet. noteCreate files the first one; a collection is optional."
              : "Tools accept either the name or the id wherever a collection is named.",
        };
      }),
  );
}
