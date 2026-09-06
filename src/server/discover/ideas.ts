/**
 * Turning what the upstreams return into rows a reader can act on.
 *
 * Four sources feed the Discover page and the search palette — Yahoo's search,
 * its trending list, its predefined screeners, and this server's own fund index
 * — and each of them describes an instrument differently. Yahoo's search calls
 * the name `shortname` and the exchange `exchDisp`; its screener calls the same
 * two `shortName` and `fullExchangeName`; a fund row has neither and carries a
 * domicile instead. Normalising here rather than in each route means the row
 * component sees one shape and the merge rules below can be stated once.
 *
 * Everything in this file is pure: it takes plain objects and returns plain
 * objects, so the interesting decisions — which of two spellings of the same
 * instrument survives a merge, how a search result is ranked against the query
 * — are unit-testable without a network or a database.
 */

import {
  ideaKey,
  type DiscoverIdea,
  type IdeaSource,
  type TrackedIn,
} from "../../shared/discover.js";
import type { WatchlistItemKind } from "../../shared/watchlist.js";

/**
 * The union of the quote shapes the Yahoo modules actually return.
 *
 * Structural rather than imported from `yahoo-finance2`: the three endpoints
 * this reads disagree about which fields exist, all of them are optional in
 * the upstream types anyway, and a local shape keeps the tests free of the
 * library. Every field is optional for the same reason a `DiscoverIdea`'s
 * price is nullable — coverage varies by instrument and by endpoint.
 */
export interface QuoteLike {
  symbol?: string | undefined;
  /** Search spells the name lower-case; the screener and quote spell it camel. */
  shortname?: string | undefined;
  longname?: string | undefined;
  shortName?: string | undefined;
  longName?: string | undefined;
  exchDisp?: string | undefined;
  fullExchangeName?: string | undefined;
  exchange?: string | undefined;
  quoteType?: string | undefined;
  typeDisp?: string | undefined;
  currency?: string | undefined;
  regularMarketPrice?: number | undefined;
  regularMarketChangePercent?: number | undefined;
}

/** The columns of a fund row this page needs; a subset of the `funds` table. */
export interface FundLike {
  code: string;
  name: string | null;
  market: string | null;
  currency: string | null;
  fundType: string | null;
}

/** A tracked (kind, ref) and the list it sits on, as stored. */
export interface TrackedRow {
  kind: WatchlistItemKind;
  ref: string;
  watchlistId: string;
  watchlistName: string;
}

