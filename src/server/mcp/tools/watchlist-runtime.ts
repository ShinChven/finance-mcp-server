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
