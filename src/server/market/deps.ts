/**
 * The one bar store, market provider and series budget in the process.
 *
 * Two routers now draw price history — a watchlist item's chart and the
 * discovery preview — and both must share these. A second `createBarStore`
 * would de-duplicate nothing against the first, and a second token bucket would
 * quietly double the per-user allowance the bucket exists to enforce, which is
 * the kind of bug that only shows up as an upstream ban.
 *
 * The database import stays deferred, the way the repos defer theirs, so
 * building routes in a test never requires a configured database.
 */

import { createBarStore } from "./bars.js";
import { createTokenBucket } from "./budget.js";
import { createYahooMarketProvider } from "./providers/yahoo.js";
import type { SeriesDeps } from "./series.js";
import { yahooFinanceClient } from "../mcp/client.js";
import { createLazyWatchlistRepo } from "../watchlist/repo.js";

export const marketProvider = createYahooMarketProvider(yahooFinanceClient);

/** Charged per user before any outbound work; a refusal must be cheap. */
export const seriesBudget = createTokenBucket();

const repo = createLazyWatchlistRepo();

let seriesDeps: Promise<SeriesDeps> | undefined;

export function loadSeriesDeps(): Promise<SeriesDeps> {
  seriesDeps ??= import("../db/index.js").then((module) => ({
    bars: createBarStore(module.db, marketProvider),
    provider: marketProvider,
    navHistory: async (code: string, since: string) => {
      const windows = await repo.getFundNavWindows([code], since);
      return windows.get(code) ?? [];
    },
  }));
  return seriesDeps;
}
