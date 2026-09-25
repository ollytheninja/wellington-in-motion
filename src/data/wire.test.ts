import { describe, expect, it } from "vitest";
import { decodeNetwork, deltaDecode, deltaEncode, encodeServices, encodeShape, decodeShape } from "./wire";
import type { WireNetwork } from "../types";

describe("wire format", () => {
  it("round trips shapes to 1e-5 degrees", () => {
    const coords: [number, number][] = [[174.77712, -41.28648], [174.8, -41.2], [174.79999, -41.30001]];
    const back = decodeShape(encodeShape(coords));
    back.forEach(([lon, lat], i) => {
      expect(lon).toBeCloseTo(coords[i]![0], 5);
      expect(lat).toBeCloseTo(coords[i]![1], 5);
    });
  });

  it("round trips control points", () => {
    const cp = [100, 0, 160, 500, 160, 500, 400, 1200];
    expect(deltaDecode(deltaEncode(cp))).toEqual(cp);
  });

  it("decodes service days across a month boundary", () => {
    const bits = encodeServices([["20260930", "20261002"]], "20260929", 5);
    expect(bits).toEqual(["01010"]);
    const wire: WireNetwork = {
      version: 2,
      feedVersion: "t",
      startDate: "20260929",
      routes: [],
      shapes: [],
      stops: {},
      services: bits,
      trips: [],
    };
    expect(decodeNetwork(wire).services).toEqual([["20260930", "20261002"]]);
  });
});
