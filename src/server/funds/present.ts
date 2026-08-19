/**
 * One shape for a fund, wherever it is reported.
 *
 * Before there were two providers each tool built its own object literal, and
 * they had already drifted — some reported `currency`, some `listedSymbol`,
 * none reported where the fund came from. With two markets in one result set
 * that stops being cosmetic: a model comparing a 62%-disclosed China quarterly
 * report against a 100%-disclosed US ETF has to be told they are not the same
 * kind of number, and the only reliable place to say so is here.
 */

import { completenessNote, type HoldingsCompleteness } from "../../shared/funds.js";
import type { Fund } from "../db/schema.js";

/** Enough to tell two matches apart in a ranked list. */
export interface FundBrief {
  code: string;
  name: string;
  provider: string;
  /** Where the fund trades — the market a holder can actually buy it in. */
  domicile: string;
  investsOffshore: boolean;
  isIndexFund: boolean;
  trackingIndex: string | null;
}

/** Everything a caller needs to act on a single named fund. */
export interface FundSummary extends FundBrief {
  fundType: string | null;
  currency: string;
  company: string | null;
  feeRate: number | null;
  /** Net assets, in millions of `currency`. */
  fundSizeMillions: number | null;
  listedSymbol: string | null;
  holdingsCompleteness: HoldingsCompleteness;
  providerMeta: Record<string, unknown>;
}

export function describeFundBrief(fund: Fund): FundBrief {
  return {
    code: fund.code,
    name: fund.name,
    provider: fund.provider,
    domicile: fund.market,
    investsOffshore: fund.investsOffshore,
    isIndexFund: fund.isIndexFund,
    trackingIndex: fund.trackingIndex,
  };
}

export function describeFund(fund: Fund): FundSummary {
  return {
    ...describeFundBrief(fund),
    fundType: fund.fundType,
    currency: fund.currency,
    company: fund.company,
    feeRate: fund.feeRate,
    fundSizeMillions: fund.fundSize,
    listedSymbol: fund.listedSymbol,
    holdingsCompleteness: fund.holdingsCompleteness,
    providerMeta: fund.providerMeta,
  };
}

/**
 * The disclosure caveat covering a whole result set.
 *
 * A single-convention result gets the plain sentence. A mixed one gets an
 * explicit warning, because the failure it prevents is silent and severe:
 * ranking funds by a disclosed sector weight puts every full-book ETF above
 * every top-holdings fund on nothing but reporting convention.
 */
export function disclosureNote(
  rows: ReadonlyArray<{ holdingsCompleteness: HoldingsCompleteness }>,
): string {
  const kinds = new Set(rows.map((row) => row.holdingsCompleteness));
  if (kinds.size === 0) return "";
  if (kinds.size === 1) {
    const [only] = [...kinds];
    return completenessNote(only ?? "top_holdings");
  }
  return (
    "This result mixes two disclosure conventions. Funds marked holdingsCompleteness=full publish " +
    "their entire portfolio, so their weights account for ~100% of net assets; funds marked " +
    "top_holdings disclose only their largest positions, so their weights sum to well under 100% and " +
    "a small position may be missing rather than absent. Compare weights within one convention — " +
    "ranking across them measures reporting rules, not portfolios."
  );
}
