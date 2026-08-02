import { describe, expect, it } from "vitest";
import { runYahooFinanceTool } from "./runtime.js";

describe("runYahooFinanceTool", () => {
  it("serializes dates into JSON-safe structured content", async () => {
    const result = await runYahooFinanceTool(async () => ({
      symbol: "AAPL",
      date: new Date("2026-01-02T03:04:05Z"),
    }));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      result: { symbol: "AAPL", date: "2026-01-02T03:04:05.000Z" },
    });
  });

  it("rejects oversized provider responses", async () => {
    const result = await runYahooFinanceTool(async () => ({ data: "x".repeat(1_000_001) }));

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("response exceeded 1 MB"),
    });
  });
});
