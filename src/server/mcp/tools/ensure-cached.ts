/**
 * Fetch-on-first-touch for the fund tools.
 *
 * Naming a fund is a clear enough request for its data; telling the caller to
 * "run the ingest job first" makes them go do by hand what the server can do
 * in a couple of seconds. These helpers try that fetch, and turn whatever
 * comes back into either silence (it worked) or a sentence the model can act
 * on (it did not).
 *
 * They are no-ops when the data is already there, so the cost falls only on
 * the first touch of a fund.
 */

import type { FundCache, EnsureResult } from "../../china/ondemand.js";
import type { FundRepo } from "../../china/repo.js";

/**
 * Fetches on demand unless this step has been synced before.
 *
 * The test is the fund's watermark, not whether the data looks useful. A fund
 * with one NAV point or an empty portfolio has been cached — that is simply
 * what the source published — and re-fetching it on every call would turn a
 * thin fund into a permanent outbound request on every tool invocation.
 */
async function ensure(
  cache: FundCache,
  repo: FundRepo,
  code: string,
  steps: ("details" | "holdings" | "nav")[],
  synced: (fund: NonNullable<Awaited<ReturnType<FundRepo["getFund"]>>>) => Date | null,
): Promise<EnsureResult | null> {
  const fund = await repo.getFund(code);
  if (fund !== null && synced(fund) !== null) return null;
  return cache.ensure(code, { steps });
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
  const result = await ensure(cache, repo, code, ["details", "holdings"], (fund) => fund.holdingsSyncedAt);
  raiseIfUnusable(result);
  return result;
}

export async function ensureNav(
  cache: FundCache,
  repo: FundRepo,
  code: string,
): Promise<EnsureResult | null> {
  const result = await ensure(cache, repo, code, ["details", "nav"], (fund) => fund.navSyncedAt);
  raiseIfUnusable(result);
  return result;
}

/**
 * The line a tool adds to its response after fetching, so the model can say why
 * the first call was slow and what the numbers are missing.
 */
export function cacheNote(result: EnsureResult | null): string | undefined {
  if (result === null || result.status === "fresh") return undefined;
  const base = `Cached on demand for this request (${result.fetched.join(", ")}).`;
  if (result.unclassified > 0) {
    return (
      `${base} ${result.unclassified} holdings were not classified before the time limit, ` +
      `so coverage understates this fund until the next sync.`
    );
  }
  return base;
}
