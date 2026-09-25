import { describe, expect, it } from "vitest";
import type { Network } from "../types";
import { Clock } from "../clock/clock";
import { buildDay, buildTrip, peakConcurrent, positionAt } from "./sim";

// One straight shape along the equator, 3 vertices, 0 / 1000 / 2000 m.
const net: Network = {
  feedVersion: "test",
  routes: [{ id: "1", short: "T", name: "Test" }],
  shapes: [{ coords: [[0, 0], [1, 0], [2, 0]], dist: [0, 1000, 2000] }],
  stops: {},
  services: [["20260925"], ["20260924"]],
  trips: [
    // 10:00 at 0 m, 10:10 at 1000 m, dwells until 10:12, 10:22 at 2000 m
    { route: 0, shape: 0, service: 0, headsign: "A", cp: [36000, 0, 36600, 1000, 36720, 1000, 37320, 2000] },
    // yesterday's late trip: 23:50 to 24:30
    { route: 0, shape: 0, service: 1, headsign: "B", cp: [85800, 0, 88200, 2000] },
  ],
};

describe("sim", () => {
  it("interpolates between stops and dwells at a stop", () => {
    const trip = buildTrip(net, net.trips[0]!, 0, "rail");
    expect(positionAt(trip, 35999)).toBeNull();
    expect(positionAt(trip, 36300)![0]).toBeCloseTo(0.5);
    expect(positionAt(trip, 36650)![0]).toBeCloseTo(1);
    expect(positionAt(trip, 37020)![0]).toBeCloseTo(1.5);
    expect(positionAt(trip, 37321)).toBeNull();
  });

  it("peak concurrency counts trips that touch at an instant as overlapping", () => {
    const at = (a: number, b: number) => buildTrip(net, { route: 0, shape: 0, service: 0, headsign: "", cp: [a, 0, b, 2000] }, 0, "rail");
    expect(peakConcurrent([at(0, 100), at(100, 200), at(300, 400)])).toBe(2);
    expect(peakConcurrent([at(0, 100), at(150, 200)])).toBe(1);
    expect(peakConcurrent([])).toBe(0);
  });

  it("times are non-decreasing", () => {
    const { times } = buildTrip(net, net.trips[0]!, 0, "rail");
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
  });

  it("day window runs from the first train to the last, with the end rounded up to 15 minutes", () => {
    const day = buildDay(net, "20260925", "rail");
    expect(day.trips).toHaveLength(1);
    expect(day.start).toBe(36000); // 10:00, the first departure
    expect(day.end).toBe(37800); // 10:30, the 10:22 arrival rounded up
  });

  it("trips past midnight stay in the day they started", () => {
    const day = buildDay(net, "20260924", "rail");
    expect(day.start).toBe(85500); // 23:45, the 23:50 departure rounded down
    expect(day.end).toBe(88200);
  });

  it("clock wraps at the end of its window", () => {
    const c = new Clock(1099, 1, 1000, 1100);
    c.tick(2000);
    expect(c.t).toBeCloseTo(1001);
  });
});
