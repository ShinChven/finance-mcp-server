/**
 * Discovery vocabulary — shared by the search API, the Discover page and the
 * command palette.
 *
 * The watchlist answers "how is what I track doing". Everything here answers
 * the question before that one: *what is there to track*. Until this existed
 * the only way into a watchlist was typing a code you already knew, which is
 * the one thing a reader who is browsing does not have.
 *
 * A `DiscoverIdea` is deliberately the smallest thing that can be shown in a
 * row and then added to a list: an addressable (kind, ref) pair, enough
 * identity to recognise it, and an optional price. It is *not* an enriched
 * watchlist item — it has no levels, no entry price and no history, because
 * nothing here is tracked yet. The moment it is added it becomes a watchlist
 * item and is priced by that page's own machinery instead.
 *
 * Pure, like `shared/funds.ts` and `shared/watchlist.ts`: no drizzle, no
 * config, so the bundle, the routes and the tests can all import it.
 */

import { z } from "zod";
import type { WatchlistItemKind } from "./watchlist.js";

/**
 * The Discover page's tabs, which are its `?tab=` values.
 *
 * Ordered by how much the reader already knows. `trending` and `movers` need
 * nothing from them — the market decides what is on screen. `themes` needs an
 * idea ("semiconductors"). `funds` needs a name or a code. `related` needs a
 * watchlist to have something to be related to, and is therefore the one tab
 * that can be legitimately empty for a new account.
 */
export const DISCOVER_TABS = ["trending", "movers", "themes", "funds", "related"] as const;
export type DiscoverTab = (typeof DISCOVER_TABS)[number];
export const DEFAULT_DISCOVER_TAB: DiscoverTab = "trending";

export function isDiscoverTab(value: string): value is DiscoverTab {
  return (DISCOVER_TABS as readonly string[]).includes(value);
}

/**
 * Regions the trending list is offered for.
 *
 * A short list rather than every region Yahoo accepts: these are the markets
 * this server's own fund index and symbol conventions already cover, and a
 * region with no readers is a request nobody makes twice.
 */
export const TRENDING_REGIONS = [
  { id: "US", label: "United States" },
  { id: "HK", label: "Hong Kong" },
  { id: "CN", label: "China" },
  { id: "GB", label: "United Kingdom" },
  { id: "JP", label: "Japan" },
] as const;
export type TrendingRegion = (typeof TRENDING_REGIONS)[number]["id"];
export const DEFAULT_TRENDING_REGION: TrendingRegion = "US";

export function isTrendingRegion(value: string): value is TrendingRegion {
  return TRENDING_REGIONS.some((region) => region.id === value);
}

/**
 * Predefined screens offered as "movers".
 *
 * A subset of the screener tool's list, chosen for being readable without a
 * parameter: "day gainers" means something on its own, where a factor screen
 * needs the factor explained. `discover.test.ts` asserts every id here is one
 * the screener tool actually accepts, so this list cannot drift out of it.
 */
export const MOVER_SCREENS = [
  { id: "day_gainers", label: "Day gainers" },
  { id: "day_losers", label: "Day losers" },
  { id: "most_actives", label: "Most active" },
  { id: "undervalued_growth_stocks", label: "Undervalued growth" },
  { id: "growth_technology_stocks", label: "Growth tech" },
  { id: "aggressive_small_caps", label: "Small caps" },
] as const;
export type MoverScreen = (typeof MOVER_SCREENS)[number]["id"];
export const DEFAULT_MOVER_SCREEN: MoverScreen = "day_gainers";

export function isMoverScreen(value: string): value is MoverScreen {
  return MOVER_SCREENS.some((screen) => screen.id === value);
}

/** Where a result on this page came from, so a row can say why it is here. */
export const IDEA_SOURCES = [
  "search",
  "trending",
  "screener",
  "theme",
  "related",
  "index",
] as const;
export type IdeaSource = (typeof IDEA_SOURCES)[number];

/** One of the user's lists that already holds this ref. */
export interface TrackedIn {
  listId: string;
  listName: string;
}

/**
 * Something addressable that a user could start tracking.
 *
 * `price` and `changePercent` are nullable and often null on purpose: search
 * results are returned unpriced so that typing stays fast, while the browsing
 * lists — where the whole point is which way things moved — are priced. A row
 * renders a dash rather than pretending, and the preview prices whatever the
 * reader actually opens.
 */
export interface DiscoverIdea {
  kind: WatchlistItemKind;
  /** The exact string a watchlist stores: a Yahoo symbol or a fund code. */
  ref: string;
  name: string | null;
  /** Yahoo's exchange for a symbol, the domicile market for a fund. */
  exchange: string | null;
  /** `EQUITY`, `ETF`, `MUTUALFUND`, `INDEX`, `CRYPTOCURRENCY`, or a fund type. */
  quoteType: string | null;
  currency: string | null;
  price: number | null;
  changePercent: number | null;
  /** How this row was found — the badge a row wears. */
  source: IdeaSource;
  /**
   * Which of the reader's lists already hold it.
   *
   * Present so the star renders filled and adding a second copy is not
   * offered. Empty is the ordinary case on a discovery page and means nothing
   * more than "not tracked".
   */
  tracked: TrackedIn[];
}

/** `kind:ref` — the identity two sources are merged on. */
export function ideaKey(kind: WatchlistItemKind, ref: string): string {
  return `${kind}:${ref}`;
}

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  kind: z.enum(["symbol", "fund"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const trendingQuerySchema = z.object({
  region: z.string().trim().toUpperCase().refine(isTrendingRegion, "unknown region").optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const moversQuerySchema = z.object({
  screen: z.string().trim().refine(isMoverScreen, "unknown screen").optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const themeQuerySchema = z.object({
  theme: z.string().trim().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

export const relatedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

/** How many results each half of a search may contribute before merging. */
export const SEARCH_LIMIT_PER_SOURCE = 12;
/** Default rows on a browsing list — a screenful, not a page to scroll. */
export const DISCOVER_DEFAULT_LIMIT = 20;

export interface IdeaListResult {
  items: DiscoverIdea[];
  /**
   * Sources that failed, named so the page can say which half is missing.
   *
   * A search that reached the local fund index but not Yahoo is still a useful
   * search; failing the whole request because one of two upstreams is down
   * would be the worse answer.
   */
  degraded?: { source: string; message: string }[];
}

export interface ThemeSummary {
  id: string;
  /** The alias shown on the pill — the first label, which reads best. */
  label: string;
  /** Every alias it answers to, so the page can search them client-side. */
  aliases: string[];
}
