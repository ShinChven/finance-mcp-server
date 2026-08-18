/**
 * Server-side half of the scope vocabulary: the `WHERE` clause a scope maps to.
 *
 * The pure definitions (names, labels, freshness windows) live in
 * `shared/funds.ts` so the SPA and env-free tests can use them too; this module
 * re-exports them so server code has a single import.
 */

import { eq, ilike, or, type SQL } from "drizzle-orm";
import { funds } from "../db/schema.js";
import type { IngestScope } from "../../shared/funds.js";

export {
  FRESHNESS_MS,
  INGEST_SCOPES,
  isFresh,
  isIngestScope,
  SCOPE_LABELS,
  SELECTABLE_SCOPES,
  type IngestScope,
  type SyncStep,
} from "../../shared/funds.js";

/**
 * The `WHERE` clause for a scope, or undefined for "no filter".
 *
 * `codes` returns undefined too — the caller supplies its own `inArray`, since
 * an explicit list is not a property of the fund.
 */
export function scopeFilter(scope: IngestScope): SQL | undefined {
  switch (scope) {
    case "qdii":
      return eq(funds.isQdii, true);
    case "index":
      return eq(funds.isIndexFund, true);
    case "equity":
      // Eastmoney's 基金类型 strings: 股票型 / 股票指数 / 混合型 / 偏股混合 …
      return or(ilike(funds.fundType, "%股票%"), ilike(funds.fundType, "%混合%"));
    case "all":
    case "codes":
      return undefined;
  }
}

/** Requests one fund costs in a full run: basics + holdings + NAV. */
export const REQUESTS_PER_FUND = 3;
