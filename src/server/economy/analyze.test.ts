import { describe, expect, it } from "vitest";
import {
  applyTransform,
  defaultTransform,
  percentChange,
  summarizeRelease,
  windowPoints,
  yearAgoIndexes,
} from "./analyze.js";
import type { Observation, SeriesDocument } from "./dbnomics.js";

/** A monthly series starting 2024-01 whose value is 100 + index. */
function monthly(count: number, values?: (number | null)[]): Observation[] {
  const observations: Observation[] = [];
  for (let i = 0; i < count; i += 1) {
    const year = 2024 + Math.floor(i / 12);
    const month = String((i % 12) + 1).padStart(2, "0");
    observations.push({
      period: `${year}-${month}`,
      date: `${year}-${month}-01`,
      value: values === undefined ? 100 + i : values[i] ?? null,
    });
  }
  return observations;
}

function document(overrides: Partial<SeriesDocument> = {}): SeriesDocument {
  return {
    provider: "FRED",
    dataset: "CPIAUCSL",
    datasetName: "CPI",
    code: "CPIAUCSL",
    name: "CPI",
    frequency: "monthly",
    unit: "Index",
    observations: monthly(26),
    ...overrides,
  };
}

describe("percentChange", () => {
  it("keeps the sign of the movement when the base is negative", () => {
    // A yield spread going from -0.5 to 0.5 has widened, not collapsed.
    expect(percentChange(0.5, -0.5)).toBe(200);
  });

  it("refuses a zero base rather than returning Infinity", () => {
    expect(percentChange(1, 0)).toBeNull();
  });
});

describe("yearAgoIndexes", () => {
  it("matches the reading twelve months back", () => {
    const indexes = yearAgoIndexes(monthly(26), "monthly");
    expect(indexes[12]).toBe(0);
    expect(indexes[25]).toBe(13);
  });

  it("has no match for the first year, where nothing precedes it", () => {
    const indexes = yearAgoIndexes(monthly(26), "monthly");
    expect(indexes.slice(0, 12).every((i) => i === -1)).toBe(true);
  });

  it("matches by date across a gap instead of counting back twelve rows", () => {
    // A suspended month: counting back 12 rows from 2025-06 would land on
    // 2024-07 and misreport the change by a month.
    const observations = monthly(26).filter((o) => o.period !== "2024-09");
    const indexes = yearAgoIndexes(observations, "monthly");
    const june2025 = observations.findIndex((o) => o.period === "2025-06");
    const matched = indexes[june2025] ?? -1;
    expect(observations[matched]?.period).toBe("2024-06");
  });

  it("tolerates a daily series that skips weekends", () => {
    // Every seventh calendar day, so the exact anniversary never lands on a
    // published reading — the nearest one inside the tolerance must still win.
    const observations: Observation[] = [];
    for (let i = 0; i < 120; i += 1) {
      const date = new Date(Date.UTC(2024, 0, 1) + i * 7 * 24 * 60 * 60 * 1_000);
      const iso = date.toISOString().slice(0, 10);
      observations.push({ period: iso, date: iso, value: i });
    }
    const indexes = yearAgoIndexes(observations, "daily");
    const matched = indexes[60] ?? -1;
    expect(matched).toBeGreaterThanOrEqual(0);

    const gapDays =
      (Date.parse(observations[60]?.date ?? "") - Date.parse(observations[matched]?.date ?? "")) /
      (24 * 60 * 60 * 1_000);
    expect(Math.abs(gapDays - 365)).toBeLessThanOrEqual(10);
  });

  it("reports no match when the series resumes after a multi-year break", () => {
    const observations: Observation[] = [
      { period: "2018-01", date: "2018-01-01", value: 1 },
      { period: "2026-01", date: "2026-01-01", value: 2 },
    ];
    expect(yearAgoIndexes(observations, "monthly")[1]).toBe(-1);
  });
});

describe("applyTransform", () => {
  it("computes year-over-year percent change", () => {
    const points = applyTransform(monthly(26), "monthly", "yoy_pct");
    // 112 against 100 a year earlier.
    expect(points[12]?.changePct).toBeCloseTo(12, 10);
    expect(points[0]?.changePct).toBeNull();
  });

  it("computes period-over-period change against the previous valued reading", () => {
    const values: (number | null)[] = [100, null, 110];
    const points = applyTransform(monthly(3, values), "monthly", "pop_pct");
    // The null month is skipped, so the step is 100 -> 110, not 110 -> nothing.
    expect(points[2]?.changePct).toBeCloseTo(10, 10);
    expect(points[1]?.changePct).toBeNull();
  });

  it("leaves values untouched and adds no field when no transform is asked for", () => {
    const points = applyTransform(monthly(3), "monthly", "none");
    expect(points.map((p) => p.value)).toEqual([100, 101, 102]);
    expect(points[1]).not.toHaveProperty("changePct");
  });
});

