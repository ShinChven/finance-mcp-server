import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { parseSigned } from "hono/utils/cookie";
import { and, eq, gt } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { sessions, users, type Session, type User } from "../db/schema.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";
import { clientIp, type AppEnv } from "../lib/http.js";

export const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const cookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "Lax" as const,
  secure: config.isProd,
};

export async function createSession(c: Context, userId: string): Promise<void> {
  const raw = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: sha256Hex(raw),
    userId,
    expiresAt,
    ip: clientIp(c),
    userAgent: c.req.header("user-agent")?.slice(0, 300),
  });
  await setSignedCookie(c, SESSION_COOKIE, raw, config.SESSION_SECRET, {
    ...cookieOptions,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(c: Context): Promise<void> {
  const raw = await getSignedCookie(c, config.SESSION_SECRET, SESSION_COOKIE);
  if (raw) {
    await db.delete(sessions).where(eq(sessions.id, sha256Hex(raw)));
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export type ResolvedSession = { user: User; session: Session };

/** Resolves a raw session token to an active user, or null. */
export async function lookupSession(raw: string): Promise<ResolvedSession | null> {
  const hash = sha256Hex(raw);
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, hash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.user.status !== "active") return null;
  return row;
}

/**
 * The role this session still grants, or null if it grants nothing any more.
 *
 * For long-lived connections that authenticated once and then have no further
 * request to hang a check on. A socket opened a week ago must not outlive the
 * session that authorized it -- and because a socket picks its subscriptions
 * from the role it saw at connect time, a demoted admin must not keep them
 * either. Returning the role rather than a boolean is what lets the caller
 * notice that second case.
 */
export async function sessionOwnerRole(sessionId: string): Promise<User["role"] | null> {
  const rows = await db
    .select({ role: users.role })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, sessionId),
        gt(sessions.expiresAt, new Date()),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}

/**
 * Resolves a raw `Cookie` header, for callers that have no Hono context.
 *
 * The WebSocket upgrade is the only one: it arrives as a bare Node
 * `IncomingMessage`, long before any Hono routing. Deliberately does not renew
 * the session — a long-lived socket must not be able to keep a session alive
 * indefinitely without the user ever loading a page.
 */
export async function loadSessionFromCookieHeader(
  header: string | undefined,
): Promise<ResolvedSession | null> {
  if (!header) return null;
  const parsed = await parseSigned(header, config.SESSION_SECRET, SESSION_COOKIE);
  const raw = parsed[SESSION_COOKIE];
  if (typeof raw !== "string" || raw === "") return null;
  return lookupSession(raw);
}

/** Resolves the session cookie to an active user, or null. */
export async function loadSession(
  c: Context,
): Promise<ResolvedSession | null> {
  const raw = await getSignedCookie(c, config.SESSION_SECRET, SESSION_COOKIE);
  if (!raw) return null;
  const row = await lookupSession(raw);
  if (!row) return null;

  // Sliding renewal once the session is past half its lifetime.
  if (row.session.expiresAt.getTime() - Date.now() < SESSION_TTL_MS / 2) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, sha256Hex(raw)));
    await setSignedCookie(c, SESSION_COOKIE, raw, config.SESSION_SECRET, {
      ...cookieOptions,
      maxAge: SESSION_TTL_MS / 1000,
    });
  }
  return row;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const resolved = await loadSession(c);
  if (!resolved) return c.json({ error: "unauthorized" }, 401);
  c.set("user", resolved.user);
  c.set("session", resolved.session);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user")?.role !== "admin") return c.json({ error: "forbidden" }, 403);
  await next();
};
