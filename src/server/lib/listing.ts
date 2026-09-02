import { asc, desc, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { z } from "zod";

export const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().max(50).optional(),
  status: z.string().max(30).optional(),
  role: z.string().max(30).optional(),
  action: z.string().max(60).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (m) => `\\${m}`);
}

/** Past this a query stops being a search and starts being a way to build a
 *  very large statement; the tail is dropped rather than refused. */
export const MAX_SEARCH_TERMS = 8;

/**
 * A free-text query split into the words a search should match individually.
 *
 * Callers that push the whole string at `websearch_to_tsquery` get AND
 * semantics, and callers that push it at `ilike` get a literal phrase — so a
 * two-word query is strictly harder to satisfy than either word alone, and
 * "fund scr" fails to find `fund-screen` because of the hyphen. Both are the
 * wrong bias for a store the user is trying to find something in: a miss reads
 * as "nothing here" and ends the search.
 *
 * A leading `-` is stripped because `websearch_to_tsquery` reads it as
 * negation, and a term the caller meant to search for must never quietly
 * exclude rows instead.
 */
export function searchTerms(input: string): string[] {
  return input
    .split(/\s+/)
    .map((term) => term.replace(/^-+/, "").trim())
    .filter((term) => term !== "")
    .slice(0, MAX_SEARCH_TERMS);
}

/** Parses "column.desc" / "column.asc" against a whitelist; falls back when absent or unknown. */
export function parseSort(
  sort: string | undefined,
  columns: Record<string, AnyColumn | SQL>,
  fallback: SQL,
): SQL {
  if (!sort) return fallback;
  const [field, direction] = sort.split(".");
  const column = field ? columns[field] : undefined;
  if (!column) return fallback;
  return direction === "asc" ? asc(column as AnyColumn) : desc(column as AnyColumn);
}

export function listResponse<T>(items: T[], total: number, query: ListQuery) {
  return {
    items,
    total,
    page: query.page,
    per_page: query.per_page,
    total_pages: Math.max(1, Math.ceil(total / query.per_page)),
  };
}
