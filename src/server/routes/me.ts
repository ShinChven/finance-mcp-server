import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { sessions, users, type User } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { requireAuth } from "../middleware/session.js";

export function userDto(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    preferences: user.preferences,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

const updateSchema = z.object({
  displayName: z.string().trim().max(80).nullable().optional(),
  preferences: z
    .object({
      theme: z.enum(["system", "light", "dark"]).optional(),
      pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).optional(),
    })
    .optional(),
});

export const meRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/", (c) => c.json(userDto(c.get("user"))))

  .patch("/", zValidator("json", updateSchema), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const [updated] = await db
      .update(users)
      .set({
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.preferences
          ? { preferences: { ...user.preferences, ...body.preferences } }
          : {}),
      })
      .where(eq(users.id, user.id))
      .returning();
    await audit({ actorUserId: user.id, action: "me.update", ip: clientIp(c) });
    return c.json(userDto(updated!));
  })

  .get("/sessions", async (c) => {
    const user = c.get("user");
    const current = c.get("session");
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(desc(sessions.createdAt));
    return c.json({
      items: rows.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        ip: s.ip,
        userAgent: s.userAgent,
        current: s.id === current.id,
      })),
    });
  })

  .delete("/sessions/:id", async (c) => {
    const user = c.get("user");
    await db
      .delete(sessions)
      .where(and(eq(sessions.id, c.req.param("id")), eq(sessions.userId, user.id)));
    await audit({ actorUserId: user.id, action: "me.session_revoke", ip: clientIp(c) });
    return c.json({ ok: true });
  });
