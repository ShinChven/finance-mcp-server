/**
 * Fund-sync vocabulary shared by the server and the SPA.
 *
 * Everything here is pure — no drizzle, no config — so it can be imported by
 * the web bundle and by tests without booting a database. The server-only
 * pieces (the upstream clients, and the `WHERE` clause each scope maps to) live
 * behind the `FundProvider` implementations in `server/funds/providers/`.
 *
 * A **provider** is one upstream source of funds: Eastmoney for the China
 * public-fund universe, iShares for its listed ETFs. Everything that differs
 * between markets is a property of the provider rather than a branch in the
 * pipeline — which scopes exist, how fast each step goes stale, and whether
 * disclosed holdings are the whole portfolio or only the largest positions.
 */

import { z } from "zod";

export const PROVIDER_IDS = ["ishares", "eastmoney"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * The one spelling of a fund code the cache is keyed by.
 *
 * `funds.code` holds a China 6-digit code or a listing ticker, and the ticker
 * is stored exactly as the provider publishes it — uppercase. Every lookup is
 * an equality match on that column, so `ivv` from a URL path or a hand-typed
 * tool argument found nothing at all and reported the fund as absent from the
 * index. Normalizing at the edges is what makes `ivv`, `IVV ` and `IVV` the
 * same fund; digits are unaffected, so no provider needs to know this exists.
 */
export function normalizeFundCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * How much of a fund's portfolio its disclosures actually cover.
 *
 * This is not a quality score — it is the unit the weights are denominated in,
 * and mixing the two silently corrupts every comparison. A China quarterly
 * report lists the top ten equity positions and stops, so its weights sum to
 * roughly 60%; an iShares daily holdings file is the entire book and sums to
 * 100%. Without this tag a screen for "funds over 30% semiconductors" quietly
 * favours whichever provider discloses more.
 */
export type HoldingsCompleteness = "full" | "top_holdings";

/** One slice of a provider's universe that a sync run can cover. */
export interface ProviderScope {
  id: string;
  label: string;
  /** Offered in the dashboard's category picker. */
  selectable: boolean;
}

/**
 * The universal scope: an explicit list of fund codes, supplied by the caller.
 * Every provider has it, and no provider defines it, so it lives here.
 */
export const CODES_SCOPE: ProviderScope = {
  id: "codes",
  label: "Specific funds",
  selectable: false,
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How long each step's result stays usable, per provider. */
export interface FreshnessWindows {
  details: number;
  holdings: number;
  nav: number;
}

export type SyncStep = keyof FreshnessWindows;

export const SYNC_STEPS: readonly SyncStep[] = ["details", "holdings", "nav"];

/**
 * How long an instrument's Yahoo profile stays usable.
 *
 * Deliberately not a day. Most of what is stored — ISIN, country, exchange,
 * sector — barely moves, and the one figure that does, market capitalization,
 * is a weekly snapshot by design: refreshing thousands of instruments daily
 * would cost more Yahoo requests than the whole fund ingest. Tool responses say
 * so rather than letting a week-old market cap read as a live one.
 */
export const INSTRUMENT_PROFILE_FRESHNESS_MS = 7 * DAY;

/**
 * How long a provider's fund index stays usable.
 *
 * The index is the list itself — every fund the source publishes, with no
 * holdings attached — and it is what every count in the dashboard is a count
 * *of*. One listing call fills it, which is why it is refreshed on its own
 * schedule rather than only as the first step of a category sync: without it
 * the page cannot say how big a category is, and a run cannot be priced.
 *
 * A day, because the universe changes at the rate funds are launched.
 */
export const FUND_INDEX_FRESHNESS_MS = 1 * DAY;

/**
 * What the SPA needs to know about a provider. The server-side half — the
 * fetching and the scope SQL — is the `FundProvider` interface.
 */
export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  /** Market the provider's funds are domiciled and traded in. */
  domicile: string;
  /** Currency fund sizes and NAVs are denominated in. */
  currency: string;
  completeness: HoldingsCompleteness;
  scopes: readonly ProviderScope[];
  /**
   * Scope a run walks when the caller names none. Not always `all`: Eastmoney's
   * universe is 27,000 funds, most of which nobody asks about, so an unqualified
   * run there should spend its budget on the offshore ones the cross-market
   * tools actually need.
   */
  defaultScope: string;
  freshness: FreshnessWindows;
}

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  ishares: {
    id: "ishares",
    label: "iShares ETFs (US)",
    domicile: "US",
    currency: "USD",
    // The published holdings file is the entire book, refreshed every trading
    // day — the reason a US ETF's exposure figures are directly comparable
    // between funds while China's quarterly ones are not.
    completeness: "full",
    scopes: [
      { id: "international", label: "International mandate", selectable: true },
      { id: "equity", label: "Equity", selectable: true },
      { id: "fixed_income", label: "Fixed income", selectable: true },
      { id: "all", label: "Entire lineup", selectable: true },
      CODES_SCOPE,
    ],
    // A few hundred products in total, so there is nothing to be gained by
    // narrowing an unqualified run.
    defaultScope: "all",
    freshness: {
      details: 30 * DAY,
      holdings: 1 * DAY,
      nav: 1 * DAY,
    },
  },
  eastmoney: {
    id: "eastmoney",
    label: "China public funds",
    domicile: "CN",
    currency: "CNY",
    // Quarterly reports carry the top ten equity positions only; the annual and
    // interim reports are complete, but the quarterly cadence is what the cache
    // is usually holding.
    completeness: "top_holdings",
    scopes: [
      { id: "qdii", label: "QDII (overseas mandate)", selectable: true },
      { id: "index", label: "Index-tracking", selectable: true },
      { id: "equity", label: "Equity & balanced", selectable: true },
      { id: "all", label: "Entire universe", selectable: true },
      CODES_SCOPE,
    ],
    defaultScope: "qdii",
    freshness: {
      details: 30 * DAY,
      // Disclosed quarterly; re-checked weekly so a new quarter lands within
      // days of publication rather than up to a quarter late.
      holdings: 7 * DAY,
      nav: 1 * DAY,
    },
  },
};

