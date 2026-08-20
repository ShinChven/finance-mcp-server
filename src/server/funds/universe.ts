/**
 * Keeping every provider's fund index loaded, without being asked.
 *
 * The index — the list of funds a source publishes, names and flags only — is
 * not the same thing as the cache. Caching a category downloads per-fund
 * detail: holdings, NAV, the tracked index, which is minutes to hours of
 * upstream work. Loading the index is one listing call, and everything the
 * dashboard can say before any of that work happens is a count over it: how
 * many QDII funds exist, what a run would cost, whether a code is even real.
 *
 * So it is refreshed on its own schedule, on boot and behind an admin route,
 * rather than only as step 1 of a sync someone remembered to start. An empty
 * index made the whole page read as zeros and — worse — made the confirmation
 * dialog report "nothing to fetch", because a scope with no rows in it and a
 * scope that is entirely fresh are the same query.
 */

import { eq, sql } from "drizzle-orm";
import { FUND_INDEX_FRESHNESS_MS, PROVIDER_IDS, type ProviderId } from "../../shared/funds.js";
import type { db as Database } from "../db/index.js";
import { fundIndexState } from "../db/schema.js";
import { ingestFundUniverse } from "./ingest.js";
import { getProvider } from "./providers/index.js";

type Db = typeof Database;

export interface IndexRefresh {
  provider: ProviderId;
  /** Funds in the index afterwards — the number the dashboard counts against. */
  funds: number;
  /** False when the stored index was still inside its freshness window. */
  refreshed: boolean;
  /** Set when the listing failed; the previous index is left in place. */
  error?: string;
}

/**
 * Refresh one provider's index if it has aged out (or `force`).
 *
 * Never throws: a source being down is not a reason to fail whatever asked —
 * boot, most of the time — and the stale index stays usable in the meantime.
 */
export async function refreshFundIndex(
  db: Db,
  provider: ProviderId,
  options: { force?: boolean; now?: number } = {},
): Promise<IndexRefresh> {
  const now = options.now ?? Date.now();
  const [state] = await db
    .select()
    .from(fundIndexState)
    .where(eq(fundIndexState.provider, provider))
    .limit(1);

  if (!options.force && state && now - state.syncedAt.getTime() < FUND_INDEX_FRESHNESS_MS) {
    return { provider, funds: state.fundCount, refreshed: false };
  }

  try {
    // The watermark is written by `ingestFundUniverse` itself, so this path and
    // a category sync's first step cannot disagree about when the list landed.
    const summary = await ingestFundUniverse(db, getProvider(provider));
    return { provider, funds: summary.fundsUpserted, refreshed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // `synced_at` deliberately does not advance: a failed listing must not buy
    // itself a full freshness window of silence. An absent row backdates to the
    // epoch so the next boot tries again immediately.
    await db
      .insert(fundIndexState)
      .values({
        provider,
        fundCount: state?.fundCount ?? 0,
        syncedAt: state?.syncedAt ?? new Date(0),
        lastError: message,
      })
      .onConflictDoUpdate({
        target: fundIndexState.provider,
        set: { lastError: sql`excluded.last_error` },
      });
    return { provider, funds: state?.fundCount ?? 0, refreshed: false, error: message };
  }
}

/**
 * Fill in the indexes that hold nothing, for a caller that just failed to find
 * a fund.
 *
 * A code that matches no fund row has two very different explanations: it is
 * not a real fund, or nobody has ever successfully loaded the index it would be
 * in. Only the second is worth acting on, and it is distinguishable without an
 * upstream request — an index that has never landed has no watermark row, or a
 * row saying it holds nothing. Providers whose index did load are left alone,
 * so a typo costs one cheap local query.
 *
 * Freshness still applies, so this cannot become a per-request listing storm:
 * a provider whose last attempt failed is retried (its watermark deliberately
 * did not advance), and one that simply has not been asked yet is filled.
 */
export async function seedEmptyFundIndexes(
  db: Db,
  options: { now?: number } = {},
): Promise<IndexRefresh[]> {
  const states = await db.select().from(fundIndexState);
  const loaded = new Set(
    states.filter((state) => state.fundCount > 0).map((state) => state.provider),
  );
  const missing = PROVIDER_IDS.filter((provider) => !loaded.has(provider));

  const results: IndexRefresh[] = [];
  for (const provider of missing) {
    results.push(await refreshFundIndex(db, provider, options));
  }
  return results;
}

/**
 * Refresh every provider's index, one at a time.
 *
 * Sequential on purpose: each provider throttles its own upstream, but there is
 * nothing to be gained from overlapping two multi-thousand-row upserts on a
 * single pool during boot.
 */
export async function refreshAllFundIndexes(
  db: Db,
  options: { force?: boolean; now?: number } = {},
): Promise<IndexRefresh[]> {
  const results: IndexRefresh[] = [];
  for (const provider of PROVIDER_IDS) {
    results.push(await refreshFundIndex(db, provider, options));
  }
  return results;
}

/** One line for the boot log, so a silent failure is not silent. */
export function describeIndexRefresh(results: IndexRefresh[]): string {
  return results
    .map((result) => {
      if (result.error) return `${result.provider}: index refresh failed (${result.error})`;
      const state = result.refreshed ? "refreshed" : "still fresh";
      return `${result.provider}: ${result.funds.toLocaleString()} funds (${state})`;
    })
    .join("; ");
}
