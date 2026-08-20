/**
 * Notes vocabulary shared by the server, the MCP tools and the SPA.
 *
 * Pure by construction — no drizzle, no config — so the web bundle, the tools
 * and the tests all import the same rules. Same arrangement as
 * `shared/watchlist.ts`, and symbols deliberately reuse that module's kinds:
 * a note about 天弘纳斯达克 links to `000834` exactly the way a watchlist item
 * refers to it, so the two features never spell the same instrument
 * differently.
 */

import { z } from "zod";
import { detectItemKind, normalizeRef, WATCHLIST_ITEM_KINDS } from "./watchlist.js";

export type NoteSymbolKind = (typeof WATCHLIST_ITEM_KINDS)[number];

/**
 * Archived notes stay searchable but drop out of the default listing.
 *
 * The alternative — deleting what an agent decided was stale — throws away the
 * one thing a note is for. Archiving is reversible; only an explicit delete is
 * not.
 */
export const NOTE_STATUSES = ["active", "archived"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

/** Who wrote the row. Recorded because "did I say this or did the model?" is
 *  the first question anyone asks of a note they do not recognise. */
export const NOTE_SOURCES = ["agent", "web"] as const;
export type NoteSource = (typeof NOTE_SOURCES)[number];

export const STATUS_LABELS: Record<NoteStatus, string> = {
  active: "Active",
  archived: "Archived",
};

/** Caps exist so one account — or one runaway agent loop — cannot grow the
 *  table without bound. */
export const MAX_COLLECTIONS_PER_USER = 100;
export const MAX_NOTES_PER_USER = 5_000;
export const MAX_TAGS_PER_NOTE = 20;
export const MAX_SYMBOLS_PER_NOTE = 30;
export const MAX_TITLE_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 600;
/** A note holds captured conversation, not a document store: generous enough
 *  for a long exchange, small enough that a search never reads megabytes. */
export const MAX_BODY_LENGTH = 60_000;
export const MAX_SEARCH_RESULTS = 50;
export const DEFAULT_SEARCH_RESULTS = 20;
/** Characters of body returned around a hit in a search result. */
export const SNIPPET_RADIUS = 90;

/**
 * One stored spelling per tag.
 *
 * Lowercased and hyphenated so "Rate Cut", "rate cut" and "#rate-cut" are the
 * same facet — a tag vocabulary that splits on capitalisation is worse than no
 * vocabulary at all. Letters are matched by Unicode property, not `a-z`, so
 * `估值` survives normalisation intact.
 */
export function normalizeTag(input: string): string {
  return input
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_./+&]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Splits a free-text tag field ("macro, rate-cut 估值") into normalized tags. */
export function parseTagInput(input: string): string[] {
  return dedupe(
    input
      .split(/[,，\n]+|\s{1,}/)
      .map(normalizeTag)
      .filter((tag) => tag.length > 0),
  ).slice(0, MAX_TAGS_PER_NOTE);
}

export interface NoteSymbolRef {
  kind: NoteSymbolKind;
  ref: string;
}

/**
 * Canonicalises a symbol the way the watchlist does: a bare 6-digit code is a
 * China fund, anything else is a Yahoo symbol, uppercased.
 */
export function normalizeSymbol(input: string, kind?: NoteSymbolKind): NoteSymbolRef {
  const resolved = kind ?? detectItemKind(input);
  return { kind: resolved, ref: normalizeRef(input, resolved) };
}

/** Splits a free-text symbol field ("NVDA, 0700.HK 000834") into refs. */
export function parseSymbolInput(input: string): NoteSymbolRef[] {
  const refs = input
    .split(/[,，\n]+|\s{1,}/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => normalizeSymbol(token));
  const seen = new Set<string>();
  const out: NoteSymbolRef[] = [];
  for (const symbol of refs) {
    const key = `${symbol.kind}:${symbol.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(symbol);
  }
  return out.slice(0, MAX_SYMBOLS_PER_NOTE);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Search terms as the snippet builder needs them.
 *
 * Quoted phrases stay whole; everything else splits on whitespace. CJK runs are
 * kept as-is rather than segmented — there is no word boundary to split on, and
 * substring matching is what actually finds them.
 */
export function searchTerms(query: string): string[] {
  const terms: string[] = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  for (const match of query.matchAll(pattern)) {
    const term = (match[1] ?? match[2] ?? "").trim();
    if (term.length > 0) terms.push(term);
  }
  return dedupe(terms);
}

export interface Snippet {
  text: string;
  /** True when the snippet was cut from the middle of the body. */
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

/**
 * A window of body text around the first matching term.
 *
 * Done here rather than with `ts_headline` for two reasons: the headline
 * function segments by the text-search parser, which mangles Chinese, and the
 * result would then have to be re-escaped for the SPA. A plain character window
 * is language-agnostic and identical in both callers.
 */
export function buildSnippet(body: string, query: string, radius = SNIPPET_RADIUS): Snippet {
  const flat = body.replace(/\s+/g, " ").trim();
  const terms = searchTerms(query);
  const haystack = flat.toLowerCase();

  let hit = -1;
  let hitLength = 0;
  for (const term of terms) {
    const index = haystack.indexOf(term.toLowerCase());
    if (index !== -1 && (hit === -1 || index < hit)) {
      hit = index;
      hitLength = term.length;
    }
  }

  if (hit === -1) {
    // No term in the body — the match came from the title, the summary, a tag
    // or a symbol. The opening of the note is the useful thing to show.
    const head = flat.slice(0, radius * 2);
    return { text: head, truncatedStart: false, truncatedEnd: head.length < flat.length };
  }

  const start = Math.max(0, hit - radius);
  const end = Math.min(flat.length, hit + hitLength + radius);
  return {
    text: flat.slice(start, end),
    truncatedStart: start > 0,
    truncatedEnd: end < flat.length,
  };
}

/* ------------------------------------------------------------------ *
 * Schemas
 * ------------------------------------------------------------------ */

export const collectionNameSchema = z.string().trim().min(1).max(80);
export const collectionDescriptionSchema = z.string().trim().max(500);

export const noteTitleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH);
export const noteSummarySchema = z.string().trim().max(MAX_SUMMARY_LENGTH);
export const noteBodySchema = z.string().max(MAX_BODY_LENGTH);
export const tagSchema = z.string().trim().min(1).max(50);
export const symbolRefSchema = z.string().trim().min(1).max(32);
export const sourceRefSchema = z.string().trim().max(200);

export const tagsSchema = z.array(tagSchema).max(MAX_TAGS_PER_NOTE);
export const symbolsSchema = z
  .array(
    z.union([
      symbolRefSchema,
      z.object({ ref: symbolRefSchema, kind: z.enum(WATCHLIST_ITEM_KINDS).optional() }),
    ]),
  )
  .max(MAX_SYMBOLS_PER_NOTE);

/** Accepts either `["NVDA"]` or `[{ ref: "000834", kind: "fund" }]`. */
export function normalizeSymbolList(
  input: z.infer<typeof symbolsSchema> | undefined,
): NoteSymbolRef[] | undefined {
  if (input === undefined) return undefined;
  const seen = new Set<string>();
  const out: NoteSymbolRef[] = [];
  for (const entry of input) {
    const symbol =
      typeof entry === "string" ? normalizeSymbol(entry) : normalizeSymbol(entry.ref, entry.kind);
    const key = `${symbol.kind}:${symbol.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(symbol);
  }
  return out;
}

export function normalizeTagList(input: string[] | undefined): string[] | undefined {
  if (input === undefined) return undefined;
  return dedupe(input.map(normalizeTag).filter((tag) => tag.length > 0)).slice(0, MAX_TAGS_PER_NOTE);
}

export const createCollectionSchema = z.object({
  name: collectionNameSchema,
  description: collectionDescriptionSchema.optional(),
});

export const updateCollectionSchema = z.object({
  name: collectionNameSchema.optional(),
  description: collectionDescriptionSchema.nullable().optional(),
});

export const createNoteSchema = z.object({
  title: noteTitleSchema,
  summary: noteSummarySchema.nullable().optional(),
  body: noteBodySchema.optional(),
  collectionId: z.string().max(64).nullable().optional(),
  tags: tagsSchema.optional(),
  symbols: symbolsSchema.optional(),
  pinned: z.boolean().optional(),
  status: z.enum(NOTE_STATUSES).optional(),
  sourceRef: sourceRefSchema.nullable().optional(),
});

export const updateNoteSchema = z.object({
  title: noteTitleSchema.optional(),
  summary: noteSummarySchema.nullable().optional(),
  body: noteBodySchema.optional(),
  /** Appended with a blank line between, for a note that grows over a session. */
  appendBody: noteBodySchema.optional(),
  collectionId: z.string().max(64).nullable().optional(),
  tags: tagsSchema.optional(),
  addTags: tagsSchema.optional(),
  symbols: symbolsSchema.optional(),
  addSymbols: symbolsSchema.optional(),
  pinned: z.boolean().optional(),
  status: z.enum(NOTE_STATUSES).optional(),
});

export const NOTE_SORTS = ["relevance", "updated", "created", "title"] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];

/** Joins a body and an appended chunk the way a running note reads. */
export function appendToBody(body: string, addition: string): string {
  const trimmed = body.trimEnd();
  if (trimmed === "") return addition.trim();
  return `${trimmed}\n\n${addition.trim()}`;
}
