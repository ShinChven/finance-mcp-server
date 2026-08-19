/**
 * Classifying an iShares product from its screener row.
 *
 * The mirror of the Eastmoney classifier: same two judgements, different
 * vocabulary. Keeping them as separate pure functions rather than one
 * configurable matcher is deliberate — the signals genuinely have nothing in
 * common, and a shared regex would only be shared by accident.
 */

import type { IsharesProduct } from "./parse.js";

/**
 * Whether the fund's mandate points outside the US.
 *
 * The screener's country field is the reliable signal where it is populated;
 * the name is the fallback, and it is a good one, because a US-listed fund with
 * a foreign mandate essentially always says so in its name.
 */
export function looksLikeOffshoreMandate(product: IsharesProduct): boolean {
  const country = product.country?.toLowerCase() ?? "";
  if (country !== "" && !country.includes("united states")) return true;

  return /\b(international|global|world|acwi|eafe|emerging|ex[- ]u\.?s\.?|europe|japan|china|india|latin america|asia|pacific|frontier|developed markets|country)\b/i.test(
    product.name,
  );
}

/**
 * Whether the product tracks an index.
 *
 * iShares' lineup is predominantly index-tracking, so this reads as "not one of
 * the named active strategies" rather than as a positive match.
 */
export function looksLikeIndexFund(product: IsharesProduct): boolean {
  return !/\b(active|actively managed|flexible income|strategic income)\b/i.test(product.name);
}

/** Total net assets in USD, converted to the millions `funds.fund_size` holds. */
export function fundSizeToMillions(totalNetAssets: number | null): number | null {
  return totalNetAssets === null ? null : totalNetAssets / 1_000_000;
}

/**
 * The index a product tracks, recovered from its name.
 *
 * The screener carries no benchmark field, and the name is where iShares puts
 * it: "iShares Core S&P 500 ETF" tracks the S&P 500. Stripping the wrapper
 * words leaves the benchmark, which is what `findFundsByTrackingIndex` matches
 * against — the same route the China side gets from a declared 跟踪标的.
 */
export function trackingIndexFromName(name: string): string | null {
  const stripped = name
    .replace(/^iShares\s+/i, "")
    .replace(/\b(Core|ESG Aware|ESG|Trust|Fund)\b/gi, " ")
    .replace(/\bETF\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped === "" ? null : stripped;
}
