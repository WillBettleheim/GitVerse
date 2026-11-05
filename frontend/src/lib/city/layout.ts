import { classifyFile, type FileCategory } from "@/lib/graph/classify";
import { computeImportance, fnv1a, normalizeLog, type FileImportance } from "@/lib/graph/metrics";
import type { CodeGraph, FileNode } from "@/lib/graph/schema";

/**
 * Turns a CodeGraph into city geometry. This is a pure function of its input: no randomness,
 * clock or locale, and input order doesn't matter. Nothing here is specific to one repository,
 * and it knows nothing about React or Three.js, so it can be tested without WebGL.
 *
 * Districts nest like the folder tree: a subfolder is a raised plot inside its parent's plot.
 */

export const DISTRICT_PALETTE = [
  "#3b82f6",
  "#22d3ee",
  "#8b5cf6",
  "#6366f1",
  "#38bdf8",
  "#a855f7",
  "#2dd4bf",
  "#d946ef",
] as const;

/** Above this, the least important files aren't drawn, and the result says how many were cut. */
export const DEFAULT_MAX_BUILDINGS = 5000;

const BUILDING_GAP = 0.6;
const DISTRICT_PADDING = 0.8;
const PLATE_STEP = 0.16;
const MIN_FOOTPRINT = 1.3;
const MAX_FOOTPRINT = 6.5;
const MIN_HEIGHT = 0.8;
const MAX_HEIGHT = 26;
/** Below these, a small repository's biggest file shouldn't look like a skyscraper. */
const REFERENCE_LOC = 400;
const REFERENCE_COMPLEXITY = 20;
/** Above 1, hotspots stand out from the rest of the skyline. */
const HEIGHT_CONTRAST = 1.5;
/** Path segments too generic to identify a part of the system. */
const GENERIC_SEGMENTS = new Set(["src", "source", "lib", "libs", "app", "apps", "packages", "pkg"]);

export interface BuildingTier {
  /** Bottom of this tier, relative to the building's base. */
  y: number;
  height: number;
  width: number;
  depth: number;
}

export interface Building {
  id: string;
  path: string;
  name: string;
  districtId: string;
  category: FileCategory;
  importance: number;
  landmark: boolean;
  fanIn: number;
  fanOut: number;
  loc: number;
  complexity: number;
  /** 0–1, from the ID. Varies window patterns without depending on position. */
  seed: number;
  x: number;
  z: number;
  /** Top of the plot this building stands on. */
  baseY: number;
  width: number;
  depth: number;
  height: number;
  tiers: BuildingTier[];
  color: string;
}

export interface District {
  id: string;
  label: string;
  parentId: string | null;
  level: number;
  /** Centre of the plate. */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Bottom of the plate. Its top is baseY + plateHeight. */
  baseY: number;
  plateHeight: number;
  color: string;
  /** Files directly in this folder. */
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
  /** Files in the graph that weren't drawn because of the visual limit. */
  omittedFileCount: number;
  bounds: { width: number; depth: number; maxHeight: number; radius: number };
}

export interface GenerateCityOptions {
  maxBuildings?: number;
}

interface Scales {
  maxLoc: number;
  maxComplexity: number;
}

/** Footprint is normalized against the largest file in this graph. */
export function footprintForLoc(loc: number, maxLoc: number): number {
  const norm = normalizeLog(loc, Math.max(maxLoc, REFERENCE_LOC));
  return round(MIN_FOOTPRINT + (MAX_FOOTPRINT - MIN_FOOTPRINT) * norm);
}

/** Height is normalized against the most complex file in this graph. */
export function heightForComplexity(complexity: number, maxComplexity: number): number {
  const norm = normalizeLog(complexity, Math.max(maxComplexity, REFERENCE_COMPLEXITY));
  return round(MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * norm ** HEIGHT_CONTRAST);
}

