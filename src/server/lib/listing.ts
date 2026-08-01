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
