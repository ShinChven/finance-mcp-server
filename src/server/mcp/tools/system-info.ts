import os from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readOnlyToolAnnotations, runTool } from "./runtime.js";

/**
 * Returns basic system information about the server.
 */
export function registerSystemInfoTool(server: McpServer): void {
  server.registerTool(
    "systemInfo",
    {
      title: "Server System Info",
      description: "Returns basic system information for the server, such as the server host.",
      annotations: readOnlyToolAnnotations,
    },
    async () =>
      runTool(async () => {
        return {
          host: os.hostname(),
        };
      }),
  );
}