export function generateCity(graph: CodeGraph, options: GenerateCityOptions = {}): CityLayout {
  const importance = computeImportance(graph);
  const maxBuildings = options.maxBuildings ?? DEFAULT_MAX_BUILDINGS;
  const files = selectDrawnFiles(graph.files, importance, maxBuildings);
  const drawn = new Set(files.map((file) => file.id));

  const scales: Scales = {
    maxLoc: graph.files.reduce((max, f) => Math.max(max, f.loc), 0),
    maxComplexity: graph.files.reduce((max, f) => Math.max(max, f.complexity), 0),
  };

  const roots = buildFolderTree(files).map((node) => packDirectory(node, scales, importance));
  const ordered = sortForPacking(roots);
  const packed = skylinePack(ordered, streetWidth(0));

  const buildings: Building[] = [];
  const districts: District[] = [];
  ordered.forEach((draft, index) => {
    place(
      draft,
      packed.positions[index].x - packed.width / 2,
      packed.positions[index].z - packed.depth / 2,
      0,
      null,
      buildings,
      districts,
    );
  });
  buildings.sort((a, b) => compareStrings(a.id, b.id));
  districts.sort((a, b) => compareStrings(a.id, b.id));

  const connections = graph.edges
    .filter(({ source, target }) => drawn.has(source) && drawn.has(target))
    .map(({ source, target }) => ({ source, target }))
    .sort((a, b) => compareStrings(a.source, b.source) || compareStrings(a.target, b.target));

  return {
    buildings,
    districts,
    connections,
    omittedFileCount: graph.files.length - files.length,
    bounds: {
      width: round(packed.width),
      depth: round(packed.depth),
      maxHeight: buildings.reduce((max, b) => Math.max(max, b.baseY + b.height), 0),
      radius: round(Math.hypot(packed.width, packed.depth) / 2),
    },
  };
}

function selectDrawnFiles(
  files: readonly FileNode[],
  importance: ReadonlyMap<string, FileImportance>,
  limit: number,
): readonly FileNode[] {
  if (files.length <= limit) return files;
  return [...files]
    .sort(
      (a, b) =>
        (importance.get(b.id)?.score ?? 0) - (importance.get(a.id)?.score ?? 0) ||
        compareStrings(a.id, b.id),
    )
    .slice(0, limit);
}

/* Folder tree */

interface DirectoryNode {
  path: string;
  files: FileNode[];
  children: Map<string, DirectoryNode>;
}

function buildFolderTree(files: readonly FileNode[]): DirectoryNode[] {
  const root: DirectoryNode = { path: "", files: [], children: new Map() };
  for (const file of files) {
    let node = root;
    const segments = file.path.split("/").slice(0, -1);
    segments.forEach((segment, index) => {
      let child = node.children.get(segment);
      if (!child) {
        child = {
          path: segments.slice(0, index + 1).join("/"),
          files: [],
          children: new Map(),
        };
        node.children.set(segment, child);
      }
      node = child;
    });
    node.files.push(file);
  }

  const top = [...root.children.values()].map(collapseChain);
  // Files at the repository root get their own plot, as there's no plot for the whole city.
  if (root.files.length > 0) top.push({ path: "", files: root.files, children: new Map() });
  return top;
}

/** A folder with no files and one subfolder adds no information, so it gets no plot. */
function collapseChain(node: DirectoryNode): DirectoryNode {
  if (node.files.length === 0 && node.children.size === 1) {
    return collapseChain([...node.children.values()][0]);
  }
  return node;
}

/* Packing */

interface Sized {
  width: number;
  depth: number;
  sortKey: string;
}

interface Lot extends Sized {
  kind: "lot";
  file: FileNode;
  info: FileImportance;
  height: number;
  x: number;
  z: number;
}

interface DistrictDraft extends Sized {
  kind: "district";
  id: string;
  color: string;
  fileIds: string[];
  items: (Lot | DistrictDraft)[];
  x: number;
  z: number;
}

/** Main roads between top-level areas, narrowing to alleys deep in the tree. */
function streetWidth(level: number): number {
  return Math.max(0.8, 3.2 - level * 1);
}

function packDirectory(
  node: DirectoryNode,
  scales: Scales,
  importance: ReadonlyMap<string, FileImportance>,
  level = 1,
): DistrictDraft {
  const subdistricts = [...node.children.values()].map((child) =>
    packDirectory(collapseChain(child), scales, importance, level + 1),
  );
  const lots = node.files.map((file) => makeLot(file, scales, importance));
  const items = sortForPacking<Lot | DistrictDraft>([...subdistricts, ...lots]);
  const packed = skylinePack(items, subdistricts.length > 0 ? streetWidth(level) : BUILDING_GAP);

  items.forEach((item, index) => {
    item.x = packed.positions[index].x + DISTRICT_PADDING;
    item.z = packed.positions[index].z + DISTRICT_PADDING;
  });

  return {
    kind: "district",
    id: node.path,
    sortKey: node.path,
    color: DISTRICT_PALETTE[fnv1a(colorAnchor(node.path)) % DISTRICT_PALETTE.length],
    fileIds: lots.map((lot) => lot.file.id).sort(compareStrings),
    items,
    width: packed.width + DISTRICT_PADDING * 2,
    depth: packed.depth + DISTRICT_PADDING * 2,
    x: 0,
    z: 0,
  };
}

