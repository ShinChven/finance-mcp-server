import { describe, expect, it } from "vitest";
import { getMcpToolCatalog } from "../../server/mcp/catalog.js";
import { schemaFields, type JsonSchemaNode } from "./json-schema.js";

/** Flattens the live tool schemas, so the browser table matches what MCP publishes. */
async function fieldsFor(toolName: string) {
  const catalog = await getMcpToolCatalog();
  const tool = catalog.tools.find((entry) => entry.name === toolName);
  if (!tool) throw new Error(`Unknown tool ${toolName}`);
  return schemaFields(tool.inputSchema as JsonSchemaNode);
}

describe("schemaFields", () => {
  it("labels unions, arrays and requiredness", async () => {
    const fields = await fieldsFor("quote");
    const query = fields.find((field) => field.name === "query");
    const queryFields = fields.find((field) => field.name === "fields");

    expect(query?.required).toBe(true);
    expect(query?.type).toBe("string | string[]");
    expect(query?.description).toContain("Yahoo Finance symbol");
    expect(queryFields?.required).toBe(false);
    expect(queryFields?.type).toBe("string[]");
    expect(queryFields?.constraints.join(" ")).toContain("items");
  });

  it("collects enum options and numeric ranges", async () => {
    const fields = await fieldsFor("screener");
    const scrId = fields.find((field) => field.name === "scrId");
    const count = fields.find((field) => field.name === "count");

    expect(scrId?.type).toBe("enum");
    expect(scrId?.options).toContain("day_gainers");
    expect(count?.type).toBe("integer");
    expect(count?.constraints).toContain("1–50");
  });

  it("hides the safe-integer ceiling zod emits for .int() and reads union descriptions", async () => {
    const fields = await fieldsFor("chart");
    const period1 = fields.find((field) => field.name === "period1");

    expect(period1?.type).toBe("string | integer");
    expect(period1?.description).toContain("Unix timestamp");
    expect(period1?.constraints.join(" ")).not.toContain("9007199254740991");
  });

  it("returns no fields for a tool without parameters", async () => {
    expect(await fieldsFor("whoami")).toEqual([]);
  });
});
