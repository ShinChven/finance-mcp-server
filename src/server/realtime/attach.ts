/**
 * Bolts the realtime endpoint onto whichever HTTP server is running.
 *
 * Deliberately not a Hono route. An upgrade is not a fetch: it never produces a
 * `Response`, and routing it through the fetch adapter would only hand back a
 * wrapper around the socket we want direct access to anyway -- `ping`,
 * `terminate` and `bufferedAmount` are the entire liveness and backpressure
 * story in `socket.ts`. Attaching to the Node server directly also means dev
 * and production share one code path, which matters because they get there very
 * differently: production owns its server, while in dev the socket has to live
 * on the server Vite already created for HMR.
 */

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { REALTIME_CLOSE, REALTIME_PATH } from "../../shared/realtime.js";
import { authenticateSession, isAllowedUpgradeOrigin } from "./auth.js";
import { registerSocket } from "./socket.js";

export interface AttachOptions {
  /**
   * Close upgrade attempts to other paths instead of leaving them for another
   * listener. True when this server owns every upgrade (production), false
   * under Vite, whose HMR socket is the other listener.
   */
  rejectUnmatched?: boolean;
}

function refuse(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function pathOf(url: string | undefined): string | null {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return null;
  }
}

export function attachRealtime(server: Server, options: AttachOptions = {}): () => void {
  const { rejectUnmatched = true } = options;
  const wss = new WebSocketServer({
    noServer: true,
    // Nothing is expected inbound, so anything large is a bug or an attack.
    maxPayload: 4 * 1024,
    // Off on purpose: `ws` warns that Node's zlib fragments memory badly under
    // concurrency, and these messages are a few dozen bytes each.
    perMessageDeflate: false,
  });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (pathOf(req.url) !== REALTIME_PATH) {
      if (rejectUnmatched) refuse(socket, "404 Not Found");
      return;
    }

    // A foreign origin never gets a handshake at all: this check is the whole
    // CSRF defence for a cookie-authenticated socket, and WebSockets are exempt
    // from the same-origin policy that would otherwise do the job.
    if (!isAllowedUpgradeOrigin(req.headers.origin, req.headers.host)) {
      refuse(socket, "403 Forbidden");
      return;
    }

    void authenticateSession(req)
      .then((identity) => {
        // A same-origin caller whose session has ended does get a handshake,
        // then an immediate close carrying the reason. An HTTP 401 here would
        // reach the browser as an opaque 1006, indistinguishable from a network
        // blip -- and the tab would reconnect against a logged-out server
        // forever instead of sending the user to log in.
        wss.handleUpgrade(req, socket, head, (ws) => {
          if (identity) registerSocket(ws, identity);
          else ws.close(REALTIME_CLOSE.UNAUTHORIZED, "session ended");
        });
      })
      .catch((error: unknown) => {
        console.error("realtime upgrade failed:", error);
        refuse(socket, "500 Internal Server Error");
      });
  };

  server.on("upgrade", onUpgrade);

  return () => {
    server.off("upgrade", onUpgrade);
    wss.close();
  };
}