export function providerScopes(provider: ProviderId): readonly ProviderScope[] {
  return PROVIDERS[provider].scopes;
}

export function selectableScopes(provider: ProviderId): readonly ProviderScope[] {
  return PROVIDERS[provider].scopes.filter((scope) => scope.selectable);
}

export function isProviderScope(provider: ProviderId, scope: string): boolean {
  return PROVIDERS[provider].scopes.some((candidate) => candidate.id === scope);
}

export function scopeLabel(provider: ProviderId, scope: string): string {
  return PROVIDERS[provider].scopes.find((candidate) => candidate.id === scope)?.label ?? scope;
}

export function isFresh(
  syncedAt: Date | null,
  step: SyncStep,
  provider: ProviderId,
  now = Date.now(),
): boolean {
  if (syncedAt === null) return false;
  return now - syncedAt.getTime() < PROVIDERS[provider].freshness[step];
}

/**
 * One line explaining what a fund's disclosed weights are denominated in.
 *
 * Tool responses carry this instead of a hard-coded sentence about quarterly
 * reports, which is false for any provider that publishes a complete book.
 */
export function completenessNote(completeness: HoldingsCompleteness): string {
  return completeness === "full"
    ? "Weights are percent of net assets from the fund's full published portfolio, so they account for essentially all of it."
    : "Weights are percent of net assets from the fund's latest disclosed report, which lists only its largest positions — a small position may be missing rather than absent.";
}

/**
 * The trailing windows a fund's return is quoted over.
 *
 * One list, shared by the computation, the MCP tool and the dashboard, because
 * these labels are a contract: a reader comparing two funds must know that both
 * "1Y" columns mean the same window, and a model reading `trailingReturns` must
 * be able to name the period it is quoting. `months: null` is the whole
 * available history, and `1d` is the change over the previous observation
 * rather than a calendar day — NAV is published on trading days, so "yesterday"
 * across a weekend or a holiday is not a fixed number of days back.
 */