function makeLot(
  file: FileNode,
  scales: Scales,
  importance: ReadonlyMap<string, FileImportance>,
): Lot {
  const size = footprintForLoc(file.loc, scales.maxLoc);
  // A slightly varied aspect ratio keeps blocks from reading as a grid of identical squares.
  const aspect = 0.86 + ((fnv1a(file.id) >>> 8) % 256) / 255 / 3.5;
  return {
    kind: "lot",
    file,
    info: importance.get(file.id) ?? { score: 0, fanIn: 0, fanOut: 0, landmark: false },
    sortKey: file.id,
    width: round(size * aspect),
    depth: round(size / aspect),
    height: heightForComplexity(file.complexity, scales.maxComplexity),
    x: 0,
    z: 0,
  };
}

function sortForPacking<T extends Sized>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => b.depth - a.depth || b.width - a.width || compareStrings(a.sortKey, b.sortKey),
  );
}

const WIDTH_FACTORS = [1.0, 1.08, 1.18, 1.3] as const;

/**
 * Skyline packing: each rectangle drops to the lowest spot it fits, tracked as the upper contour
 * of everything placed so far. Unlike rows, it fills the gaps beside tall items, so city blocks
 * stay dense. Ties go to the left, which keeps the result deterministic.
 */
function skylinePack(items: readonly { width: number; depth: number }[], gap: number) {
  const area = items.reduce((sum, i) => sum + (i.width + gap) * (i.depth + gap), 0);
  const widest = items.reduce((max, i) => Math.max(max, i.width), 0);

  // No single width suits every mix of sizes, so try a few and keep the most compact square.
  let best = packAtWidth(items, gap, Math.max(Math.sqrt(area) * WIDTH_FACTORS[0], widest + gap));
  for (const factor of WIDTH_FACTORS.slice(1)) {
    const attempt = packAtWidth(items, gap, Math.max(Math.sqrt(area) * factor, widest + gap));
    if (Math.max(attempt.width, attempt.depth) < Math.max(best.width, best.depth) - 1e-9) {
      best = attempt;
    }
  }
  return best;
}

function packAtWidth(items: readonly { width: number; depth: number }[], gap: number, limit: number) {

  // Sorted by x, and together covering 0 to limit.
  let skyline: { x: number; z: number; width: number }[] = [{ x: 0, z: 0, width: limit }];
  const positions: { x: number; z: number }[] = [];
  let totalWidth = 0;
  let totalDepth = 0;

  for (const item of items) {
    const needed = item.width + gap;
    let bestX = 0;
    let bestZ = Number.POSITIVE_INFINITY;

    for (let i = 0; i < skyline.length; i++) {
      const x = skyline[i].x;
      if (x + item.width > limit + 1e-6) break;
      let z = 0;
      for (let j = i; j < skyline.length && skyline[j].x < x + needed - 1e-9; j++) {
        z = Math.max(z, skyline[j].z);
      }
      if (z < bestZ - 1e-9) {
        bestZ = z;
        bestX = x;
      }
    }

    positions.push({ x: bestX, z: bestZ });
    totalWidth = Math.max(totalWidth, bestX + item.width);
    totalDepth = Math.max(totalDepth, bestZ + item.depth);
    skyline = raiseSkyline(skyline, bestX, needed, bestZ + item.depth + gap);
  }

  return { positions, width: totalWidth, depth: totalDepth };
}

function raiseSkyline(
  skyline: readonly { x: number; z: number; width: number }[],
  x: number,
  width: number,
  z: number,
) {
  const end = x + width;
  const next: { x: number; z: number; width: number }[] = [];
  let inserted = false;
  const push = (segment: { x: number; z: number; width: number }) => {
    if (segment.width <= 1e-9) return;
    const last = next[next.length - 1];
    if (last && Math.abs(last.z - segment.z) < 1e-9) last.width += segment.width;
    else next.push({ ...segment });
  };
  for (const segment of skyline) {
    const segmentEnd = segment.x + segment.width;
    if (segmentEnd <= x || segment.x >= end) {
      if (segment.x >= end && !inserted) {
        push({ x, z, width });
        inserted = true;
      }
      push(segment);
      continue;
    }
    if (segment.x < x) push({ x: segment.x, z: segment.z, width: x - segment.x });
    if (!inserted) {
      push({ x, z, width });
      inserted = true;
    }
    if (segmentEnd > end) push({ x: end, z: segment.z, width: segmentEnd - end });
  }
  if (!inserted) push({ x, z, width });
  return next;
}

