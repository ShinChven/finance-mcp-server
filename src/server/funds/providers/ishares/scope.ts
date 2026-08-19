/**
 * The `WHERE` clause each iShares scope maps to.
 *
 * Scope names are declared in `shared/funds.ts`; this is the server-side half.
 * The `provider = 'ishares'` filter is added by the caller, so nothing here
 * repeats it.
 */

import { eq, ilike, type SQL } from "drizzle-orm";
import { funds } from "../../../db/schema.js";

export function isharesScopeFilter(scope: string): SQL | undefined {
  switch (scope) {
    case "international":
      return eq(funds.investsOffshore, true);
    case "equity":
      // `fund_type` holds the screener's aladdinAssetClass verbatim.
      return ilike(funds.fundType, "%equity%");
    case "fixed_income":
      return ilike(funds.fundType, "%fixed income%");
    default:
      return undefined;
  }
}
