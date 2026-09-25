/** Shape of public/data/network.json. Written by pipeline/, read by src/data/. */
export interface Network {
  feedVersion: string;
  routes: RouteInfo[];
  /** Track geometry. `coords` is [lon, lat] pairs, `dist` is metres from the start. */
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
