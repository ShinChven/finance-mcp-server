import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { buildMcpServer } from "./server.js";
import { BRAND_SLUG, MCP_SERVER_NAME } from "../../shared/brand.js";

export interface McpToolCatalog {
  server: { name: string; version: string; instructions: string | null };
  tools: Tool[];
}

let cached: Promise<McpToolCatalog> | undefined;

/**
 * Tool metadata exactly as an MCP client sees it: `tools/list` is run against a
 * metadata-only server over an in-memory transport, so the dashboard can never
 * drift from the real registrations. Registrations are static, so the result is
 * cached for the process; a failed load is not cached.
 */
export function getMcpToolCatalog(): Promise<McpToolCatalog> {
  cached ??= loadCatalog().catch((error: unknown) => {
    cached = undefined;
    throw error;
  });
  return cached;
}

async function loadCatalog(): Promise<McpToolCatalog> {
  // No request auth: only tool metadata is read, never a tool handler.
  const server = buildMcpServer(null);
  const client = new Client({ name: `${BRAND_SLUG}-catalog`, version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const { tools } = await client.listTools();
    const info = client.getServerVersion();
    return {
      server: {
        name: info?.name ?? MCP_SERVER_NAME,
        version: info?.version ?? "0.0.0",
        instructions: client.getInstructions() ?? null,
      },
      tools,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

/** Case-insensitive match over name, title, description and parameter names. */
export function toolMatches(tool: Tool, needle: string): boolean {
  const properties = tool.inputSchema.properties ?? {};
  const haystack = [tool.name, tool.title ?? "", tool.description ?? "", ...Object.keys(properties)]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle.toLowerCase());
}
