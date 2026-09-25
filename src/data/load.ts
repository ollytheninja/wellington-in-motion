import type { Network, WireNetwork } from "../types";
import { decodeNetwork } from "./wire";

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
