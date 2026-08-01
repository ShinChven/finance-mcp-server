import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateSecret,
  PAT_PREFIX,
  randomToken,
  sha256Hex,
  verifyPkceS256,
} from "./crypto.js";

describe("generateSecret", () => {
  it("prefixes the token and stores only a hash", () => {
    const secret = generateSecret(PAT_PREFIX);
    expect(secret.token).toMatch(/^mcp_[A-Za-z0-9_-]{32}$/);
    expect(secret.hash).toBe(sha256Hex(secret.token));
    expect(secret.hash).not.toContain(secret.token);
    expect(secret.displayPrefix).toBe(secret.token.slice(0, 10) + "…");
  });

  it("generates unique tokens", () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateSecret(PAT_PREFIX).token));
    expect(seen.size).toBe(100);
  });
});

describe("verifyPkceS256", () => {
  it("accepts a matching verifier/challenge pair", () => {
    const verifier = randomToken(32);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("rejects a wrong verifier", () => {
    const challenge = createHash("sha256").update("right-verifier").digest("base64url");
    expect(verifyPkceS256("wrong-verifier", challenge)).toBe(false);
  });

  it("rejects malformed challenges without throwing", () => {
    expect(verifyPkceS256("verifier", "")).toBe(false);
    expect(verifyPkceS256("verifier", "short")).toBe(false);
  });
});
