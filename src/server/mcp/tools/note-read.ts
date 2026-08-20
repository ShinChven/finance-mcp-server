import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import type { NotesRepo } from "../../notes/repo.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";
import { MAX_READ_IDS, noteDetail, noteIdSchema, requireNotesUser } from "./note-runtime.js";

/**
 * Full text for notes already identified.
 *
 * Capped at a handful of ids per call, because bodies hold captured
 * conversation: reading twenty is how a context window disappears, and the
 * summaries in `notesSearch` exist precisely so that it does not have to.
 */
export function registerNoteReadTool(
  server: McpServer,
  repo: NotesRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "noteRead",
    {
      title: "Read Notes",
      description:
        `Read the full body of up to ${MAX_READ_IDS} notes by id, with their tags, symbols and ` +
        "provenance. Ids come from notesSearch — read only the ones whose summary looked relevant.",
      inputSchema: {
        ids: z
          .array(noteIdSchema)
          .min(1)
          .max(MAX_READ_IDS)
          .describe("Note ids, in the order you want them back."),
      },
      annotations: readOnlyToolAnnotations,
    },
    async ({ ids }) =>
      runTool(async () => {
        const userId = requireNotesUser(auth);
        const notes = await repo.getNotes(userId, ids);
        const missing = ids.filter((id) => !notes.some((note) => note.id === id));

        return {
          count: notes.length,
          notes: notes.map(noteDetail),
          // Never "not yours" — an id from another account is simply not found.
          missing: missing.length > 0 ? missing : undefined,
        };
      }),
  );
}
