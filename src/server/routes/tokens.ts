import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { accessTokens, type AccessToken } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { generateSecret, PAT_PREFIX } from "../lib/crypto.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { escapeLike, listQuerySchema, listResponse, parseSort } from "../lib/listing.js";
import { requireAuth } from "../middleware/session.js";

function tokenDto(t: AccessToken) {
  return {
    id: t.id,
    name: t.name,
    tokenPrefix: t.tokenPrefix,
    status: t.status,
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt,
    lastUsedIp: t.lastUsedIp,
    createdAt: t.createdAt,
  };
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresAt: z.iso.datetime().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

const statusFilter = z.enum(["active", "disabled", "revoked"]);

async function ownedToken(userId: string, id: string): Promise<AccessToken | undefined> {
  const rows = await db
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.id, id), eq(accessTokens.userId, userId)))
    .limit(1);
  return rows[0];
}

export const tokenRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/", zValidator("query", listQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const user = c.get("user");
    const filters: SQL[] = [eq(accessTokens.userId, user.id)];
    if (query.q) filters.push(ilike(accessTokens.name, `%${escapeLike(query.q)}%`));
    const status = statusFilter.safeParse(query.status);
    if (status.success) filters.push(eq(accessTokens.status, status.data));

    const where = and(...filters);
    const order = parseSort(
      query.sort,
      {
        created_at: accessTokens.createdAt,
        name: accessTokens.name,
        last_used_at: accessTokens.lastUsedAt,
        expires_at: accessTokens.expiresAt,
      },
      desc(accessTokens.createdAt),
    );
    const [totalRow] = await db.select({ n: count() }).from(accessTokens).where(where);
    const rows = await db
      .select()
      .from(accessTokens)
      .where(where)
      .orderBy(order)
      .limit(query.per_page)
      .offset((query.page - 1) * query.per_page);
    return c.json(listResponse(rows.map(tokenDto), totalRow?.n ?? 0, query));
  })

  .post("/", zValidator("json", createSchema), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    if (body.expiresAt && new Date(body.expiresAt).getTime() <= Date.now()) {
      return c.json({ error: "expiration must be in the future" }, 400);
    }
    const secret = generateSecret(PAT_PREFIX);
    const [row] = await db
      .insert(accessTokens)
      .values({
        userId: user.id,
        name: body.name,
        tokenHash: secret.hash,
        tokenPrefix: secret.displayPrefix,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      })
      .returning();
    await audit({
      actorUserId: user.id,
      action: "token.create",
      targetType: "access_token",
      targetId: row!.id,
      meta: { name: body.name, expiresAt: body.expiresAt ?? null },
      ip: clientIp(c),
    });
    // The raw token is returned exactly once and never stored.
    return c.json({ token: secret.token, item: tokenDto(row!) }, 201);
  })

  .patch("/:id", zValidator("json", updateSchema), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const token = await ownedToken(user.id, c.req.param("id"));
    if (!token) return c.json({ error: "not found" }, 404);
    if (token.status === "revoked") return c.json({ error: "token is revoked" }, 409);
    const [updated] = await db
      .update(accessTokens)
      .set(body)
      .where(eq(accessTokens.id, token.id))
      .returning();
    await audit({
      actorUserId: user.id,
      action: "token.update",
      targetType: "access_token",
      targetId: token.id,
      meta: body,
      ip: clientIp(c),
    });
    return c.json(tokenDto(updated!));
  })

  .post("/:id/revoke", async (c) => {
    const user = c.get("user");
    const token = await ownedToken(user.id, c.req.param("id"));
    if (!token) return c.json({ error: "not found" }, 404);
    const [updated] = await db
      .update(accessTokens)
      .set({ status: "revoked" })
      .where(eq(accessTokens.id, token.id))
      .returning();
    await audit({
      actorUserId: user.id,
      action: "token.revoke",
      targetType: "access_token",
      targetId: token.id,
      ip: clientIp(c),
    });
    return c.json(tokenDto(updated!));
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const token = await ownedToken(user.id, c.req.param("id"));
    if (!token) return c.json({ error: "not found" }, 404);
    await db.delete(accessTokens).where(eq(accessTokens.id, token.id));
    await audit({
      actorUserId: user.id,
      action: "token.delete",
      targetType: "access_token",
      targetId: token.id,
      meta: { name: token.name },
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  });
