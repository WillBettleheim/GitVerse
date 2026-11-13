import type { CycleIndex } from "./dependencies";
import type { Adjacency } from "./queries";
import type { CodeGraph, FileNode } from "./schema";

/** Every number here is counted from the graph. Nothing is estimated or invented. */

const TOP = 8;
const GENERIC = new Set(["src", "source", "lib", "libs", "app", "apps", "packages", "pkg"]);

export interface RankedFile {
  id: string;
  value: number;
}

export interface FolderShare {
  folder: string;
  files: number;
  loc: number;
  /** Fraction of all lines of code, 0–1. */
  share: number;
  /** Imports that leave this folder for another one. */
  outgoing: number;
}

export interface Insights {
  files: number;
  edges: number;
  totalLoc: number;
  cycles: number;
  filesInCycles: number;
  largestCycle: number;
  mostDependedUpon: RankedFile[];
  largest: RankedFile[];
  /** Empty when the graph has no complexity data to rank. */
  hotspots: RankedFile[];
  folders: FolderShare[];
  /** Files that nothing imports and that import nothing. */
  isolated: number;
}

/** The top-level part of the system a file belongs to: `src/server` rather than `src`. */
export function areaOf(path: string): string {
  const parts = path.split("/").slice(0, -1);
  if (parts.length === 0) return "(root)";
  if (GENERIC.has(parts[0]) && parts.length > 1) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

function top(files: readonly FileNode[], value: (f: FileNode) => number): RankedFile[] {
  return files
    .map((f) => ({ id: f.id, value: value(f) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1))
    .slice(0, TOP);
}

export function computeInsights(
  graph: CodeGraph,
  adjacency: Adjacency,
  cycles: CycleIndex,
): Insights {
  const totalLoc = graph.files.reduce((sum, f) => sum + f.loc, 0);
  const area = new Map(graph.files.map((f) => [f.id, areaOf(f.path)]));

  const folders = new Map<string, FolderShare>();
  for (const file of graph.files) {
    const key = area.get(file.id)!;
    const entry = folders.get(key) ?? { folder: key, files: 0, loc: 0, share: 0, outgoing: 0 };
    entry.files += 1;
    entry.loc += file.loc;
    folders.set(key, entry);
  }
  for (const { source, target } of graph.edges) {
    if (area.get(source) !== area.get(target)) folders.get(area.get(source)!)!.outgoing += 1;
  }
  for (const entry of folders.values()) entry.share = totalLoc > 0 ? entry.loc / totalLoc : 0;

  // Complexity of 1 is the floor for straight-line code, so a graph with nothing above it has no
  // hotspots worth ranking.
  const hasComplexity = graph.files.some((f) => f.complexity > 1);

  return {
    files: graph.files.length,
    edges: graph.edges.length,
    totalLoc,
    cycles: cycles.groups.length,
    filesInCycles: cycles.groups.reduce((sum, g) => sum + g.length, 0),
    largestCycle: cycles.groups[0]?.length ?? 0,
    mostDependedUpon: top(graph.files, (f) => adjacency.importedBy.get(f.id)?.length ?? 0),
    largest: top(graph.files, (f) => f.loc),
    hotspots: hasComplexity ? top(graph.files, (f) => f.complexity) : [],
    folders: [...folders.values()].sort(
      (a, b) => b.loc - a.loc || b.files - a.files || (a.folder < b.folder ? -1 : 1),
    ),
    isolated: graph.files.filter(
      (f) => !adjacency.imports.get(f.id)?.length && !adjacency.importedBy.get(f.id)?.length,
    ).length,
  };
}
