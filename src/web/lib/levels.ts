/**
 * Turning typed text into price levels.
 *
 * Lives here rather than in the component because it is the one part of the
 * levels UI with a judgement in it — which kind an unlabelled number is — and
 * that judgement is worth testing without rendering anything.
 */

import { WATCHLIST_LEVEL_KINDS, type WatchlistLevelKind } from "../../shared/watchlist.js";

export interface LevelDraft {
  kind: WatchlistLevelKind;
  price: number;
  priceHigh?: number;
  label?: string;
  note?: string;
  validUntil?: string;
}

export interface LevelPatch {
  kind?: WatchlistLevelKind;
  price?: number;
  priceHigh?: number | null;
  label?: string | null;
  note?: string | null;
  validUntil?: string | null;
  status?: "active" | "hit" | "invalidated";
}

/**
 * `185 prior high`, one per line, with an optional leading kind.
 *
 * The kind is inferred from which side of the live price the number falls on,
 * because that is the reading anyone typing a chart level already has in their
 * head; naming it explicitly ("stop 152 thesis breaks") wins. With no live
 * price to compare — adding an item that is not quoted yet — everything is a
 * target, which is the one kind that carries no claim about direction.
 */
export function parseLevelLines(text: string, price: number | null): LevelDraft[] {
  const drafts: LevelDraft[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const match = /^(?:([a-z]+)\s+)?(\d+(?:\.\d+)?)(?:\s*[-–~]\s*(\d+(?:\.\d+)?))?\s*(.*)$/i.exec(
      trimmed,
    );
    if (match === null) continue;

    const [, kindWord, low, high, label] = match;
    const named = WATCHLIST_LEVEL_KINDS.find((kind) => kind === kindWord?.toLowerCase());
    const value = Number(low);
    if (!Number.isFinite(value) || value <= 0) continue;

    drafts.push({
      kind: named ?? (price === null ? "target" : value > price ? "resistance" : "support"),
      price: value,
      ...(high !== undefined && { priceHigh: Number(high) }),
      ...(label !== undefined && label.trim() !== "" && { label: label.trim() }),
    });
  }
  return drafts;
}
