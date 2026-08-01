import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { oauthClients, oauthGrants, oauthTokens } from "../db/schema.js";
import { generateSecret, newId, OAUTH_ACCESS_PREFIX, OAUTH_REFRESH_PREFIX } from "../lib/crypto.js";

export const ACCESS_TOKEN_TTL_S = 60 * 60;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;

export async function issueTokenPair(grant: { id: string; clientId: string; scope: string }, familyId?: string) {
  const access = generateSecret(OAUTH_ACCESS_PREFIX);
  const refresh = generateSecret(OAUTH_REFRESH_PREFIX);
  const family = familyId ?? newId();
  const now = Date.now();

  await db.insert(oauthTokens).values([
    {
      kind: "access",
      tokenHash: access.hash,
      grantId: grant.id,
      familyId: family,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_S * 1000),
    },
    {
      kind: "refresh",
      tokenHash: refresh.hash,
      grantId: grant.id,
      familyId: family,
      expiresAt: new Date(now + REFRESH_TOKEN_TTL_S * 1000),
    },
  ]);
  const lastUsedAt = new Date();
  await db.update(oauthGrants).set({ lastUsedAt }).where(eq(oauthGrants.id, grant.id));
  await db.update(oauthClients).set({ lastUsedAt }).where(eq(oauthClients.clientId, grant.clientId));

  return {
    access_token: access.token,
    token_type: "Bearer" as const,
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refresh.token,
    scope: grant.scope,
  };
}
