import { describe, expect, it } from "vitest";
import { classifyRefreshUse, REFRESH_REUSE_GRACE_MS } from "./rotation.js";

/**
 * The rule that decides whether a client keeps its connection or has to be
 * re-authorized by hand. Getting "reuse" wrong in either direction is
 * expensive: too eager and an ordinary retry disconnects a working client
 * permanently, too lax and a revoked token can mint itself a new pair.
 */
describe("classifyRefreshUse", () => {
  const now = Date.UTC(2026, 7, 22, 12, 0, 0);
  const ago = (ms: number) => new Date(now - ms);

  it("rotates a token that has never been used", () => {
    expect(classifyRefreshUse({ revokedAt: null, rotatedAt: null }, now)).toBe("rotate");
  });

  it("treats a just-rotated token as the same exchange arriving twice", () => {
    // The deploy case: the rotation committed, the response never arrived, and
    // the client retried with the token it still holds.
    expect(classifyRefreshUse({ revokedAt: ago(2_000), rotatedAt: ago(2_000) }, now)).toBe("replay");
  });

  it("honours the grace window at its edge and not beyond it", () => {
    const at = REFRESH_REUSE_GRACE_MS;
    expect(classifyRefreshUse({ revokedAt: ago(at), rotatedAt: ago(at) }, now)).toBe("replay");
    expect(classifyRefreshUse({ revokedAt: ago(at + 1), rotatedAt: ago(at + 1) }, now)).toBe("reuse");
  });

  it("calls a long-rotated token reuse", () => {
    const hour = 60 * 60 * 1000;
    expect(classifyRefreshUse({ revokedAt: ago(hour), rotatedAt: ago(hour) }, now)).toBe("reuse");
  });

  it("never extends the grace window to a token revoked for another reason", () => {
    // Revoked without a rotation is a withdrawn grant, a /revoke call, or an
    // earlier reuse detection. Honouring those inside the window would leave a
    // 30-second hole in which a revoked client could re-arm itself.
    expect(classifyRefreshUse({ revokedAt: ago(1_000), rotatedAt: null }, now)).toBe("reuse");
    expect(classifyRefreshUse({ revokedAt: ago(0), rotatedAt: null }, now)).toBe("reuse");
  });

  it("does not punish a clock that moved backwards", () => {
    // Two reads of the wall clock can disagree; the retry is still live.
    expect(classifyRefreshUse({ revokedAt: ago(-5_000), rotatedAt: ago(-5_000) }, now)).toBe("replay");
  });
});
