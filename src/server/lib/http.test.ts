import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "./http.js";

/**
 * `onError` replaces Hono's built-in HTTPException handling rather than running
 * alongside it, which is how every deliberate status thrown by the MCP
 * transport used to reach clients as a 500.
 */
describe("errorHandler", () => {
  function appThrowing(err: unknown) {
    const app = new Hono();
    app.get("/", () => {
      throw err;
    });
    app.onError(errorHandler);
    return app;
  }

  it("passes an HTTPException's own response through untouched", async () => {
    const res = await appThrowing(
      new HTTPException(406, {
        res: Response.json({ jsonrpc: "2.0", error: { message: "Not Acceptable" } }, { status: 406 }),
      }),
    ).request("/");

    expect(res.status).toBe(406);
    await expect(res.json()).resolves.toMatchObject({ error: { message: "Not Acceptable" } });
  });

  it("keeps an HTTPException status even when it carries no response body", async () => {
    const res = await appThrowing(new HTTPException(415, { message: "Unsupported Media Type" })).request("/");
    expect(res.status).toBe(415);
  });

  it("still hides unexpected errors behind a 500", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await appThrowing(new Error("connection terminated unexpectedly")).request("/");
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual({ error: "internal server error" });
      // The detail belongs in the log, not the response.
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
