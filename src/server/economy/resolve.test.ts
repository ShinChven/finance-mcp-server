import { describe, expect, it, vi } from "vitest";
import { UnknownIndicatorError, resolveSeries, seriesIdSchema } from "./resolve.js";
import type { DbnomicsClient, SeriesDocument } from "./dbnomics.js";

function stubClient(): DbnomicsClient {
  const document: SeriesDocument = {
    provider: "FRED",
    dataset: "CPIAUCSL",
    datasetName: null,
    code: "CPIAUCSL",
    name: null,
    frequency: "monthly",
    unit: null,
    observations: [],
  };
  return {
    fetchSeries: vi.fn(async () => document),
    fetchIndicator: vi.fn(async () => document),
  } as unknown as DbnomicsClient;
}

describe("seriesIdSchema", () => {
  it("accepts the two- and three-segment forms real providers use", () => {
    for (const id of [
      "FRED/CPIAUCSL/CPIAUCSL",
      "FRED/CPIAUCSL",
      "Eurostat/prc_hicp_midx/M.I15.CP00.EA",
      "ECB/FM/D.U2.EUR.4F.KR.MRR_FR.LEV",
      "WB/WDI/NY.GDP.MKTP.CD",
    ]) {
      expect(seriesIdSchema.safeParse(id).success, id).toBe(true);
    }
  });

  it("refuses anything that could steer the request off the series endpoint", () => {
    // This string is interpolated into a URL path, so traversal, encoded
    // separators, query strings and absolute URLs all have to be unreachable.
    for (const id of [
      "FRED/../../admin",
      "FRED/..%2Fadmin",
      "FRED/A/A?observations=0",
      "http://evil.test/x",
      "//evil.test/x",
      "FRED//CPIAUCSL",
      "FRED/A/A/B",
      "FRED",
      "FRED/A A",
      "FRED/A#B",
    ]) {
      expect(seriesIdSchema.safeParse(id).success, id).toBe(false);
    }
  });
});

describe("resolveSeries", () => {
  it("fetches a catalogue indicator through the indicator path", async () => {
    const client = stubClient();
    const resolved = await resolveSeries(client, { indicator: "us-cpi" });

    expect(client.fetchIndicator).toHaveBeenCalled();
    expect(resolved.descriptor?.code).toBe("CPIAUCSL");
    expect(resolved.requested).toBe("us-cpi");
  });

  it("prefers an explicit path when both are given, being the more specific of the two", async () => {
    const client = stubClient();
    const resolved = await resolveSeries(client, {
      indicator: "us-cpi",
      seriesId: "FRED/UNRATE/UNRATE",
    });

    expect(client.fetchSeries).toHaveBeenCalledWith("FRED/UNRATE/UNRATE");
    expect(client.fetchIndicator).not.toHaveBeenCalled();
    expect(resolved.descriptor).toBeNull();
  });

  it("names the catalogue and the escape hatch when the id is unknown", async () => {
    await expect(resolveSeries(stubClient(), { indicator: "cpi" })).rejects.toThrow(
      UnknownIndicatorError,
    );
    await expect(resolveSeries(stubClient(), { indicator: "cpi" })).rejects.toThrow(/seriesId/);
  });

  it("refuses a request that names neither", async () => {
    await expect(resolveSeries(stubClient(), {})).rejects.toThrow(/indicator/);
  });
});
