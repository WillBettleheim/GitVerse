import { describe, expect, it } from "vitest";
import {
  ambientOpacity,
  arcPoint,
  arcTangent,
  relatedConnections,
  roofOf,
  selectAmbientConnections,
  type Vec3,
} from "./arcs";
import type { Building } from "./layout";

const from: Vec3 = [0, 5, 0];
const to: Vec3 = [20, 12, 0];

describe("arcPoint", () => {
  it("starts and ends exactly on the roofs", () => {
    expect(arcPoint(from, to, 0)).toEqual(from);
    expect(arcPoint(from, to, 1)).toEqual(to);
  });

  it("clears both roofs at its peak", () => {
    expect(arcPoint(from, to, 0.5)[1]).toBeGreaterThan(12);
  });

  it("arcs higher over a longer distance", () => {
    const far: Vec3 = [100, 12, 0];
    expect(arcPoint(from, far, 0.5)[1]).toBeGreaterThan(arcPoint(from, to, 0.5)[1]);
  });
});

describe("arcTangent", () => {
  it("is a unit vector pointing towards the imported file", () => {
    const tangent = arcTangent(from, to, 0.85);
    expect(Math.hypot(...tangent)).toBeCloseTo(1, 6);
    expect(tangent[0]).toBeGreaterThan(0);
  });

  it("descends near the end of the arc", () => {
    expect(arcTangent(from, to, 0.9)[1]).toBeLessThan(0);
  });
});

describe("roofOf", () => {
  it("sits on top of the building, above its plate", () => {
    expect(roofOf({ x: 1, z: 2, baseY: 0.5, height: 10 } as Building)).toEqual([1, 10.5, 2]);
  });
});

describe("relatedConnections", () => {
  it("returns both directions, and nothing else", () => {
    const connections = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "d" },
    ];
    expect(relatedConnections(connections, "b")).toEqual(connections.slice(0, 2));
  });
});

describe("selectAmbientConnections", () => {
  const buildings = [
    { id: "hub", importance: 0.9 },
    { id: "mid", importance: 0.5 },
    { id: "low", importance: 0.1 },
    { id: "low2", importance: 0.1 },
  ] as Building[];
  const connections = [
    { source: "low", target: "low2" },
    { source: "mid", target: "hub" },
    { source: "low", target: "mid" },
  ];

  it("keeps everything under the limit", () => {
    expect(selectAmbientConnections(connections, buildings, 10)).toHaveLength(3);
  });

  it("keeps the connections between the most important files", () => {
    expect(selectAmbientConnections(connections, buildings, 1)).toEqual([
      { source: "mid", target: "hub" },
    ]);
  });

  it("is deterministic when scores tie", () => {
    const tied = [
      { source: "low2", target: "low" },
      { source: "low", target: "low2" },
    ];
    const forward = selectAmbientConnections(tied, buildings, 1);
    const backward = selectAmbientConnections([...tied].reverse(), buildings, 1);
    expect(forward).toEqual(backward);
  });
});

describe("ambientOpacity", () => {
  it("fades as the graph gets denser", () => {
    expect(ambientOpacity(1200)).toBeLessThan(ambientOpacity(88));
    expect(ambientOpacity(0)).toBe(0);
    expect(ambientOpacity(5)).toBeLessThanOrEqual(0.3);
  });
});
