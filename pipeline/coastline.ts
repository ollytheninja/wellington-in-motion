/**
 * Fetches the LINZ NZ Coastlines (Topo, 1:50k) layer for the Wellington region, clips and
 * simplifies it, and writes public/data/coastline.json. Run with `make coastline`.
 *
 * Needs a LINZ Data Service API key in LINZ_API_KEY. The raw download is cached in
 * ./cache/linz so reprocessing does not need the network. Pass --offline to skip the download.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { LonLat } from "../src/geo";
import type { WireCoastline } from "../src/types";
import { encodeShape } from "../src/data/wire";
import { simplify } from "./project";

const LAYER_ID = 50258;
const LAYER_URL = "https://data.linz.govt.nz/layer/50258-nz-coastlines-topo-150k/";
const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";
const CACHE = new URL("../cache/linz/coastline-topo50.geojson", import.meta.url).pathname;
const OUT = new URL("../public/data/coastline.json", import.meta.url).pathname;

/** Kapiti to Wairarapa, with room to spare. */
const BBOX = { west: 174.4, south: -41.7, east: 176.2, north: -40.5 };
const TOLERANCE_M = 4;

async function download(key: string): Promise<void> {
  const { west, south, east, north } = BBOX;
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: `layer-${LAYER_ID}`,
    outputFormat: "json",
    srsName: "EPSG:4326",
    // WFS 2.0 with an EPSG URN takes latitude first.
    bbox: `${south},${west},${north},${east},urn:ogc:def:crs:EPSG::4326`,
  });
  const res = await fetch(`https://data.linz.govt.nz/services;key=${key}/wfs?${params}`);
  if (!res.ok) throw new Error(`LINZ WFS returned ${res.status}. Check LINZ_API_KEY.`);
  mkdirSync(new URL("../cache/linz/", import.meta.url).pathname, { recursive: true });
  writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
}

const inside = ([lon, lat]: LonLat) => lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;

/** Cuts a line into the runs that are inside the box, keeping one point either side so lines reach the edge. */
function clip(line: LonLat[]): LonLat[][] {
  const runs: LonLat[][] = [];
  let run: LonLat[] = [];
  line.forEach((p, i) => {
    if (inside(p)) {
      if (run.length === 0 && i > 0) run.push(line[i - 1]!);
      run.push(p);
    } else if (run.length > 0) {
      run.push(p);
      runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);
  return runs.filter((r) => r.length >= 2);
}

async function main() {
  const offline = process.argv.includes("--offline");
  if (!offline) {
    const key = process.env.LINZ_API_KEY;
    if (!key) throw new Error("LINZ_API_KEY is not set. See .env.example.");
    console.log("Downloading NZ Coastlines (Topo, 1:50k) from the LINZ Data Service");
    await download(key);
  } else if (!existsSync(CACHE)) {
    throw new Error(`No cached download at ${CACHE}. Run without --offline first.`);
  }

  const geojson = JSON.parse(readFileSync(CACHE, "utf8")) as {
    features: { geometry: { type: string; coordinates: LonLat[] | LonLat[][] } }[];
  };
  let rawPoints = 0;
  const lines: number[][] = [];
  let keptPoints = 0;
  for (const f of geojson.features) {
    const parts = f.geometry.type === "LineString" ? [f.geometry.coordinates as LonLat[]] : (f.geometry.coordinates as LonLat[][]);
    for (const part of parts) {
      rawPoints += part.length;
      for (const run of clip(part)) {
        const simple = simplify(run, TOLERANCE_M);
        keptPoints += simple.length;
        lines.push(encodeShape(simple));
      }
    }
  }

  const out: WireCoastline = {
    version: 1,
    source: "Land Information New Zealand (LINZ), NZ Coastlines (Topo, 1:50k)",
    sourceUrl: LAYER_URL,
    licence: "CC BY 4.0",
    licenceUrl: LICENCE_URL,
    changes: `Clipped to the Wellington region and simplified to ${TOLERANCE_M} m.`,
    lines,
  };
  mkdirSync(new URL("../public/data/", import.meta.url).pathname, { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync(OUT, json);
  console.log(`${geojson.features.length} features, ${rawPoints} points, ${lines.length} lines, ${keptPoints} points kept`);
  console.log(`wrote ${(json.length / 1024).toFixed(0)} KiB to coastline.json`);
}

await main();
