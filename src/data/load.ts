import type { Network } from "../types";

export async function loadNetwork(): Promise<Network> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/network.json`);
  if (!res.ok) throw new Error(`network.json: ${res.status}. Run "npm run data" first.`);
  return (await res.json()) as Network;
}

/** All dates any service runs on, sorted, as YYYYMMDD. */
export function availableDates(net: Network): string[] {
  return [...new Set(net.services.flat())].sort();
}
