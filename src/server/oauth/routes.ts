import { Hono } from "hono";
import type { Context } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/index.js";
import {
  oauthAuthCodes,
  oauthClients,
  oauthGrants,
  oauthTokens,
  type OAuthClient,
  type User,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { newId, randomToken, sha256Hex, verifyPkceS256 } from "../lib/crypto.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { csrfProtect } from "../middleware/csrf.js";
import { rateLimit } from "../middleware/ratelimit.js";
import { loadSession } from "../middleware/session.js";
import { issueTokenPair } from "./issue.js";
import { SUPPORTED_SCOPES } from "./metadata.js";
import { consentPage, oauthErrorPage } from "./pages.js";
import { validRedirectUri } from "./redirect.js";
import { classifyRefreshUse } from "./rotation.js";
import { narrowScope } from "./scope.js";

const AUTH_CODE_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Dynamic Client Registration (RFC 7591)
// ---------------------------------------------------------------------------

const registerSchema = z.looseObject({
  client_name: z.string().trim().min(1).max(200).optional(),
  redirect_uris: z.array(z.string().min(1).max(2000)).min(1).max(10),
  logo_uri: z.url().max(2000).optional(),
  client_uri: z.url().max(2000).optional(),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().max(200).optional(),
});


// ---------------------------------------------------------------------------
// Authorization endpoint helpers
// ---------------------------------------------------------------------------

type AuthorizeParams = {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  resource: string;
};

function readAuthorizeParams(source: Record<string, string | undefined>): AuthorizeParams {
  return {
    client_id: source.client_id ?? "",
    redirect_uri: source.redirect_uri ?? "",
    response_type: source.response_type ?? "",
    state: source.state ?? "",
    code_challenge: source.code_challenge ?? "",
    code_challenge_method: source.code_challenge_method ?? "",
    scope: source.scope?.trim() || "mcp",
    resource: source.resource ?? "",
  };
}

function redirectWithError(c: Context, params: AuthorizeParams, error: string, description: string) {
  const url = new URL(params.redirect_uri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (params.state) url.searchParams.set("state", params.state);
  return c.redirect(url.toString());
}

/**
 * Validates client_id + redirect_uri (must never redirect on failure), then the
 * remaining params (failures redirect back to the client per RFC 6749 §4.1.2.1).
 */
async function validateAuthorizeRequest(
  c: Context,
  params: AuthorizeParams,
): Promise<{ client: OAuthClient } | { response: Response }> {
  const rows = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, params.client_id))
    .limit(1);
  const client = rows[0];
  if (!client) {
    return { response: c.html(oauthErrorPage("Unknown client", "The client_id is not registered."), 400) };
  }
  if (!client.redirectUris.includes(params.redirect_uri)) {
    return {
      response: c.html(
        oauthErrorPage("Invalid redirect URI", "The redirect_uri does not match the client registration."),
        400,
      ),
    };
  }
  if (client.status !== "active") {
    return {
      response: c.html(oauthErrorPage("Client disabled", "This client has been disabled by an administrator."), 403),
    };
  }
  if (params.response_type !== "code") {
    return { response: redirectWithError(c, params, "unsupported_response_type", "only response_type=code is supported") };
  }
  if (!params.code_challenge || params.code_challenge_method !== "S256") {
    return { response: redirectWithError(c, params, "invalid_request", "PKCE with S256 is required") };
  }
  const granted = narrowScope(params.scope);
  if (granted === null) {
    return { response: redirectWithError(c, params, "invalid_scope", "unsupported scope requested") };
  }
  // Everything downstream -- the consent screen, the stored grant, the token
  // response -- reads the narrowed scope, so what the user approves and what the
  // client is told it received are the same string.
  params.scope = granted;
  const resource = params.resource.replace(/\/+$/, "");
  if (resource && resource !== config.APP_URL && resource !== `${config.APP_URL}/mcp`) {
    return { response: redirectWithError(c, params, "invalid_target", "unknown resource") };
  }
  return { client };
}

