import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import type { Layer } from "@deck.gl/core";
import type { Network } from "../types";
import { BUS_COLOUR, FALLBACK_COLOUR, LINE_COLOURS, hexToRgb } from "../palette";
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
  private railTrips: SimTrip[] = [];
  private busTrips: SimTrip[] = [];
  private showBuses = true;
  private busColour = hexToRgb(BUS_COLOUR);

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

  setTrips(rail: SimTrip[], bus: SimTrip[]): void {
    this.railTrips = rail;
    this.busTrips = bus;
  }

  setShowBuses(on: boolean): void {
    this.showBuses = on;
  }

  /** Draw the network at time `t`. `speed` is simulated seconds per real second and sets the trail length. */
  draw(t: number, speed: number): { trains: number; buses: number } {
    const trainDots = this.dotsAt(this.railTrips, t, (trip) => this.routeColours[trip.route]!);
    const busDots = this.showBuses ? this.dotsAt(this.busTrips, t, () => this.busColour) : [];
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
      // Buses first so trains draw on top of them.
      ...(this.showBuses
        ? [
            this.trailLayer("bus-trails", this.busTrips, () => this.busColour, t, trail, 1.5),
            ...this.dotLayers("bus", busDots, { glow: 10, inner: 5, core: 1.8 }),
          ]
        : []),
      this.trailLayer("trails", this.railTrips, (trip) => this.routeColours[trip.route]!, t, trail, 2.5),
      ...this.dotLayers("train", trainDots, { glow: 20, inner: 9, core: 3.5 }),
    ];
    this.overlay.setProps({ layers });
    return { trains: trainDots.length, buses: busDots.length };
  }

  private dotsAt(trips: SimTrip[], t: number, colourOf: (trip: SimTrip) => Rgb): Dot[] {
    const dots: Dot[] = [];
    for (const trip of trips) {
      const pos = positionAt(trip, t);
      if (pos) dots.push({ pos, colour: colourOf(trip) });
    }
    return dots;
  }

  private trailLayer(
    id: string,
    trips: SimTrip[],
    colourOf: (trip: SimTrip) => Rgb,
    t: number,
    trailLength: number,
    width: number,
  ): Layer {
    return new TripsLayer<SimTrip>({
      id,
      data: trips,
      getPath: (d) => d.path,
      getTimestamps: (d) => d.times,
      getColor: (d) => colourOf(d),
      currentTime: t,
      trailLength,
      fadeTrail: true,
      getWidth: width,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      parameters: ADDITIVE,
    });
  }

  private dotLayers(id: string, dots: Dot[], size: { glow: number; inner: number; core: number }): Layer[] {
    const dot = (suffix: string, radius: number, fill: (d: Dot) => [number, number, number, number], additive: boolean) =>
      new ScatterplotLayer<Dot>({
        id: `${id}-${suffix}`,
        data: dots,
        getPosition: (d) => d.pos,
        getFillColor: fill,
        getRadius: radius,
        radiusUnits: "pixels",
        ...(additive ? { parameters: ADDITIVE } : {}),
      });
    return [
      dot("glow", size.glow, (d) => rgba(d.colour, 45), true),
      dot("inner", size.inner, (d) => rgba(d.colour, 110), true),
      dot("core", size.core, () => [255, 255, 255, 255], false),
    ];
  }
}
