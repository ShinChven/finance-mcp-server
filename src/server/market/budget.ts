/**
 * What one account may spend on price history.
 *
 * The list view costs one batched quote a minute however long the list is.
 * Charts do not work that way: each one is a request for a specific symbol,
 * behind a client queue two deep, and the only limiter this server had guards
 * `/auth` and is keyed by IP. An account clicking down a long list, or an agent
 * looping over one, is not abuse — it is just a shape the previous design never
 * had to survive.
 *
 * A token bucket rather than a fixed window, so a burst of a dozen while
 * reading is fine and a sustained loop is not. Per user rather than per IP:
 * the thing being rationed is upstream requests made on someone's behalf, and
 * an office behind one address should not share one allowance.
 */

/** Sustained rate, in requests per minute. */
export const SERIES_RATE_PER_MINUTE = 60;

/** How many may be spent at once before the sustained rate starts to bite. */
export const SERIES_BURST = 20;

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimiter {
  /** Spends a token, or reports how long until one is free. */
  take(key: string, now?: number): { ok: true } | { ok: false; retryAfterSeconds: number };
}

export function createTokenBucket(
  options: { ratePerMinute?: number; burst?: number } = {},
): RateLimiter {
  const rate = (options.ratePerMinute ?? SERIES_RATE_PER_MINUTE) / 60_000;
  const burst = options.burst ?? SERIES_BURST;
  const buckets = new Map<string, Bucket>();

  return {
    take(key, now = Date.now()) {
      // Idle accounts are dropped rather than accumulated: without this the map
      // is a slow leak keyed by every user who ever opened a chart.
      if (buckets.size > 5_000) {
        for (const [id, bucket] of buckets) {
          if (now - bucket.updatedAt > 600_000) buckets.delete(id);
        }
      }

      const bucket = buckets.get(key) ?? { tokens: burst, updatedAt: now };
      const refilled = Math.min(burst, bucket.tokens + (now - bucket.updatedAt) * rate);

      if (refilled < 1) {
        buckets.set(key, { tokens: refilled, updatedAt: now });
        return { ok: false, retryAfterSeconds: Math.ceil((1 - refilled) / rate / 1_000) };
      }

      buckets.set(key, { tokens: refilled - 1, updatedAt: now });
      return { ok: true };
    },
  };
}
