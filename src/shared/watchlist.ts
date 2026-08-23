/**
 * Watchlist vocabulary shared by the server, the MCP tools and the SPA.
 *
 * Everything here is pure — no drizzle, no config — so the web bundle, the MCP
 * tools and the tests can all import it. Same rule as `shared/funds.ts`.
 */

import { z } from "zod";

/**
 * A watchlist holds two kinds of thing, because two things are valued
 * differently: Yahoo-quoted instruments (stocks, ETFs, indices, crypto), which
 * have a live price, and funds valued from the locally cached NAV. Someone
 * tracking 天弘纳斯达克 next to NVDA should not need two separate lists.
 *
 * A US ETF is genuinely both — `IVV` is a cached fund *and* a Yahoo symbol. It
 * is stored as a symbol, because a live intraday quote is strictly better than
 * yesterday's close; the fund tools still reach it by the same code.
 */
export const WATCHLIST_ITEM_KINDS = ["symbol", "fund"] as const;
export type WatchlistItemKind = (typeof WATCHLIST_ITEM_KINDS)[number];

export const KIND_LABELS: Record<WatchlistItemKind, string> = {
  symbol: "Instrument",
  fund: "Fund (NAV)",
};

/** Caps exist so one account cannot grow the table without bound. */
export const MAX_WATCHLISTS_PER_USER = 50;
export const MAX_ITEMS_PER_WATCHLIST = 500;
/** Per call, not per list — a batch add still has to respect the list cap. */
export const MAX_ITEMS_PER_ADD = 50;
/**
 * Price levels per item. Twenty is already more than anyone reads off a chart;
 * the cap exists so an agent looping over "add another level" cannot turn one
 * row into an unbounded table.
 */
export const MAX_LEVELS_PER_ITEM = 20;

const FUND_CODE = /^\d{6}$/;

/**
 * Bare 6 digits is a China fund code; anything else is a Yahoo symbol.
 *
 * Unambiguous in this codebase's symbol space because Yahoo's CN listings
 * always carry an exchange suffix (`600519.SS`), so a dotless `600519` can only
 * be a fund code. A listed ETF deliberately falls through to `symbol` — it is
 * quotable, and a live price beats a cached NAV. Callers that know better pass
 * `kind` explicitly.
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
export const priceSchema = z.number().finite().positive().max(1e12);

/* ------------------------------------------------------------------ *
 * Price levels
 *
 * A tracked item accumulates prices that matter: where it was bought, where
 * resistance is, where the thesis breaks. They are one vocabulary because they
 * are one gesture — "this number, and why" — and differ only in intent.
 *
 * `kind` records that intent at the time of writing and nothing more. In
 * particular a level carries no direction: "上看 200" stops being an upside
 * target the moment the price trades through 200, so which side of the market
 * a level sits on is derived from the live price by `locateLevel`, never
 * stored. The stored number is the only part that does not go stale.
 * ------------------------------------------------------------------ */

export const WATCHLIST_LEVEL_KINDS = ["support", "resistance", "target", "stop", "entry"] as const;
export type WatchlistLevelKind = (typeof WATCHLIST_LEVEL_KINDS)[number];

export const LEVEL_KIND_LABELS: Record<WatchlistLevelKind, string> = {
  support: "Support",
  resistance: "Resistance",
  target: "Target",
  stop: "Stop",
  entry: "Entry zone",
};

/**
 * `hit` and `invalidated` are both "no longer waiting for this", kept apart
 * because they mean opposite things about the call that produced the level.
 */
export const WATCHLIST_LEVEL_STATUSES = ["active", "hit", "invalidated"] as const;
export type WatchlistLevelStatus = (typeof WATCHLIST_LEVEL_STATUSES)[number];

/** Who put the level there — an agent's read is worth showing as such. */
export const WATCHLIST_LEVEL_SOURCES = ["user", "agent"] as const;
export type WatchlistLevelSource = (typeof WATCHLIST_LEVEL_SOURCES)[number];

