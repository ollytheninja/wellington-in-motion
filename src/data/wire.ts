import { cumulativeDistance, type LonLat } from "../geo";
import type { Network, WireNetwork } from "../types";

const SCALE = 1e5;

export function encodeShape(coords: LonLat[]): number[] {
  const out: number[] = [];
  let pLon = 0;
  let pLat = 0;
  for (const [lon, lat] of coords) {
    const iLon = Math.round(lon * SCALE);
    const iLat = Math.round(lat * SCALE);
    out.push(iLon - pLon, iLat - pLat);
    pLon = iLon;
    pLat = iLat;
  }
  return out;
}

export function decodeShape(packed: number[]): LonLat[] {
  const out: LonLat[] = [];
  let lon = 0;
  let lat = 0;
  for (let i = 0; i < packed.length; i += 2) {
    lon += packed[i]!;
    lat += packed[i + 1]!;
    out.push([lon / SCALE, lat / SCALE]);
  }
  return out;
}

export function deltaEncode(values: number[]): number[] {
  return values.map((v, i) => (i < 2 ? v : v - values[i - 2]!));
}

export function deltaDecode(packed: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < packed.length; i++) out.push(i < 2 ? packed[i]! : packed[i]! + out[i - 2]!);
  return out;
}

/** `date` (YYYYMMDD) moved by `n` days. */
export function addDays(date: string, n: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + n));
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

export function encodeServices(services: string[][], startDate: string, days: number): string[] {
  return services.map((dates) => {
    const set = new Set(dates);
    let s = "";
    for (let i = 0; i < days; i++) s += set.has(addDays(startDate, i)) ? "1" : "0";
    return s;
  });
}

export function decodeNetwork(wire: WireNetwork): Network {
  const shapes = wire.shapes.map((packed) => {
    const coords = decodeShape(packed);
    return { coords, dist: cumulativeDistance(coords) };
  });
  const services = wire.services.map((bits) => {
    const dates: string[] = [];
    for (let i = 0; i < bits.length; i++) if (bits[i] === "1") dates.push(addDays(wire.startDate, i));
    return dates;
  });
  return {
    feedVersion: wire.feedVersion,
    routes: wire.routes,
    shapes,
    stops: wire.stops,
    services,
    trips: wire.trips.map((t) => ({
      route: t.r,
      shape: t.s,
      service: t.v,
      headsign: t.h,
      cp: deltaDecode(t.c),
    })),
  };
}
