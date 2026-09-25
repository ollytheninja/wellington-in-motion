/** A set of routes for one mode, decoded and ready for the simulation. */
export interface Network {
  feedVersion: string;
  routes: RouteInfo[];
  /** Track or road geometry. `coords` is [lon, lat] pairs, `dist` is metres from the start. */
  shapes: { coords: [number, number][]; dist: number[] }[];
  stops: Record<string, { name: string; lon: number; lat: number }>;
  /** Service ids are indexes into this list. Values are YYYYMMDD dates the service runs. */
  services: string[][];
  trips: TripRecord[];
}

export interface RouteInfo {
  id: string;
  short: string;
  name: string;
}

export interface TripRecord {
  route: number;
  shape: number;
  service: number;
  headsign: string;
  /** Flat control points: [seconds, metresAlongShape, ...]. Arrival and departure of a stop are separate points. */
  cp: number[];
}

/**
 * What the pipeline writes to public/data/*.json. Same content as Network, packed
 * so the bus file stays a few MB. See src/data/wire.ts.
 */
export interface WireNetwork {
  version: 2;
  feedVersion: string;
  /** YYYYMMDD of the first day in each service bit string. */
  startDate: string;
  routes: RouteInfo[];
  /** Each shape is [lon0, lat0, dlon1, dlat1, ...] in units of 1e-5 degrees. */
  shapes: number[][];
  stops: Network["stops"];
  /** One string of "0" and "1" per service, one character per day from `startDate`. */
  services: string[];
  trips: {
    r: number;
    s: number;
    v: number;
    h: string;
    /** Control points, delta encoded: [t0, d0, dt1, dd1, ...]. */
    c: number[];
  }[];
}
