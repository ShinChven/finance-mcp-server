import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const PAT_PREFIX = "mcp_";
export const OAUTH_ACCESS_PREFIX = "mcpo_";
export const OAUTH_REFRESH_PREFIX = "mcpr_";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Generates an opaque secret with the given prefix. Only the SHA-256 hash is
 * ever persisted; `displayPrefix` is what list views may show.
 */
export function generateSecret(prefix: string): {
  token: string;
  hash: string;
  displayPrefix: string;
} {
  const token = prefix + randomBytes(24).toString("base64url");
  return {
    token,
    hash: sha256Hex(token),
    displayPrefix: `${token.slice(0, prefix.length + 6)}…`,
  };
}

/** RFC 7636 S256: challenge must equal base64url(sha256(verifier)). */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
