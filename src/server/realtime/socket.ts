/**
 * One connected dashboard.
 *
 * Everything here exists because a socket, unlike a request, has to survive
 * being ignored for a week on a second monitor:
 *
 * - **Liveness.** A dead TCP connection does not announce itself. The sweeper
 *   sends a protocol ping and terminates anything that missed the previous one
 *   -- `terminate`, not `close`, because a peer that cannot answer a ping will
 *   not answer a close handshake either. It also sends an application-level
 *   `ping` message, which is what the browser watchdog resets: browsers do not
 *   expose protocol pings to JavaScript, so without it a tab cannot tell an
 *   idle socket from a dead one.
 * - **Session lifetime.** The cookie was checked once, at upgrade. It is
 *   re-checked on a slow timer so that logging out, or a session expiring,
 *   actually ends the connection.
 * - **Backpressure.** A sleeping laptop accepts a socket but stops reading it.
 *   Writes then queue in the process. Events are droppable by design -- the
 *   client re-syncs on reconnect -- so a backed-up socket is skipped, and one
 *   that stays backed up is hung up on.
 */

import type { WebSocket } from "ws";
import { REALTIME_CLOSE, type ServerMessage } from "../../shared/realtime.js";
import { sessionOwnerRole } from "../middleware/session.js";
import { ADMIN_CHANNEL, subscribe, userChannel } from "./bus.js";
import type { SocketIdentity } from "./auth.js";

const SWEEP_MS = 30_000;
const SESSION_RECHECK_MS = 5 * 60_000;
/** One dashboard, a phone, a few stale tabs. Past this someone is looping. */
const MAX_SOCKETS_PER_USER = 8;
/** Skip a send once the peer is this far behind. */
const BACKPRESSURE_SKIP_BYTES = 512 * 1024;
/** Hang up: the peer has stopped reading entirely. */
const BACKPRESSURE_DROP_BYTES = 4 * 1024 * 1024;

const OPEN = 1;

interface SocketState {
  identity: SocketIdentity;
  /** Cleared on every pong; a sweep that finds it false terminates. */
  alive: boolean;
  lastSessionCheck: number;
  /** A recheck is in flight; do not start a second one behind it. */
  checking: boolean;
  unsubscribe: () => void;
}

const sockets = new Map<WebSocket, SocketState>();
let sweeper: ReturnType<typeof setInterval> | null = null;

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState !== OPEN) return;
  if (ws.bufferedAmount > BACKPRESSURE_DROP_BYTES) {
    ws.terminate();
    return;
  }
  // Dropping is safe: a reconnect re-syncs everything the client missed.
  if (ws.bufferedAmount > BACKPRESSURE_SKIP_BYTES) return;
  ws.send(JSON.stringify(message));
}

function cleanup(ws: WebSocket): void {
  const state = sockets.get(ws);
  if (!state) return;
  state.unsubscribe();
  sockets.delete(ws);
  if (sockets.size === 0 && sweeper !== null) {
    clearInterval(sweeper);
    sweeper = null;
  }
}

function enforceConnectionCap(userId: string): void {
  // Map iteration is insertion-ordered, so the first match is the oldest.
  const mine = [...sockets.entries()].filter(([, state]) => state.identity.userId === userId);
  for (const [ws] of mine.slice(0, Math.max(0, mine.length - MAX_SOCKETS_PER_USER))) {
    ws.close(REALTIME_CLOSE.REPLACED, "too many connections");
  }
}

function sweep(): void {
  const now = Date.now();
  for (const [ws, state] of sockets) {
    if (!state.alive) {
      ws.terminate();
      cleanup(ws);
      continue;
    }
    state.alive = false;
    ws.ping();
    send(ws, { type: "ping" });

    if (!state.checking && now - state.lastSessionCheck >= SESSION_RECHECK_MS) {
      state.checking = true;
      void sessionOwnerRole(state.identity.sessionId)
        .then((role) => {
          if (role === null) {
            ws.close(REALTIME_CLOSE.UNAUTHORIZED, "session ended");
            return;
          }
          // Channels are chosen once, at connect time, so a change of role can
          // only be applied by ending the connection: the client reconnects and
          // subscribes as whoever it is now.
          if ((role === "admin") !== state.identity.isAdmin) {
            ws.close(REALTIME_CLOSE.STALE_IDENTITY, "role changed");
            return;
          }
          // Advanced only on a definite answer, so a failed check really is
          // retried by the next sweep rather than deferred another interval.
          state.lastSessionCheck = Date.now();
        })
        .catch((error: unknown) => {
          // A database blip must not disconnect everyone.
          console.error("realtime session recheck failed:", error);
        })
        .finally(() => {
          state.checking = false;
        });
    }
  }
}

function ensureSweeper(): void {
  if (sweeper !== null) return;
  sweeper = setInterval(sweep, SWEEP_MS);
  sweeper.unref?.();
}

/** Takes over a freshly upgraded socket for the rest of its life. */
export function registerSocket(ws: WebSocket, identity: SocketIdentity): void {
  const channels = identity.isAdmin
    ? [userChannel(identity.userId), ADMIN_CHANNEL]
    : [userChannel(identity.userId)];

  const unsubscribe = subscribe(channels, (message) => send(ws, message));
  sockets.set(ws, {
    identity,
    alive: true,
    lastSessionCheck: Date.now(),
    checking: false,
    unsubscribe,
  });

  ws.on("pong", () => {
    const state = sockets.get(ws);
    if (state) state.alive = true;
  });
  // The client has nothing to say yet. Reading and discarding is deliberate:
  // `maxPayload` on the server already caps what can arrive.
  ws.on("message", () => {});
  ws.on("close", () => cleanup(ws));
  ws.on("error", () => {
    cleanup(ws);
    ws.terminate();
  });

  enforceConnectionCap(identity.userId);
  ensureSweeper();
}

/**
 * Runs one sweep immediately.
 *
 * A test seam: the revocation paths below are on a five-minute timer inside a
 * thirty-second one, and they are exactly the paths worth pinning.
 */
export function sweepNow(): void {
  sweep();
}

/** Test seam, and the shutdown path. */
export function closeAllSockets(): void {
  for (const [ws] of sockets) {
    cleanup(ws);
    ws.close(1001, "server shutting down");
  }
}

export function connectionCount(): number {
  return sockets.size;
}
