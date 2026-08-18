/**
 * Fund-sync vocabulary shared by the server and the SPA.
 *
 * Everything here is pure — no drizzle, no config — so it can be imported by
 * the web bundle and by tests without booting a database. The one server-only
 * piece, the `WHERE` clause for a scope, lives in `server/china/scope.ts`.
 */

import { z } from "zod";

export const INGEST_SCOPES = ["qdii", "index", "equity", "all", "codes"] as const;
export type IngestScope = (typeof INGEST_SCOPES)[number];

/** Scopes a user can pick from the dashboard; `codes` is CLI/API-only. */
export const SELECTABLE_SCOPES = [
  "qdii",
  "index",
  "equity",
  "all",
] as const satisfies readonly IngestScope[];

export const SCOPE_LABELS: Record<IngestScope, string> = {
  qdii: "QDII (overseas)",
  index: "Index-tracking",
  equity: "Equity & balanced",
  all: "Entire universe",
  codes: "Specific funds",
};

export function isIngestScope(value: string): value is IngestScope {
  return (INGEST_SCOPES as readonly string[]).includes(value);
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * How long each step's result stays usable.
 *
 * The three age at very different rates: a fund's profile barely moves, its
 * portfolio is disclosed quarterly (re-checked weekly so a new quarter lands
 * within days of publication), and its NAV changes every trading day.
 */
export const FRESHNESS_MS = {
  details: 30 * DAY,
  holdings: 7 * DAY,
  nav: 1 * DAY,
} as const;

export type SyncStep = keyof typeof FRESHNESS_MS;

export function isFresh(syncedAt: Date | null, step: SyncStep, now = Date.now()): boolean {
  if (syncedAt === null) return false;
  return now - syncedAt.getTime() < FRESHNESS_MS[step];
}

/**
 * Query-string booleans, parsed explicitly.
 *
 * NOT `z.coerce.boolean()`: that is `Boolean(value)`, and `Boolean("false")` is
 * `true`, so every `?force=false` would silently request a full refetch.
 */
export const booleanParam = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

export const previewQuerySchema = z.object({
  scope: z.enum(SELECTABLE_SCOPES),
  limit: z.coerce.number().int().min(1).max(30_000).optional(),
  force: booleanParam,
});

export const syncBodySchema = z.object({
  scope: z.enum(SELECTABLE_SCOPES),
  /**
   * `null` means "no cap — every candidate in scope"; omitted falls back to the
   * runner's default. The dashboard sends `null`, because its confirmation
   * dialog counts the whole scope: a silent cap would make the number the user
   * approved a lie.
   */
  limit: z.coerce.number().int().min(1).max(30_000).nullable().optional(),
  force: z.boolean().default(false),
});
