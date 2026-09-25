/**
 * Turns the Metlink GTFS feed in ./gtfs into public/data/network.json (rail) and
 * public/data/buses.json. Run with `make data`.
 */
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse";
import type { LonLat } from "../src/geo";
import type { WireNetwork } from "../src/types";
import { decodeShape, deltaEncode, encodeServices, encodeShape } from "../src/data/wire";
import { buildPolyline, projectStops, simplify, type Polyline } from "./project";

const GTFS_DIR = new URL("../gtfs/", import.meta.url).pathname;
const OUT_DIR = new URL("../public/data/", import.meta.url).pathname;

interface ModeConfig {
  name: string;
  file: string;
  routeTypes: string[];
  /** Shapes are simplified to this tolerance in metres. */
  toleranceM: number;
  /** Bus stops are too many to draw, so only rail ships them. */
  includeStops: boolean;
}

// Route types: 2 rail, 3 bus, 712 school bus. Ferry (4) and cable car (5) are not included yet.
const MODES: ModeConfig[] = [
  { name: "rail", file: "network.json", routeTypes: ["2"], toleranceM: 1, includeStops: true },
  { name: "bus", file: "buses.json", routeTypes: ["3", "712"], toleranceM: 3, includeStops: false },
];

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
const parseDate = (s: string) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);

