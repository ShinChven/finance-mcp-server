/**
 * Attaches current values to watchlist rows.
 *
 * Nothing priceable is stored on the item itself, so this is where the two
 * sources meet: Yahoo for instruments, the local fund cache for funds.
 * The two are labelled rather than blended — a fund's daily NAV move and a
 * stock's intraday change are not the same measurement, and a column that
 * silently mixed them would be misleading.
 *
 * Failures degrade to `available: false` with a reason instead of throwing: a
 * watchlist that will not render because one quote provider is down is worse
 * than one that renders with gaps.
 */

import {
  isLevelExpired,
  locateLevel,
  NEAR_LEVEL_PERCENT,
  percentChange,
  type LevelPosition,
  type WatchlistItemKind,
  type WatchlistLevelKind,
  type WatchlistLevelSource,
  type WatchlistLevelStatus,
} from "../../shared/watchlist.js";
import type { YahooFinanceClient } from "../mcp/client.js";
import { yahooRequestOptions } from "../mcp/tools/runtime.js";
import type { WatchlistLevel } from "../db/schema.js";
import type { WatchlistItemRow, WatchlistRepo } from "./repo.js";

export interface LiveValue {
  /** `market` for a Yahoo quote, `nav` for a fund's last published NAV. */
  basis: "market" | "nav";
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string | null;
  /** Yahoo's session state (`REGULAR`, `CLOSED`, …); null for funds. */
  marketState: string | null;
  /** Quote time, or the NAV date for a fund. */
  asOf: string | null;
  available: boolean;
  unavailableReason?: string;
}

/**
 * A stored level plus everything about it that depends on the current price.
 *
 * `side`, `distancePercent` and `expired` are computed here on every read for
 * the same reason no price is stored on an item: a level's relationship to the
 * market changes every tick, and a persisted copy would be a lie between them.
 */
export interface EnrichedLevel extends LevelPosition {
  id: string;
  kind: WatchlistLevelKind;
  price: number;
  priceHigh: number | null;
  label: string | null;
  note: string | null;
  source: WatchlistLevelSource;
  status: WatchlistLevelStatus;
  hitAt: string | null;
  validUntil: string | null;
  expired: boolean;
}

export interface EnrichedItem {
  id: string;
  kind: WatchlistItemKind;
  ref: string;
  name: string | null;
  note: string | null;
  entryPrice: number | null;
  entryAt: string | null;
  /** How the item has done since it went on the list — measured from entry. */
  sinceEntryPercent: number | null;
  /** Highest first, so the list reads like a ladder around the price. */
  levels: EnrichedLevel[];
  /**
   * The first level the price would meet going either way, ignoring levels
   * that are hit, invalidated or expired. Computed here rather than in the
   * client because the table sorts on it.
   */
  nearest: { above: EnrichedLevel | null; below: EnrichedLevel | null };
  addedAt: string;
  live: LiveValue;
}

export interface WatchlistTotals {
  items: number;
  priced: number;
  advancing: number;
  declining: number;
  /** Unweighted mean of available change percentages — a breadth reading, not
   *  a portfolio return: watchlists carry no position sizes. */
  averageChangePercent: number | null;
  best: { ref: string; changePercent: number } | null;
  worst: { ref: string; changePercent: number } | null;
  /** Items whose next level in either direction is within `NEAR_LEVEL_PERCENT`. */
  approaching: number;
}

const UNAVAILABLE = (reason: string, basis: LiveValue["basis"]): LiveValue => ({
  basis,
  price: null,
  change: null,
  changePercent: null,
  currency: null,
  marketState: null,
  asOf: null,
  available: false,
  unavailableReason: reason,
});

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isoTime(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 1e11 ? value : value * 1_000).toISOString();
  }
  return typeof value === "string" ? value : null;
}

function key(kind: WatchlistItemKind, ref: string): string {
  return `${kind}:${ref}`;
}

