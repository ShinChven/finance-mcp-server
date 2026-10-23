import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import type { DbnomicsClient, Observation, SeriesDocument } from "../../economy/dbnomics.js";
import { DbnomicsError } from "../../economy/dbnomics.js";
import type { McpAuth } from "../../lib/http.js";
import { findIndicator } from "../../../shared/economy.js";
import { buildMcpServer } from "../server.js";

const auth = {
  user: {
    id: "user-1",
    email: "investor@example.com",
    googleSub: null,
    name: "Investor",
    displayName: "Test Investor",
    avatarUrl: null,
    role: "user",
    status: "active",
    preferences: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastLoginAt: null,
  },
  method: "pat",
  sourceId: "token-1",
  label: "Test token",
} satisfies McpAuth;

/** A monthly series starting 2024-01 whose value is 100 + index. */
function monthlyObservations(count: number): Observation[] {
  return Array.from({ length: count }, (_, i) => {
    const year = 2024 + Math.floor(i / 12);
    const month = String((i % 12) + 1).padStart(2, "0");
    return { period: `${year}-${month}`, date: `${year}-${month}-01`, value: 100 + i };
  });
}

function seriesDocument(overrides: Partial<SeriesDocument> = {}): SeriesDocument {
  return {
    provider: "FRED",
    dataset: "CPIAUCSL",
    datasetName: "Consumer Price Index",
    code: "CPIAUCSL",
    name: "CPI for All Urban Consumers",
    frequency: "monthly",
    unit: "Index 1982-1984=100",
    observations: monthlyObservations(26),
    ...overrides,
  };
}

interface Structured {
  result: Record<string, unknown>;
}

