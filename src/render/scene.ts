import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import type { Layer } from "@deck.gl/core";
import type { Network } from "../types";
import { FALLBACK_COLOUR, LINE_COLOURS, hexToRgb } from "../palette";
import { positionAt, type SimTrip } from "../sim/sim";

const CARTO_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json";

const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#05070d" } }],
};

/** Adds up brightness where things overlap. This is what makes busy corridors glow. */
const ADDITIVE = {
  blend: true,
  blendColorSrcFactor: "src-alpha",
  blendColorDstFactor: "one",
  blendAlphaSrcFactor: "one",
  blendAlphaDstFactor: "one",
} as const;

type Rgb = [number, number, number];
const rgba = (c: Rgb, a: number): [number, number, number, number] => [c[0], c[1], c[2], a];

function bounds(net: Network): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const shape of net.shapes) {
    for (const [lon, lat] of shape.coords) {
      w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat);
    }
  }
  return [[w, s], [e, n]];
}

interface Dot {
  pos: [number, number];
  colour: Rgb;
}

export class Scene {
  private map: maplibregl.Map;
  private overlay: MapboxOverlay;
  private routeColours: Rgb[];
  private baseLines: { path: [number, number][]; colour: Rgb }[] = [];
  private stops: { pos: [number, number] }[];
  private trips: SimTrip[] = [];

  constructor(container: HTMLElement, net: Network) {
    this.routeColours = net.routes.map((r) => hexToRgb(LINE_COLOURS[r.short] ?? FALLBACK_COLOUR));
    const shapeRoute = new Map<number, number>();
    for (const t of net.trips) if (!shapeRoute.has(t.shape)) shapeRoute.set(t.shape, t.route);
    this.baseLines = net.shapes.map((s, i) => ({
      path: s.coords,
      colour: this.routeColours[shapeRoute.get(i) ?? 0]!,
    }));
    this.stops = Object.values(net.stops).map((s) => ({ pos: [s.lon, s.lat] }));

    this.map = new maplibregl.Map({
      container,
      style: CARTO_DARK,
      bounds: bounds(net),
      fitBoundsOptions: { padding: { top: 60, bottom: 120, left: 60, right: 60 } },
      attributionControl: { compact: true },
    });
    this.overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    this.map.addControl(this.overlay as unknown as maplibregl.IControl);
  }

  setBasemap(on: boolean): void {
    this.map.setStyle(on ? CARTO_DARK : EMPTY_STYLE);
  }

  setTrips(trips: SimTrip[]): void {
    this.trips = trips;
  }

  /** Draw the network at time `t`. `speed` is simulated seconds per real second and sets the trail length. */
  draw(t: number, speed: number): number {
    const dots: Dot[] = [];
    for (const trip of this.trips) {
      const pos = positionAt(trip, t);
      if (pos) dots.push({ pos, colour: this.routeColours[trip.route]! });
    }
    const trail = Math.min(900, Math.max(120, speed * 0.75));

    const layers: Layer[] = [
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
      new TripsLayer<SimTrip>({
        id: "trails",
        data: this.trips,
        getPath: (d) => d.path,
        getTimestamps: (d) => d.times,
        getColor: (d) => this.routeColours[d.route]!,
        currentTime: t,
        trailLength: trail,
        fadeTrail: true,
        getWidth: 2.5,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        parameters: ADDITIVE,
      }),
      new ScatterplotLayer<Dot>({
        id: "glow",
        data: dots,
        getPosition: (d) => d.pos,
        getFillColor: (d) => rgba(d.colour, 45),
        getRadius: 20,
        radiusUnits: "pixels",
        parameters: ADDITIVE,
      }),
      new ScatterplotLayer<Dot>({
        id: "glow-inner",
        data: dots,
        getPosition: (d) => d.pos,
        getFillColor: (d) => rgba(d.colour, 110),
        getRadius: 9,
        radiusUnits: "pixels",
        parameters: ADDITIVE,
      }),
      new ScatterplotLayer<Dot>({
        id: "core",
        data: dots,
        getPosition: (d) => d.pos,
        getFillColor: [255, 255, 255, 255],
        getRadius: 3.5,
        radiusUnits: "pixels",
      }),
    ];
    this.overlay.setProps({ layers });
    return dots.length;
  }
}
