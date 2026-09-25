/**
 * Turns the Metlink GTFS feed in ./gtfs into public/data/network.json (rail only).
 * Run with `npm run data`.
 */
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse";
import type { Network, TripRecord } from "../src/types";
import { buildPolyline, projectOnto, type Polyline } from "./project";

const GTFS_DIR = new URL("../gtfs/", import.meta.url).pathname;
const OUT = new URL("../public/data/network.json", import.meta.url).pathname;
const RAIL = "2";

type Row = Record<string, string>;

async function readCsv(name: string, onRow: (row: Row) => void): Promise<void> {
  const parser = createReadStream(GTFS_DIR + name).pipe(
    parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }),
  );
  for await (const row of parser) onRow(row as Row);
}

function gtfsSeconds(t: string): number {
  const [h, m, s] = t.split(":").map(Number);
  return h! * 3600 + m! * 60 + (s ?? 0);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

async function main() {
  const feedInfo: Row[] = [];
  await readCsv("feed_info.txt", (r) => feedInfo.push(r));
  const feed = feedInfo[0]!;

  const routeRows: Row[] = [];
  await readCsv("routes.txt", (r) => r.route_type === RAIL && routeRows.push(r));
  const routeIndex = new Map(routeRows.map((r, i) => [r.route_id!, i]));

  const tripRows: Row[] = [];
  await readCsv("trips.txt", (r) => routeIndex.has(r.route_id!) && tripRows.push(r));
  const tripIds = new Set(tripRows.map((t) => t.trip_id!));
  const shapeIds = [...new Set(tripRows.map((t) => t.shape_id!))];
  const shapeIndex = new Map(shapeIds.map((id, i) => [id, i]));
  const serviceIds = [...new Set(tripRows.map((t) => t.service_id!))];
  const serviceIndex = new Map(serviceIds.map((id, i) => [id, i]));

  // Shapes
  const rawShapes = new Map<string, { seq: number; lon: number; lat: number }[]>();
  await readCsv("shapes.txt", (r) => {
    if (!shapeIndex.has(r.shape_id!)) return;
    let pts = rawShapes.get(r.shape_id!);
    if (!pts) rawShapes.set(r.shape_id!, (pts = []));
    pts.push({ seq: +r.shape_pt_sequence!, lon: +r.shape_pt_lon!, lat: +r.shape_pt_lat! });
  });
  const polylines: Polyline[] = shapeIds.map((id) => {
    const pts = rawShapes.get(id)!.sort((a, b) => a.seq - b.seq);
    return buildPolyline(pts.map((p) => [p.lon, p.lat]));
  });

  // Stops and stop times
  const stopRows = new Map<string, Row>();
  await readCsv("stops.txt", (r) => stopRows.set(r.stop_id!, r));
  const stopTimes = new Map<string, { seq: number; arr: number; dep: number; stop: string }[]>();
  await readCsv("stop_times.txt", (r) => {
    if (!tripIds.has(r.trip_id!)) return;
    let list = stopTimes.get(r.trip_id!);
    if (!list) stopTimes.set(r.trip_id!, (list = []));
    list.push({
      seq: +r.stop_sequence!,
      arr: gtfsSeconds(r.arrival_time!),
      dep: gtfsSeconds(r.departure_time!),
      stop: r.stop_id!,
    });
  });

  // Service days, within the feed's own window
  const cal = new Map<string, Row>();
  await readCsv("calendar.txt", (r) => serviceIndex.has(r.service_id!) && cal.set(r.service_id!, r));
  const exceptions = new Map<string, Map<string, string>>();
  await readCsv("calendar_dates.txt", (r) => {
    if (!serviceIndex.has(r.service_id!)) return;
    let m = exceptions.get(r.service_id!);
    if (!m) exceptions.set(r.service_id!, (m = new Map()));
    m.set(r.date!, r.exception_type!);
  });
  const parseDate = (s: string) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
  const days: string[] = [];
  for (let d = parseDate(feed.feed_start_date!); ymd(d) <= feed.feed_end_date!; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(ymd(d));
  }
  const services: string[][] = serviceIds.map((id) => {
    const c = cal.get(id);
    return days.filter((day) => {
      const ex = exceptions.get(id)?.get(day);
      if (ex === "1") return true;
      if (ex === "2") return false;
      if (!c) return false;
      const weekday = DAY_NAMES[parseDate(day).getUTCDay()]!;
      return c[weekday] === "1" && c.start_date! <= day && day <= c.end_date!;
    });
  });

  // Trips: project each stop onto the shape to get control points
  const trips: TripRecord[] = [];
  let worstOffset = 0;
  let worstTrip = "";
  let nonMonotonic = 0;
  for (const t of tripRows) {
    const list = stopTimes.get(t.trip_id!)?.sort((a, b) => a.seq - b.seq);
    if (!list || list.length < 2) continue;
    const line = polylines[shapeIndex.get(t.shape_id!)!]!;
    const cp: number[] = [];
    let segment = 0;
    let lastAlong = 0;
    let lastTime = 0;
    for (const st of list) {
      const stop = stopRows.get(st.stop)!;
      const p = projectOnto(line, +stop.stop_lon!, +stop.stop_lat!, segment);
      segment = p.segment;
      if (p.offset > worstOffset) {
        worstOffset = p.offset;
        worstTrip = `${t.trip_id} at ${stop.stop_name}`;
      }
      if (p.along < lastAlong) nonMonotonic++;
      const along = Math.round(Math.max(p.along, lastAlong));
      const arr = Math.max(st.arr, lastTime);
      const dep = Math.max(st.dep, arr);
      cp.push(arr, along);
      if (dep !== arr) cp.push(dep, along);
      lastAlong = along;
      lastTime = dep;
    }
    trips.push({
      route: routeIndex.get(t.route_id!)!,
      shape: shapeIndex.get(t.shape_id!)!,
      service: serviceIndex.get(t.service_id!)!,
      headsign: t.trip_headsign ?? "",
      cp,
    });
  }

  const usedStops: Network["stops"] = {};
  for (const list of stopTimes.values()) {
    for (const st of list) {
      const s = stopRows.get(st.stop)!;
      usedStops[st.stop] = { name: s.stop_name!, lon: +s.stop_lon!, lat: +s.stop_lat! };
    }
  }

  const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
  const network: Network = {
    feedVersion: `${feed.feed_version} (${feed.feed_start_date}-${feed.feed_end_date})`,
    routes: routeRows.map((r) => ({ id: r.route_id!, short: r.route_short_name!, name: r.route_long_name! })),
    shapes: polylines.map((p) => ({
      coords: p.coords.map(([lon, lat]) => [round5(lon), round5(lat)]),
      dist: p.dist.map(Math.round),
    })),
    stops: usedStops,
    services,
    trips,
  };

  mkdirSync(new URL("../public/data/", import.meta.url).pathname, { recursive: true });
  const json = JSON.stringify(network);
  writeFileSync(OUT, json);
  console.log(`feed ${network.feedVersion}`);
  console.log(`${network.routes.length} routes, ${network.shapes.length} shapes, ${Object.keys(usedStops).length} stops, ${trips.length} trips`);
  console.log(`worst stop-to-shape offset ${worstOffset.toFixed(0)} m (${worstTrip}), ${nonMonotonic} non-monotonic projections`);
  console.log(`wrote ${(json.length / 1024).toFixed(0)} KiB to ${OUT}`);
}

await main();
