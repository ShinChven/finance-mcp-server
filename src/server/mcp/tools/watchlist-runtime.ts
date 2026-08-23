/**
 * Shared plumbing for the watchlist tools.
 *
 * Unlike every other tool family here, these read and write rows that belong to
 * one user, so each handler must start from the authenticated identity — never
 * from a user id in the arguments, which the model could otherwise be talked
 * into supplying.
 */

import { z } from "zod";
import type { McpAuth } from "../../lib/http.js";
import {
  levelLabelSchema,
  levelNoteSchema,
  levelValidUntilSchema,
  priceSchema,
  WATCHLIST_LEVEL_KINDS,
} from "../../../shared/watchlist.js";

export function requireWatchlistUser(auth: McpAuth | null): string {
  if (auth === null) {
    throw new Error("Watchlist tools are only available on an authenticated MCP request.");
  }
  return auth.user.id;
}

export const listReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .describe(
    "Watchlist name or id. Omit when the user has exactly one list; with several, naming one is required.",
  );

/**
 * One price level, as a tool argument.
 *
 * A raw shape rather than a `z.object`, because two tools embed it in
 * different places and the MCP SDK wants the shape at the top level of an
 * input schema. The descriptions carry the part a model cannot infer: a level
 * records intent, not direction — which side of the market it is on is read
 * off the live price, so the same row stays correct after a breakout.
 */
export const levelInputShape = {
  kind: z
    .enum(WATCHLIST_LEVEL_KINDS)
    .describe(
      "What the price means: `support`/`resistance` are chart levels, `target` is where the thesis " +
        "plays out, `stop` is where it is wrong, `entry` is where it becomes worth buying. Do not " +
        "encode direction — a target above today's price is still just a target.",
    ),
  price: priceSchema.describe("The level, or the low edge of a zone."),
  priceHigh: priceSchema
    .optional()
    .describe("High edge, for a zone rather than a single price. Must exceed `price`."),
  label: levelLabelSchema
    .optional()
    .describe('Where the number comes from: "prior high", "200-day MA", "gap fill".'),
  note: levelNoteSchema.optional().describe("The reasoning, when it needs more than a label."),
  validUntil: levelValidUntilSchema
    .optional()
    .describe("YYYY-MM-DD after which the level no longer applies, e.g. the next earnings date."),
};
