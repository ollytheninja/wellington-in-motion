import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import type { Layer } from "@deck.gl/core";
import type { Coastline, Mode } from "../data/load";
import type { Network } from "../types";
import { BUS_COLOUR, FALLBACK_COLOUR, FERRY_COLOUR, LINE_COLOURS, hexToRgb } from "../palette";
import { positionAt, type SimTrip } from "../sim/sim";

const HILLSHADE_KEY = import.meta.env.VITE_LINZ_BASEMAPS_KEY as string | undefined;

/** Hillshade of the New Zealand surface model. Sea is transparent, so it stays as dark as the background. */
const HILLSHADE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    hillshade: {
      type: "raster",
      tiles: [`https://basemaps.linz.govt.nz/v1/tiles/hillshade-igor-dsm/WebMercatorQuad/{z}/{x}/{y}.webp?api=${HILLSHADE_KEY}`],
      tileSize: 256,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#05070d" } },
    // Sea is the lightest thing in the tiles and land is shaded darker. Flip that, so the sea is near black, land is a dim grey and the network still glows.
    { id: "hillshade", type: "raster", source: "hillshade", paint: { "raster-brightness-min": 0.3, "raster-brightness-max": 0.03 } },
  ],
};

const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#05070d" } }],
};

/** Without a key there is no hillshade, so the map falls back to the plain dark background. */
const STYLE = HILLSHADE_KEY ? HILLSHADE_STYLE : EMPTY_STYLE;

/** Adds up brightness where things overlap. This is what makes busy corridors glow. */
const ADDITIVE = {
  blend: true,
  blendColorSrcFactor: "src-alpha",
  blendColorDstFactor: "one",
  blendAlphaSrcFactor: "one",
  blendAlphaDstFactor: "one",
} as const;

type Rgb = [number, number, number];
/** A cool blue-grey, brighter than the bus routes so the shape of the harbour reads first. */
const COAST_RGBA: [number, number, number, number] = [110, 140, 185, 130];
/** Dark enough that the bus network reads as a backdrop, not as something moving. */
const BUS_ROUTE_RGBA: [number, number, number, number] = [74, 78, 90, 150];
const rgba = (c: Rgb, a: number): [number, number, number, number] => [c[0], c[1], c[2], a];

function bounds(nets: Network[]): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const net of nets) {
    for (const shape of net.shapes) {
      for (const [lon, lat] of shape.coords) {
        w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat);
      }
    }
  }
  return [[w, s], [e, n]];
}

/**
 * Trips grouped by start time. Only a few chunks run at any moment, so the rest are hidden and
 * cost nothing to draw. Their data never changes, so hiding one does not re-upload it. Without
 * this the bus trail layer pushes about a million vertices through the GPU every frame, and
 * about 7% of them belong to buses that are running.
 */
interface Chunk {
  trips: SimTrip[];
  /** Earliest first time and latest last time of any trip in the chunk. */
  start: number;
  end: number;
}

const CHUNK_SIZE = 250;

function chunkTrips(trips: SimTrip[]): Chunk[] {
  const sorted = [...trips].sort((a, b) => a.times[0]! - b.times[0]!);
  const chunks: Chunk[] = [];
  for (let i = 0; i < sorted.length; i += CHUNK_SIZE) {
    const group = sorted.slice(i, i + CHUNK_SIZE);
    let start = Infinity;
    let end = -Infinity;
    for (const trip of group) {
      start = Math.min(start, trip.times[0]!);
      end = Math.max(end, trip.times[trip.times.length - 1]!);
    }
    chunks.push({ trips: group, start, end });
  }
  return chunks;
}

/** Dots for one mode, as flat arrays so deck.gl can upload them without calling an accessor per dot. */
interface Dots {
  count: number;
  positions: Float64Array;
  colours: Uint8Array;
}

interface Style {
  trailWidth: number;
  glow: number;
  inner: number;
  core: number;
}

