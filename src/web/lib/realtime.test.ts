/**
 * The client, against real sockets.
 *
 * These run in Node with its global `WebSocket`, so the failure modes being
 * tested are the real ones rather than a hand-written fake: a handshake that
 * never completes, a server that hangs up, a close code that must not be
 * retried. The two DOM globals the class touches are stubbed because it binds
 * wake-up listeners; nothing else about the environment matters.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { REALTIME_CLOSE, type ServerMessage } from "../../shared/realtime.js";

vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
vi.stubGlobal("window", { addEventListener: () => {} });

const { RealtimeConnection } = await import("./realtime.js");

let server: Server;
let wss: WebSocketServer | null;
let url: string;
const connections: ServerSocket[] = [];
const clients: InstanceType<typeof RealtimeConnection>[] = [];
/** Raw TCP sockets, so a stalled handshake cannot hold `server.close()` open. */
const rawSockets: Socket[] = [];

/** A server that upgrades normally. */
function serveWebSocket(): void {
  wss = new WebSocketServer({ server });
  wss.on("connection", (socket) => connections.push(socket));
}

function client(): InstanceType<typeof RealtimeConnection> {
  const connection = new RealtimeConnection(() => url);
  clients.push(connection);
  return connection;
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeEach(async () => {
  wss = null;
  connections.length = 0;
  // No request handler and, until a test asks for one, no upgrade handler
  // either -- which is precisely the stalled-handshake case.
  server = createServer();
  rawSockets.length = 0;
  server.on("connection", (socket) => rawSockets.push(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/events`;
});

afterEach(async () => {
  // Real timers first: the awaits below are timer-driven, and a test that left
  // fake timers installed would hang the hook rather than fail.
  vi.useRealTimers();
  for (const connection of clients.splice(0)) connection.close();
  wss?.close();
  for (const socket of rawSockets.splice(0)) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("RealtimeConnection", () => {
  it("gives up on a handshake that never completes", async () => {
    // The regression this exists for: a server that accepts the TCP connection
    // and never upgrades fires neither `error` nor `close`, so without its own
    // deadline the socket sits in CONNECTING and the tab never retries.
    vi.useFakeTimers();
    const connection = client();
    const seen: string[] = [];
    connection.onStatus((status) => seen.push(status));
    connection.subscribe(() => {});

    expect(connection.currentStatus).toBe("connecting");
    // Just past the deadline, and before the reconnect it schedules fires.
    await vi.advanceTimersByTimeAsync(10_100);

    expect(connection.currentStatus).toBe("offline");
    expect(seen).toContain("offline");
  });

  it("retries after abandoning a stalled handshake", async () => {
    vi.useFakeTimers();
    const connection = client();
    const seen: string[] = [];
    connection.onStatus((status) => seen.push(status));
    connection.subscribe(() => {});

    // Long enough for the deadline and the reconnect it schedules.
    await vi.advanceTimersByTimeAsync(11_000);

    expect(seen).toEqual(["connecting", "offline", "connecting"]);
  });

  it("delivers a parsed change event to subscribers", async () => {
    serveWebSocket();
    const received: ServerMessage[] = [];
    const connection = client();
    connection.subscribe((message) => received.push(message));

    await waitFor(() => connections.length === 1);
    connections[0]?.send(
      JSON.stringify({ type: "change", topic: "notes", action: "created", ids: ["n1"] }),
    );

    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual({ type: "change", topic: "notes", action: "created", ids: ["n1"] });
  });

  it("swallows a malformed frame instead of passing it on", async () => {
    serveWebSocket();
    const received: ServerMessage[] = [];
    const connection = client();
    connection.subscribe((message) => received.push(message));

    await waitFor(() => connections.length === 1);
    connections[0]?.send("not json at all");
    connections[0]?.send(JSON.stringify({ type: "change", topic: "nonsense" }));
    connections[0]?.send(JSON.stringify({ type: "ping" }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(received).toHaveLength(0);
    expect(connection.currentStatus).toBe("open");
  });

  it("reconnects after the server drops it, and re-syncs only then", async () => {
    serveWebSocket();
    let resyncs = 0;
    const connection = client();
    connection.onResync(() => {
      resyncs += 1;
    });
    connection.subscribe(() => {});

    await waitFor(() => connections.length === 1);
    // The first connection is not a re-sync: the page just loaded its queries.
    expect(resyncs).toBe(0);

    connections[0]?.close();
    await waitFor(() => connections.length === 2);
    await waitFor(() => resyncs === 1);

    expect(connection.currentStatus).toBe("open");
  });

  it("stops for good on an authentication close, without retrying", async () => {
    serveWebSocket();
    const connection = client();
    connection.subscribe(() => {});

    await waitFor(() => connections.length === 1);
    connections[0]?.close(REALTIME_CLOSE.UNAUTHORIZED, "session ended");

    await waitFor(() => connection.currentStatus === "unauthorized");
    // Retrying against a logged-out server is a request flood, so nothing
    // should come back however long we wait.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(connections).toHaveLength(1);
  });

  it("does not reconnect after close(), which is what logging out calls", async () => {
    serveWebSocket();
    const connection = client();
    connection.subscribe(() => {});

    await waitFor(() => connections.length === 1);
    connection.close();

    expect(connection.currentStatus).toBe("offline");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(connections).toHaveLength(1);
  });
});