export const levelLabelSchema = z.string().trim().max(80);
export const levelNoteSchema = z.string().trim().max(500);
/** Plain `YYYY-MM-DD`; a level's shelf life is a day, never a timestamp. */
export const levelValidUntilSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const levelBody = {
  kind: z.enum(WATCHLIST_LEVEL_KINDS),
  price: priceSchema,
  /** Set only for a zone ("3.20–3.40 一带"); must be above `price`. */
  priceHigh: priceSchema.optional(),
  label: levelLabelSchema.optional(),
  note: levelNoteSchema.optional(),
  validUntil: levelValidUntilSchema.optional(),
};

/** A zone stored the wrong way round would silently never match. */
const orderedBand = <T extends { price: number; priceHigh?: number | null }>(
  value: T,
  ctx: z.RefinementCtx,
): void => {
  if (value.priceHigh !== undefined && value.priceHigh !== null && value.priceHigh <= value.price) {
    ctx.addIssue({
      code: "custom",
      path: ["priceHigh"],
      message: "priceHigh must be greater than price.",
    });
  }
};

export const levelInputSchema = z.object(levelBody).superRefine(orderedBand);
export type LevelInput = z.infer<typeof levelInputSchema>;

export const addLevelsSchema = z.object({
  levels: z.array(levelInputSchema).min(1).max(MAX_LEVELS_PER_ITEM),
});

export const updateLevelSchema = z
  .object({
    kind: levelBody.kind.optional(),
    price: priceSchema.optional(),
    priceHigh: priceSchema.nullable().optional(),
    label: levelLabelSchema.nullable().optional(),
    note: levelNoteSchema.nullable().optional(),
    validUntil: levelValidUntilSchema.nullable().optional(),
    status: z.enum(WATCHLIST_LEVEL_STATUSES).optional(),
  })
  .superRefine((value, ctx) => {
    // Only checkable when both edges are in the same patch; a patch that moves
    // one edge alone is validated against the stored row in the repo.
    if (value.price !== undefined) orderedBand({ ...value, price: value.price }, ctx);
  });

export const watchlistItemInputSchema = z.object({
  ref: itemRefSchema,
  kind: z.enum(WATCHLIST_ITEM_KINDS).optional(),
  note: itemNoteSchema.optional(),
  /**
   * What it cost when it went on the list. Normally captured from the live
   * quote at add time; passed explicitly only to backfill something bought
   * before it was tracked.
   */
  entryPrice: priceSchema.optional(),
  entryAt: z.string().datetime().optional(),
  levels: z.array(levelInputSchema).max(MAX_LEVELS_PER_ITEM).optional(),
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
  entryPrice: priceSchema.nullable().optional(),
  entryAt: z.string().datetime().nullable().optional(),
});

/**
 * Percentage move from `from` to `to`.
 *
 * Which number is the denominator is the whole meaning here, so callers pass
 * it first: measured from the entry price this is "how the position has done",
 * measured from the live price it is "how far the market must travel".
 */
export function percentChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return Number((((to - from) / from) * 100).toFixed(2));
}

/** Where a level sits relative to the live price, and how far away it is. */
export interface LevelPosition {
  /** `inside` is only reachable for a zone; a single price is `at` on a match. */
  side: "above" | "below" | "inside" | "at" | null;
  /**
   * Signed move the price must make to reach the level, as a percentage of the
   * live price: `+4.9` means it has to rise 4.9%. Zero inside a zone.
   */
  distancePercent: number | null;
}

/**
 * Distance is measured to the near edge of a zone, because that is where the
 * market meets it — the far edge only matters once it is already inside.
 */
export function locateLevel(
  price: number | null,
  low: number,
  high: number | null = null,
): LevelPosition {
  if (price === null) return { side: null, distancePercent: null };
  const top = high ?? low;
  if (price < low) return { side: "above", distancePercent: percentChange(price, low) };
  if (price > top) return { side: "below", distancePercent: percentChange(price, top) };
  return { side: high === null ? "at" : "inside", distancePercent: 0 };
}

/**
 * What counts as "the price is nearly there".
 *
 * One number, shared by the `near` filter, the summary count and the row
 * highlight, so the three cannot disagree about which items are interesting.
 */
export const NEAR_LEVEL_PERCENT = 2;

/** A level past its shelf life is shown greyed out, not deleted. */
export function isLevelExpired(validUntil: string | null, today = new Date()): boolean {
  if (validUntil === null) return false;
  return validUntil < today.toISOString().slice(0, 10);
}
