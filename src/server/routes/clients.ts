import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq, ilike, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { oauthClients, oauthGrants, oauthTokens } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { escapeLike, listQuerySchema, listResponse, parseSort } from "../lib/listing.js";
import { requireAuth } from "../middleware/session.js";

const statusFilter = z.enum(["active", "disabled", "revoked"]);
const updateSchema = z.object({ status: z.enum(["active", "disabled"]) });

type GrantRow = {
  grant: typeof oauthGrants.$inferSelect;
  client: typeof oauthClients.$inferSelect;
};

function grantDto({ grant, client }: GrantRow) {
  return {
    id: grant.id,
    clientId: client.clientId,
    clientName: client.clientName,
    clientUri: client.clientUri,
    logoUri: client.logoUri,
    clientStatus: client.status,
    scope: grant.scope,
    status: grant.status,
    createdAt: grant.createdAt,
    lastUsedAt: grant.lastUsedAt,
  };
}

async function ownedGrant(userId: string, id: string): Promise<GrantRow | undefined> {
  const rows = await db
    .select({ grant: oauthGrants, client: oauthClients })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.clientId))
    .where(and(eq(oauthGrants.id, id), eq(oauthGrants.userId, userId)))
    .limit(1);
  return rows[0];
}

async function revokeGrantTokens(grantId: string): Promise<void> {
  await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.grantId, grantId), isNull(oauthTokens.revokedAt)));
}

export const clientRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/", zValidator("query", listQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const user = c.get("user");
    const filters: SQL[] = [eq(oauthGrants.userId, user.id)];
    if (query.q) filters.push(ilike(oauthClients.clientName, `%${escapeLike(query.q)}%`));
    const status = statusFilter.safeParse(query.status);
    if (status.success) filters.push(eq(oauthGrants.status, status.data));

    const where = and(...filters);
    const order = parseSort(
      query.sort,
      {
        created_at: oauthGrants.createdAt,
        last_used_at: oauthGrants.lastUsedAt,
        name: oauthClients.clientName,
      },
      desc(oauthGrants.createdAt),
    );
    const base = db
      .select({ grant: oauthGrants, client: oauthClients })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.clientId));
    const [totalRow] = await db
      .select({ n: count() })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.clientId))
      .where(where);
    const rows = await base
      .where(where)
      .orderBy(order)
      .limit(query.per_page)
      .offset((query.page - 1) * query.per_page);
    return c.json(listResponse(rows.map(grantDto), totalRow?.n ?? 0, query));
  })

  .patch("/:id", zValidator("json", updateSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    const row = await ownedGrant(user.id, c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);
    if (row.grant.status === "revoked") return c.json({ error: "authorization is revoked" }, 409);
    await db.update(oauthGrants).set({ status: body.status }).where(eq(oauthGrants.id, row.grant.id));
    await audit({
      actorUserId: user.id,
      action: "oauth.grant_update",
      targetType: "oauth_grant",
      targetId: row.grant.id,
      meta: { status: body.status, client: row.client.clientName },
      ip: clientIp(c),
    });
    return c.json(grantDto({ ...row, grant: { ...row.grant, status: body.status } }));
  })

  .post("/:id/revoke", async (c) => {
    const user = c.get("user");
    const row = await ownedGrant(user.id, c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);
    await db.update(oauthGrants).set({ status: "revoked" }).where(eq(oauthGrants.id, row.grant.id));
    await revokeGrantTokens(row.grant.id);
    await audit({
      actorUserId: user.id,
      action: "oauth.grant_revoke",
      targetType: "oauth_grant",
      targetId: row.grant.id,
      meta: { client: row.client.clientName },
      ip: clientIp(c),
    });
    return c.json(grantDto({ ...row, grant: { ...row.grant, status: "revoked" } }));
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const row = await ownedGrant(user.id, c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);
    // FK cascade removes this grant's oauth tokens with it.
    await db.delete(oauthGrants).where(eq(oauthGrants.id, row.grant.id));
    await audit({
      actorUserId: user.id,
      action: "oauth.grant_delete",
      targetType: "oauth_grant",
      targetId: row.grant.id,
      meta: { client: row.client.clientName },
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  });
