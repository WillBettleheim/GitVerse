import type { Building, CityLayout, District } from "@/lib/city/layout";
import type { SnapshotDiff } from "./api";

/**
 * Animation plans between two city layouts. Buildings are matched by file path, carried across
 * renames, so a file that didn't change keeps its identity and just moves with its district.
 */

export interface Box {
  x: number;
  /** Bottom of the box. */
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}

export type ChangeKind = "added" | "removed" | "modified" | "renamed" | "unchanged";

export interface TransitionBuilding {
  /** The file's id in the newer snapshot, or the older one if it was removed. */
  id: string;
  change: ChangeKind;
  color: string;
  /** The building it's drawn as, for category and landmark styling. */
  style: Building;
  tiers: { from: Box; to: Box }[];
}

export interface TransitionDistrict {
  id: string;
  color: string;
  from: Box;
  to: Box;
}

export interface TransitionPlan {
  buildings: TransitionBuilding[];
  districts: TransitionDistrict[];
}

export interface ChangeIndex {
  /** Old path to new path. */
  renames: ReadonlyMap<string, string>;
  /** Change kind by the path in the newer snapshot. Removed files use their old path. */
  kinds: ReadonlyMap<string, ChangeKind>;
}

export function changeIndex(diff: SnapshotDiff): ChangeIndex {
  const kinds = new Map<string, ChangeKind>();
  for (const path of diff.files.added) kinds.set(path, "added");
  for (const path of diff.files.removed) kinds.set(path, "removed");
  for (const file of diff.files.modified) kinds.set(file.path, "modified");
  for (const rename of diff.files.renamed) kinds.set(rename.to, "renamed");
  return { renames: new Map(diff.files.renamed.map((r) => [r.from, r.to])), kinds };
}

/** When no diff is available: identity by path, change by blob. Renames are not guessed. */
export function changeIndexFromCities(from: CityLayout, to: CityLayout): ChangeIndex {
  const before = new Map(from.buildings.map((b) => [b.id, b]));
  const kinds = new Map<string, ChangeKind>();
  for (const building of to.buildings) {
    const old = before.get(building.id);
    kinds.set(building.id, !old ? "added" : sameShape(old, building) ? "unchanged" : "modified");
  }
  const present = new Set(to.buildings.map((b) => b.id));
  for (const building of from.buildings) {
    if (!present.has(building.id)) kinds.set(building.id, "removed");
  }
  return { renames: new Map(), kinds };
}

function sameShape(a: Building, b: Building): boolean {
  return a.loc === b.loc && a.complexity === b.complexity;
}

function tierBoxes(b: Building): Box[] {
  return b.tiers.map((tier) => ({
    x: b.x,
    y: b.baseY + tier.y,
    z: b.z,
    width: tier.width,
    height: tier.height,
    depth: tier.depth,
  }));
}

/** A box flattened onto its own top or base, so a tier can grow from or sink into nothing. */
function flat(box: Box, at: "top" | "base"): Box {
  return { ...box, y: at === "top" ? box.y + box.height : box.y, height: 0 };
}

function pairTiers(from: Box[], to: Box[]): { from: Box; to: Box }[] {
  const count = Math.max(from.length, to.length);
  const pairs = [];
  for (let i = 0; i < count; i++) {
    const a = from[i] ?? flat(from[from.length - 1] ?? to[i], "top");
    const b = to[i] ?? flat(to[to.length - 1] ?? from[i], "top");
    pairs.push({ from: from[i] ? a : { ...a, x: b.x, z: b.z }, to: b });
  }
  return pairs;
}

export function buildTransition(
  from: CityLayout,
  to: CityLayout,
  changes: ChangeIndex,
): TransitionPlan {
  const target = new Map(to.buildings.map((b) => [b.id, b]));
  const carried = new Set<string>();
  const buildings: TransitionBuilding[] = [];

  for (const old of from.buildings) {
    const newId = changes.renames.get(old.id) ?? old.id;
    const next = target.get(newId);
    if (next) {
      carried.add(newId);
      buildings.push({
        id: newId,
        change: changes.kinds.get(newId) ?? "unchanged",
        color: next.color,
        style: next,
        tiers: pairTiers(tierBoxes(old), tierBoxes(next)),
      });
    } else {
      buildings.push({
        id: old.id,
        change: "removed",
        color: old.color,
        style: old,
        tiers: tierBoxes(old).map((box) => ({ from: box, to: flat(box, "base") })),
      });
    }
  }
  for (const next of to.buildings) {
    if (carried.has(next.id)) continue;
    buildings.push({
      id: next.id,
      change: "added",
      color: next.color,
      style: next,
      tiers: tierBoxes(next).map((box) => ({ from: flat(box, "base"), to: box })),
    });
  }

  return { buildings, districts: transitionDistricts(from.districts, to.districts) };
}

function plate(d: District): Box {
  return { x: d.x, y: d.baseY, z: d.z, width: d.width, height: d.plateHeight, depth: d.depth };
}

function transitionDistricts(from: District[], to: District[]): TransitionDistrict[] {
  const before = new Map(from.map((d) => [d.id, d]));
  const after = new Map(to.map((d) => [d.id, d]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  return ids.map((id) => {
    const a = before.get(id);
    const b = after.get(id);
    const end = b ? plate(b) : { ...plate(a!), width: 0, depth: 0 };
    const start = a ? plate(a) : { ...plate(b!), width: 0, depth: 0 };
    return { id, color: (b ?? a)!.color, from: start, to: end };
  });
}

/** Ease in and out, so movement starts and settles gently. */
export function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export function lerpBox(from: Box, to: Box, t: number): Box {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    z: mix(from.z, to.z),
    width: mix(from.width, to.width),
    height: mix(from.height, to.height),
    depth: mix(from.depth, to.depth),
  };
}
