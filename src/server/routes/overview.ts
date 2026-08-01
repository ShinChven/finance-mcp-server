import { Hono } from "hono";
import { and, count, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { accessTokens, auditLog, oauthGrants } from "../db/schema.js";
import type { AppEnv } from "../lib/http.js";
import { requireAuth } from "../middleware/session.js";

export const overviewRoutes = new Hono<AppEnv>().use(requireAuth).get("/", async (c) => {
  const user = c.get("user");
  const now = new Date();
  const soon = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const notExpired = or(isNull(accessTokens.expiresAt), gt(accessTokens.expiresAt, now));
  const [activeTokens] = await db
    .select({ n: count() })
    .from(accessTokens)
    .where(and(eq(accessTokens.userId, user.id), eq(accessTokens.status, "active"), notExpired));
  const [expiringSoon] = await db
    .select({ n: count() })
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.userId, user.id),
        eq(accessTokens.status, "active"),
        gt(accessTokens.expiresAt, now),
        lt(accessTokens.expiresAt, soon),
      ),
    );
  const [activeGrants] = await db
    .select({ n: count() })
    .from(oauthGrants)
    .where(and(eq(oauthGrants.userId, user.id), eq(oauthGrants.status, "active")));

  const [lastAccess] = await db
    .select({
      last: sql<string | null>`greatest(
        (select max(${accessTokens.lastUsedAt}) from ${accessTokens} where ${accessTokens.userId} = ${user.id}),
        (select max(${oauthGrants.lastUsedAt}) from ${oauthGrants} where ${oauthGrants.userId} = ${user.id})
      )`,
    })
    .from(sql`(select 1) as one`);

  const recentActivity = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.actorUserId, user.id))
    .orderBy(desc(auditLog.createdAt))
    .limit(10);

  return c.json({
    activeTokens: activeTokens?.n ?? 0,
    expiringSoon: expiringSoon?.n ?? 0,
    activeGrants: activeGrants?.n ?? 0,
    lastMcpAccess: lastAccess?.last ?? null,
    recentActivity: recentActivity.map((entry) => ({
      id: entry.id,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      meta: entry.meta,
      createdAt: entry.createdAt,
    })),
  });
});
