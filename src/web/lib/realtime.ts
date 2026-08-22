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
 * - **Two timers, because a socket fails in two different ways.** A handshake
 *   that stalls -- accepted at the TCP level, never upgraded -- fires neither
 *   `error` nor `close`, so `CONNECTING` needs its own deadline or the tab waits
 *   forever. An established socket whose connection dies silently looks exactly
 *   like an idle one, because protocol pongs are invisible to JavaScript; the
 *   server's application-level `ping` is what the watchdog resets.
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
/** A handshake that has not completed by now is not going to. */
const CONNECT_TIMEOUT_MS = 10_000;
/** The attempt count whose backoff window is already the maximum. */
const SLOW_ATTEMPT = Math.ceil(Math.log2(MAX_DELAY_MS / BASE_DELAY_MS));

function defaultUrl(): string {
  const url = new URL(REALTIME_PATH, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export class RealtimeConnection {
  private socket: WebSocket | null = null;
  private status: RealtimeStatus = "offline";
  private attempt = 0;
  private openedAt = 0;
  /** Distinguishes the first connect from a reconnect, which must re-sync. */
  private connectedBefore = false;
  /** Terminal: the session this connection belonged to is over. */
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeBound = false;

  private readonly messageHandlers = new Set<(message: ServerMessage) => void>();
  private readonly statusHandlers = new Set<(status: RealtimeStatus) => void>();
  private readonly resyncHandlers = new Set<() => void>();

  /** The URL is injectable so tests can point at a local server. */
  constructor(private readonly url: () => string = defaultUrl) {}

  get currentStatus(): RealtimeStatus {
    return this.status;
  }

  /**
   * Starts the connection on the first subscriber and keeps it for the life of
   * the tab. Unsubscribing does not close it: the shell mounts once per session
   * and React would otherwise tear the socket down and rebuild it on every
   * StrictMode remount. Ending it is `close`, which logging out calls.
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

  /**
   * Ends the connection for good.
   *
   * Logging out has to do this explicitly. The server would notice on its next
   * session recheck, but that is minutes away, and until then a signed-out tab
   * holds an authenticated socket open.
   */
  close(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.detach(socket);
      socket.close(1000, "signed out");
    }
    this.setStatus("offline");
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of this.statusHandlers) handler(status);
  }

  private detach(socket: WebSocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  /**
   * Gives up on a socket that is not going to report its own failure.
   *
   * Handlers come off first: the `close` we then ask for may be delivered long
   * after the replacement connection exists, and a late `onclose` from a dead
   * socket must not null out the live one.
   */
  private abandon(socket: WebSocket): void {
    this.detach(socket);
    socket.close();
    if (this.socket !== socket) return;
    this.socket = null;
    this.clearTimers();
    this.setStatus("offline");
    this.scheduleReconnect();
  }

  private connect(): void {
    if (this.socket !== null || this.stopped || this.status === "unauthorized") return;
    this.clearTimers();
    this.setStatus("connecting");
    this.openedAt = 0;

    const socket = new WebSocket(this.url());
    this.socket = socket;

    // A stalled handshake reports nothing at all -- not an error, not a close --
    // so this deadline is the only thing that ends it.
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (socket.readyState !== WebSocket.OPEN) this.abandon(socket);
    }, CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      this.clearConnectTimer();
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
      this.clearTimers();

      if (event.code === REALTIME_CLOSE.UNAUTHORIZED) {
        this.setStatus("unauthorized");
        return;
      }
      if (this.openedAt > 0 && Date.now() - this.openedAt > STABLE_MS) this.attempt = 0;
      if (event.code === REALTIME_CLOSE.REPLACED) {
        // The connection cap evicted this tab. Coming straight back would evict
        // a live one, which would come back and evict this one: wait it out.
        this.attempt = Math.max(this.attempt, SLOW_ATTEMPT);
      }
      this.setStatus("offline");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
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

  private clearTimers(): void {
    this.clearReconnect();
    this.clearWatchdog();
    this.clearConnectTimer();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer === null) return;
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      // Silence past the server's keepalive interval: the socket is wedged, not
      // idle. Abandoning turns that into an ordinary reconnect, without waiting
      // on a close handshake the peer may never answer.
      if (this.socket) this.abandon(this.socket);
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
      if (this.socket !== null || this.stopped || this.status === "unauthorized") return;
      this.attempt = 0;
      this.connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
  }
}

export const realtime = new RealtimeConnection();
