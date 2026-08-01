import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { auditLog, oauthClients, oauthGrants, sessions, users } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { escapeLike, listQuerySchema, listResponse, parseSort } from "../lib/listing.js";
import { requireAdmin, requireAuth } from "../middleware/session.js";
import { userDto } from "./me.js";

const createUserSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().max(120).optional(),
  role: z.enum(["admin", "user"]).default("user"),
});

const updateUserSchema = z.object({
  status: z.enum(["active", "disabled"]).optional(),
  role: z.enum(["admin", "user"]).optional(),
  name: z.string().trim().max(120).optional(),
});

const clientUpdateSchema = z.object({ status: z.enum(["active", "disabled"]) });

export const adminRoutes = new Hono<AppEnv>()
  .use(requireAuth, requireAdmin)

  .get("/users", zValidator("query", listQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const filters: SQL[] = [];
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      filters.push(or(ilike(users.email, like), ilike(users.name, like), ilike(users.displayName, like))!);
    }
    const status = z.enum(["active", "disabled"]).safeParse(query.status);
    if (status.success) filters.push(eq(users.status, status.data));
    const role = z.enum(["admin", "user"]).safeParse(query.role);
    if (role.success) filters.push(eq(users.role, role.data));

    const where = filters.length ? and(...filters) : undefined;
    const order = parseSort(
      query.sort,
      { created_at: users.createdAt, email: users.email, last_login_at: users.lastLoginAt },
      desc(users.createdAt),
    );
    const [totalRow] = await db.select({ n: count() }).from(users).where(where);
    const rows = await db
      .select()
      .from(users)
      .where(where)
      .orderBy(order)
      .limit(query.per_page)
      .offset((query.page - 1) * query.per_page);
    return c.json(listResponse(rows.map(userDto), totalRow?.n ?? 0, query));
  })

  .post("/users", zValidator("json", createUserSchema), async (c) => {
    const body = c.req.valid("json");
    const admin = c.get("user");
    const existing = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (existing.length > 0) return c.json({ error: "a user with this email already exists" }, 409);
    const [row] = await db
      .insert(users)
      .values({ email: body.email, name: body.name, role: body.role })
      .returning();
    await audit({
      actorUserId: admin.id,
      action: "user.create",
      targetType: "user",
      targetId: row!.id,
      meta: { email: body.email, role: body.role },
      ip: clientIp(c),
    });
    return c.json(userDto(row!), 201);
  })

  .patch("/users/:id", zValidator("json", updateUserSchema), async (c) => {
    const body = c.req.valid("json");
    const admin = c.get("user");
    const id = c.req.param("id");
    if (id === admin.id && (body.status === "disabled" || body.role === "user")) {
      return c.json({ error: "you cannot disable or demote your own account" }, 400);
    }
    const [updated] = await db.update(users).set(body).where(eq(users.id, id)).returning();
    if (!updated) return c.json({ error: "not found" }, 404);
    if (body.status === "disabled") {
      await db.delete(sessions).where(eq(sessions.userId, id));
    }
    await audit({
      actorUserId: admin.id,
      action: "user.update",
      targetType: "user",
      targetId: id,
      meta: body,
      ip: clientIp(c),
    });
    return c.json(userDto(updated));
  })

  .get("/clients", zValidator("query", listQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const filters: SQL[] = [];
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      filters.push(or(ilike(oauthClients.clientName, like), ilike(oauthClients.clientId, like))!);
    }
    const status = z.enum(["active", "disabled"]).safeParse(query.status);
    if (status.success) filters.push(eq(oauthClients.status, status.data));

    const where = filters.length ? and(...filters) : undefined;
    const order = parseSort(
      query.sort,
      {
        created_at: oauthClients.createdAt,
        last_used_at: oauthClients.lastUsedAt,
        name: oauthClients.clientName,
      },
      desc(oauthClients.createdAt),
    );
    const grantCounts = sql<number>`(select count(*) from ${oauthGrants} where ${oauthGrants.clientId} = ${oauthClients.clientId})`;
    const [totalRow] = await db.select({ n: count() }).from(oauthClients).where(where);
    const rows = await db
      .select({ client: oauthClients, grantCount: grantCounts })
      .from(oauthClients)
      .where(where)
      .orderBy(order)
      .limit(query.per_page)
      .offset((query.page - 1) * query.per_page);
    return c.json(
      listResponse(
        rows.map(({ client, grantCount }) => ({
          clientId: client.clientId,
          clientName: client.clientName,
          clientUri: client.clientUri,
          logoUri: client.logoUri,
          redirectUris: client.redirectUris,
          status: client.status,
          grantCount: Number(grantCount),
          createdAt: client.createdAt,
          lastUsedAt: client.lastUsedAt,
        })),
        totalRow?.n ?? 0,
        query,
      ),
    );
  })

  .patch("/clients/:id", zValidator("json", clientUpdateSchema), async (c) => {
    const body = c.req.valid("json");
    const admin = c.get("user");
    const id = c.req.param("id");
    const [updated] = await db
      .update(oauthClients)
      .set({ status: body.status })
      .where(eq(oauthClients.clientId, id))
      .returning();
    if (!updated) return c.json({ error: "not found" }, 404);
    await audit({
      actorUserId: admin.id,
      action: "oauth.client_update",
      targetType: "oauth_client",
      targetId: id,
      meta: { status: body.status },
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  })

  .delete("/clients/:id", async (c) => {
    const admin = c.get("user");
    const id = c.req.param("id");
    const existing = await db.select().from(oauthClients).where(eq(oauthClients.clientId, id)).limit(1);
    if (existing.length === 0) return c.json({ error: "not found" }, 404);
    // FK cascade removes grants, auth codes, and tokens for this client.
    await db.delete(oauthClients).where(eq(oauthClients.clientId, id));
    await audit({
      actorUserId: admin.id,
      action: "oauth.client_delete",
      targetType: "oauth_client",
      targetId: id,
      meta: { name: existing[0]!.clientName },
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  })

  .get("/audit", zValidator("query", listQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const filters: SQL[] = [];
    if (query.action) filters.push(eq(auditLog.action, query.action));
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      filters.push(
        or(ilike(auditLog.action, like), ilike(auditLog.targetId, like), ilike(users.email, like))!,
      );
    }
    const where = filters.length ? and(...filters) : undefined;
    const [totalRow] = await db
      .select({ n: count() })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorUserId, users.id))
      .where(where);
    const rows = await db
      .select({ entry: auditLog, actorEmail: users.email })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorUserId, users.id))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(query.per_page)
      .offset((query.page - 1) * query.per_page);
    return c.json(
      listResponse(
        rows.map(({ entry, actorEmail }) => ({
          id: entry.id,
          action: entry.action,
          actorEmail,
          targetType: entry.targetType,
          targetId: entry.targetId,
          meta: entry.meta,
          ip: entry.ip,
          createdAt: entry.createdAt,
        })),
        totalRow?.n ?? 0,
        query,
      ),
    );
  });
