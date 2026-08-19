/**
 * The `WHERE` clause each Eastmoney scope maps to.
 *
 * Scope *names* are declared in `shared/funds.ts` so the SPA can render the
 * category picker without importing drizzle; this is the server-side half. The
 * `provider = 'eastmoney'` filter is added by the caller, so nothing here
 * repeats it.
 */

import { eq, ilike, or, type SQL } from "drizzle-orm";
import { funds } from "../../../db/schema.js";

export function eastmoneyScopeFilter(scope: string): SQL | undefined {
  switch (scope) {
    case "qdii":
      return eq(funds.investsOffshore, true);
    case "index":
      return eq(funds.isIndexFund, true);
    case "equity":
      // Eastmoney's 基金类型 strings: 股票型 / 股票指数 / 混合型 / 偏股混合 …
      return or(ilike(funds.fundType, "%股票%"), ilike(funds.fundType, "%混合%"));
    // `all` is every fund this provider has; `codes` is filtered by the
    // caller's explicit list. Neither narrows further here.
    default:
      return undefined;
  }
}
