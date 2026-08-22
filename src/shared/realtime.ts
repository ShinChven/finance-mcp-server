/**
 * The realtime protocol, shared by the socket server and the SPA.
 *
 * One rule shapes everything here: **a message never carries business data.**
 * It says what changed, not what it changed to. The client then re-reads
 * through the ordinary HTTP API, where `requireAuth` and the user-scoped repos
 * are the only authorization gate there has ever been. That makes an
 * over-broadcast structurally incapable of leaking anything — the worst a
 * misrouted event can do is make someone refetch their own data.
 *
 * The one exception is `job`, and it earns it: sync progress is a pair of
 * counters on a row the dashboard is already showing, it changes every couple
 * of seconds, and re-reading a twenty-row job list to watch one number tick is
 * exactly the waste the socket exists to remove.
 */

import { z } from "zod";

export const REALTIME_PATH = "/api/events";

/**
 * Topics are dashboard-shaped, not table-shaped: one topic per group of pages
 * that refresh together. `notes` covers notes, collections and facets because
 * no page shows one without the others.
 */
export const REALTIME_TOPICS = ["notes", "watchlist", "skills", "funds"] as const;
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

export const REALTIME_ACTIONS = ["created", "updated", "deleted"] as const;
export type RealtimeAction = (typeof REALTIME_ACTIONS)[number];

/**
 * Past this many ids in one coalesced event, naming them stops being cheaper
 * than not naming them — the client falls back to invalidating the topic's
 * detail queries wholesale, which an empty `ids` already means.
 */
export const MAX_IDS_PER_EVENT = 100;

/**
 * `ids` is a hint for targeted invalidation, never a promise of completeness:
 * empty means "some entity in this topic changed, assume any of them".
 */
export const changeMessageSchema = z.object({
  type: z.literal("change"),
  topic: z.enum(REALTIME_TOPICS),
  action: z.enum(REALTIME_ACTIONS),
  ids: z.array(z.string()).max(MAX_IDS_PER_EVENT).default([]),
});

/** Mirrors the columns the sync console re-renders while a run is in flight. */
export const jobProgressSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  processedFunds: z.number(),
  totalFunds: z.number(),
  skippedFresh: z.number(),
  error: z.string().nullable(),
});
export type JobProgress = z.infer<typeof jobProgressSchema>;

export const jobMessageSchema = z.object({
  type: z.literal("job"),
  job: jobProgressSchema,
  /** Null once the run ends, so the console can drop its "running" state. */
  activeJobId: z.string().nullable(),
});

/**
 * Application-level keepalive. The protocol already has ping/pong frames, but
 * browsers do not surface them to JavaScript, so a tab has no way to tell a
 * healthy idle socket from one whose TCP connection died behind a NAT that
 * never sent a FIN. This message is what the client's watchdog resets.
 */
export const pingMessageSchema = z.object({ type: z.literal("ping") });

export const serverMessageSchema = z.discriminatedUnion("type", [
  changeMessageSchema,
  jobMessageSchema,
  pingMessageSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/**
 * Close codes in the 4000–4999 application range.
 *
 * `UNAUTHORIZED` is the one the client must not retry on: a socket whose
 * session expired will fail again immediately, and a reconnect loop against a
 * logged-out server is just a request flood.
 */
export const REALTIME_CLOSE = {
  UNAUTHORIZED: 4401,
  /** The connection cap for this user pushed the oldest socket out. */
  REPLACED: 4409,
} as const;
