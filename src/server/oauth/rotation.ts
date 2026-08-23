/**
 * What to do with a refresh token that has already been rotated once.
 *
 * Rotation without a grace window turns three ordinary events into a permanent
 * disconnection, because reuse revokes the whole token family and the client
 * cannot recover without a fresh consent:
 *
 * - The server restarts (a deploy) mid-refresh. The rotation committed, the
 *   response never arrived, and the client retries with the token it still has.
 * - The client fires several MCP requests at once, they all see 401, and each
 *   one refreshes with the same token. One wins; the rest look like theft.
 * - Any network retry of a request whose response was lost.
 *
 * So a token that was rotated moments ago is treated as the same exchange
 * arriving twice rather than as a stolen credential, and the client gets a
 * usable pair back. The window is deliberately short: it is sized for a retry,
 * not for an attacker who captured a token and came back later.
 *
 * A token revoked for any *other* reason -- reuse detected earlier, an explicit
 * /revoke, a withdrawn grant -- never gets that latitude, which is why the
 * rotation path records `rotatedAt` alongside `revokedAt` and this rule reads
 * it. Without that distinction, revoking a grant would leave a 30-second hole
 * in which the client could mint itself a new pair.
 */

/** How long after a rotation a repeat of the same exchange is still honoured. */
export const REFRESH_REUSE_GRACE_MS = 30_000;

export type RefreshDecision =
  /** Fresh token: rotate it and issue the successor pair. */
  | "rotate"
  /** Already rotated, but only just: issue a pair without revoking the family. */
  | "replay"
  /** Revoked for another reason, or rotated too long ago: treat as theft. */
  | "reuse";

export function classifyRefreshUse(
  token: { revokedAt: Date | null; rotatedAt: Date | null },
  now: number = Date.now(),
): RefreshDecision {
  if (!token.revokedAt) return "rotate";
  if (!token.rotatedAt) return "reuse";
  // A negative age means the clock moved backwards between the two reads, not
  // that the rotation is from the future; the retry it represents is still live.
  return now - token.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_MS ? "replay" : "reuse";
}
