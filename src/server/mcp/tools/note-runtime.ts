/**
 * Shared plumbing for the note tools.
 *
 * Like the watchlist family, these read and write rows that belong to one user,
 * so each handler starts from the authenticated identity — never from a user id
 * in the arguments, which the model could otherwise be talked into supplying.
 *
 * The shapes returned here are the other half of the design. A note's body is
 * the expensive part and is never included in a listing: `notesSearch` returns
 * the summary plus a snippet, and `noteRead` is the deliberate second call that
 * fetches the text. That split is what lets an agent scan fifty notes for the
 * relevant two without spending a context window on it.
 */

import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import {
  buildSnippet,
  MAX_SYMBOLS_PER_NOTE,
  MAX_TAGS_PER_NOTE,
  NOTE_STATUSES,
  symbolsSchema,
  tagSchema,
} from "../../../shared/notes.js";
import type { NoteRecord } from "../../notes/repo.js";

export function requireNotesUser(auth: McpAuth | null): string {
  if (auth === null) {
    throw new Error("Note tools are only available on an authenticated MCP request.");
  }
  return auth.user.id;
}

export const noteIdSchema = z.string().trim().min(1).max(64).describe("Note id, from notesSearch.");

export const collectionReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .describe("Collection name or id. Omit to leave the note unfiled.");

export const tagsArgSchema = z
  .array(tagSchema)
  .max(MAX_TAGS_PER_NOTE)
  .describe(
    'Topic labels, normalized to lowercase-hyphenated ("Rate Cut" becomes "rate-cut"). ' +
      "Reuse tags the user already has — noteCollections lists them — so the vocabulary stays small.",
  );

export const symbolsArgSchema = symbolsSchema.describe(
  'Instruments this note is about: Yahoo symbols ("NVDA", "0700.HK") or 6-digit China fund codes ' +
    '("000834"). A bare 6-digit code is read as a fund. This is what makes "what do I know about X" ' +
    "answerable later.",
);

export const statusArgSchema = z
  .enum(NOTE_STATUSES)
  .describe("`active` (default) or `archived`. Archived notes stay searchable but leave the listing.");

export const MAX_READ_IDS = 5;
export const MAX_SYMBOLS_ARG = MAX_SYMBOLS_PER_NOTE;

/** What a listing returns: everything except the body. */
export function noteHeader(note: NoteRecord) {
  return {
    id: note.id,
    title: note.title,
    summary: note.summary,
    collection: note.collectionName,
    tags: note.tags,
    symbols: note.symbols.map((symbol) => symbol.ref),
    status: note.status,
    pinned: note.pinned,
    /** So a caller can tell a one-line jotting from a captured transcript. */
    bodyChars: note.body.length,
    updatedAt: note.updatedAt.toISOString(),
  };
}

/** A search hit: the header plus why it matched. */
export function noteHit(note: NoteRecord, query: string | undefined) {
  const header = noteHeader(note);
  if (query === undefined || query.trim() === "") return header;
  const snippet = buildSnippet(note.body, query);
  return {
    ...header,
    snippet:
      snippet.text === ""
        ? undefined
        : `${snippet.truncatedStart ? "…" : ""}${snippet.text}${snippet.truncatedEnd ? "…" : ""}`,
  };
}

/** The full note, as `noteRead` returns it. */
export function noteDetail(note: NoteRecord) {
  return {
    ...noteHeader(note),
    body: note.body,
    source: note.source,
    sourceRef: note.sourceRef,
    createdAt: note.createdAt.toISOString(),
  };
}
