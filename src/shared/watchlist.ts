/**
 * Watchlist vocabulary shared by the server, the MCP tools and the SPA.
 *
 * Everything here is pure — no drizzle, no config — so the web bundle, the MCP
 * tools and the tests can all import it. Same rule as `shared/funds.ts`.
 */

import { z } from "zod";

/**
 * A watchlist holds two kinds of thing, because the server covers two data
 * families: Yahoo-quoted instruments (stocks, ETFs, indices, crypto) and China
 * public funds, which Yahoo does not carry. Someone tracking 天弘纳斯达克 next to
 * NVDA should not need two separate lists.
 */
export const WATCHLIST_ITEM_KINDS = ["symbol", "fund"] as const;
export type WatchlistItemKind = (typeof WATCHLIST_ITEM_KINDS)[number];

export const KIND_LABELS: Record<WatchlistItemKind, string> = {
  symbol: "Instrument",
  fund: "China fund",
};

/** Caps exist so one account cannot grow the table without bound. */
export const MAX_WATCHLISTS_PER_USER = 50;
export const MAX_ITEMS_PER_WATCHLIST = 500;
/** Per call, not per list — a batch add still has to respect the list cap. */
export const MAX_ITEMS_PER_ADD = 50;

const FUND_CODE = /^\d{6}$/;

/**
 * Bare 6 digits is a China fund code; anything else is a Yahoo symbol.
 *
 * Unambiguous in this codebase's symbol space because Yahoo's CN listings
 * always carry an exchange suffix (`600519.SS`), so a dotless `600519` can only
 * be a fund code. Callers that know better pass `kind` explicitly.
 */
export function detectItemKind(ref: string): WatchlistItemKind {
  return FUND_CODE.test(ref.trim()) ? "fund" : "symbol";
}

/**
 * One stored spelling per instrument, so the same holding added as "aapl" and
 * "AAPL" collides on the unique index instead of appearing twice.
 */
export function normalizeRef(ref: string, kind: WatchlistItemKind): string {
  const trimmed = ref.trim();
  return kind === "symbol" ? trimmed.toUpperCase() : trimmed;
}

export const watchlistNameSchema = z.string().trim().min(1).max(80);
export const watchlistDescriptionSchema = z.string().trim().max(500);
export const itemNoteSchema = z.string().trim().max(500);
/** Yahoo symbols and 6-digit fund codes both fit well inside 32 chars. */
export const itemRefSchema = z.string().trim().min(1).max(32);
export const targetPriceSchema = z.number().finite().positive().max(1e12);

export const watchlistItemInputSchema = z.object({
  ref: itemRefSchema,
  kind: z.enum(WATCHLIST_ITEM_KINDS).optional(),
  note: itemNoteSchema.optional(),
  targetPrice: targetPriceSchema.optional(),
});

export type WatchlistItemInput = z.infer<typeof watchlistItemInputSchema>;

export const createWatchlistSchema = z.object({
  name: watchlistNameSchema,
  description: watchlistDescriptionSchema.optional(),
});

export const updateWatchlistSchema = z.object({
  name: watchlistNameSchema.optional(),
  description: watchlistDescriptionSchema.nullable().optional(),
});

export const addItemsSchema = z.object({
  items: z.array(watchlistItemInputSchema).min(1).max(MAX_ITEMS_PER_ADD),
});

export const updateItemSchema = z.object({
  note: itemNoteSchema.nullable().optional(),
  targetPrice: targetPriceSchema.nullable().optional(),
});

/**
 * Distance from the live price to the target, as a signed percentage of the
 * target: negative means the price is still below it.
 */
export function targetDistancePercent(price: number | null, target: number | null): number | null {
  if (price === null || target === null || target === 0) return null;
  return Number((((price - target) / target) * 100).toFixed(2));
}
