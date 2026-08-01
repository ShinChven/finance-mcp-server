import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { Google, decodeIdToken, generateCodeVerifier, generateState } from "arctic";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { csrfProtect } from "../middleware/csrf.js";
import { rateLimit } from "../middleware/ratelimit.js";
import { createSession, destroySession } from "../middleware/session.js";

const google = new Google(
  config.GOOGLE_CLIENT_ID,
  config.GOOGLE_CLIENT_SECRET,
  `${config.APP_URL}/auth/google/callback`,
);

const FLOW_COOKIE_OPTS = {
  path: "/",
  httpOnly: true,
  sameSite: "Lax" as const,
  secure: config.isProd,
  maxAge: 600,
};

/** Only allow same-app relative redirect targets. */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function loginRedirect(c: Parameters<typeof deleteCookie>[0], error: string) {
  return c.redirect(`/login?error=${encodeURIComponent(error)}`);
}

type GoogleClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export const authRoutes = new Hono<AppEnv>()
  .use(rateLimit({ windowMs: 60_000, max: 20 }))

  .get("/google", async (c) => {
    const state = generateState();
    const verifier = generateCodeVerifier();
    const next = safeNext(c.req.query("next"));
    await setSignedCookie(c, "g_state", state, config.SESSION_SECRET, FLOW_COOKIE_OPTS);
    await setSignedCookie(c, "g_verifier", verifier, config.SESSION_SECRET, FLOW_COOKIE_OPTS);
    await setSignedCookie(c, "g_next", next, config.SESSION_SECRET, FLOW_COOKIE_OPTS);
    const url = google.createAuthorizationURL(state, verifier, ["openid", "email", "profile"]);
    return c.redirect(url.toString());
  })

  .get("/google/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const storedState = await getSignedCookie(c, config.SESSION_SECRET, "g_state");
    const verifier = await getSignedCookie(c, config.SESSION_SECRET, "g_verifier");
    const next = safeNext((await getSignedCookie(c, config.SESSION_SECRET, "g_next")) || "/");
    for (const name of ["g_state", "g_verifier", "g_next"]) deleteCookie(c, name, { path: "/" });

    if (!code || !state || !storedState || !verifier || state !== storedState) {
      return loginRedirect(c, "oauth_failed");
    }

    let claims: GoogleClaims;
    try {
      const tokens = await google.validateAuthorizationCode(code, verifier);
      claims = decodeIdToken(tokens.idToken()) as GoogleClaims;
    } catch (err) {
      console.error("google token exchange failed:", err);
      return loginRedirect(c, "oauth_failed");
    }
    if (!claims.email || claims.email_verified === false) {
      return loginRedirect(c, "email_unverified");
    }
    const email = claims.email.toLowerCase();

    // Allowlist login: the user row must already exist (seeded admin or
    // admin-created). Match by linked Google account first, then by email.
    const bySub = await db.select().from(users).where(eq(users.googleSub, claims.sub)).limit(1);
    const user = bySub[0] ?? (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (!user) {
      await audit({ action: "user.login_denied", meta: { email }, ip: clientIp(c) });
      return loginRedirect(c, "not_invited");
    }
    if (user.status !== "active") return loginRedirect(c, "account_disabled");

    await db
      .update(users)
      .set({
        googleSub: claims.sub,
        name: claims.name ?? user.name,
        avatarUrl: claims.picture ?? user.avatarUrl,
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, user.id));
    await createSession(c, user.id);
    await audit({ actorUserId: user.id, action: "user.login", ip: clientIp(c) });
    return c.redirect(next);
  })

  .post("/logout", csrfProtect, async (c) => {
    await destroySession(c);
    return c.json({ ok: true });
  });