function firstString(...values: (string | undefined | null)[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function finite(value: number | undefined | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Which of the reader's lists hold each (kind, ref), keyed by `kind:ref`.
 *
 * Built once per request and looked up per row: a hundred rows against a
 * five-hundred-item watchlist is a map lookup, not a scan.
 */
export function trackedIndex(rows: TrackedRow[]): Map<string, TrackedIn[]> {
  const index = new Map<string, TrackedIn[]>();
  for (const row of rows) {
    const key = ideaKey(row.kind, row.ref);
    const existing = index.get(key);
    const entry = { listId: row.watchlistId, listName: row.watchlistName };
    if (existing === undefined) index.set(key, [entry]);
    else existing.push(entry);
  }
  return index;
}

export function ideaFromQuote(
  quote: QuoteLike,
  source: IdeaSource,
  tracked: Map<string, TrackedIn[]>,
): DiscoverIdea | null {
  const ref = firstString(quote.symbol);
  // Yahoo's search mixes news and navigational entries in with the quotes;
  // anything without a symbol is not addressable and cannot be tracked.
  if (ref === null) return null;

  return {
    kind: "symbol",
    ref,
    name: firstString(quote.longname, quote.longName, quote.shortname, quote.shortName),
    exchange: firstString(quote.exchDisp, quote.fullExchangeName, quote.exchange),
    quoteType: firstString(quote.quoteType, quote.typeDisp),
    currency: firstString(quote.currency),
    price: finite(quote.regularMarketPrice),
    changePercent: finite(quote.regularMarketChangePercent),
    source,
    tracked: tracked.get(ideaKey("symbol", ref)) ?? [],
  };
}

export function ideaFromFund(
  fund: FundLike,
  source: IdeaSource,
  tracked: Map<string, TrackedIn[]>,
): DiscoverIdea {
  return {
    kind: "fund",
    ref: fund.code,
    name: fund.name,
    // A fund's "exchange" is where it is domiciled and bought — the distinction
    // a reader needs is CN versus US, not which venue prints the NAV.
    exchange: fund.market,
    quoteType: fund.fundType,
    currency: fund.currency,
    price: null,
    changePercent: null,
    source,
    tracked: tracked.get(ideaKey("fund", fund.code)) ?? [],
  };
}

/**
 * Merge result groups into one list, the first spelling of a ref winning.
 *
 * Groups are passed in priority order, and the caller puts symbols ahead of
 * funds for the reason `detectItemKind` gives: `IVV` is genuinely both a cached
 * fund and a quoted symbol, and a live intraday quote beats yesterday's NAV, so
 * the symbol is the one to offer. Showing both would put the same ETF on screen
 * twice under two different prices.
 *
 * Deduplication is therefore on the ref alone, not on `kind:ref` — those two
 * rows are the collision this rule exists to resolve. It costs nothing
 * elsewhere: a China fund code and a Yahoo symbol for the same company are
 * different strings (`600519` and `600519.SS`), so both survive, as they
 * should — one is a fund, the other a listing.
 */
export function mergeIdeas(groups: DiscoverIdea[][], limit: number): DiscoverIdea[] {
  const seen = new Set<string>();
  const out: DiscoverIdea[] = [];
  for (const group of groups) {
    for (const idea of group) {
      const key = idea.ref.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(idea);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Search ranking: what the reader typed, first.
 *
 * Three tiers — the ref or name matched exactly, then either one started with
 * the query, then everything else — and stable within each, so an upstream's
 * own relevance order survives inside a tier. Deliberately not a score: this
 * merges two sources that cannot be scored against each other, and a fake
 * common scale would order them by nothing at all.
 *
 * Matching is case-insensitive on both sides so `nvda` finds `NVDA`, and runs
 * on the name as well as the ref because half the point is that the reader
 * knows the name — "易方达" — and not the code.
 */
export function rankSearchIdeas(ideas: DiscoverIdea[], query: string): DiscoverIdea[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return ideas;

  const tier = (idea: DiscoverIdea): number => {
    const ref = idea.ref.toLowerCase();
    const name = (idea.name ?? "").toLowerCase();
    if (ref === needle || name === needle) return 0;
    if (ref.startsWith(needle) || name.startsWith(needle)) return 1;
    return 2;
  };

  return ideas
    .map((idea, index) => ({ idea, index, tier: tier(idea) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.idea);
}

/**
 * One element, uniformly at random.
 *
 * Takes the generator so "surprise me" is testable: a random button whose only
 * assertion could be "it returned something" would not catch an off-by-one that
 * never picks the last element.
 */
export function pickRandom<T>(items: readonly T[], random: () => number = Math.random): T | null {
  if (items.length === 0) return null;
  const index = Math.min(items.length - 1, Math.floor(random() * items.length));
  return items[index] ?? null;
}

/**
 * Prices already-built ideas from a value lookup keyed `kind:ref`.
 *
 * Split from the fetch so the routes can price ideas from whatever source they
 * came from with one code path — and so the rule that an unavailable quote
 * leaves the row unpriced rather than zeroed is written once.
 */
export function priceIdeas(
  ideas: DiscoverIdea[],
  values: Map<string, { price: number | null; changePercent: number | null; currency: string | null }>,
): DiscoverIdea[] {
  return ideas.map((idea) => {
    const value = values.get(ideaKey(idea.kind, idea.ref));
    if (value === undefined) return idea;
    return {
      ...idea,
      price: value.price ?? idea.price,
      changePercent: value.changePercent ?? idea.changePercent,
      currency: value.currency ?? idea.currency,
    };
  });
}