const STYLES: Record<Mode, Style> = {
  rail: { trailWidth: 2.5, glow: 20, inner: 9, core: 3.5 },
  ferry: { trailWidth: 2.5, glow: 20, inner: 9, core: 3.5 },
  bus: { trailWidth: 1.5, glow: 10, inner: 5, core: 1.8 },
};

/** Bottom first. Later modes draw on top, so buses never hide a train. */
const DRAW_ORDER: Mode[] = ["bus", "ferry", "rail"];

export type Counts = Record<Mode, number>;

export class Scene {
  private map: maplibregl.Map;
  private overlay: MapboxOverlay;
  private railColours: Rgb[];
  private baseLines: { path: [number, number][]; colour: Rgb }[] = [];
  private coastLines: { path: [number, number][] }[];
  private busLines: { path: [number, number][] }[] = [];
  private stops: { pos: [number, number] }[] = [];
  private chunks: Record<Mode, Chunk[]> = { rail: [], ferry: [], bus: [] };
  private visible: Record<Mode, boolean> = { rail: true, ferry: true, bus: true };
  private fixedColour: Record<"ferry" | "bus", Rgb> = { ferry: hexToRgb(FERRY_COLOUR), bus: hexToRgb(BUS_COLOUR) };

  /** `base` are the modes with drawn track and stops. Their shapes set the initial view. */
  constructor(container: HTMLElement, base: { mode: Mode; net: Network }[], coastline: Coastline | null) {
    this.coastLines = (coastline?.lines ?? []).map((path) => ({ path }));
    const rail = base.find((b) => b.mode === "rail")!.net;
    this.railColours = rail.routes.map((r) => hexToRgb(LINE_COLOURS[r.short] ?? FALLBACK_COLOUR));
    for (const { mode, net } of base) {
      const shapeRoute = new Map<number, number>();
      for (const t of net.trips) if (!shapeRoute.has(t.shape)) shapeRoute.set(t.shape, t.route);
      net.shapes.forEach((s, i) =>
        this.baseLines.push({
          path: s.coords,
          colour: mode === "rail" ? this.railColours[shapeRoute.get(i) ?? 0]! : this.fixedColour[mode as "ferry"],
        }),
      );
      for (const s of Object.values(net.stops)) this.stops.push({ pos: [s.lon, s.lat] });
    }

    this.map = new maplibregl.Map({
      container,
      style: STYLE,
      bounds: bounds(base.map((b) => b.net)),
      fitBoundsOptions: { padding: { top: 60, bottom: 120, left: 60, right: 60 } },
      attributionControl: false,
    });
    // Deck draws to its own canvas. Capping the pixel ratio cuts the pixels it fills on high-density screens.
    this.overlay = new MapboxOverlay({ interleaved: false, layers: [], useDevicePixels: Math.min(window.devicePixelRatio || 1, 1.5) });
    this.map.addControl(this.overlay as unknown as maplibregl.IControl);
  }

  /** Draw every bus route as a dark grey line. Buses load after the rest, so this is separate from the constructor. */
  setBusRoutes(net: Network): void {
    this.busLines = net.shapes.map((s) => ({ path: s.coords }));
  }

  setTrips(mode: Mode, trips: SimTrip[]): void {
    this.chunks[mode] = chunkTrips(trips);
  }

  setVisible(mode: Mode, on: boolean): void {
    this.visible[mode] = on;
  }

  private colourOf(trip: SimTrip): Rgb {
    return trip.mode === "rail" ? this.railColours[trip.route]! : this.fixedColour[trip.mode];
  }

