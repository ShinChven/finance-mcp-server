/**
 * The dashboard's end of the realtime socket.
 *
 * One connection per tab, opened once and kept for the session. Everything here
 * is about surviving the way this dashboard is actually used: left open on a
 * second screen for days, on a machine that sleeps, behind a proxy that hangs up
 * on idle connections.
 *
 * - **Reconnect with jitter.** Exponential, capped, and randomised, so a server
 *   restart does not bring every open tab back in the same millisecond. The
 *   backoff resets only after a connection has held for a while, so a server
 *   that accepts and immediately drops does not get hammered.
 * - **Do not retry a rejection.** A socket closed for authentication will be
 *   closed again instantly; retrying it is a request flood against a logged-out
 *   server. That state is terminal and the shell redirects to login.
 * - **A watchdog, because the browser will not tell us.** Protocol pongs are
 *   invisible to JavaScript, so a socket whose TCP connection died silently
 *   looks exactly like an idle one. The server sends an application-level
 *   `ping`; going quiet for longer than that interval means dead, not idle.
 * - **Re-sync on reconnect, not replay.** Nothing here buffers or sequences
 *   events. Whatever was missed while disconnected is recovered by invalidating
 *   every query once on reconnect, which is why the protocol needs no ids,
 *   cursors or replay window.
 */

import {
  REALTIME_CLOSE,
  REALTIME_PATH,
  serverMessageSchema,
  type ServerMessage,
} from "../../shared/realtime.js";

export type RealtimeStatus = "connecting" | "open" | "offline" | "unauthorized";

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 15_000;
/** Held this long, a connection counts as healthy and the backoff resets. */
const STABLE_MS = 10_000;
/** The server pings every 30s; two missed in a row means the socket is wedged. */
const WATCHDOG_MS = 75_000;

function socketUrl(): string {
  const url = new URL(REALTIME_PATH, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

class RealtimeConnection {
  private socket: WebSocket | null = null;
  private status: RealtimeStatus = "offline";
  private attempt = 0;
  private openedAt = 0;
  /** Distinguishes the first connect from a reconnect, which must re-sync. */
  private connectedBefore = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeBound = false;

  private readonly messageHandlers = new Set<(message: ServerMessage) => void>();
  private readonly statusHandlers = new Set<(status: RealtimeStatus) => void>();
  private readonly resyncHandlers = new Set<() => void>();

  get currentStatus(): RealtimeStatus {
    return this.status;
  }

  /**
   * Starts the connection on the first subscriber and keeps it for the life of
   * the tab. Unsubscribing does not close it: the shell mounts once per session
   * and React would otherwise tear the socket down and rebuild it on every
   * StrictMode remount.
   */
  subscribe(handler: (message: ServerMessage) => void): () => void {
    this.messageHandlers.add(handler);
    this.bindWake();
    this.connect();
    return () => this.messageHandlers.delete(handler);
  }

  onStatus(handler: (status: RealtimeStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /** Fires after a reconnect, never after the first connect. */
  onResync(handler: () => void): () => void {
    this.resyncHandlers.add(handler);
    return () => this.resyncHandlers.delete(handler);
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of this.statusHandlers) handler(status);
  }

  private connect(): void {
    if (this.socket !== null || this.status === "unauthorized") return;
    this.clearReconnect();
    this.setStatus("connecting");
    this.openedAt = 0;

    const socket = new WebSocket(socketUrl());
    this.socket = socket;

    socket.onopen = () => {
      this.openedAt = Date.now();
      this.setStatus("open");
      this.armWatchdog();
      if (this.connectedBefore) {
        for (const handler of this.resyncHandlers) handler();
      }
      this.connectedBefore = true;
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      // Any traffic proves the socket is alive, including the keepalive.
      this.armWatchdog();
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data) as unknown;
      } catch {
        return;
      }
      const message = serverMessageSchema.safeParse(parsed);
      // Validated even though we wrote the server: this is the one input that
      // can arrive at any moment, and a malformed frame must not reach render.
      if (!message.success || message.data.type === "ping") return;
      for (const handler of this.messageHandlers) handler(message.data);
    };

    socket.onerror = () => socket.close();

    socket.onclose = (event: CloseEvent) => {
      this.socket = null;
      this.clearWatchdog();

      if (event.code === REALTIME_CLOSE.UNAUTHORIZED) {
        this.setStatus("unauthorized");
        return;
      }
      if (this.openedAt > 0 && Date.now() - this.openedAt > STABLE_MS) this.attempt = 0;
      this.setStatus("offline");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** this.attempt);
    this.attempt += 1;
    // Full jitter: anywhere in the window, not a fixed step off it.
    const delay = Math.max(250, Math.random() * ceiling);
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      // Silence past the server's keepalive interval: closing turns a wedged
      // socket into an ordinary reconnect.
      this.socket?.close();
    }, WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer === null) return;
    clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  /**
   * A machine coming back from sleep, or a network coming back, should not wait
   * out the remaining backoff. This is what makes an always-on display recover
   * the moment someone looks at it.
   */
  private bindWake(): void {
    if (this.wakeBound) return;
    this.wakeBound = true;
    const wake = (): void => {
      if (this.socket !== null || this.status === "unauthorized") return;
      this.attempt = 0;
      this.connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
  }
}

export const realtime = new RealtimeConnection();
