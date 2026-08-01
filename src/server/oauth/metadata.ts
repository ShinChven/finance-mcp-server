import { Hono } from "hono";
import { config } from "../config.js";

export const SUPPORTED_SCOPES = ["mcp"];

/** RFC 8414 + RFC 9728 discovery documents, required by the MCP auth spec. */
export const wellKnownRoutes = new Hono()
  .get("/oauth-authorization-server", (c) =>
    c.json({
      issuer: config.APP_URL,
      authorization_endpoint: `${config.APP_URL}/oauth/authorize`,
      token_endpoint: `${config.APP_URL}/oauth/token`,
      registration_endpoint: `${config.APP_URL}/oauth/register`,
      revocation_endpoint: `${config.APP_URL}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: SUPPORTED_SCOPES,
    }),
  )
  .get("/oauth-protected-resource", (c) =>
    c.json({
      resource: config.APP_URL,
      authorization_servers: [config.APP_URL],
      bearer_methods_supported: ["header"],
      scopes_supported: SUPPORTED_SCOPES,
    }),
  )
  // Some clients append the resource path to the well-known URL (RFC 9728 §3.1).
  .get("/oauth-protected-resource/mcp", (c) =>
    c.json({
      resource: `${config.APP_URL}/mcp`,
      authorization_servers: [config.APP_URL],
      bearer_methods_supported: ["header"],
      scopes_supported: SUPPORTED_SCOPES,
    }),
  );
