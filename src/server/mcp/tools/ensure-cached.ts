/**
 * Fetch-on-first-touch for the fund tools.
 *
 * Naming a fund is a clear enough request for its data; telling the caller to
 * "run the ingest job first" makes them go do by hand what the server can do
 * in a couple of seconds. These helpers try that fetch, and turn whatever
 * comes back into either silence (it worked) or a sentence the model can act
 * on (it did not).
 *
 * They are no-ops while the data is inside its freshness window, so the cost
 * falls on the first touch of a fund and then on whatever has since gone out
 * of date — never on every call.
 */

import type { FundCache, EnsureResult } from "../../funds/ondemand.js";
import type { FundRepo } from "../../funds/repo.js";

/**
 * Fetches on demand when this step is missing or past its freshness window.
 *
 * The freshness test lives in the cache, which reads the fund's own watermark
 * against its provider's window, so a fund fetched an hour ago costs one query
 * and no request. What used to be here instead was "has this ever been
 * synced" — which meant a fund cached once was never refreshed again by any
 * tool, and a NAV ingested three weeks ago was served as today's number for as
 * long as nobody ran a batch sync. A stale price is a wrong answer, not a
 * cheap one.
 *
 * Whether a failed fetch is fatal depends on what is already stored: with no
 * prior data the tool would return an empty shell and should say why, but a
 * refresh that fails on a fund we already hold leaves the caller with the last
 * good figures, which beats an error.
 */
async function ensure(
  cache: FundCache,
  repo: FundRepo,
  code: string,
  steps: ("details" | "holdings" | "nav")[],
  synced: (fund: NonNullable<Awaited<ReturnType<FundRepo["getFund"]>>>) => Date | null,
): Promise<EnsureResult | null> {
  const fund = await repo.getFund(code);
  const stored = fund !== null && synced(fund) !== null;
  const result = await cache.ensure(code, { steps });
  if (!stored) raiseIfUnusable(result);
  return result;
}

/** Raises the on-demand failure rather than letting a tool return an empty shell. */
function raiseIfUnusable(result: EnsureResult | null): void {
  if (result === null) return;
  if (result.status === "cached" || result.status === "fresh") return;
  throw new Error(result.message);
}

export async function ensureHoldings(
  cache: FundCache,
  repo: FundRepo,
  code: string,
): Promise<EnsureResult | null> {
  return ensure(cache, repo, code, ["details", "holdings"], (fund) => fund.holdingsSyncedAt);
}

export async function ensureNav(
  cache: FundCache,
  repo: FundRepo,
  code: string,
): Promise<EnsureResult | null> {
  return ensure(cache, repo, code, ["details", "nav"], (fund) => fund.navSyncedAt);
}

/**
 * The line a tool adds to its response after fetching, so the model can say why
 * the first call was slow and what the numbers are missing.
 */
export function cacheNote(result: EnsureResult | null): string | undefined {
  if (result === null || result.status === "fresh") return undefined;
  const base =
    result.fetched.length === 0
      ? "Nothing could be cached for this request, so these figures are the last ones stored."
      : `Cached on demand for this request (${result.fetched.join(", ")}).`;
  const parts = [base];
  // A step that failed is the likeliest explanation for a thin answer, so it
  // travels with the answer rather than only into the server's error column.
  if (result.error !== undefined) parts.push(`Some of it failed: ${result.error}.`);
  if (result.unclassified > 0) {
    parts.push(
      `${result.unclassified} holdings were not classified before the time limit, ` +
        `so coverage understates this fund until the next sync.`,
    );
  }
  return parts.join(" ");
}
