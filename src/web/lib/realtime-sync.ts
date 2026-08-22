/**
 * Turns a realtime event into query invalidation.
 *
 * This table is the entire client half of the design: the server says which
 * topic changed, and TanStack Query -- which already holds the cache, the
 * subscriptions and the dedup -- does the rest. Nothing here holds state of its
 * own, so there is no second copy of the data to drift.
 *
 * Topics deliberately map to more keys than their name suggests. A note edit
 * moves collection counts and tag facets, and every page's numbers show up on
 * the overview, so one event invalidates all of them. Over-invalidating costs a
 * refetch of data the user is looking at anyway; under-invalidating shows them
 * something stale, which is the failure this whole feature exists to prevent.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { RealtimeTopic, ServerMessage } from "../../shared/realtime.js";
import type { JobsResult } from "./types.js";

interface TopicKeys {
  /** Invalidated on any event in the topic. */
  lists: string[][];
  /** Prefix of the per-entity detail query, when the topic has one. */
  detail?: string;
}

const TOPIC_KEYS: Record<RealtimeTopic, TopicKeys> = {
  notes: {
    lists: [["notes"], ["note-collections"], ["note-facets"], ["overview"]],
    detail: "note",
  },
  watchlist: {
    // Item queries key on the list id, but they also key on the page's search
    // params, so the prefix is the only sane granularity.
    lists: [["watchlists"], ["watchlist-items"], ["overview"]],
  },
  skills: {
    lists: [["skills"], ["skill-revisions"], ["overview"]],
    detail: "skill",
  },
  funds: {
    lists: [["funds"], ["fund-stats"], ["fund-holdings"], ["sync-jobs"], ["overview"]],
  },
};

/**
 * Sync progress is the one event that carries its values instead of a hint:
 * the counters are what the console renders, and re-reading a twenty-row job
 * list every two seconds to watch one number tick is what the socket replaced.
 */
function applyJobProgress(
  queryClient: QueryClient,
  job: Extract<ServerMessage, { type: "job" }>,
): void {
  let patched = false;
  queryClient.setQueryData<JobsResult>(["sync-jobs"], (previous) => {
    if (!previous) return previous;
    const index = previous.items.findIndex((item) => item.id === job.job.id);
    const existing = previous.items[index];
    if (existing === undefined) return previous;
    patched = true;
    const items = [...previous.items];
    items[index] = { ...existing, ...job.job };
    return { ...previous, items, activeJobId: job.activeJobId };
  });
  // A run that started after the console last loaded is not in the list yet,
  // and a patch cannot invent it.
  if (!patched) void queryClient.invalidateQueries({ queryKey: ["sync-jobs"] });
}

export function applyRealtimeMessage(queryClient: QueryClient, message: ServerMessage): void {
  if (message.type === "ping") return;
  if (message.type === "job") {
    applyJobProgress(queryClient, message);
    return;
  }

  const keys = TOPIC_KEYS[message.topic];
  for (const queryKey of keys.lists) void queryClient.invalidateQueries({ queryKey });

  if (keys.detail === undefined) return;
  // No ids means the server could not name what changed -- a collection rename
  // that moved unknown notes, a skill deleted by slug -- so widen to the prefix.
  if (message.ids.length === 0) {
    void queryClient.invalidateQueries({ queryKey: [keys.detail] });
    return;
  }
  for (const id of message.ids) {
    void queryClient.invalidateQueries({ queryKey: [keys.detail, id] });
  }
}
