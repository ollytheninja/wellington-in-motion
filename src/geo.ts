/** Planar approximation, good to well under a metre over the size of Wellington. */
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_AT_EQUATOR = 111320;

export type LonLat = [number, number];

/** Metres east and north of the origin, scaled at latitude `lat0`. */
export function toMetres(lon: number, lat: number, lat0: number): [number, number] {
  return [lon * M_PER_DEG_LON_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180), lat * M_PER_DEG_LAT];
}

/** Cumulative metres along a line, one entry per vertex. */
export function cumulativeDistance(coords: LonLat[]): number[] {
  const lat0 = coords[0]?.[1] ?? 0;
  const dist = [0];
  for (let i = 1; i < coords.length; i++) {
    const a = toMetres(...coords[i - 1]!, lat0);
    const b = toMetres(...coords[i]!, lat0);
    dist.push(dist[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return dist;
}