/* Placement: converts nested relative offsets into world positions */

function place(
  draft: DistrictDraft,
  cornerX: number,
  cornerZ: number,
  level: number,
  parentId: string | null,
  buildings: Building[],
  districts: District[],
): void {
  const baseY = round(level * PLATE_STEP);
  const topY = round(baseY + PLATE_STEP);
  districts.push({
    id: draft.id,
    label: draft.id === "" ? "(root)" : draft.id,
    parentId,
    level,
    x: round(cornerX + draft.width / 2),
    z: round(cornerZ + draft.depth / 2),
    width: round(draft.width),
    depth: round(draft.depth),
    baseY,
    plateHeight: PLATE_STEP,
    color: draft.color,
    fileIds: draft.fileIds,
  });

  for (const item of draft.items) {
    if (item.kind === "district") {
      place(item, cornerX + item.x, cornerZ + item.z, level + 1, draft.id, buildings, districts);
    } else {
      buildings.push(makeBuilding(item, cornerX, cornerZ, topY, draft));
    }
  }
}

function makeBuilding(
  lot: Lot,
  cornerX: number,
  cornerZ: number,
  baseY: number,
  district: DistrictDraft,
): Building {
  const hash = fnv1a(lot.file.id);
  const category = classifyFile(lot.file.path);
  return {
    id: lot.file.id,
    path: lot.file.path,
    name: lot.file.path.split("/").pop() ?? lot.file.path,
    districtId: district.id,
    category,
    importance: lot.info.score,
    landmark: lot.info.landmark,
    fanIn: lot.info.fanIn,
    fanOut: lot.info.fanOut,
    loc: lot.file.loc,
    complexity: lot.file.complexity,
    seed: round((hash % 1000) / 1000),
    x: round(cornerX + lot.x + lot.width / 2),
    z: round(cornerZ + lot.z + lot.depth / 2),
    baseY,
    width: lot.width,
    depth: lot.depth,
    height: lot.height,
    tiers: makeTiers(category, lot, hash),
    color: district.color,
  };
}

const TIER_SPLITS: Record<number, readonly number[]> = {
  1: [1],
  2: [0.68, 0.32],
  3: [0.55, 0.28, 0.17],
};
const TIER_SETBACK = 0.2;
const SLAB_HEIGHT = 1.7;
const SLAB_GAP = 0.16;
const MIN_HEIGHT_FOR_SETBACKS = 5;

/** The massing a building gets. Always adds up to the building's full height. */
function makeTiers(category: FileCategory, lot: Lot, hash: number): BuildingTier[] {
  const { width, depth, height } = lot;

  if (category === "data") {
    // Data files read as stacked storage slabs.
    const count = Math.min(5, Math.max(1, Math.floor(height / SLAB_HEIGHT)));
    const slab = (height - SLAB_GAP * (count - 1)) / count;
    return Array.from({ length: count }, (_, index) => ({
      y: round(index * (slab + SLAB_GAP)),
      height: round(slab),
      width,
      depth,
    }));
  }

  const roll = hash % 100;
  const plain = category === "config" || category === "test" || height < MIN_HEIGHT_FOR_SETBACKS;
  const count = lot.info.landmark ? 3 : plain ? 1 : roll < 40 ? 1 : roll < 78 ? 2 : 3;

  let y = 0;
  return TIER_SPLITS[count].map((share, index) => {
    const scale = 1 - index * TIER_SETBACK;
    const tier = {
      y: round(y),
      height: round(height * share),
      width: round(width * scale),
      depth: round(depth * scale),
    };
    y += height * share;
    return tier;
  });
}

/** Subfolders share their area's hue, so related districts read as one neighbourhood. */
function colorAnchor(path: string): string {
  const segments = path.split("/");
  let index = 0;
  while (index < segments.length - 1 && GENERIC_SEGMENTS.has(segments[index])) index++;
  return segments.slice(0, index + 1).join("/");
}

/** Code-unit order. localeCompare would make layout depend on the machine's locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