async function ensureGrant(userId: string, clientId: string, scope: string) {
  const [grant] = await db
    .insert(oauthGrants)
    .values({ userId, clientId, scope })
    .onConflictDoUpdate({
      target: [oauthGrants.userId, oauthGrants.clientId],
      set: { scope, status: "active" },
    })
    .returning();
  return grant!;
}

async function issueCodeAndRedirect(c: Context, user: User, client: OAuthClient, params: AuthorizeParams) {
  const grant = await ensureGrant(user.id, client.clientId, params.scope);
  const code = randomToken(32);
  await db.insert(oauthAuthCodes).values({
    codeHash: sha256Hex(code),
    clientId: client.clientId,
    userId: user.id,
    grantId: grant.id,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    scope: params.scope,
    resource: params.resource || null,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
  });
  const url = new URL(params.redirect_uri);
  url.searchParams.set("code", code);
  if (params.state) url.searchParams.set("state", params.state);
  return c.redirect(url.toString());
}

// ---------------------------------------------------------------------------
// Token endpoint helpers
// ---------------------------------------------------------------------------

function tokenError(c: Context, error: string, description: string, status: 400 | 401 = 400) {
  return c.json({ error, error_description: description }, status, { "Cache-Control": "no-store" });
}

async function revokeFamily(familyId: string): Promise<void> {
  await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.familyId, familyId), isNull(oauthTokens.revokedAt)));
}

async function revokeGrantTokens(grantId: string): Promise<void> {
  await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.grantId, grantId), isNull(oauthTokens.revokedAt)));
}

/**
 * A code presented twice (RFC 6749 §4.1.2): the first exchange may have been an
 * attacker's, so the tokens it produced are revoked rather than left running.
 */
