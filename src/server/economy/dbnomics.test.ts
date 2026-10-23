import { describe, expect, it, vi } from "vitest";
import {
  DbnomicsClient,
  DbnomicsError,
  candidatePaths,
  parseSeries,
  periodToDate,
} from "./dbnomics.js";
import type { IndicatorDescriptor } from "../../shared/economy.js";

function envelope(doc: Record<string, unknown>) {
  return { series: { docs: [doc], num_found: 1 } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const cpi: IndicatorDescriptor = {
  id: "us-cpi",
  label: "US CPI",
  provider: "FRED",
  code: "CPIAUCSL",
  frequency: "monthly",
  unit: "Index",
  kind: "index",
  note: "",
};

describe("parseSeries", () => {
  it("zips the parallel period and value arrays and keeps the metadata", () => {
    const document = parseSeries(
      envelope({
        "@frequency": "monthly",
        provider_code: "FRED",
        dataset_code: "CPIAUCSL",
        dataset_name: "Consumer Price Index",
        series_code: "CPIAUCSL",
        series_name: "CPI for All Urban Consumers",
        unit: "Index 1982-1984=100",
        period: ["2026-01", "2026-02"],
        period_start_day: ["2026-01-01", "2026-02-01"],
        value: [317.5, 318.9],
      }),
    );

    expect(document.provider).toBe("FRED");
    expect(document.dataset).toBe("CPIAUCSL");
    expect(document.name).toBe("CPI for All Urban Consumers");
    expect(document.frequency).toBe("monthly");
    expect(document.unit).toBe("Index 1982-1984=100");
    expect(document.observations).toEqual([
      { period: "2026-01", date: "2026-01-01", value: 317.5 },
      { period: "2026-02", date: "2026-02-01", value: 318.9 },
    ]);
  });

  it('reads DBnomics\'s "NA" and empty strings as missing, not as zero', () => {
    const document = parseSeries(
      envelope({
        "@frequency": "monthly",
        period: ["2026-01", "2026-02", "2026-03", "2026-04"],
        period_start_day: ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"],
        value: [1.5, "NA", "", "2.5"],
      }),
    );

    expect(document.observations.map((o) => o.value)).toEqual([1.5, null, null, 2.5]);
  });

  it("stops at the shorter array rather than shifting every reading by a row", () => {
    const document = parseSeries(
      envelope({
        "@frequency": "monthly",
        period: ["2026-01", "2026-02", "2026-03"],
        period_start_day: ["2026-01-01", "2026-02-01", "2026-03-01"],
        value: [1, 2],
      }),
    );

    expect(document.observations).toHaveLength(2);
    expect(document.observations.at(-1)?.period).toBe("2026-02");
  });

  it("sorts oldest first even when the provider does not", () => {
    const document = parseSeries(
      envelope({
        "@frequency": "monthly",
        period: ["2026-03", "2026-01", "2026-02"],
        period_start_day: ["2026-03-01", "2026-01-01", "2026-02-01"],
        value: [3, 1, 2],
      }),
    );

    expect(document.observations.map((o) => o.value)).toEqual([1, 2, 3]);
  });

  it("widens a bare period label into a sortable date when period_start_day is absent", () => {
    const annual = parseSeries(
      envelope({ "@frequency": "annual", period: ["2025"], value: [7] }),
    );
    expect(annual.observations[0]).toEqual({ period: "2025", date: "2025-01-01", value: 7 });

    // A quarter label is not a date any comparison understands, and a series
    // of them would otherwise be discarded wholesale by a range filter.
    const quarterly = parseSeries(
      envelope({ "@frequency": "quarterly", period: ["2026-Q2"], value: [3] }),
    );
    expect(quarterly.observations[0]?.date).toBe("2026-04-01");
  });

  it("maps every quarter to the first day of its quarter", () => {
    expect(periodToDate("2026-Q1")).toBe("2026-01-01");
    expect(periodToDate("2026-Q2")).toBe("2026-04-01");
    expect(periodToDate("2026-Q3")).toBe("2026-07-01");
    expect(periodToDate("2026Q4")).toBe("2026-10-01");
    expect(periodToDate("2026-07")).toBe("2026-07-01");
    // Anything unrecognized is passed through rather than guessed at.
    expect(periodToDate("2026-W03")).toBe("2026-W03");
  });

  it("rejects a payload carrying no series", () => {
    expect(() => parseSeries({ series: { docs: [] } })).toThrow(DbnomicsError);
    expect(() => parseSeries({})).toThrow(DbnomicsError);
  });
});

describe("DbnomicsClient", () => {
  it("caches by URL so repeated tool calls cost one upstream request", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(envelope({ "@frequency": "monthly", period: ["2026-01"], value: [1] })),
    );
    const client = new DbnomicsClient({ fetchImpl, minIntervalMs: 0 });

    await client.fetchSeries("FRED/A/A");
    await client.fetchSeries("FRED/A/A");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to the two-segment path when the three-segment one is absent", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/FRED/CPIAUCSL/CPIAUCSL")) return jsonResponse({}, 404);
      return jsonResponse(envelope({ "@frequency": "monthly", period: ["2026-01"], value: [317] }));
    });
    const client = new DbnomicsClient({ fetchImpl, minIntervalMs: 0 });

    const document = await client.fetchIndicator(cpi);
    expect(document.observations).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // The working path is remembered, so the probe is not repeated.
    await client.fetchIndicator(cpi);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("surfaces an upstream failure instead of retrying it as a wrong guess", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    const client = new DbnomicsClient({ fetchImpl, minIntervalMs: 0 });

    await expect(client.fetchIndicator(cpi)).rejects.toThrow(/500/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("explains a 404 in terms of the identifier and a 429 in terms of the free tier", async () => {
    const notFound = new DbnomicsClient({
      fetchImpl: async () => jsonResponse({}, 404),
      minIntervalMs: 0,
    });
    await expect(notFound.fetchSeries("FRED/NOPE/NOPE")).rejects.toThrow(/db\.nomics\.world/);

    const limited = new DbnomicsClient({
      fetchImpl: async () => jsonResponse({}, 429),
      minIntervalMs: 0,
    });
    await expect(limited.fetchSeries("FRED/A/A")).rejects.toThrow(/rate-limited/);
  });

  it("asks for observations, since the default response carries metadata only", async () => {
    let requested = "";
    const client = new DbnomicsClient({
      fetchImpl: async (url) => {
        requested = String(url);
        return jsonResponse(envelope({ "@frequency": "monthly", period: ["2026-01"], value: [1] }));
      },
      minIntervalMs: 0,
    });

    await client.fetchSeries("FRED/A/A");
    expect(requested).toContain("observations=1");
    expect(requested).toContain("/series/FRED/A/A");
  });
});

describe("candidatePaths", () => {
  it("tries the nested form before the flat one", () => {
    expect(candidatePaths(cpi)).toEqual(["FRED/CPIAUCSL/CPIAUCSL", "FRED/CPIAUCSL"]);
  });
});
