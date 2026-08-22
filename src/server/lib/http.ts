import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { User, Session } from "../db/schema.js";

export type McpAuth = {
  user: User;
  method: "pat" | "oauth";
  /** access_tokens.id or oauth_grants.id depending on method */
  sourceId: string;
  /** token name or client name, for display */
  label: string;
  scope?: string;
};

export type AppEnv = {
  Variables: {
    user: User;
    session: Session;
    mcpAuth: McpAuth;
  };
};

export function clientIp(c: Context): string | undefined {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return undefined;
}

/**
 * The app-wide error handler.
 *
 * An `HTTPException` carries the response its thrower intended, and a custom
 * `onError` replaces Hono's default handling of it -- so returning a blanket 500
 * here was turning every deliberate status into an opaque one. That mattered
 * most on `/mcp`, where the transport signals 406, 415, 400 and 404 by throwing:
 * a client that gets 500 instead cannot tell a malformed request from a broken
 * server, and neither can anyone reading the logs.
 */
export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(`${c.req.method} ${c.req.path} failed:`, err);
  return c.json({ error: "internal server error" }, 500);
};
