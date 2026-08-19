/**
 * What a fund source has to provide, and nothing more.
 *
 * The pipeline in `ingest.ts` walks funds, stores holdings, classifies symbols
 * and recomputes exposure without knowing which market it is working in. Every
 * difference between sources — quarterly HTML tables versus a daily CSV, a
 * 6-digit code versus a ticker, top-ten disclosure versus a complete book —
 * ends here, behind these five methods.
 *
 * The rule that keeps it that way: a provider returns *normalized* values. It
 * canonicalizes its own symbols (`toCanonicalSymbol`), converts its own weight
 * units to percent of net assets, and reports its own parse failures. Nothing
 * downstream re-interprets what a provider hands back.
 */

import type { SQL } from "drizzle-orm";
import type {
  HoldingsCompleteness,
  ProviderDescriptor,
  ProviderId,
} from "../../shared/funds.js";

/** One disclosed position, canonicalized and denominated in percent of NAV. */
export interface HoldingEntry {
  symbol: string;
  name: string | null;
  /** Percent of net asset value, 0-100. */
  weight: number;
  /** ISO date of the report this position was disclosed in. */
  reportDate: string;
  /**
   * The position's ISIN, when the source publishes one.
   *
   * Stored on the instrument rather than the position: it is the identifier
   * that survives a venue change, a ticker reassignment and a dual listing, so
   * it is the reliable key for reconciling this holding against another source.
   * Optional because most sources — Eastmoney among them — do not carry it.
   */
  isin?: string | null;
}

export interface NavPoint {
  navDate: string;
  nav: number | null;
  accNav: number | null;
  dailyReturn: number | null;
}

/** A fund as it appears in the provider's index — cheap fields only. */
export interface UniverseEntry {
  code: string;
  name: string;
  fundType: string | null;
  isIndexFund: boolean;
  investsOffshore: boolean;
  providerMeta?: Record<string, unknown>;
}

/**
 * The per-fund profile. Every field is nullable because a provider reports what
 * it knows: `null` means "not available from this source", and the ingest
 * leaves the stored value alone rather than overwriting it with nothing.
 */
export interface FundDetails {
  name: string | null;
  fundType: string | null;
  trackingIndex: string | null;
  company: string | null;
  manager: string | null;
  /** Management fee, percent per year. */
  feeRate: number | null;
  /** Net assets, in the provider's own currency unit. */
  fundSize: number | null;
  listedSymbol: string | null;
  isIndexFund: boolean | null;
  investsOffshore: boolean | null;
  providerMeta?: Record<string, unknown>;
}

export interface HoldingsResult {
  entries: HoldingEntry[];
  /**
   * Positions the source carried but the parser could not read. Non-zero means
   * a format drift, and the fund's stored portfolio is understated — the
   * failure mode that once made Tokyo-coded positions vanish silently.
   */
  dropped: number;
  /** Breakdown of `dropped`, for the run summary. */
  dropReason?: string;
  /**
   * Set only when this particular report is denominated differently from the
   * provider's usual disclosure — a China annual report is a complete book
   * where the quarterly one before it was a top-ten slice.
   */
  completeness?: HoldingsCompleteness;
}

export interface FundProvider {
  readonly id: ProviderId;
  readonly descriptor: ProviderDescriptor;

  /** Step 1 — the provider's whole fund index. One cheap call, ideally. */
  listUniverse(): Promise<UniverseEntry[]>;
  /** Step 2 — profile detail, most importantly the tracked index. */
  fetchDetails(code: string): Promise<FundDetails>;
  /** Step 3 — the latest disclosed portfolio. */
  fetchHoldings(code: string): Promise<HoldingsResult>;
  /** Step 4 — NAV or closing-price history, newest window first. */
  fetchNav(code: string): Promise<NavPoint[]>;

  /**
   * The extra `WHERE` clause one of this provider's scopes maps to, or
   * undefined for "everything this provider has". The `provider = id` filter is
   * applied by the caller, so a scope filter never repeats it.
   */
  scopeFilter(scope: string): SQL | undefined;

  /** Minimum gap this provider keeps between upstream requests. Used to
   *  estimate how long a run will take before it is started. */
  readonly requestIntervalMs: number;
  /** Upstream requests one fund costs in a full refresh (details + holdings + nav). */
  readonly requestsPerFund: number;
}
