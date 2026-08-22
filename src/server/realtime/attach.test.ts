/**
 * The upgrade path, end to end over a real socket.
 *
 * Worth an integration test rather than unit tests: the handshake is where the
 * origin check, the authentication result, the path match and the `ws` server
 * all meet, and every one of those is invisible to a test that stops at the
 * function boundary.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

vi.mock("./auth.js", () => ({
  isAllowedUpgradeOrigin: (origin: string | undefined) => origin === "http://dashboard.test",
  authenticateSession: (request: { headers: Record<string, string | undefined> }) =>
    Promise.resolve(
      request.headers.cookie === "sid=admin"
        ? { userId: "u1", sessionId: "s1", isAdmin: true }
        : request.headers.cookie === "sid=user"
          ? { userId: "u2", sessionId: "s2", isAdmin: false }
          : null,
    ),
}));
// `socket.ts` reaches for the database to re-check sessions on its slow timer.
vi.mock("../middleware/session.js", () => ({ sessionIsActive: () => Promise.resolve(true) }));

const { REALTIME_CLOSE, REALTIME_PATH } = await import("../../shared/realtime.js");
const { attachRealtime } = await import("./attach.js");
const { publishChange, publishJob, resetBus } = await import("./bus.js");
const { closeAllSockets } = await import("./socket.js");

let server: Server;
let detach: () => void;
let origin: string;
const clients: WebSocket[] = [];

function connect(cookie: string, path: string = REALTIME_PATH): WebSocket {
  const { port } = server.address() as AddressInfo;
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    headers: { origin, cookie },
  });
  clients.push(socket);
  return socket;
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

/** The next message that is not the keepalive. */
function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.on("message", (data: Buffer) => {
      const parsed = JSON.parse(data.toString()) as { type: string };
      if (parsed.type !== "ping") resolve(parsed);
    });
  });
}

beforeEach(async () => {
  origin = "http://dashboard.test";
  server = createServer((_req, res) => res.end("ok"));
  detach = attachRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  closeAllSockets();
  resetBus();
  detach();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("realtime upgrade", () => {
  it("delivers a change published to the connected user's channel", async () => {
    const socket = connect("sid=user");
    await opened(socket);

    const message = nextMessage(socket);
    publishChange("u2", "notes", "created", ["note-1"]);

    await expect(message).resolves.toEqual({
      type: "change",
      topic: "notes",
      action: "created",
      ids: ["note-1"],
    });
  });

  it("does not deliver another user's changes", async () => {
    const socket = connect("sid=user");
    await opened(socket);

    const received: unknown[] = [];
    socket.on("message", (data: Buffer) => received.push(JSON.parse(data.toString())));
    publishChange("someone-else", "notes", "created", ["note-1"]);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(received).toHaveLength(0);
  });

  it("gives admins the fund-cache channel and ordinary users none of it", async () => {
    const admin = connect("sid=admin");
    const user = connect("sid=user");
    await Promise.all([opened(admin), opened(user)]);

    const adminSaw: unknown[] = [];
    const userSaw: unknown[] = [];
    admin.on("message", (data: Buffer) => adminSaw.push(JSON.parse(data.toString())));
    user.on("message", (data: Buffer) => userSaw.push(JSON.parse(data.toString())));

    publishJob(
      { id: "job-1", status: "running", processedFunds: 1, totalFunds: 9, skippedFresh: 0, error: null },
      "job-1",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(adminSaw).toHaveLength(1);
    expect(userSaw).toHaveLength(0);
  });

  it("refuses the handshake outright for a foreign origin", async () => {
    origin = "http://evil.test";
    const socket = connect("sid=user");

    await expect(opened(socket)).rejects.toThrow(/403/);
  });

  it("accepts an expired session's handshake, then closes with a readable code", async () => {
    // An HTTP 401 would reach the browser as an opaque 1006, indistinguishable
    // from a network blip, and the tab would retry forever instead of
    // redirecting to login.
    const socket = connect("sid=expired");
    const code = await new Promise<number>((resolve) => socket.once("close", resolve));

    expect(code).toBe(REALTIME_CLOSE.UNAUTHORIZED);
  });

  it("refuses an upgrade to any other path", async () => {
    const socket = connect("sid=user", "/api/something-else");

    await expect(opened(socket)).rejects.toThrow(/404/);
  });

  it("leaves ordinary HTTP requests alone", async () => {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);

    await expect(response.text()).resolves.toBe("ok");
  });
});
