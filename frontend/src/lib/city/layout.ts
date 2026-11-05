import type { CodeGraph, FileNode } from "@/lib/graph/schema";

/**
 * Turns a CodeGraph into city geometry. This is a pure function of its input:
 * no randomness, clock or locale, and input order doesn't matter. It knows nothing
 * about React or Three.js, so determinism can be tested without WebGL.
 */

export const DISTRICT_PALETTE = [
  "#3b82f6",
  "#22d3ee",
  "#8b5cf6",
  "#6366f1",
  "#38bdf8",
  "#a855f7",
] as const;

const BUILDING_GAP = 0.9;
const DISTRICT_PADDING = 1.6;
const STREET_WIDTH = 4;
const MIN_FOOTPRINT = 1.4;
const MAX_FOOTPRINT = 6;
const MIN_HEIGHT = 1;
const MAX_HEIGHT = 30;
const HEIGHT_PER_COMPLEXITY = 0.45;

export interface Building {
  id: string;
  path: string;
  name: string;
  districtId: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
}

export interface District {
  id: string;
  label: string;
  /** Centre of the plate. */
  x: number;
  z: number;
  width: number;
  depth: number;
  color: string;
  fileIds: string[];
}

export interface Connection {
  source: string;
  target: string;
}

export interface CityLayout {
  buildings: Building[];
  districts: District[];
  connections: Connection[];
  bounds: { width: number; depth: number; maxHeight: number; radius: number };
}

/** Sizes in world units. Both grow monotonically, then saturate. */
export function footprintForLoc(loc: number): number {
  return round(clamp(MIN_FOOTPRINT + Math.sqrt(loc) / 6, MIN_FOOTPRINT, MAX_FOOTPRINT));
}

export function heightForComplexity(complexity: number): number {
  return round(clamp(MIN_HEIGHT + complexity * HEIGHT_PER_COMPLEXITY, MIN_HEIGHT, MAX_HEIGHT));
}

export function generateCity(graph: CodeGraph): CityLayout {
  const byDirectory = new Map<string, FileNode[]>();
  for (const file of graph.files) {
    const directory = directoryOf(file.path);
    const group = byDirectory.get(directory);
    if (group) group.push(file);
    else byDirectory.set(directory, [file]);
  }

  const drafts = [...byDirectory.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([directory, files]) => draftDistrict(directory, files));

  // Largest first for tighter packing; the path breaks ties deterministically.
  const ordered = [...drafts].sort(
    (a, b) => b.width * b.depth - a.width * a.depth || compareStrings(a.id, b.id),
  );
  const packed = shelfPack(ordered, STREET_WIDTH);

  const districts: District[] = [];
  const buildings: Building[] = [];
  ordered.forEach((draft, index) => {
    const cornerX = packed.positions[index].x - packed.width / 2;
    const cornerZ = packed.positions[index].z - packed.depth / 2;
    districts.push({
      id: draft.id,
      label: draft.id === "" ? "(root)" : draft.id,
      x: round(cornerX + draft.width / 2),
      z: round(cornerZ + draft.depth / 2),
      width: round(draft.width),
      depth: round(draft.depth),
      color: draft.color,
      fileIds: draft.lots.map((lot) => lot.file.id),
    });
    for (const lot of draft.lots) {
      buildings.push({
        id: lot.file.id,
        path: lot.file.path,
        name: lot.file.path.split("/").pop() ?? lot.file.path,
        districtId: draft.id,
        x: round(cornerX + lot.x + lot.width / 2),
        z: round(cornerZ + lot.z + lot.depth / 2),
        width: lot.width,
        depth: lot.depth,
        height: heightForComplexity(lot.file.complexity),
        color: draft.color,
      });
    }
  });
  buildings.sort((a, b) => compareStrings(a.id, b.id));

  const connections = graph.edges
    .map(({ source, target }) => ({ source, target }))
    .sort((a, b) => compareStrings(a.source, b.source) || compareStrings(a.target, b.target));

  return {
    buildings,
    districts,
    connections,
    bounds: {
      width: round(packed.width),
      depth: round(packed.depth),
      maxHeight: buildings.reduce((max, b) => Math.max(max, b.height), 0),
      radius: round(Math.hypot(packed.width, packed.depth) / 2),
    },
  };
}

interface Lot {
  file: FileNode;
  x: number;
  z: number;
  width: number;
  depth: number;
}

interface DistrictDraft {
  id: string;
  color: string;
  width: number;
  depth: number;
  lots: Lot[];
}

function draftDistrict(directory: string, files: FileNode[]): DistrictDraft {
  const items = files
    .map((file) => {
      const size = footprintForLoc(file.loc);
      return { file, width: size, depth: size };
    })
    .sort((a, b) => b.width - a.width || compareStrings(a.file.id, b.file.id));
  const packed = shelfPack(items, BUILDING_GAP);

  return {
    id: directory,
    color: DISTRICT_PALETTE[fnv1a(directory) % DISTRICT_PALETTE.length],
    width: packed.width + DISTRICT_PADDING * 2,
    depth: packed.depth + DISTRICT_PADDING * 2,
    lots: items.map((item, index) => ({
      file: item.file,
      width: item.width,
      depth: item.depth,
      x: packed.positions[index].x + DISTRICT_PADDING,
      z: packed.positions[index].z + DISTRICT_PADDING,
    })),
  };
}

/** Places rectangles left to right in rows, aiming for a roughly square result. */
function shelfPack(items: readonly { width: number; depth: number }[], gap: number) {
  const area = items.reduce((sum, i) => sum + (i.width + gap) * (i.depth + gap), 0);
  const targetRowWidth = Math.sqrt(area) * 1.15;

  const positions: { x: number; z: number }[] = [];
  let x = 0;
  let z = 0;
  let rowDepth = 0;
  let width = 0;
  for (const item of items) {
    if (x > 0 && x + item.width > targetRowWidth) {
      x = 0;
      z += rowDepth + gap;
      rowDepth = 0;
    }
    positions.push({ x, z });
    width = Math.max(width, x + item.width);
    rowDepth = Math.max(rowDepth, item.depth);
    x += item.width + gap;
  }
  return { positions, width, depth: z + rowDepth };
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Code-unit order. localeCompare would make layout depend on the machine's locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** FNV-1a: a stable colour for a path, unaffected by what else is in the repository. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
