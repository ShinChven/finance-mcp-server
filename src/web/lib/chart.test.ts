import { describe, expect, it } from "vitest";
import {
  areaPath,
  domainWithLevels,
  linePath,
  nearestIndex,
  plotInDomain,
  plotInDomainSeries,
  plotSeries,
  plotValue,
  type ChartBox,
} from "./chart.js";

const box: ChartBox = { width: 100, height: 60, padTop: 10, padBottom: 10 };

describe("plotSeries", () => {
  it("spans the box and puts the highest value at the top", () => {
    const points = plotSeries([0, 1, 2], [1, 3, 2], box);

    expect(points[0]?.x).toBe(0);
    expect(points[2]?.x).toBe(100);
    // 40 usable pixels between padTop 10 and padBottom 10.
    expect(points[1]?.y).toBe(10); // the maximum
    expect(points[0]?.y).toBe(50); // the minimum
    expect(points[2]?.y).toBe(30); // halfway
  });

  it("spaces points by their x value, not by their position", () => {
    // A gap in the middle of the series must show as a gap: this is the
    // difference between a suspended fund and one that simply moved slowly.
    const points = plotSeries([0, 90, 100], [1, 2, 3], box);

    expect(points[1]?.x).toBe(90);
  });

  it("draws a flat series down the middle instead of dividing by zero", () => {
    const points = plotSeries([0, 1, 2], [2, 2, 2], box);

    for (const point of points) expect(point.y).toBe(30);
  });

  it("centres a single observation rather than pinning it to the left edge", () => {
    const points = plotSeries([0], [5], box);

    expect(points[0]?.x).toBe(50);
  });
});

describe("plotValue", () => {
  it("places a value on the same scale as the series", () => {
    const values = [1, 3, 2];

    expect(plotValue(1, values, box)).toBe(plotSeries([0, 1, 2], values, box)[0]?.y);
    expect(plotValue(2, values, box)).toBe(30);
  });
});

describe("linePath and areaPath", () => {
  it("moves once and lines thereafter", () => {
    const path = linePath([
      { x: 0, y: 1 },
      { x: 2, y: 3 },
    ]);

    expect(path).toBe("M0 1 L2 3");
  });

  it("closes the area down to the baseline under both ends", () => {
    const area = areaPath(
      [
        { x: 0, y: 1 },
        { x: 2, y: 3 },
      ],
      60,
    );

    expect(area).toBe("M0 1 L2 3 L2 60 L0 60 Z");
  });

  it("returns an empty path for an empty series rather than broken markup", () => {
    expect(linePath([])).toBe("");
    expect(areaPath([], 60)).toBe("");
  });
});

describe("nearestIndex", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
  ];

  it("picks the closest point on either side", () => {
    expect(nearestIndex(points, 4)).toBe(0);
    expect(nearestIndex(points, 6)).toBe(1);
    expect(nearestIndex(points, 14)).toBe(1);
  });

  it("clamps past both ends, so hovering the edge still reads an observation", () => {
    expect(nearestIndex(points, -50)).toBe(0);
    expect(nearestIndex(points, 999)).toBe(2);
  });
});

describe("domainWithLevels", () => {
  const box = { width: 100, height: 100, padTop: 0, padBottom: 0 };

  it("stretches to contain a level the prices do not reach", () => {
    // The whole point of the watchlist chart: a stop below the window is the
    // one level most worth seeing, and a scale fitted to prices alone hides it.
    const domain = domainWithLevels([100, 105, 110], [90]);
    expect(domain.low).toBeLessThan(90);
    expect(domain.high).toBeGreaterThan(110);
    expect(domain.clamped).toEqual([]);
  });

  it("leaves a level far outside the window clamped instead of flattening the line", () => {
    // A target at 400 against a window of 100–110 would compress the price
    // line into a rule. The shape survives; the level becomes an edge marker.
    const domain = domainWithLevels([100, 105, 110], [400]);
    expect(domain.clamped).toEqual([400]);
    expect(domain.high).toBeLessThan(150);
  });

  it("keeps the near level and clamps only the far one", () => {
    const domain = domainWithLevels([100, 110], [108, 900]);
    expect(domain.clamped).toEqual([900]);
    expect(domain.high).toBeGreaterThan(110);
  });

  it("gives a flat series a usable domain", () => {
    const domain = domainWithLevels([50, 50, 50], []);
    expect(domain.high).toBeGreaterThan(domain.low);
  });

  it("survives an empty series", () => {
    expect(domainWithLevels([], [100])).toEqual({ low: 0, high: 1, clamped: [] });
  });

  it("places a value inside the domain it was given", () => {
    const domain = { low: 0, high: 100, clamped: [] };
    expect(plotInDomain(100, domain, box)).toBe(0);
    expect(plotInDomain(0, domain, box)).toBe(100);
    expect(plotInDomain(50, domain, box)).toBe(50);
  });

  it("spreads x over real elapsed time, not over array position", () => {
    // A gap in the history must show as a gap: a suspended listing that
    // published nothing for a month is not one evenly spaced step.
    const points = plotInDomainSeries([0, 1, 31], [10, 11, 12], { low: 0, high: 20, clamped: [] }, box);
    expect(points[1]?.x).toBeCloseTo(100 / 31, 4);
    expect(points[2]?.x).toBe(100);
  });
});
