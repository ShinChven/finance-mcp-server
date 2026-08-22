/**
 * Who is allowed to open a realtime socket.
 *
 * Two checks, and the second one is the one people forget. A browser cannot set
 * headers on a WebSocket handshake, so the session cookie is the only credential
 * available -- and WebSockets are exempt from the same-origin policy, which
 * means any page on the internet can open an authenticated socket to this
 * server unless the `Origin` header is verified. That check is not optional
 * here; it is the entire CSRF defence for this endpoint.
 */

import type { IncomingMessage } from "node:http";
import { isSelfOrigin } from "../lib/origin.js";
import { loadSessionFromCookieHeader } from "../middleware/session.js";

export interface SocketIdentity {
  userId: string;
  /** Re-checked periodically so an expired or revoked session closes the socket. */
  sessionId: string;
  isAdmin: boolean;
}

/**
 * A missing `Origin` is a rejection, not a pass. Every browser sends one on a
 * WebSocket handshake, so its absence means the caller is not a browser -- and
 * a non-browser client has no business authenticating with a session cookie
 * when it could be using a personal access token against `/mcp` instead.
 */
export function isAllowedUpgradeOrigin(
  origin: string | undefined,
  host: string | undefined,
): boolean {
  if (!origin || origin === "null") return false;
  return isSelfOrigin(origin, host);
}

/**
 * The session half of the check. Kept separate from the origin half because the
 * two failures deserve different answers: a foreign origin is refused before any
 * handshake, while an expired session is told so over a socket it can read.
 */
export async function authenticateSession(req: IncomingMessage): Promise<SocketIdentity | null> {
  const resolved = await loadSessionFromCookieHeader(req.headers.cookie);
  if (!resolved) return null;
  return {
    userId: resolved.user.id,
    sessionId: resolved.session.id,
    isAdmin: resolved.user.role === "admin",
  };
}
