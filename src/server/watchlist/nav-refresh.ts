/**
 * Keeping the fund rows on a watchlist from going quietly stale.
 *
 * A watchlist prices its funds from the local NAV cache, and nothing on the
 * read path used to fill that cache: a fund only refreshed when someone opened
 * its fund page or ran a category sync. A list of funds nobody drills into
 * therefore kept showing the NAV it was ingested with — a three-week-old number
 * rendered exactly like a live one, which is worse than no number at all.
 *
 * The fix deliberately does not happen inside the response. Fetching NAV for
 * every stale fund before answering would turn one page load into a queue of
 * throttled upstream requests, which is the same mistake the symbol path avoids
 * by never fetching bars on a list read. Instead the read serves what is
 * cached, says so (`stale`), and kicks the refresh off behind it; when it
 * lands, the user's own realtime channel tells the page to refetch and the
 * numbers fill in. The next read is fresh either way.
 */

import { isFresh } from "../../shared/funds.js";
import type { FundCache } from "../funds/ondemand.js";
import type { FundSnapshot } from "./repo.js";

/**
 * Funds refreshed per read.
 *
 * Sized under the on-demand cache's own pending ceiling so that one page load
 * cannot fill the queue and turn every other caller's fetch into a `busy`
 * refusal. A list with more stale funds than this catches up over consecutive
 * reads rather than in one burst — the rows say they are stale meanwhile.
 */
export const MAX_NAV_REFRESH_PER_READ = 4;

/** Whether the cached NAV for a fund is past its provider's freshness window. */
export function isNavStale(snapshot: FundSnapshot, now = Date.now()): boolean {
  return !isFresh(snapshot.navSyncedAt, "nav", snapshot.provider, now);
}

export interface NavRefreshOptions {
  /**
   * Called once, after the batch, if any fund actually took new data. The route
   * uses it to nudge the page that is already open; a caller with nowhere to
   * send that omits it.
   */
  onRefreshed?: () => void;
}

/**
 * Refreshes stale funds in the background and resolves immediately.
 *
 * Returns the codes it started on, so the caller can log or test what it
 * picked without waiting for the fetches. Errors are swallowed on purpose:
 * this is a chore running behind a response that has already been sent, and an
 * unhandled rejection from a throttled upstream must not take the process with
 * it.
 */
export function refreshStaleFundNav(
  snapshots: Iterable<FundSnapshot>,
  cache: FundCache,
  options: NavRefreshOptions = {},
): string[] {
  const now = Date.now();
  const codes = [...snapshots]
    .filter((snapshot) => isNavStale(snapshot, now))
    .map((snapshot) => snapshot.code)
    .slice(0, MAX_NAV_REFRESH_PER_READ);
  if (codes.length === 0) return codes;

  void (async () => {
    let landed = false;
    for (const code of codes) {
      try {
        // NAV only, and no classification: a watchlist row shows a price and a
        // daily move, and re-walking a fund's holdings through Yahoo to render
        // one number would cost orders of magnitude more than the row is worth.
        const result = await cache.ensure(code, { steps: ["nav"], classify: false });
        if (result.status === "cached") landed = true;
      } catch {
        // Already recorded on the fund row as `last_sync_error`; the row keeps
        // showing its last known NAV, flagged stale.
      }
    }
    if (landed) options.onRefreshed?.();
  })();

  return codes;
}
