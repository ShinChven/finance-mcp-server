import type { MiddlewareHandler } from "hono";
import { selfOrigins } from "../lib/origin.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Origin-header CSRF check for cookie-authenticated routes. Falls back to
 * Referer when Origin is absent or "null" (WebKit sends "null" on a form POST
 * whose page load crossed origins mid-navigation, e.g. after the Google
 * login redirect chain lands back on the OAuth consent page) — same
 * fallback OWASP's Origin-verification guidance recommends.
 */
export const csrfProtect: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const allowed = selfOrigins(c.req.header("host"));

  const origin = c.req.header("origin");
  if (origin && origin !== "null") {
    if (!allowed.has(origin)) return c.json({ error: "cross-origin request rejected" }, 403);
    return next();
  }

  const referer = c.req.header("referer");
  const refererOrigin = referer ? originOf(referer) : null;
  if (!refererOrigin) return c.json({ error: "missing origin" }, 403);
  if (!allowed.has(refererOrigin)) return c.json({ error: "cross-origin request rejected" }, 403);
  await next();
};
