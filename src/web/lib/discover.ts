/**
 * Pure helpers behind the search palette and the preview.
 *
 * Here rather than beside the components because each of them encodes a
 * decision worth testing on its own: how an instrument is addressed in a URL,
 * and when a query is offered as a ref the index has not heard of.
 */

import type { DiscoverIdea } from "../../shared/discover.js";
import { detectItemKind, type WatchlistItemKind } from "../../shared/watchlist.js";

/**
 * `symbol:NVDA` — one param carrying both halves of an address.
 *
 * One param rather than two because they are one fact: a `kind` with no `ref`
 * addresses nothing, and two params can go out of step in a URL somebody edits.
 * The ref may itself contain a colon in principle, so only the first splits.
 */
export function parseIdeaParam(value: string): { kind: WatchlistItemKind; ref: string } | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const kind = value.slice(0, separator);
  const ref = value.slice(separator + 1).trim();
  if (ref === "" || (kind !== "symbol" && kind !== "fund")) return null;
  return { kind, ref };
}

export function ideaParam(idea: { kind: WatchlistItemKind; ref: string }): string {
  return `${idea.kind}:${idea.ref}`;
}

/**
 * Whether a query could itself be a ref.
 *
 * Gates the "add it anyway" row. A Yahoo symbol is letters, digits and a few
 * separators (`0700.HK`, `BRK-B`, `^GSPC`, `BTC-USD`); a company or fund name
 * is not, and offering to track "易方达" as an instrument *called* 易方达 would
 * be offering a row that could only ever fail to price.
 */
export function looksLikeRef(query: string): boolean {
  return /^[A-Za-z0-9.\-^=]{1,32}$/.test(query.trim());
}

/**
 * A ref the index does not know, offered anyway.
 *
 * The fund universe lags new listings and Yahoo's search misses plenty of
 * suffixed tickers, so "I typed a valid symbol and the app refused to track it"
 * is a real failure this avoids. The kind is decided by the same rule the
 * watchlist applies when it stores a bare ref, and the spelling is normalised
 * the same way, so adding it here and typing it into the Add dialog produce one
 * row rather than two.
 */
export function fallbackIdea(query: string): DiscoverIdea {
  const ref = query.trim();
  const kind = detectItemKind(ref);
  return {
    kind,
    ref: kind === "symbol" ? ref.toUpperCase() : ref,
    name: null,
    exchange: null,
    quoteType: null,
    currency: null,
    price: null,
    changePercent: null,
    source: "search",
    tracked: [],
  };
}