describe("defaultTransform", () => {
  it("reads an index as a change and leaves rates and levels as published", () => {
    expect(defaultTransform({ kind: "index" })).toBe("yoy_pct");
    expect(defaultTransform({ kind: "rate" })).toBe("none");
    expect(defaultTransform({ kind: "level" })).toBe("none");
  });
});

describe("windowPoints", () => {
  it("keeps the most recent readings, not the oldest", () => {
    const points = windowPoints(monthly(26), { limit: 3 });
    expect(points.map((p) => p.period)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("applies the date range before the limit", () => {
    const points = windowPoints(monthly(26), { from: "2024-03", to: "2024-06", limit: 100 });
    expect(points.map((p) => p.period)).toEqual(["2024-03", "2024-04", "2024-05", "2024-06"]);
  });

  it("returns everything when the limit exceeds the series", () => {
    expect(windowPoints(monthly(5), { limit: 100 })).toHaveLength(5);
  });

  it("reads `to` as the end of the period named, not its first instant", () => {
    // Daily readings through a month: "to: 2024-01" must mean all of January,
    // otherwise a caller typing a month gets a single day back.
    const daily: Observation[] = Array.from({ length: 40 }, (_, i) => {
      const iso = new Date(Date.UTC(2024, 0, 1) + i * 24 * 60 * 60 * 1_000)
        .toISOString()
        .slice(0, 10);
      return { period: iso, date: iso, value: i };
    });

    const january = windowPoints(daily, { to: "2024-01", limit: 500 });
    expect(january).toHaveLength(31);
    expect(january.at(-1)?.date).toBe("2024-01-31");

    const throughYear = windowPoints(daily, { to: "2024", limit: 500 });
    expect(throughYear).toHaveLength(40);

    const throughDay = windowPoints(daily, { to: "2024-01-05", limit: 500 });
    expect(throughDay.at(-1)?.date).toBe("2024-01-05");
  });

  it("keeps a reading whose period shape it cannot parse rather than dropping it", () => {
    const points: Observation[] = [
      { period: "2026-W03", date: "2026-W03", value: 1 },
      { period: "2026-02", date: "2026-02-01", value: 2 },
    ];
    expect(windowPoints(points, { limit: 100 })).toHaveLength(2);
  });
});

describe("summarizeRelease", () => {
  it("reports the latest print, the step before it, and how stale it is", () => {
    const summary = summarizeRelease(document(), new Date("2026-03-15T00:00:00Z"));

    expect(summary.latest).toEqual({ period: "2026-02", date: "2026-02-01", value: 125 });
    expect(summary.previous).toEqual({ period: "2026-01", date: "2026-01-01", value: 124 });
    expect(summary.change).toBe(1);
    expect(summary.changePct).toBeCloseTo(0.80645, 4);
    expect(summary.yoyChange).toBe(12);
    expect(summary.yoyPct).toBeCloseTo(10.6194, 3);
    // 2026-02-01 to 2026-03-15.
    expect(summary.staleDays).toBe(42);
  });

  it("skips trailing missing readings to find the latest real print", () => {
    const values: (number | null)[] = Array.from({ length: 26 }, (_, i) => 100 + i);
    values[25] = null;
    values[24] = null;
    const summary = summarizeRelease(
      document({ observations: monthly(26, values) }),
      new Date("2026-03-15T00:00:00Z"),
    );

    expect(summary.latest?.period).toBe("2025-12");
    expect(summary.previous?.period).toBe("2025-11");
  });

  it("returns nulls rather than throwing when a series has no values at all", () => {
    const summary = summarizeRelease(
      document({ observations: monthly(3, [null, null, null]) }),
      new Date("2026-03-15T00:00:00Z"),
    );

    expect(summary.latest).toBeNull();
    expect(summary.previous).toBeNull();
    expect(summary.change).toBeNull();
    expect(summary.staleDays).toBeNull();
  });

  it("reports an absolute change even where a percent change is meaningless", () => {
    // A spread crossing zero: the percentage is noise, the difference is not.
    const observations: Observation[] = [
      { period: "2025-01", date: "2025-01-01", value: -0.4 },
      { period: "2025-02", date: "2025-02-01", value: 0.2 },
    ];
    const summary = summarizeRelease(
      document({ observations, frequency: "monthly" }),
      new Date("2025-03-01T00:00:00Z"),
    );

    expect(summary.change).toBeCloseTo(0.6, 10);
    expect(summary.yoyChange).toBeNull();
  });
});