async function quoteSymbols(
  symbols: string[],
  client: YahooFinanceClient,
): Promise<Map<string, LiveValue>> {
  const values = new Map<string, LiveValue>();
  if (symbols.length === 0) return values;

  let rows: unknown[];
  try {
    rows = (await client.quote(symbols, {}, yahooRequestOptions())) as unknown[];
  } catch (error) {
    const reason = `Quote lookup failed: ${error instanceof Error ? error.message : String(error)}`;
    for (const symbol of symbols) values.set(symbol, UNAVAILABLE(reason, "market"));
    return values;
  }

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const quote = row as Record<string, unknown>;
    const symbol = str(quote["symbol"]);
    if (symbol === null) continue;
    values.set(symbol, {
      basis: "market",
      price: num(quote["regularMarketPrice"]),
      change: num(quote["regularMarketChange"]),
      changePercent: num(quote["regularMarketChangePercent"]),
      currency: str(quote["currency"]),
      marketState: str(quote["marketState"]),
      asOf: isoTime(quote["regularMarketTime"]),
      available: num(quote["regularMarketPrice"]) !== null,
      ...(num(quote["regularMarketPrice"]) === null
        ? { unavailableReason: "Yahoo returned no price for this symbol." }
        : {}),
    });
  }

  // Yahoo drops unknown symbols from the response rather than erroring, so
  // whatever is still missing is a symbol that does not resolve.
  for (const symbol of symbols) {
    if (!values.has(symbol)) {
      values.set(
        symbol,
        UNAVAILABLE("No Yahoo Finance data for this symbol — check the spelling or suffix.", "market"),
      );
    }
  }
  return values;
}

async function quoteFunds(
  codes: string[],
  repo: WatchlistRepo,
): Promise<{ values: Map<string, LiveValue>; names: Map<string, string> }> {
  const values = new Map<string, LiveValue>();
  const names = new Map<string, string>();
  if (codes.length === 0) return { values, names };

  let snapshots: Awaited<ReturnType<WatchlistRepo["getFundSnapshots"]>>;
  try {
    snapshots = await repo.getFundSnapshots(codes);
  } catch (error) {
    const reason = `Fund cache lookup failed: ${error instanceof Error ? error.message : String(error)}`;
    for (const code of codes) values.set(code, UNAVAILABLE(reason, "nav"));
    return { values, names };
  }

  for (const code of codes) {
    const snapshot = snapshots.get(code);
    if (snapshot === undefined) {
      values.set(
        code,
        UNAVAILABLE("This fund is not in the local index yet — cache it from the Funds page.", "nav"),
      );
      continue;
    }
    names.set(code, snapshot.name);
    if (snapshot.nav === null) {
      values.set(code, UNAVAILABLE("No NAV history cached for this fund yet.", "nav"));
      continue;
    }
    // dailyReturn is already a percentage; the absolute move is derived from it
    // because Eastmoney publishes the percentage, not the previous NAV.
    const changePercent = snapshot.dailyReturn;
    values.set(code, {
      basis: "nav",
      price: snapshot.nav,
      change:
        changePercent === null
          ? null
          : Number((snapshot.nav - snapshot.nav / (1 + changePercent / 100)).toFixed(4)),
      changePercent,
      currency: "CNY",
      marketState: null,
      asOf: snapshot.navDate,
      available: true,
    });
  }
  return { values, names };
}

/**
 * Enriches stored rows with current values. One Yahoo call for every symbol on
 * the list and one database round trip for every fund, regardless of list size.
 */
function enrichLevel(level: WatchlistLevel, price: number | null, today: Date): EnrichedLevel {
  const position = locateLevel(price, level.price, level.priceHigh);
  return {
    id: level.id,
    kind: level.kind,
    price: level.price,
    priceHigh: level.priceHigh,
    label: level.label,
    note: level.note,
    source: level.source,
    status: level.status,
    hitAt: level.hitAt?.toISOString() ?? null,
    validUntil: level.validUntil,
    expired: isLevelExpired(level.validUntil, today),
    ...position,
  };
}

/**
 * Which level the price runs into next, in each direction.
 *
 * Only `active`, unexpired levels count: a stop that already triggered is
 * history, and surfacing it as the next thing below would misread the chart.
 */
function nearestLevels(levels: EnrichedLevel[]): EnrichedItem["nearest"] {
  const live = levels.filter((level) => level.status === "active" && !level.expired);
  // `levels` is sorted high to low, so the last one above and the first one
  // below are the two adjacent to the price.
  const above = live.filter((level) => level.side === "above");
  const below = live.filter((level) => level.side === "below");
  return {
    above: above[above.length - 1] ?? null,
    below: below[0] ?? null,
  };
}

export interface ValueDeps {
  client: YahooFinanceClient;
  repo: WatchlistRepo;
}

