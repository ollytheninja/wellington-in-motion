import { cumulativeDistance, toMetres, type LonLat } from "../src/geo";

export interface Polyline {
  coords: LonLat[];
  /** Cumulative metres from the first point. */
  dist: number[];
}

export function buildPolyline(coords: LonLat[]): Polyline {
  return { coords, dist: cumulativeDistance(coords) };
}

/** Douglas-Peucker. Drops vertices that are within `toleranceM` of the straight line between their neighbours. */
export function simplify(coords: LonLat[], toleranceM: number): LonLat[] {
  if (coords.length <= 2) return coords;
  const lat0 = coords[0]![1];
  const pts = coords.map(([lon, lat]) => toMetres(lon, lat, lat0));
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = pts[first]!;
    const [bx, by] = pts[last]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstDist = toleranceM;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = pts[i]!;
      const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

export interface Projection {
  /** Metres along the polyline. */
  along: number;
  /** Metres from the polyline to the point. */
  offset: number;
  /** Index of the segment the point landed on. */
  segment: number;
}

/**
 * Nearest point on the polyline, searching only segments at or after `fromSegment`.
 * Stops on one trip are visited in order, so passing the previous result stops a
 * line that doubles back from snapping a stop to the wrong pass.
 */
export function projectOnto(line: Polyline, lon: number, lat: number, fromSegment = 0): Projection {
  const lat0 = line.coords[0]?.[1] ?? lat;
  const [px, py] = toMetres(lon, lat, lat0);
  let best: Projection = { along: 0, offset: Infinity, segment: fromSegment };
  for (let i = fromSegment; i < line.coords.length - 1; i++) {
    const [ax, ay] = toMetres(...line.coords[i]!, lat0);
    const [bx, by] = toMetres(...line.coords[i + 1]!, lat0);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const offset = Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
    if (offset < best.offset) {
      best = { along: line.dist[i]! + u * Math.sqrt(len2), offset, segment: i };
    }
  }
  return best;
}

interface Candidate {
  along: number;
  offset: number;
}

const metreCache = new WeakMap<Polyline, { xs: Float64Array; ys: Float64Array }>();

function metresOf(line: Polyline) {
  let m = metreCache.get(line);
  if (!m) {
    const lat0 = line.coords[0]?.[1] ?? 0;
    const xs = new Float64Array(line.coords.length);
    const ys = new Float64Array(line.coords.length);
    line.coords.forEach(([lon, lat], i) => {
      [xs[i], ys[i]] = toMetres(lon, lat, lat0);
    });
    metreCache.set(line, (m = { xs, ys }));
  }
  return m;
}

/** Places along the line that are a plausible home for the point: local minima of distance, near the best one. */
function candidates(line: Polyline, lon: number, lat: number): Candidate[] {
  const { xs, ys } = metresOf(line);
  const [px, py] = toMetres(lon, lat, line.coords[0]?.[1] ?? lat);
  const n = xs.length - 1;
  const offsets = new Float64Array(n);
  const alongs = new Float64Array(n);
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = xs[i + 1]! - xs[i]!;
    const dy = ys[i + 1]! - ys[i]!;
    const len2 = dx * dx + dy * dy;
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - xs[i]!) * dx + (py - ys[i]!) * dy) / len2));
    offsets[i] = Math.hypot(px - (xs[i]! + u * dx), py - (ys[i]! + u * dy));
    alongs[i] = line.dist[i]! + u * Math.sqrt(len2);
    if (offsets[i]! < min) min = offsets[i]!;
  }
  const out: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    const o = offsets[i]!;
    if (o > min + 30) continue;
    if ((i > 0 && offsets[i - 1]! < o) || (i < n - 1 && offsets[i + 1]! < o)) continue;
    out.push({ along: alongs[i]!, offset: o });
  }
  return out.sort((a, b) => a.offset - b.offset).slice(0, 8);
}

/**
 * Places every stop of a trip on its shape. Stops are visited in order, so the positions must
 * not go backwards. Picking each stop's nearest point greedily fails when a road doubles back
 * or runs parallel to itself, so this chooses the set of positions with the least total offset.
 */
export function projectStops(line: Polyline, stops: { lon: number; lat: number }[]): Projection[] {
  const cands = stops.map((s) => candidates(line, s.lon, s.lat));
  const cost: number[][] = [];
  const from: number[][] = [];
  cands.forEach((cs, j) => {
    cost.push([]);
    from.push([]);
    cs.forEach((c, k) => {
      if (j === 0) {
        cost[j]![k] = c.offset;
        from[j]![k] = -1;
        return;
      }
      let best = Infinity;
      let bestFrom = 0;
      let fallback = Infinity;
      let fallbackFrom = 0;
      cands[j - 1]!.forEach((p, i) => {
        const total = cost[j - 1]![i]!;
        if (p.along <= c.along + 0.5 && total < best) {
          best = total;
          bestFrom = i;
        }
        if (total < fallback) {
          fallback = total;
          fallbackFrom = i;
        }
      });
      // No earlier position is behind this one. Allow it at a heavy penalty and clamp later.
      const useFallback = best === Infinity;
      cost[j]![k] = c.offset + (useFallback ? fallback + 1000 : best);
      from[j]![k] = useFallback ? fallbackFrom : bestFrom;
    });
  });

  const out: Projection[] = new Array(stops.length);
  let k = cost[stops.length - 1]!.reduce((bi, v, i, a) => (v < a[bi]! ? i : bi), 0);
  for (let j = stops.length - 1; j >= 0; j--) {
    const c = cands[j]![k]!;
    out[j] = { along: c.along, offset: c.offset, segment: 0 };
    k = from[j]![k]!;
  }
  return out;
}