async function rejectCodeReplay(
  c: Context,
  row: { grantId: string; userId: string; clientId: string; issuedFamilyId: string | null },
) {
  if (row.issuedFamilyId) await revokeFamily(row.issuedFamilyId);
  else await revokeGrantTokens(row.grantId);
  await audit({
    actorUserId: row.userId,
    action: "oauth.code_replay",
    targetType: "oauth_client",
    targetId: row.clientId,
    ip: clientIp(c),
  });
  return tokenError(c, "invalid_grant", "authorization code already used");
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const oauthRoutes = new Hono<AppEnv>()

  .post("/register", rateLimit({ windowMs: 60_000, max: 10 }), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return tokenError(c, "invalid_client_metadata", "request body must be JSON");
    }
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return tokenError(c, "invalid_client_metadata", parsed.error.issues[0]?.message ?? "invalid metadata");
    }
    const meta = parsed.data;
    const invalidUri = meta.redirect_uris.find((uri) => !validRedirectUri(uri));
    if (invalidUri) {
      return tokenError(c, "invalid_redirect_uri", `redirect_uri not allowed: ${invalidUri}`);
    }

    const clientId = newId();
    const clientName = meta.client_name ?? "Unnamed MCP client";
    await db.insert(oauthClients).values({
      clientId,
      clientName,
      redirectUris: meta.redirect_uris,
      logoUri: meta.logo_uri,
      clientUri: meta.client_uri,
      tokenEndpointAuthMethod: "none",
    });
    await audit({
      action: "oauth.client_register",
      targetType: "oauth_client",
      targetId: clientId,
      meta: { name: clientName, redirectUris: meta.redirect_uris },
      ip: clientIp(c),
    });
    return c.json(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: clientName,
        redirect_uris: meta.redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: SUPPORTED_SCOPES.join(" "),
      },
      201,
    );
  })

  .get("/authorize", async (c) => {
    const params = readAuthorizeParams(Object.fromEntries(new URL(c.req.url).searchParams));
    const validated = await validateAuthorizeRequest(c, params);
    if ("response" in validated) return validated.response;

    const resolved = await loadSession(c);
    if (!resolved) {
      const next = `/oauth/authorize?${new URL(c.req.url).searchParams.toString()}`;
      return c.redirect(`/login?next=${encodeURIComponent(next)}`);
    }

    // Skip consent when an active grant already covers the requested scope.
    const [existing] = await db
      .select()
      .from(oauthGrants)
      .where(
        and(eq(oauthGrants.userId, resolved.user.id), eq(oauthGrants.clientId, validated.client.clientId)),
      )
      .limit(1);
    if (existing?.status === "active" && existing.scope === params.scope) {
      return issueCodeAndRedirect(c, resolved.user, validated.client, params);
    }

    return c.html(
      consentPage({
        clientName: validated.client.clientName,
        userEmail: resolved.user.email,
        scope: params.scope,
        fields: { ...params },
      }),
    );
  })

  .post("/authorize/decision", csrfProtect, async (c) => {
    const form = await c.req.parseBody();
    const fields = Object.fromEntries(
      Object.entries(form).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    const params = readAuthorizeParams(fields);
    const validated = await validateAuthorizeRequest(c, params);
    if ("response" in validated) return validated.response;

    const resolved = await loadSession(c);
    if (!resolved) return c.html(oauthErrorPage("Session expired", "Please sign in and try again."), 401);

    if (fields.decision !== "approve") {
      await audit({
        actorUserId: resolved.user.id,
        action: "oauth.consent_denied",
        targetType: "oauth_client",
        targetId: validated.client.clientId,
        ip: clientIp(c),
      });
      return redirectWithError(c, params, "access_denied", "the user denied the request");
    }
    await audit({
      actorUserId: resolved.user.id,
      action: "oauth.consent_granted",
      targetType: "oauth_client",
      targetId: validated.client.clientId,
      meta: { scope: params.scope },
      ip: clientIp(c),
    });
    return issueCodeAndRedirect(c, resolved.user, validated.client, params);
  })

  .post("/token", rateLimit({ windowMs: 60_000, max: 60 }), async (c) => {
    const form = await c.req.parseBody();
    const get = (key: string): string => (typeof form[key] === "string" ? (form[key] as string) : "");
    const grantType = get("grant_type");

    if (grantType === "authorization_code") {
      const code = get("code");
      const verifier = get("code_verifier");
      const clientId = get("client_id");
      const redirectUri = get("redirect_uri");
      if (!code || !verifier || !clientId || !redirectUri) {
        return tokenError(c, "invalid_request", "code, code_verifier, client_id and redirect_uri are required");
      }
      const [row] = await db
        .select()
        .from(oauthAuthCodes)
        .where(eq(oauthAuthCodes.codeHash, sha256Hex(code)))
        .limit(1);
      if (!row) return tokenError(c, "invalid_grant", "unknown authorization code");
      if (row.consumedAt) return rejectCodeReplay(c, row);
      if (row.expiresAt.getTime() < Date.now()) return tokenError(c, "invalid_grant", "authorization code expired");
      if (row.clientId !== clientId) return tokenError(c, "invalid_grant", "client mismatch");
      if (row.redirectUri !== redirectUri) return tokenError(c, "invalid_grant", "redirect_uri mismatch");
      if (!verifyPkceS256(verifier, row.codeChallenge)) {
        return tokenError(c, "invalid_grant", "PKCE verification failed");
      }
      const [grant] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, row.grantId)).limit(1);
      if (!grant || grant.status !== "active") return tokenError(c, "invalid_grant", "authorization no longer valid");

      const familyId = newId();
      // Conditional, and the returned row is the proof it was this request that
      // consumed the code: two exchanges racing here would otherwise both pass
      // the `consumedAt` check above and both be issued tokens.
      const [claimed] = await db
        .update(oauthAuthCodes)
        .set({ consumedAt: new Date(), issuedFamilyId: familyId })
        .where(and(eq(oauthAuthCodes.codeHash, row.codeHash), isNull(oauthAuthCodes.consumedAt)))
        .returning();
      if (!claimed) return rejectCodeReplay(c, { ...row, issuedFamilyId: null });
      const tokens = await issueTokenPair(grant, familyId);
      return c.json(tokens, 200, { "Cache-Control": "no-store", Pragma: "no-cache" });
    }

    if (grantType === "refresh_token") {
      const refreshToken = get("refresh_token");
      const clientId = get("client_id");
      if (!refreshToken || !clientId) {
        return tokenError(c, "invalid_request", "refresh_token and client_id are required");
      }
      const rows = await db
        .select({ token: oauthTokens, grant: oauthGrants })
        .from(oauthTokens)
        .innerJoin(oauthGrants, eq(oauthTokens.grantId, oauthGrants.id))
        .where(and(eq(oauthTokens.tokenHash, sha256Hex(refreshToken)), eq(oauthTokens.kind, "refresh")))
        .limit(1);
      const row = rows[0];
      if (!row) return tokenError(c, "invalid_grant", "unknown refresh token");
      if (row.token.expiresAt.getTime() < Date.now()) return tokenError(c, "invalid_grant", "refresh token expired");
      if (row.grant.clientId !== clientId) return tokenError(c, "invalid_grant", "client mismatch");
      if (row.grant.status !== "active") return tokenError(c, "invalid_grant", "authorization no longer valid");

      const rejectReuse = async () => {
        await revokeFamily(row.token.familyId);
        await audit({
          actorUserId: row.grant.userId,
          action: "oauth.refresh_reuse",
          targetType: "oauth_grant",
          targetId: row.grant.id,
          meta: { familyId: row.token.familyId },
          ip: clientIp(c),
        });
        return tokenError(c, "invalid_grant", "refresh token reuse detected");
      };

      // See `rotation.ts`: a token rotated seconds ago is a retried exchange, not
      // a stolen credential, and gets a fresh pair instead of killing the family.
      if (classifyRefreshUse(row.token) === "reuse") return rejectReuse();
      if (!row.token.revokedAt) {
        const now = new Date();
        const [rotated] = await db
          .update(oauthTokens)
          .set({ revokedAt: now, rotatedAt: now })
          .where(and(eq(oauthTokens.id, row.token.id), isNull(oauthTokens.revokedAt)))
          .returning();
        // Nothing updated means the row changed under us between the read and
        // the write: either a concurrent refresh (fine, both are the same client
        // asking twice) or a revocation that landed in between (not fine). The
        // re-read tells them apart, which a blind update never could.
        if (!rotated) {
          const [current] = await db
            .select()
            .from(oauthTokens)
            .where(eq(oauthTokens.id, row.token.id))
            .limit(1);
          if (!current || classifyRefreshUse(current) !== "replay") return rejectReuse();
        }
      }
      const tokens = await issueTokenPair(row.grant, row.token.familyId);
      return c.json(tokens, 200, { "Cache-Control": "no-store", Pragma: "no-cache" });
    }

    return tokenError(c, "unsupported_grant_type", "use authorization_code or refresh_token");
  })

  .post("/revoke", rateLimit({ windowMs: 60_000, max: 60 }), async (c) => {
    const form = await c.req.parseBody();
    const token = typeof form.token === "string" ? form.token : "";
    if (token) {
      const [row] = await db
        .select()
        .from(oauthTokens)
        .where(eq(oauthTokens.tokenHash, sha256Hex(token)))
        .limit(1);
      if (row && !row.revokedAt) {
        if (row.kind === "refresh") {
          await revokeFamily(row.familyId);
        } else {
          await db.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.id, row.id));
        }
      }
    }
    // RFC 7009: respond 200 whether or not the token was found.
    return c.json({});
  });
