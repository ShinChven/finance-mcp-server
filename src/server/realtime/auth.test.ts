import { describe, expect, it, vi } from "vitest";

// Both dependencies are stubbed: `lib/origin.js` reaches for the real
// environment through `config`, and `middleware/session.js` opens a database
// pool on import. Neither is what these tests are about.
vi.mock("../lib/origin.js", () => ({
  isSelfOrigin: (origin: string, host: string | undefined) =>
    origin === `https://${host}` || origin === "https://dashboard.example.com",
}));
vi.mock("../middleware/session.js", () => ({
  loadSessionFromCookieHeader: vi.fn(),
}));

const { isAllowedUpgradeOrigin, authenticateSession } = await import("./auth.js");
const { loadSessionFromCookieHeader } = await import("../middleware/session.js");

const loadSession = vi.mocked(loadSessionFromCookieHeader);

describe("isAllowedUpgradeOrigin", () => {
  it("accepts the dashboard's own origin", () => {
    expect(isAllowedUpgradeOrigin("https://dashboard.example.com", "dashboard.example.com")).toBe(
      true,
    );
  });

  it("rejects another site's origin", () => {
    // WebSockets are exempt from the same-origin policy, so without this check
    // any page on the internet could open an authenticated socket here.
    expect(isAllowedUpgradeOrigin("https://evil.example.com", "dashboard.example.com")).toBe(false);
  });

  it("rejects a missing Origin rather than treating it as same-origin", () => {
    // Every browser sends one on a handshake, so its absence means the caller
    // is not a browser and should be using a token against /mcp instead.
    expect(isAllowedUpgradeOrigin(undefined, "dashboard.example.com")).toBe(false);
  });

  it("rejects the literal null origin", () => {
    expect(isAllowedUpgradeOrigin("null", "dashboard.example.com")).toBe(false);
  });
});

describe("authenticateSession", () => {
  it("returns no identity without a usable session cookie", async () => {
    loadSession.mockResolvedValueOnce(null);
    const request = { headers: { cookie: "sid=expired" } } as never;
    await expect(authenticateSession(request)).resolves.toBeNull();
  });

  it("carries the admin flag, which decides the extra channel", async () => {
    loadSession.mockResolvedValueOnce({
      user: { id: "u1", role: "admin" },
      session: { id: "s1" },
    } as never);
    const request = { headers: { cookie: "sid=good" } } as never;

    await expect(authenticateSession(request)).resolves.toEqual({
      userId: "u1",
      sessionId: "s1",
      isAdmin: true,
    });
  });

  it("does not make an ordinary user an admin", async () => {
    loadSession.mockResolvedValueOnce({
      user: { id: "u2", role: "user" },
      session: { id: "s2" },
    } as never);
    const request = { headers: { cookie: "sid=good" } } as never;

    await expect(authenticateSession(request)).resolves.toMatchObject({ isAdmin: false });
  });
});
