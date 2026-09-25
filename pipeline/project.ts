/** Planar approximation, good to well under a metre over the size of Wellington. */
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_AT_EQUATOR = 111320;

export interface Polyline {
  coords: [number, number][];
  /** Cumulative metres from the first point. */
  dist: number[];
}

function toMetres(lon: number, lat: number, lat0: number): [number, number] {
  return [lon * M_PER_DEG_LON_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180), lat * M_PER_DEG_LAT];
}

export function buildPolyline(coords: [number, number][]): Polyline {
  const lat0 = coords[0]?.[1] ?? 0;
  const dist = [0];
  for (let i = 1; i < coords.length; i++) {
    const a = toMetres(...coords[i - 1]!, lat0);
    const b = toMetres(...coords[i]!, lat0);
    dist.push(dist[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { coords, dist };
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
