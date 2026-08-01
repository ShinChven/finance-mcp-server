import { and, isNotNull, lt, or } from "drizzle-orm";
import { db } from "./index.js";
import { oauthAuthCodes, oauthTokens, sessions } from "./schema.js";

const KEEP_DEAD_OAUTH_TOKENS_MS = 60 * 24 * 60 * 60 * 1000;

/** Removes rows that can never authenticate again. Runs at boot and hourly. */
export async function cleanupExpired(): Promise<void> {
  const now = new Date();
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db
    .delete(oauthAuthCodes)
    .where(or(lt(oauthAuthCodes.expiresAt, now), isNotNull(oauthAuthCodes.consumedAt)));
  // Expired/revoked oauth tokens are kept for a while so reuse detection and
  // "last used" history still work, then dropped.
  const cutoff = new Date(Date.now() - KEEP_DEAD_OAUTH_TOKENS_MS);
  await db
    .delete(oauthTokens)
    .where(
      or(
        lt(oauthTokens.expiresAt, cutoff),
        and(isNotNull(oauthTokens.revokedAt), lt(oauthTokens.revokedAt, cutoff)),
      ),
    );
}

export function scheduleCleanup(): void {
  const run = () =>
    cleanupExpired().catch((err: unknown) => console.error("cleanup failed:", err));
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}
