import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import type { AppEnv, McpAuth } from "../lib/http.js";
import { mcpBearerAuth } from "../middleware/bearer.js";

/**
 * Builds a per-request MCP server (stateless Streamable HTTP). Add new tools
 * here or split them into files under src/server/mcp/tools/.
 */
function buildMcpServer(auth: McpAuth): McpServer {
  const server = new McpServer({ name: "mcp-server-dashboard", version: "0.1.0" });

  server.registerTool(
    "whoami",
    { description: "Returns the authenticated user and how this request was authorized." },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              userId: auth.user.id,
              email: auth.user.email,
              name: auth.user.displayName ?? auth.user.name,
              authMethod: auth.method === "pat" ? "personal access token" : "oauth 2.1",
              authLabel: auth.label,
              scope: auth.scope ?? null,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "echo",
    {
      description: "Echoes back the provided text.",
      inputSchema: { text: z.string().describe("Text to echo back") },
    },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  );

  return server;
}

export const mcpRoutes = new Hono<AppEnv>().all("/", mcpBearerAuth, async (c) => {
  const server = buildMcpServer(c.get("mcpAuth"));
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);
  return response ?? c.body(null, 202);
});
