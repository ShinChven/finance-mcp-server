import type { Context } from "hono";
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
