/** Our own line colours. Metlink's Melling and Hutt Valley are both orange, which is useless with additive glow. */
export const LINE_COLOURS: Record<string, string> = {
  KPL: "#5cff8a",
  MEL: "#ff8a3d",
  WRL: "#ffe14d",
  HVL: "#ff4d94",
  JVL: "#3dc8ff",
};

/** Every bus is the same colour. 200-odd routes would be noise, and violet is clear of the rail colours. */
export const BUS_COLOUR = "#b48cff";

export const FERRY_COLOUR = "#19e6d2";

export const FALLBACK_COLOUR = "#ffffff";

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
