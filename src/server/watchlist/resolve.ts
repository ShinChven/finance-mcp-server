/**
 * How a caller names a watchlist.
 *
 * Agents address lists the way a person would — "add NVDA to my AI list" — so
 * the tools accept a name as readily as an id, and fall back to the obvious
 * list when there is only one. The rules live here rather than in each tool so
 * the four of them cannot drift apart.
 */

import { MAX_WATCHLISTS_PER_USER } from "../../shared/watchlist.js";
import type { WatchlistRepo, WatchlistSummary } from "./repo.js";

/** Name used when a first list has to be created implicitly. */
export const DEFAULT_WATCHLIST_NAME = "Watchlist";

export class WatchlistNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchlistNotFoundError";
  }
}

function nameList(lists: WatchlistSummary[]): string {
  return lists.map((list) => `"${list.name}"`).join(", ");
}

/**
 * Resolves an id or a name to one of the user's lists.
 *
 * With no reference: the single list if there is exactly one, otherwise an
 * error naming the candidates — guessing between several would silently write
 * to the wrong one.
 */
export async function resolveWatchlist(
  repo: WatchlistRepo,
  userId: string,
  reference?: string,
): Promise<WatchlistSummary> {
  const lists = await repo.listWatchlists(userId);

  if (reference === undefined || reference.trim() === "") {
    if (lists.length === 1) return lists[0]!;
    if (lists.length === 0) {
      throw new WatchlistNotFoundError(
        "You have no watchlists yet. Call watchlistAdd to create one.",
      );
    }
    throw new WatchlistNotFoundError(
      `You have ${lists.length} watchlists (${nameList(lists)}). Say which one.`,
    );
  }

  const needle = reference.trim();
  const byId = lists.find((list) => list.id === needle);
  if (byId !== undefined) return byId;

  const byName = lists.find((list) => list.name.toLowerCase() === needle.toLowerCase());
  if (byName !== undefined) return byName;

  throw new WatchlistNotFoundError(
    lists.length === 0
      ? `No watchlist named "${needle}". You have none yet — pass create: true to make it.`
      : `No watchlist named "${needle}". You have: ${nameList(lists)}.`,
  );
}

/**
 * Resolution for the write path, which may create the list.
 *
 * A user with no lists at all gets one made without being asked: there is
 * nothing to disambiguate and no way to create clutter. Once lists exist, a
 * name that does not match is an error unless `create` is explicit — otherwise
 * one typo silently forks a parallel list, and the divergence only shows up
 * later when half the items are missing.
 */
export async function resolveOrCreateWatchlist(
  repo: WatchlistRepo,
  userId: string,
  options: { reference?: string; create?: boolean },
): Promise<{ list: WatchlistSummary; created: boolean }> {
  const lists = await repo.listWatchlists(userId);
  const reference = options.reference?.trim();

  if (lists.length === 0) {
    const list = await repo.createWatchlist(userId, {
      name: reference !== undefined && reference !== "" ? reference : DEFAULT_WATCHLIST_NAME,
    });
    return { list, created: true };
  }

  if (reference === undefined || reference === "") {
    if (lists.length === 1) return { list: lists[0]!, created: false };
    throw new WatchlistNotFoundError(
      `You have ${lists.length} watchlists (${nameList(lists)}). Say which one to add to.`,
    );
  }

  const existing =
    lists.find((list) => list.id === reference) ??
    lists.find((list) => list.name.toLowerCase() === reference.toLowerCase());
  if (existing !== undefined) return { list: existing, created: false };

  if (options.create !== true) {
    throw new WatchlistNotFoundError(
      `No watchlist named "${reference}". You have: ${nameList(lists)}. ` +
        `Pass create: true to make a new one.`,
    );
  }
  if (lists.length >= MAX_WATCHLISTS_PER_USER) {
    throw new WatchlistNotFoundError(
      `You already have ${MAX_WATCHLISTS_PER_USER} watchlists — delete one first.`,
    );
  }

  const list = await repo.createWatchlist(userId, { name: reference });
  return { list, created: true };
}
