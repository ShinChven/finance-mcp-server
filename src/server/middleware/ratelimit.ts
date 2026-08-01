import type { MiddlewareHandler } from "hono";
import { clientIp } from "../lib/http.js";

/**
 * Small fixed-window in-memory rate limiter, keyed by client IP. Suited to the
 * single-container deployment this app targets.
 */
export function rateLimit(options: { windowMs: number; max: number }): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async (c, next) => {
    const now = Date.now();
    if (hits.size > 10_000) {
      for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    }
    const key = clientIp(c) ?? "local";
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
    } else if (++entry.count > options.max) {
      return c.json({ error: "rate_limited" }, 429, {
        "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)),
      });
    }
    await next();
  };
}
