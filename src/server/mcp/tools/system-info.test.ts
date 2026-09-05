import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { buildMcpServer } from "../server.js";

describe("systemInfo tool", () => {
  it("returns the server host", async () => {
    const server = buildMcpServer(null);
    const client = new Client({ name: "test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const response = CallToolResultSchema.parse(
        await client.callTool({ name: "systemInfo" }),
      );
      expect(response.isError).not.toBe(true);

      const text = response.content[0];
      expect(text?.type).toBe("text");
      if (text?.type !== "text") throw new Error("Expected text response");

      const data = JSON.parse(text.text);
      expect(data).toEqual({
        host: os.hostname(),
      });
      expect(response.structuredContent).toEqual({
        result: {
          host: os.hostname(),
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
