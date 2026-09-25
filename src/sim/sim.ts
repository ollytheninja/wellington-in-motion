import type { Mode } from "../data/load";
import type { Network, TripRecord } from "../types";

export const DAY = 86400;

/** A trip ready to draw. Times are seconds from midnight of the day being shown, and can be negative. */
export interface SimTrip {
  mode: Mode;
  route: number;
  headsign: string;
  path: [number, number][];
  times: number[];
}

/** A service day: its trips and the span from the first departure to the last arrival. */
export interface Day {
  trips: SimTrip[];
  /** Seconds from midnight. `end` can be past 86400 for services that run after midnight. */
  start: number;
  end: number;
}

const ROUND = 900;

/**
 * The trips of one service day, and the window to play. The window starts at the first
 * train and ends at the last, so the timeline has no dead hours. Trips after midnight
 * belong to the day they started on.
 */
export function buildDay(net: Network, date: string, mode: Mode): Day {
  const running = new Set<number>();
  net.services.forEach((dates, i) => dates.includes(date) && running.add(i));
  const trips = net.trips.filter((t) => running.has(t.service)).map((t) => buildTrip(net, t, 0, mode));
  if (trips.length === 0) return { trips, start: 0, end: DAY };
  let start = Infinity;
  let end = -Infinity;
  for (const t of trips) {
    start = Math.min(start, t.times[0]!);
    end = Math.max(end, t.times[t.times.length - 1]!);
  }
  return { trips, start: Math.floor(start / ROUND) * ROUND, end: Math.ceil(end / ROUND) * ROUND };
}

export function buildTrip(net: Network, trip: TripRecord, offset: number, mode: Mode): SimTrip {
  const shape = net.shapes[trip.shape]!;
  const cp = trip.cp;
  const n = cp.length / 2;
  const firstD = cp[1]!;
  const lastD = cp[cp.length - 1]!;

  const pts: { d: number; t: number }[] = [];
  for (let k = 0; k < n; k++) pts.push({ d: cp[2 * k + 1]!, t: cp[2 * k]! });

  // Shape vertices strictly between the first and last stop get a time by interpolating between control points.
  let k = 0;
  for (let i = 0; i < shape.dist.length; i++) {
    const d = shape.dist[i]!;
    if (d <= firstD || d >= lastD) continue;
    while (k + 1 < n - 1 && cp[2 * (k + 1) + 1]! <= d) k++;
    const d0 = cp[2 * k + 1]!;
    const d1 = cp[2 * (k + 1) + 1]!;
    const t0 = cp[2 * k]!;
    const t1 = cp[2 * (k + 1)]!;
    pts.push({ d, t: d1 === d0 ? t0 : t0 + ((d - d0) / (d1 - d0)) * (t1 - t0) });
  }
  pts.sort((a, b) => a.d - b.d || a.t - b.t);

  return {
    mode,
    route: trip.route,
    headsign: trip.headsign,
    path: pts.map((p) => coordAt(shape, p.d)),
    times: pts.map((p) => p.t + offset),
  };
}

function coordAt(shape: Network["shapes"][number], d: number): [number, number] {
  const dist = shape.dist;
  let lo = 0;
  let hi = dist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (dist[mid]! <= d) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= dist.length - 1) return shape.coords[dist.length - 1]!;
  const span = dist[lo + 1]! - dist[lo]!;
  const u = span === 0 ? 0 : (d - dist[lo]!) / span;
  const a = shape.coords[lo]!;
  const b = shape.coords[lo + 1]!;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

/** Where the trip is at time `t`, or null if it is not running. Pure function of `t`, so scrubbing is free. */
export function positionAt(trip: SimTrip, t: number): [number, number] | null {
  const times = trip.times;
  if (t < times[0]! || t > times[times.length - 1]!) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= times.length - 1) return trip.path[lo]!;
  const span = times[lo + 1]! - times[lo]!;
  const u = span === 0 ? 0 : (t - times[lo]!) / span;
  const a = trip.path[lo]!;
  const b = trip.path[lo + 1]!;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}