async function main() {
  const feedInfo: Row[] = [];
  await readCsv("feed_info.txt", (r) => feedInfo.push(r));
  const feed = feedInfo[0]!;

  // Which mode each route belongs to
  const modeOfType = new Map(MODES.flatMap((m) => m.routeTypes.map((t) => [t, m] as const)));
  const routeRows = new Map<string, Row>();
  const routeMode = new Map<string, ModeConfig>();
  await readCsv("routes.txt", (r) => {
    const mode = modeOfType.get(r.route_type!);
    if (!mode) return;
    routeRows.set(r.route_id!, r);
    routeMode.set(r.route_id!, mode);
  });

  const tripRows: Row[] = [];
  await readCsv("trips.txt", (r) => routeRows.has(r.route_id!) && tripRows.push(r));
  const tripIds = new Set(tripRows.map((t) => t.trip_id!));
  const shapeIds = new Set(tripRows.map((t) => t.shape_id!));
  const serviceIds = new Set(tripRows.map((t) => t.service_id!));

  const rawShapes = new Map<string, { seq: number; lon: number; lat: number }[]>();
  await readCsv("shapes.txt", (r) => {
    if (!shapeIds.has(r.shape_id!)) return;
    let pts = rawShapes.get(r.shape_id!);
    if (!pts) rawShapes.set(r.shape_id!, (pts = []));
    pts.push({ seq: +r.shape_pt_sequence!, lon: +r.shape_pt_lon!, lat: +r.shape_pt_lat! });
  });

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
  await readCsv("calendar.txt", (r) => serviceIds.has(r.service_id!) && cal.set(r.service_id!, r));
  const exceptions = new Map<string, Map<string, string>>();
  await readCsv("calendar_dates.txt", (r) => {
    if (!serviceIds.has(r.service_id!)) return;
    let m = exceptions.get(r.service_id!);
    if (!m) exceptions.set(r.service_id!, (m = new Map()));
    m.set(r.date!, r.exception_type!);
  });
  const days: string[] = [];
  for (let d = parseDate(feed.feed_start_date!); ymd(d) <= feed.feed_end_date!; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(ymd(d));
  }
  const runsOn = (id: string, day: string): boolean => {
    const ex = exceptions.get(id)?.get(day);
    if (ex === "1") return true;
    if (ex === "2") return false;
    const c = cal.get(id);
    if (!c) return false;
    return c[DAY_NAMES[parseDate(day).getUTCDay()]!] === "1" && c.start_date! <= day && day <= c.end_date!;
  };

  mkdirSync(OUT_DIR, { recursive: true });
  for (const mode of MODES) {
    const modeTrips = tripRows.filter((t) => routeMode.get(t.route_id!) === mode);
    const routeList = [...new Set(modeTrips.map((t) => t.route_id!))];
    const routeIndex = new Map(routeList.map((id, i) => [id, i]));
    const shapeList = [...new Set(modeTrips.map((t) => t.shape_id!))];
    const shapeIndex = new Map(shapeList.map((id, i) => [id, i]));
    const serviceList = [...new Set(modeTrips.map((t) => t.service_id!))];
    const serviceIndex = new Map(serviceList.map((id, i) => [id, i]));

    // Simplify, then round to the wire precision so the browser sees the same line we project onto
    let rawPoints = 0;
    let keptPoints = 0;
    const packedShapes: number[][] = [];
    const polylines: Polyline[] = shapeList.map((id) => {
      const pts = rawShapes.get(id)!.sort((a, b) => a.seq - b.seq);
      const simple = simplify(
        pts.map((p): LonLat => [p.lon, p.lat]),
        mode.toleranceM,
      );
      const packed = encodeShape(simple);
      packedShapes.push(packed);
      rawPoints += pts.length;
      keptPoints += simple.length;
      return buildPolyline(decodeShape(packed));
    });

    const trips: WireNetwork["trips"] = [];
    const usedStops: WireNetwork["stops"] = {};
    let worstOffset = 0;
    let worstTrip = "";
    let farStops = 0;
    let totalStops = 0;
    for (const t of modeTrips) {
      const list = stopTimes.get(t.trip_id!)?.sort((a, b) => a.seq - b.seq);
      if (!list || list.length < 2) continue;
      const line = polylines[shapeIndex.get(t.shape_id!)!]!;
      const cp: number[] = [];
      let lastAlong = 0;
      let lastTime = 0;
      const stops = list.map((st) => stopRows.get(st.stop)!);
      const projections = projectStops(
        line,
        stops.map((s) => ({ lon: +s.stop_lon!, lat: +s.stop_lat! })),
      );
      list.forEach((st, i) => {
        const stop = stops[i]!;
        const p = projections[i]!;
        totalStops++;
        if (p.offset > 30) farStops++;
        if (p.offset > worstOffset) {
          worstOffset = p.offset;
          worstTrip = `${t.trip_id} at ${stop.stop_name}`;
        }
        const along = Math.round(Math.max(p.along, lastAlong));
        const arr = Math.max(st.arr, lastTime);
        const dep = Math.max(st.dep, arr);
        cp.push(arr, along);
        if (dep !== arr) cp.push(dep, along);
        lastAlong = along;
        lastTime = dep;
        if (mode.includeStops) {
          usedStops[st.stop] = { name: stop.stop_name!, lon: +stop.stop_lon!, lat: +stop.stop_lat! };
        }
      });
      trips.push({
        r: routeIndex.get(t.route_id!)!,
        s: shapeIndex.get(t.shape_id!)!,
        v: serviceIndex.get(t.service_id!)!,
        h: t.trip_headsign ?? "",
        c: deltaEncode(cp),
      });
    }

    const wire: WireNetwork = {
      version: 2,
      feedVersion: `${feed.feed_version} (${feed.feed_start_date}-${feed.feed_end_date})`,
      startDate: days[0]!,
      routes: routeList.map((id) => {
        const r = routeRows.get(id)!;
        return { id, short: r.route_short_name!, name: r.route_long_name! };
      }),
      shapes: packedShapes,
      stops: usedStops,
      services: encodeServices(
        serviceList.map((id) => days.filter((d) => runsOn(id, d))),
        days[0]!,
        days.length,
      ),
      trips,
    };
    const json = JSON.stringify(wire);
    writeFileSync(OUT_DIR + mode.file, json);
    console.log(
      `${mode.name}: ${routeList.length} routes, ${shapeList.length} shapes (${rawPoints} to ${keptPoints} points), ${trips.length} trips`,
    );
    console.log(
      `  stops more than 30 m from their shape: ${farStops} of ${totalStops}, worst ${worstOffset.toFixed(0)} m (${worstTrip})`,
    );
    console.log(`  wrote ${(json.length / 1024 / 1024).toFixed(2)} MiB to ${mode.file}`);
  }
}

await main();