export const TRAILING_PERIODS = [
  { id: "1d", label: "1D", title: "Since the previous NAV", months: null },
  { id: "1m", label: "1M", title: "1 month", months: 1 },
  { id: "3m", label: "3M", title: "3 months", months: 3 },
  { id: "6m", label: "6M", title: "6 months", months: 6 },
  { id: "1y", label: "1Y", title: "1 year", months: 12 },
  { id: "3y", label: "3Y", title: "3 years", months: 36 },
  { id: "5y", label: "5Y", title: "5 years", months: 60 },
  { id: "max", label: "Max", title: "Since the earliest NAV on record", months: null },
] as const;

export type TrailingPeriodId = (typeof TRAILING_PERIODS)[number]["id"];

/**
 * Query-string booleans, parsed explicitly.
 *
 * NOT `z.coerce.boolean()`: that is `Boolean(value)`, and `Boolean("false")` is
 * `true`, so every `?force=false` would silently request a full refetch.
 */
export const booleanParam = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const providerParam = z.enum(PROVIDER_IDS);

/** Scope is validated against the provider's own list, which zod alone cannot
 *  express — the refinement is what keeps `?provider=ishares&scope=qdii` out. */
const scopedSyncFields = {
  provider: providerParam,
  scope: z.string().min(1),
};

const refineScope = <T extends { provider: ProviderId; scope: string }>(value: T, ctx: z.RefinementCtx) => {
  if (!isProviderScope(value.provider, value.scope)) {
    ctx.addIssue({
      code: "custom",
      path: ["scope"],
      message: `"${value.scope}" is not a scope of provider "${value.provider}"`,
    });
  }
};

export const previewQuerySchema = z
  .object({
    ...scopedSyncFields,
    limit: z.coerce.number().int().min(1).max(30_000).optional(),
    force: booleanParam,
  })
  .superRefine(refineScope);

export const syncBodySchema = z
  .object({
    ...scopedSyncFields,
    /**
     * `null` means "no cap — every candidate in scope"; omitted falls back to
     * the runner's default. The dashboard sends `null`, because its
     * confirmation dialog counts the whole scope: a silent cap would make the
     * number the user approved a lie.
     */
    limit: z.coerce.number().int().min(1).max(30_000).nullable().optional(),
    force: z.boolean().default(false),
  })
  .superRefine(refineScope);

/**
 * The windows the NAV chart can be drawn over.
 *
 * Derived from `TRAILING_PERIODS` rather than listed again, so a reader
 * switching the chart to 1Y and a reader reading the 1Y figure above it are
 * looking at the same window by construction. `1d` is dropped: two
 * observations are a number, not a shape.
 */
export const NAV_RANGES = TRAILING_PERIODS.filter(
  (period): period is Exclude<(typeof TRAILING_PERIODS)[number], { id: "1d" }> =>
    period.id !== "1d",
);

export type NavRangeId = (typeof NAV_RANGES)[number]["id"];

/** Long enough to show a cycle, short enough that most funds cover it. */
export const DEFAULT_NAV_RANGE: NavRangeId = "1y";

const NAV_RANGE_IDS = NAV_RANGES.map((range) => range.id) as [NavRangeId, ...NavRangeId[]];

export function isNavRange(value: string): value is NavRangeId {
  return (NAV_RANGE_IDS as readonly string[]).includes(value);
}

export const navQuerySchema = z.object({
  range: z.enum(NAV_RANGE_IDS).default(DEFAULT_NAV_RANGE),
});

/** Months back from the window's end, or null for the whole history. */
export function navRangeMonths(range: NavRangeId): number | null {
  return NAV_RANGES.find((entry) => entry.id === range)?.months ?? null;
}
