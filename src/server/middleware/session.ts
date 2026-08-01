import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
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

/** Resolves the session cookie to an active user, or null. */
export async function loadSession(
  c: Context,
): Promise<{ user: User; session: Session } | null> {
  const raw = await getSignedCookie(c, config.SESSION_SECRET, SESSION_COOKIE);
  if (!raw) return null;
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

  // Sliding renewal once the session is past half its lifetime.
  if (row.session.expiresAt.getTime() - Date.now() < SESSION_TTL_MS / 2) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, hash));
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