  /** Draw the network at time `t`. `speed` is simulated seconds per real second and sets the trail length. */
  draw(t: number, speed: number): Counts {
    const trail = Math.min(900, Math.max(120, speed * 0.75));
    const counts: Counts = { rail: 0, ferry: 0, bus: 0 };
    const layers: Layer[] = [
      new PathLayer<{ path: [number, number][] }>({
        id: "coastline",
        data: this.coastLines,
        getPath: (d) => d.path,
        getColor: COAST_RGBA,
        getWidth: 1.2,
        widthUnits: "pixels",
      }),
      ...(this.visible.bus
        ? [
            new PathLayer<{ path: [number, number][] }>({
              id: "bus-routes",
              data: this.busLines,
              getPath: (d) => d.path,
              getColor: BUS_ROUTE_RGBA,
              getWidth: 1,
              widthUnits: "pixels",
            }),
          ]
        : []),
      new PathLayer<{ path: [number, number][]; colour: Rgb }>({
        id: "rails",
        data: this.baseLines,
        getPath: (d) => d.path,
        getColor: (d) => rgba(d.colour, 110),
        getWidth: 1,
        widthUnits: "pixels",
      }),
      new ScatterplotLayer<{ pos: [number, number] }>({
        id: "stops",
        data: this.stops,
        getPosition: (d) => d.pos,
        getFillColor: [255, 255, 255, 150],
        getRadius: 2.5,
        radiusUnits: "pixels",
      }),
    ];
    for (const mode of DRAW_ORDER) {
      if (!this.visible[mode]) continue;
      const style = STYLES[mode];
      const dots = this.dotsAt(this.chunks[mode], t);
      counts[mode] = dots.count;
      layers.push(...this.trailLayers(mode, t, trail, style.trailWidth), ...this.dotLayers(mode, dots, style));
    }
    this.overlay.setProps({ layers });
    return counts;
  }

  private dotsAt(chunks: Chunk[], t: number): Dots {
    let capacity = 0;
    for (const chunk of chunks) if (t >= chunk.start && t <= chunk.end) capacity += chunk.trips.length;
    const positions = new Float64Array(capacity * 2);
    const colours = new Uint8Array(capacity * 4);
    let n = 0;
    for (const chunk of chunks) {
      if (t < chunk.start || t > chunk.end) continue;
      for (const trip of chunk.trips) {
        const pos = positionAt(trip, t);
        if (!pos) continue;
        const colour = this.colourOf(trip);
        positions[n * 2] = pos[0];
        positions[n * 2 + 1] = pos[1];
        colours[n * 4] = colour[0];
        colours[n * 4 + 1] = colour[1];
        colours[n * 4 + 2] = colour[2];
        colours[n * 4 + 3] = 255;
        n++;
      }
    }
    return { count: n, positions: positions.subarray(0, n * 2), colours: colours.subarray(0, n * 4) };
  }

  /** One layer per chunk, shown only while some trip in it can still have a visible trail. */
  private trailLayers(mode: Mode, t: number, trailLength: number, width: number): Layer[] {
    return this.chunks[mode].map(
      (chunk, i) =>
        new TripsLayer<SimTrip>({
          id: `${mode}-trails-${i}`,
          data: chunk.trips,
          visible: t >= chunk.start && t <= chunk.end + trailLength,
          getPath: (d) => d.path,
          getTimestamps: (d) => d.times,
          getColor: (d) => this.colourOf(d),
          currentTime: t,
          trailLength,
          fadeTrail: true,
          getWidth: width,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          parameters: ADDITIVE,
        }),
    );
  }

  private dotLayers(id: string, dots: Dots, size: Style): Layer[] {
    // The three layers share one set of arrays. Alpha comes from layer opacity, so the colours are opaque.
    const data = {
      length: dots.count,
      attributes: {
        getPosition: { value: dots.positions, size: 2 },
        getFillColor: { value: dots.colours, size: 4 },
      },
    };
    const dot = (suffix: string, radius: number, opacity: number, additive: boolean) =>
      new ScatterplotLayer({
        id: `${id}-${suffix}`,
        data,
        opacity,
        getRadius: radius,
        radiusUnits: "pixels",
        ...(additive ? { parameters: ADDITIVE } : {}),
      });
    return [dot("glow", size.glow, 45 / 255, true), dot("inner", size.inner, 110 / 255, true), dot("core", size.core, 1, false)];
  }
}