async function connect(
  handlers: {
    fetchIndicator?: (...args: unknown[]) => Promise<SeriesDocument>;
    fetchSeries?: (...args: unknown[]) => Promise<SeriesDocument>;
  } = {},
) {
  const fetchIndicator = vi.fn(
    handlers.fetchIndicator ?? (async () => seriesDocument()),
  );
  const fetchSeries = vi.fn(handlers.fetchSeries ?? (async () => seriesDocument()));
  const server = buildMcpServer(auth, {
    economy: { fetchIndicator, fetchSeries } as unknown as DbnomicsClient,
  });
  const mcpClient = new Client({ name: "economy-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  return {
    fetchIndicator,
    fetchSeries,
    async call(name: string, args: Record<string, unknown>) {
      return CallToolResultSchema.parse(await mcpClient.callTool({ name, arguments: args }));
    },
    async close() {
      await mcpClient.close();
      await server.close();
    },
  };
}

describe("economicSeries", () => {
  it("reads an index indicator year-over-year by default, because the level says nothing", async () => {
    const harness = await connect();
    try {
      const result = await harness.call("economicSeries", { indicator: "us-cpi" });
      expect(result.isError).not.toBe(true);

      const { result: body } = result.structuredContent as unknown as Structured;
      expect(body["transform"]).toBe("yoy_pct");
      expect(body["requested"]).toBe("us-cpi");

      const series = body["series"] as Record<string, unknown>;
      expect(series["provider"]).toBe("FRED");
      expect(series["code"]).toBe("CPIAUCSL");
      expect(series["frequency"]).toBe("monthly");
      expect(series["kind"]).toBe("index");

      const observations = body["observations"] as { period: string; changePct: number | null }[];
      const january2025 = observations.find((o) => o.period === "2025-01");
      expect(january2025?.changePct).toBeCloseTo(12, 10);
    } finally {
      await harness.close();
    }
  });

  it("returns rates as published rather than as a percent change", async () => {
    const harness = await connect({
      fetchIndicator: async () =>
        seriesDocument({ code: "DGS10", name: "10-Year Treasury", unit: "Percent" }),
    });
    try {
      const result = await harness.call("economicSeries", { indicator: "us-10y" });
      const { result: body } = result.structuredContent as unknown as Structured;
      expect(body["transform"]).toBe("none");

      const observations = body["observations"] as Record<string, unknown>[];
      expect(observations[0]).not.toHaveProperty("changePct");
    } finally {
      await harness.close();
    }
  });

  it("honours an explicit transform over the indicator's default", async () => {
    const harness = await connect();
    try {
      const result = await harness.call("economicSeries", {
        indicator: "us-cpi",
        transform: "none",
      });
      const { result: body } = result.structuredContent as unknown as Structured;
      expect(body["transform"]).toBe("none");

      const observations = body["observations"] as { value: number }[];
      expect(observations[0]?.value).toBe(100);
    } finally {
      await harness.close();
    }
  });

  it("windows to the most recent readings and reports what it left behind", async () => {
    const harness = await connect();
    try {
      const result = await harness.call("economicSeries", {
        indicator: "us-cpi",
        limit: 3,
        transform: "none",
      });
      const { result: body } = result.structuredContent as unknown as Structured;

      expect(body["observationsAvailable"]).toBe(26);
      expect(body["count"]).toBe(3);
      const observations = body["observations"] as { period: string }[];
      expect(observations.map((o) => o.period)).toEqual(["2025-12", "2026-01", "2026-02"]);
    } finally {
      await harness.close();
    }
  });

  it("passes a raw DBnomics path straight through, with no catalogue opinion attached", async () => {
    const harness = await connect();
    try {
      const result = await harness.call("economicSeries", {
        seriesId: "Eurostat/prc_hicp_midx/M.I15.CP00.EA",
      });
      const { result: body } = result.structuredContent as unknown as Structured;

      expect(harness.fetchSeries).toHaveBeenCalledWith("Eurostat/prc_hicp_midx/M.I15.CP00.EA");
      expect(harness.fetchIndicator).not.toHaveBeenCalled();
      // Nothing is known about an uncatalogued series, so nothing is assumed.
      expect(body["transform"]).toBe("none");
      expect((body["series"] as Record<string, unknown>)["kind"]).toBeNull();
    } finally {
      await harness.close();
    }
  });

  it("names the known indicators when given one it does not have", async () => {
    const harness = await connect();
    try {
      const result = await harness.call("economicSeries", { indicator: "us-inflation" });
      expect(result.isError).toBe(true);

      const [content] = result.content as { text: string }[];
      expect(content?.text).toContain("us-cpi");
      expect(content?.text).toContain("seriesId");
    } finally {
      await harness.close();
    }
  });

  it("requires one of the two ways in", async () => {
    const harness = await connect();
    try {
      const result = await harness.call("economicSeries", {});
      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("reports an upstream failure as a tool error, not a transport failure", async () => {
    const harness = await connect({
      fetchIndicator: async () => {
        throw new DbnomicsError("DBnomics rate-limited this server (429).", 429);
      },
    });
    try {
      const result = await harness.call("economicSeries", { indicator: "us-cpi" });
      expect(result.isError).toBe(true);
      const [content] = result.content as { text: string }[];
      expect(content?.text).toContain("429");
    } finally {
      await harness.close();
    }
  });
});

describe("economicRelease", () => {
  it("reports the latest print with its change, its year-over-year move, and its age", async () => {
    const harness = await connect();
    try {
      const result = await harness.call("economicRelease", { indicators: ["us-cpi"] });
      expect(result.isError).not.toBe(true);

      const { result: body } = result.structuredContent as unknown as Structured;
      const releases = body["releases"] as Record<string, unknown>[];
      const [cpi] = releases;

      expect(cpi?.["requested"]).toBe("us-cpi");
      expect(cpi?.["latest"]).toEqual({ period: "2026-02", date: "2026-02-01", value: 125 });
      expect(cpi?.["change"]).toBe(1);
      expect(cpi?.["yoyChange"]).toBe(12);
      expect(typeof cpi?.["staleDays"]).toBe("number");
    } finally {
      await harness.close();
    }
  });

  it("answers several indicators in one call, for a macro snapshot", async () => {
    const harness = await connect();
    try {
      const result = await harness.call("economicRelease", {
        indicators: ["us-cpi", "us-unemployment", "us-10y"],
      });
      const { result: body } = result.structuredContent as unknown as Structured;

      expect(body["count"]).toBe(3);
      const releases = body["releases"] as { requested: string }[];
      expect(releases.map((r) => r.requested)).toEqual(["us-cpi", "us-unemployment", "us-10y"]);
    } finally {
      await harness.close();
    }
  });

  it("keeps the rest of the snapshot when one series fails", async () => {
    const harness = await connect({
      fetchIndicator: async (...args: unknown[]) => {
        const descriptor = args[0] as { id: string };
        if (descriptor.id === "us-unemployment") {
          throw new DbnomicsError("DBnomics has no series at that path (404).", 404);
        }
        return seriesDocument();
      },
    });
    try {
      const result = await harness.call("economicRelease", {
        indicators: ["us-cpi", "us-unemployment"],
      });
      expect(result.isError).not.toBe(true);

      const { result: body } = result.structuredContent as unknown as Structured;
      const releases = body["releases"] as Record<string, unknown>[];

      expect(releases[0]?.["latest"]).toBeTruthy();
      expect(releases[1]?.["error"]).toContain("404");
      expect(releases[1]?.["latest"]).toBeUndefined();
    } finally {
      await harness.close();
    }
  });

  it("mixes catalogue ids and raw paths in one snapshot", async () => {
    const harness = await connect();
    try {
      const result = await harness.call("economicRelease", {
        indicators: ["us-cpi"],
        seriesIds: ["FRED/UNRATE/UNRATE"],
      });
      const { result: body } = result.structuredContent as unknown as Structured;

      expect(body["count"]).toBe(2);
      expect(harness.fetchIndicator).toHaveBeenCalledTimes(1);
      expect(harness.fetchSeries).toHaveBeenCalledWith("FRED/UNRATE/UNRATE");
    } finally {
      await harness.close();
    }
  });

  it("requires at least one target", async () => {
    const harness = await connect();
    try {
      const result = await harness.call("economicRelease", {});
      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});

describe("the indicator catalogue", () => {
  it("resolves ids case-insensitively and with surrounding space", () => {
    expect(findIndicator("  US-CPI ")?.code).toBe("CPIAUCSL");
  });

  it("has no duplicate ids", () => {
    const ids = ["us-cpi", "us-core-pce", "us-10y", "us-unemployment"];
    for (const id of ids) expect(findIndicator(id)).toBeDefined();
  });
});
