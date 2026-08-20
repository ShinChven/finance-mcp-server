import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuth } from "../../lib/http.js";
import type { NotesRepo } from "../../notes/repo.js";
import { destructiveToolAnnotations, runTool } from "./runtime.js";
import { noteIdSchema, requireNotesUser } from "./note-runtime.js";

/**
 * Deleting one note.
 *
 * Deliberately the smallest destructive verb available: an agent can remove a
 * note it could equally have created, but it cannot delete a collection — that
 * would unfile everything inside it, and it lives on the dashboard behind a
 * confirmation, the same rule the watchlist tools follow.
 *
 * Archiving is the better default and the description says so. A note the model
 * judges stale is exactly the kind of thing whose value only becomes clear
 * later.
 */
export function registerNoteDeleteTool(
  server: McpServer,
  repo: NotesRepo,
  auth: McpAuth | null,
): void {
  server.registerTool(
    "noteDelete",
    {
      title: "Delete Note",
      description:
        "Permanently delete one note. Prefer noteUpdate with `status: \"archived\"` unless the user " +
        "asked for it gone — archiving keeps the note searchable and is reversible; this is not. " +
        "Collections cannot be deleted from here.",
      inputSchema: { id: noteIdSchema },
      annotations: destructiveToolAnnotations,
    },
    async ({ id }) =>
      runTool(async () => {
        const userId = requireNotesUser(auth);
        const existing = await repo.getNote(userId, id);
        if (existing === null) throw new Error(`No note with id ${id}.`);
        await repo.deleteNote(userId, id);
        return { deleted: { id, title: existing.title } };
      }),
  );
}
