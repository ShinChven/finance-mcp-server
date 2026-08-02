import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import type { AppEnv } from "../lib/http.js";
import { mcpBearerAuth } from "../middleware/bearer.js";
import { buildMcpServer } from "./server.js";

export const mcpRoutes = new Hono<AppEnv>().all("/", mcpBearerAuth, async (c) => {
  const server = buildMcpServer(c.get("mcpAuth"));
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);
  return response ?? c.body(null, 202);
});
