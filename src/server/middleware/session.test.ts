import { describe, expect, it, vi } from "vitest";
import { serializeSigned } from "hono/utils/cookie";

const SECRET = "test-session-secret-at-least-32-chars";

const { rows } = vi.hoisted(() => ({ rows: { current: [] as unknown[] } }));

vi.mock("../config.js", () => ({ config: { SESSION_SECRET: SECRET, isProd: false } }));
vi.mock("../db/index.js", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(rows.current);
  return { db: { select: () => chain }, pool: {} };
});

const { loadSessionFromCookieHeader } = await import("./session.js");

async function cookieFor(value: string, secret = SECRET): Promise<string> {
  return serializeSigned("sid", value, secret, { path: "/" });
}

/**
 * The cookie path the realtime socket authenticates on.
 *
 * An upgrade arrives as a bare Node request with no Hono context, so it cannot
 * use `getSignedCookie` and parses the header itself. That makes this the one
 * place where a mistake would hand out sockets on unverified cookies, and it is
 * not reachable from any of the HTTP route tests.
 */
describe("loadSessionFromCookieHeader", () => {
  it("resolves a correctly signed cookie to its session", async () => {
    rows.current = [{ session: { id: "hashed" }, user: { id: "u1", status: "active" } }];
    const header = await cookieFor("raw-token");

    await expect(loadSessionFromCookieHeader(header)).resolves.toMatchObject({
      user: { id: "u1" },
    });
  });

  it("rejects a cookie signed with a different secret", async () => {
    // The forgery case: without signature verification this would authenticate.
    rows.current = [{ session: { id: "hashed" }, user: { id: "u1", status: "active" } }];
    const header = await cookieFor("raw-token", "an-entirely-different-secret-value");

    await expect(loadSessionFromCookieHeader(header)).resolves.toBeNull();
  });

  it("rejects a cookie whose value was edited after signing", async () => {
    rows.current = [{ session: { id: "hashed" }, user: { id: "u1", status: "active" } }];
    const header = (await cookieFor("raw-token")).replace("raw-token", "raw-tokeX");

    await expect(loadSessionFromCookieHeader(header)).resolves.toBeNull();
  });

  it("returns nothing when there is no cookie header at all", async () => {
    await expect(loadSessionFromCookieHeader(undefined)).resolves.toBeNull();
  });

  it("returns nothing when the header carries other cookies but no session", async () => {
    await expect(loadSessionFromCookieHeader("theme=dark; locale=en")).resolves.toBeNull();
  });

  it("returns nothing when the signature verifies but no session row matches", async () => {
    rows.current = [];
    const header = await cookieFor("raw-token");

    await expect(loadSessionFromCookieHeader(header)).resolves.toBeNull();
  });
});
