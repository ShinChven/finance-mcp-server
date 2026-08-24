import { describe, expect, it } from "vitest";
import { getMcpToolCatalog, toolMatches } from "./catalog.js";

/** The tools that change stored state; every other tool must stay read-only. */
const WRITE_TOOLS = new Set([
  "watchlistAdd",
  "watchlistLevels",
  "watchlistRemove",
  "noteCreate",
  "noteUpdate",
  "noteDelete",
  "skillSave",
]);

describe("mcp tool catalog", () => {
  it("exposes every registered tool with browsable metadata", async () => {
    const catalog = await getMcpToolCatalog();

    expect(catalog.server).toMatchObject({ name: "fintools", version: "0.1.0" });
    expect(catalog.server.instructions).toContain("Yahoo Finance");
    expect(catalog.tools.map((tool) => tool.name)).toEqual([
      "whoami",
      "search",
      "companyNews",
      "quote",
      "quoteSummary",
      "chart",
      "screener",
      "trendingSymbols",
      "options",
      "insights",
      "recommendationsBySymbol",
      "fundamentalsTimeSeries",
      "earningsAnalysis",
      "cryptoTickers",
      "secFilings",
      "secFinancials",
      "watchlists",
      "watchlist",
      "watchlistAdd",
      "watchlistLevels",
      "watchlistRemove",
      "noteCollections",
      "notesSearch",
      "noteRead",
      "noteCreate",
      "noteUpdate",
      "noteDelete",
      "skills",
      "skillRead",
      "skillSave",
      "fundExposure",
      "fundsByStock",
      "fundsBySector",
      "fundsByHoldings",
      "similarFunds",
      "themeToFunds",
      "compareFunds",
      "fundPerformance",
    ]);
    for (const tool of catalog.tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema.type, tool.name).toBe("object");
      // Only the watchlist, note and skill writers may declare themselves mutating;
      // anything else that stops being read-only is a tool that grew side effects.
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(!WRITE_TOOLS.has(tool.name));
    }
  });

  it("maps zod input schemas to JSON Schema properties", async () => {
    const catalog = await getMcpToolCatalog();
    const screener = catalog.tools.find((tool) => tool.name === "screener");

    expect(screener?.inputSchema.required).toEqual(["scrId"]);
    const properties = screener?.inputSchema.properties as
      | Record<string, { enum?: string[]; maximum?: number }>
      | undefined;
    expect(properties?.scrId?.enum).toContain("day_gainers");
    expect(properties?.count?.maximum).toBe(50);
  });

  it("caches the catalog across calls", async () => {
    expect(await getMcpToolCatalog()).toBe(await getMcpToolCatalog());
  });

  it("matches on name, description and parameter names", async () => {
    const catalog = await getMcpToolCatalog();
    const quote = catalog.tools.find((tool) => tool.name === "quote")!;

    expect(toolMatches(quote, "QUOT")).toBe(true);
    expect(toolMatches(quote, "real-time")).toBe(true);
    expect(toolMatches(quote, "fields")).toBe(true);
    expect(toolMatches(quote, "balance sheet")).toBe(false);
  });
});
