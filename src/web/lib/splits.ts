/**
 * Levels that a corporate action has quietly invalidated.
 *
 * A four-for-one split turns a $600 target into a line the price can never
 * reach again. Nothing about the stored level changes, nothing errors, and the
 * only visible symptom is a level drawn far off the top of the chart — which is
 * exactly the case the chart's own domain clamp hides in order to keep the
 * price line readable.
 *
 * So it is detected rather than inferred from the picture, and it is only ever
 * flagged. Rewriting a number a person wrote — or an assistant recorded with a
 * rationale beside it — because a ratio appeared in a feed is not a correction
 * the software gets to make on its own.
 */

import type { SeriesEvent } from "../../shared/series.js";
import type { WatchlistLevel } from "./types.js";

export interface StaleLevel {
  level: WatchlistLevel;
  /** Combined factor of every split since the level was recorded. */
  factor: number;
  /** What the level would become if rescaled. */
  suggested: number;
  suggestedHigh: number | null;
}

/**
 * Splits that landed after a level was recorded, combined.
 *
 * Combined rather than "the latest", because two splits in one window compound:
 * a level set before both is wrong by the product, not by the second one.
 */
export function staleLevels(levels: WatchlistLevel[], events: SeriesEvent[]): StaleLevel[] {
  const splits = events.filter(
    (event): event is SeriesEvent & { factor: number } =>
      event.kind === "split" && event.factor !== null && event.factor > 0 && event.factor !== 1,
  );
  if (splits.length === 0) return [];

  const stale: StaleLevel[] = [];
  for (const level of levels) {
    // Dates rather than instants: an event carries an exchange calendar date,
    // and a level recorded at any time that day predates the day's open.
    const recorded = level.createdAt.slice(0, 10);
    const after = splits.filter((split) => split.date > recorded);
    if (after.length === 0) continue;

    const factor = after.reduce((product, split) => product * split.factor, 1);
    stale.push({
      level,
      factor,
      suggested: Number((level.price / factor).toFixed(4)),
      suggestedHigh:
        level.priceHigh === null ? null : Number((level.priceHigh / factor).toFixed(4)),
    });
  }
  return stale;
}

/** How a factor reads to a person: 4 is "4-for-1", 0.25 is "1-for-4". */
export function describeFactor(factor: number): string {
  return factor >= 1
    ? `${Number(factor.toFixed(2))}-for-1`
    : `1-for-${Number((1 / factor).toFixed(2))}`;
}
