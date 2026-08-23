import type { Context, MiddlewareHandler } from "hono";
import { and, eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import {
  accessTokens,
  oauthClients,
  oauthGrants,
  oauthTokens,
  users,
} from "../db/schema.js";
import { OAUTH_ACCESS_PREFIX, PAT_PREFIX, sha256Hex } from "../lib/crypto.js";
import { clientIp, type AppEnv, type McpAuth } from "../lib/http.js";

const LAST_USED_THROTTLE_MS = 60_000;

function unauthorized(c: Context, description: string) {
  return c.json({ error: "unauthorized", error_description: description }, 401, {
    // The path-suffixed document, not the root one (RFC 9728 §3.1): the resource
    // being protected is `{APP_URL}/mcp`, and the root document describes
    // `{APP_URL}`. A client that checks the `resource` it gets back against the
    // URL it was calling rejects the mismatch and never starts the OAuth flow.
    "WWW-Authenticate": `Bearer resource_metadata="${config.APP_URL}/.well-known/oauth-protected-resource/mcp"`,
  });
}

function shouldTouch(lastUsedAt: Date | null): boolean {
  return !lastUsedAt || Date.now() - lastUsedAt.getTime() > LAST_USED_THROTTLE_MS;
}

async function resolvePat(c: Context, token: string): Promise<McpAuth | string> {
  const rows = await db
    .select({ token: accessTokens, user: users })
    .from(accessTokens)
    .innerJoin(users, eq(accessTokens.userId, users.id))
    .where(eq(accessTokens.tokenHash, sha256Hex(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return "unknown token";
  if (row.token.status !== "active") return `token is ${row.token.status}`;
  if (row.token.expiresAt && row.token.expiresAt.getTime() < Date.now()) return "token expired";
  if (row.user.status !== "active") return "user is disabled";

  if (shouldTouch(row.token.lastUsedAt)) {
    db.update(accessTokens)
      .set({ lastUsedAt: new Date(), lastUsedIp: clientIp(c) })
      .where(eq(accessTokens.id, row.token.id))
      .catch((err: unknown) => console.error("last_used update failed:", err));
  }
  return { user: row.user, method: "pat", sourceId: row.token.id, label: row.token.name };
}

async function resolveOAuthToken(c: Context, token: string): Promise<McpAuth | string> {
  const rows = await db
    .select({ token: oauthTokens, grant: oauthGrants, client: oauthClients, user: users })
    .from(oauthTokens)
    .innerJoin(oauthGrants, eq(oauthTokens.grantId, oauthGrants.id))
    .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.clientId))
    .innerJoin(users, eq(oauthGrants.userId, users.id))
    .where(and(eq(oauthTokens.tokenHash, sha256Hex(token)), eq(oauthTokens.kind, "access")))
    .limit(1);
  const row = rows[0];
  if (!row) return "unknown token";
  if (row.token.revokedAt) return "token revoked";
  if (row.token.expiresAt.getTime() < Date.now()) return "token expired";
  if (row.grant.status !== "active") return `authorization is ${row.grant.status}`;
  if (row.client.status !== "active") return "client is disabled";
  if (row.user.status !== "active") return "user is disabled";

  if (shouldTouch(row.token.lastUsedAt)) {
    const now = new Date();
    Promise.all([
      db.update(oauthTokens).set({ lastUsedAt: now }).where(eq(oauthTokens.id, row.token.id)),
      db.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, row.grant.id)),
      db
        .update(oauthClients)
        .set({ lastUsedAt: now })
        .where(eq(oauthClients.clientId, row.client.clientId)),
    ]).catch((err: unknown) => console.error("last_used update failed:", err));
  }
  return {
    user: row.user,
    method: "oauth",
    sourceId: row.grant.id,
    label: row.client.clientName,
    scope: row.grant.scope,
  };
}

/** Authenticates /mcp requests with either a personal access token or an OAuth 2.1 access token. */
export const mcpBearerAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return unauthorized(c, "missing bearer token");
  const token = header.slice("Bearer ".length).trim();

  let result: McpAuth | string;
  if (token.startsWith(OAUTH_ACCESS_PREFIX)) {
    result = await resolveOAuthToken(c, token);
  } else if (token.startsWith(PAT_PREFIX)) {
    result = await resolvePat(c, token);
  } else {
    result = "unrecognized token format";
  }

  if (typeof result === "string") return unauthorized(c, result);
  c.set("mcpAuth", result);
  await next();
};
