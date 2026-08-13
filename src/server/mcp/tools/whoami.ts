import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpAuth } from "../../lib/http.js";
import { readOnlyToolAnnotations } from "./runtime.js";

/** `auth` is null only for metadata-only servers (see `catalog.ts`), where handlers never run. */
export function registerWhoamiTool(server: McpServer, auth: McpAuth | null): void {
  server.registerTool(
    "whoami",
    {
      title: "Current MCP Identity",
      description: "Returns the authenticated user and how this request was authorized.",
      annotations: readOnlyToolAnnotations,
    },
    async () => {
      if (!auth) throw new Error("whoami is only available on an authenticated MCP request.");
      return {
        content: [
          {
            type: "text" as const,
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
      };
    },
  );
}
