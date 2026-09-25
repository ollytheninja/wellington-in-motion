import type { LonLat } from "../geo";
import type { Network, WireCoastline, WireNetwork } from "../types";
import { decodeNetwork, decodeShape } from "./wire";

export type Mode = "rail" | "ferry" | "bus";

const FILES: Record<Mode, string> = { rail: "network.json", ferry: "ferry.json", bus: "buses.json" };

export async function loadNetwork(mode: Mode): Promise<Network> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${FILES[mode]}`);
  if (!res.ok) throw new Error(`${FILES[mode]}: ${res.status}. Run "make data" first.`);
  return decodeNetwork((await res.json()) as WireNetwork);
}

/** All dates any service runs on, sorted, as YYYYMMDD. */
export function availableDates(net: Network): string[] {
  const dates = new Set<string>();
  for (const service of net.services) for (const d of service) dates.add(d);
  return [...dates].sort();
}

/** Who to credit for a dataset, as CC BY 4.0 asks. */
export interface Credit {
  source: string;
  sourceUrl: string;
  licence: string;
  licenceUrl: string;
  /** What we did to the data. */
  changes: string;
}

export interface Coastline {
  lines: LonLat[][];
  credit: Credit;
}

/** The coastline is optional. Returns null if `make coastline` has not been run. */
export async function loadCoastline(): Promise<Coastline | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/coastline.json`);
  if (!res.ok) return null;
  const wire = (await res.json()) as WireCoastline;
  return {
    lines: wire.lines.map(decodeShape),
    credit: {
      source: wire.source,
      sourceUrl: wire.sourceUrl,
      licence: wire.licence,
      licenceUrl: wire.licenceUrl,
      changes: wire.changes,
    },
  };
}
