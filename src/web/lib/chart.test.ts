import { describe, expect, it } from "vitest";
import {
  areaPath,
  linePath,
  nearestIndex,
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
