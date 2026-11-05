import type { Building, Connection } from "./layout";

export type Vec3 = [number, number, number];

const ARC_CLEARANCE = 1.5;
const ARC_LIFT_PER_DISTANCE = 0.18;

export function roofOf(building: Building): Vec3 {
  return [building.x, building.baseY + building.height, building.z];
}

/** A parabola from roof to roof. `t` runs 0→1 from importer to imported. */
export function arcPoint(from: Vec3, to: Vec3, t: number): Vec3 {
  const distance = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const peak = Math.max(from[1], to[1]) + ARC_CLEARANCE + distance * ARC_LIFT_PER_DISTANCE;
  const straight = from[1] + (to[1] - from[1]) * t;
  return [
    from[0] + (to[0] - from[0]) * t,
    straight + (peak - straight) * 4 * t * (1 - t),
    from[2] + (to[2] - from[2]) * t,
  ];
}

/** The unit direction of travel at `t`, for pointing arrowheads. */
export function arcTangent(from: Vec3, to: Vec3, t: number): Vec3 {
  const step = 0.01;
  const a = arcPoint(from, to, Math.max(0, t - step));
  const b = arcPoint(from, to, Math.min(1, t + step));
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...d) || 1;
  return [d[0] / length, d[1] / length, d[2] / length];
}

export function relatedConnections(connections: readonly Connection[], id: string): Connection[] {
  return connections.filter((c) => c.source === id || c.target === id);
}

/**
 * Picks which connections stay visible when a graph has too many to draw legibly: those between
 * the most important files. Selecting any building still shows all of its own connections.
 */
export function selectAmbientConnections(
  connections: readonly Connection[],
  buildings: readonly Building[],
  limit: number,
): Connection[] {
  if (connections.length <= limit) return [...connections];
  const importance = new Map(buildings.map((b) => [b.id, b.importance]));
  const score = (c: Connection) =>
    (importance.get(c.source) ?? 0) + (importance.get(c.target) ?? 0);
  return connections
    .map((connection) => ({ connection, score: score(connection) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        compareStrings(a.connection.source, b.connection.source) ||
        compareStrings(a.connection.target, b.connection.target),
    )
    .slice(0, limit)
    .map((entry) => entry.connection);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Lighter fades for dense graphs, so they read as a haze rather than a solid mass. */
export function ambientOpacity(count: number): number {
  return count === 0 ? 0 : Math.min(0.3, 3.5 / Math.sqrt(count));
}