/**
 * Current value for anything addressable as (kind, ref), keyed by `kind:ref`.
 *
 * Split out of `enrichItems` because adding an item needs the same two lookups
 * for a different reason — capturing what it cost at the moment it was tracked
 * — and doing it twice would be two ways to price the same thing.
 */
export async function currentValues(
  refs: { kind: WatchlistItemKind; ref: string }[],
  deps: ValueDeps,
): Promise<{ values: Map<string, LiveValue>; names: Map<string, string> }> {
  const symbols = [...new Set(refs.filter((i) => i.kind === "symbol").map((i) => i.ref))];
  const codes = [...new Set(refs.filter((i) => i.kind === "fund").map((i) => i.ref))];

  const [symbolValues, fundResult] = await Promise.all([
    quoteSymbols(symbols, deps.client),
    quoteFunds(codes, deps.repo),
  ]);

  const values = new Map<string, LiveValue>();
  for (const [symbol, value] of symbolValues) values.set(key("symbol", symbol), value);
  for (const [code, value] of fundResult.values) values.set(key("fund", code), value);
  return { values, names: fundResult.names };
}

/**
 * Fills in the entry price of rows that did not bring one.
 *
 * Automatic on purpose: "what was it worth when I started watching this" is
 * only answerable at this moment, and a field the caller has to remember to
 * fill would be empty on exactly the rows that needed it. An explicit value
 * always wins, so backfilling a holding bought months ago still works. A quote
 * that cannot be had leaves the row alone rather than failing the add — the
 * item still belongs on the list.
 */
export async function withEntryPrices<T extends { kind: WatchlistItemKind; ref: string; entryPrice?: number | null }>(
  rows: T[],
  deps: ValueDeps,
): Promise<T[]> {
  const missing = rows.filter((row) => row.entryPrice === undefined || row.entryPrice === null);
  if (missing.length === 0) return rows;

  const { values } = await currentValues(missing, deps);
  return rows.map((row) => {
    if (row.entryPrice !== undefined && row.entryPrice !== null) return row;
    const price = values.get(key(row.kind, row.ref))?.price ?? null;
    return price === null ? row : { ...row, entryPrice: price };
  });
}

export async function enrichItems(
  items: WatchlistItemRow[],
  deps: ValueDeps,
): Promise<EnrichedItem[]> {
  const { values, names } = await currentValues(items, deps);

  const today = new Date();

  return items.map((item) => {
    const live =
      values.get(key(item.kind, item.ref)) ??
      UNAVAILABLE("No value source for this item.", item.kind === "fund" ? "nav" : "market");
    const levels = item.levels
      .map((level) => enrichLevel(level, live.price, today))
      .sort((a, b) => b.price - a.price);
    return {
      id: item.id,
      kind: item.kind,
      ref: item.ref,
      // The stored name wins; the fund cache fills in what was never captured.
      name: item.name ?? names.get(item.ref) ?? null,
      note: item.note,
      entryPrice: item.entryPrice,
      entryAt: item.entryAt?.toISOString() ?? null,
      sinceEntryPercent: percentChange(item.entryPrice, live.price),
      levels,
      nearest: nearestLevels(levels),
      addedAt: item.createdAt.toISOString(),
      live,
    };
  });
}

/** Close enough to a level that it is worth looking at today. */
export function isApproaching(item: EnrichedItem): boolean {
  return [item.nearest.above, item.nearest.below].some(
    (level) =>
      level !== null &&
      level.distancePercent !== null &&
      Math.abs(level.distancePercent) <= NEAR_LEVEL_PERCENT,
  );
}

export function summarize(items: EnrichedItem[]): WatchlistTotals {
  const moves = items
    .map((item) => item.live.changePercent)
    .filter((value): value is number => value !== null);

  const ranked = items
    .filter((item) => item.live.changePercent !== null)
    .map((item) => ({ ref: item.ref, changePercent: item.live.changePercent! }))
    .sort((a, b) => b.changePercent - a.changePercent);

  return {
    items: items.length,
    priced: items.filter((item) => item.live.available).length,
    advancing: moves.filter((value) => value > 0).length,
    declining: moves.filter((value) => value < 0).length,
    averageChangePercent:
      moves.length === 0
        ? null
        : Number((moves.reduce((sum, value) => sum + value, 0) / moves.length).toFixed(2)),
    best: ranked[0] ?? null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1]! : null,
    approaching: items.filter(isApproaching).length,
  };
}
