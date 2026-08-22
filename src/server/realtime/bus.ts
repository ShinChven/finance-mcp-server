/**
 * The in-process fan-out for realtime events.
 *
 * Publishers do not know about sockets and sockets do not know about
 * publishers; both meet at a channel name. That indirection is the whole point
 * of the module: today a channel is a `Set` of listeners in this process, which
 * is correct because the container runs one server process and the agent's MCP
 * calls land in it. If this ever runs as more than one instance, `deliver`
 * becomes a Postgres `NOTIFY` and nothing above this file changes.
 *
 * Two design notes:
 *
 * - **Coalescing.** A single agent turn can produce a burst: `watchlistAdd`
 *   with five items, an agent rewriting three notes in a row. Events are
 *   buffered per (channel, topic, action) for `COALESCE_MS` and flushed as one
 *   message, so a burst costs the dashboard one refetch rather than five.
 * - **Dev-mode identity.** Vite re-executes SSR modules on change, which would
 *   otherwise leave already-connected sockets subscribed to a bus instance no
 *   publisher can reach any more. Pinning the state to a global symbol keeps
 *   one registry across reloads.
 */

import {
  MAX_IDS_PER_EVENT,
  type JobProgress,
  type RealtimeAction,
  type RealtimeTopic,
  type ServerMessage,
} from "../../shared/realtime.js";

export type Listener = (message: ServerMessage) => void;

/** Everything one user may see. */
export function userChannel(userId: string): string {
  return `user:${userId}`;
}

/** Fund-cache and sync state: server-wide data, shown only on admin pages. */
export const ADMIN_CHANNEL = "role:admin";

export const COALESCE_MS = 50;

interface PendingChange {
  channel: string;
  topic: RealtimeTopic;
  action: RealtimeAction;
  ids: Set<string>;
  /** Too many ids to be worth naming; the client widens instead. */
  overflowed: boolean;
}

interface BusState {
  listeners: Map<string, Set<Listener>>;
  pending: Map<string, PendingChange>;
  timer: ReturnType<typeof setTimeout> | null;
}

const STATE_KEY = Symbol.for("finance-mcp.realtime.bus");

function state(): BusState {
  const holder = globalThis as typeof globalThis & { [STATE_KEY]?: BusState };
  holder[STATE_KEY] ??= { listeners: new Map(), pending: new Map(), timer: null };
  return holder[STATE_KEY];
}

export function subscribe(channels: readonly string[], listener: Listener): () => void {
  const { listeners } = state();
  for (const channel of channels) {
    let set = listeners.get(channel);
    if (!set) {
      set = new Set();
      listeners.set(channel, set);
    }
    set.add(listener);
  }
  return () => {
    const { listeners: current } = state();
    for (const channel of channels) {
      const set = current.get(channel);
      if (!set) continue;
      set.delete(listener);
      if (set.size === 0) current.delete(channel);
    }
  };
}

function deliver(channel: string, message: ServerMessage): void {
  const set = state().listeners.get(channel);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(message);
    } catch (error) {
      // One broken socket must never stop delivery to the others, and must
      // never surface as a failure in the write that triggered the event.
      console.error("realtime listener failed:", error);
    }
  }
}

function flush(): void {
  const current = state();
  current.timer = null;
  const batch = [...current.pending.values()];
  current.pending.clear();
  for (const change of batch) {
    deliver(change.channel, {
      type: "change",
      topic: change.topic,
      action: change.action,
      ids: change.overflowed ? [] : [...change.ids],
    });
  }
}

function schedule(): void {
  const current = state();
  if (current.timer !== null) return;
  current.timer = setTimeout(flush, COALESCE_MS);
  // A pending flush is never a reason to keep the process alive.
  current.timer.unref?.();
}

function enqueue(
  channel: string,
  topic: RealtimeTopic,
  action: RealtimeAction,
  ids: readonly string[],
): void {
  const current = state();
  const key = `${channel} ${topic} ${action}`;
  let entry = current.pending.get(key);
  if (!entry) {
    entry = { channel, topic, action, ids: new Set(), overflowed: false };
    current.pending.set(key, entry);
  }
  if (!entry.overflowed) {
    for (const id of ids) entry.ids.add(id);
    if (entry.ids.size > MAX_IDS_PER_EVENT) {
      entry.overflowed = true;
      entry.ids.clear();
    }
  }
  schedule();
}

/** Something in one user's own data changed. */
export function publishChange(
  userId: string,
  topic: RealtimeTopic,
  action: RealtimeAction,
  ids: readonly string[] = [],
): void {
  enqueue(userChannel(userId), topic, action, ids);
}

/** Something in the server-wide fund cache changed. */
export function publishAdminChange(
  topic: RealtimeTopic,
  action: RealtimeAction,
  ids: readonly string[] = [],
): void {
  enqueue(ADMIN_CHANNEL, topic, action, ids);
}

/**
 * Sync progress, sent uncoalesced: the runner already throttles these writes to
 * one every two seconds, and the counters are the message.
 */
export function publishJob(job: JobProgress, activeJobId: string | null): void {
  deliver(ADMIN_CHANNEL, { type: "job", job, activeJobId });
}

/** Sends straight through to one channel, bypassing the coalescing buffer. */
export function publishNow(channel: string, message: ServerMessage): void {
  deliver(channel, message);
}

/** Test seam: drops every listener and pending event. */
export function resetBus(): void {
  const current = state();
  if (current.timer !== null) clearTimeout(current.timer);
  current.timer = null;
  current.listeners.clear();
  current.pending.clear();
}
