import { describe, expect, it } from "vitest";
import { isKnownTimeZone, toExchangeDate, yearStartInZone, zoneLabel } from "./timezone.js";

describe("toExchangeDate", () => {
  it("keeps a US evening print on the trading day it belongs to", () => {
    // 4 March 2026, 20:00 in New York — an after-hours print. In UTC that is
    // already the 5th, so taking the UTC date would file it under the next
    // trading day and shift the bar by one.
    const evening = Date.parse("2026-03-05T01:00:00Z");
    expect(toExchangeDate(evening, "America/New_York")).toBe("2026-03-04");
    expect(new Date(evening).toISOString().slice(0, 10)).toBe("2026-03-05");
  });

  it("crosses a DST boundary without moving the date", () => {
    // US clocks go forward on 8 March 2026. The close is 21:00 UTC before it
    // and 20:00 UTC after, and both belong to their own local day.
    expect(toExchangeDate(Date.parse("2026-03-06T21:00:00Z"), "America/New_York")).toBe("2026-03-06");
    expect(toExchangeDate(Date.parse("2026-03-09T20:00:00Z"), "America/New_York")).toBe("2026-03-09");
  });

  it("keeps an Asian session on its own day, where UTC is still yesterday", () => {
    // 09:30 in Hong Kong is 01:30 UTC the same day; the Shanghai open likewise.
    expect(toExchangeDate(Date.parse("2026-03-04T01:30:00Z"), "Asia/Hong_Kong")).toBe("2026-03-04");
    expect(toExchangeDate(Date.parse("2026-03-04T01:30:00Z"), "Asia/Shanghai")).toBe("2026-03-04");
    // And an instant just before midnight UTC is already tomorrow there.
    expect(toExchangeDate(Date.parse("2026-03-04T23:30:00Z"), "Asia/Tokyo")).toBe("2026-03-05");
  });

  it("falls back to UTC rather than throwing on a zone the runtime cannot resolve", () => {
    // Upstream metadata is not a trusted input, and a backfill that dies
    // thousands of bars in is worse than one bar under a slightly wrong date.
    expect(toExchangeDate(Date.parse("2026-03-04T21:00:00Z"), "Mars/Olympus")).toBe("2026-03-04");
    expect(isKnownTimeZone("Mars/Olympus")).toBe(false);
    expect(isKnownTimeZone("America/New_York")).toBe(true);
  });
});

describe("yearStartInZone", () => {
  it("turns the year over when the exchange does, not when UTC does", () => {
    // 31 December 2025, 19:00 in New York — still 2025 there, already 2026 in
    // UTC. A YTD window must start from the exchange's own new year.
    const instant = new Date("2026-01-01T00:00:00Z");
    expect(yearStartInZone("America/New_York", instant)).toBe("2025-01-01");
    expect(yearStartInZone("Asia/Shanghai", instant)).toBe("2026-01-01");
  });
});

describe("zoneLabel", () => {
  it("names the zone so an intraday axis can say what its clock is", () => {
    expect(zoneLabel("America/New_York", new Date("2026-03-04T21:00:00Z"))).toMatch(/E[SD]T|GMT/);
    expect(zoneLabel("Mars/Olympus")).toBe("UTC");
  });
});
