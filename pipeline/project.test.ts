import { describe, expect, it } from "vitest";
import { buildPolyline, projectStops, simplify } from "./project";

describe("projectStops", () => {
  // A road that goes out along the equator and comes back along a parallel road 20 m north.
  const out: [number, number][] = [[0, 0], [0.01, 0], [0.02, 0]];
  const back: [number, number][] = [[0.02, 0.00018], [0.01, 0.00018], [0, 0.00018]];
  const line = buildPolyline([...out, ...back]);

  it("keeps stops in order on a road that doubles back", () => {
    // Stops on the return leg sit closer to the return road. The last stop is at the start
    // of the shape's return, so a greedy nearest-point pass would grab the outbound road.
    const stops = [
      { lon: 0.0, lat: 0.0 },
      { lon: 0.02, lat: 0.0 },
      { lon: 0.01, lat: 0.00018 },
      { lon: 0.0, lat: 0.00018 },
    ];
    const p = projectStops(line, stops);
    for (let i = 1; i < p.length; i++) expect(p[i]!.along).toBeGreaterThanOrEqual(p[i - 1]!.along);
    expect(p[2]!.along).toBeGreaterThan(p[1]!.along);
    expect(p[3]!.offset).toBeLessThan(1);
  });
});

describe("simplify", () => {
  it("drops points on a straight line and keeps corners", () => {
    const line: [number, number][] = [[0, 0], [0.001, 0], [0.002, 0], [0.002, 0.002]];
    expect(simplify(line, 2)).toEqual([[0, 0], [0.002, 0], [0.002, 0.002]]);
  });
});
