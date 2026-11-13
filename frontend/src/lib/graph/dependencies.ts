import type { Adjacency } from "./queries";
import type { CodeGraph } from "./schema";

/**
 * Dependency traversal and cycle detection. All of it runs on the import graph alone, once per
 * graph or per selection, never per frame.
 */

export type Direction = "imports" | "importedBy" | "both";
export type DepthSetting = 1 | 2 | 3 | "all";

export interface Reach {
  root: string;
  /** Files the root depends on, with their shortest distance in imports. */
  imports: ReadonlyMap<string, number>;
  /** Files that depend on the root, with their shortest distance. */
  importedBy: ReadonlyMap<string, number>;
}

export type EdgeRole = "import" | "importer" | "cycle" | "added" | "insight";

export interface RoleEdge {
  source: string;
  target: string;
  role: EdgeRole;
}

export function maxDepth(setting: DepthSetting): number {
  return setting === "all" ? Number.POSITIVE_INFINITY : setting;
}

function bfs(
  root: string,
  next: ReadonlyMap<string, readonly string[]>,
  limit: number,
): Map<string, number> {
  const depth = new Map<string, number>();
  let frontier = [root];
  for (let level = 1; level <= limit && frontier.length > 0; level++) {
    const upcoming: string[] = [];
    for (const id of frontier) {
      for (const neighbour of next.get(id) ?? []) {
        if (neighbour === root || depth.has(neighbour)) continue;
        depth.set(neighbour, level);
        upcoming.push(neighbour);
      }
    }
    frontier = upcoming;
  }
  return depth;
}

/** Breadth-first, so each file gets its shortest distance from the root. */
export function traverse(
  adjacency: Adjacency,
  root: string,
  direction: Direction,
  depth: DepthSetting,
): Reach {
  const limit = maxDepth(depth);
  return {
    root,
    imports: direction === "importedBy" ? new Map() : bfs(root, adjacency.imports, limit),
    importedBy: direction === "imports" ? new Map() : bfs(root, adjacency.importedBy, limit),
  };
}

/**
 * The edges that make up a traversal: each step leads one hop further from the root. Edges inside
 * the root's own cycle are marked separately, because there direction stops meaning "upstream".
 */
export function reachEdges(
  edges: readonly { source: string; target: string }[],
  reach: Reach,
  cycle: ReadonlySet<string> | null,
): RoleEdge[] {
  const distance = (map: ReadonlyMap<string, number>, id: string) =>
    id === reach.root ? 0 : map.get(id);
  const result: RoleEdge[] = [];
  for (const { source, target } of edges) {
    if (cycle && cycle.has(source) && cycle.has(target) && cycle.has(reach.root)) {
      result.push({ source, target, role: "cycle" });
      continue;
    }
    const from = distance(reach.imports, source);
    const to = distance(reach.imports, target);
    if (from !== undefined && to !== undefined && to === from + 1) {
      result.push({ source, target, role: "import" });
      continue;
    }
    const importer = distance(reach.importedBy, source);
    const imported = distance(reach.importedBy, target);
    if (importer !== undefined && imported !== undefined && importer === imported + 1) {
      result.push({ source, target, role: "importer" });
    }
  }
  return result;
}

export interface CycleIndex {
  /** Files that reach each other through imports. Only groups of two or more. */
  groups: string[][];
  groupOf: ReadonlyMap<string, number>;
}

/**
 * Tarjan's strongly connected components, iterative so a long import chain can't overflow the
 * stack. Matches what the backend reports for real analyses.
 */
export function findCycles(graph: Pick<CodeGraph, "files" | "edges">): CycleIndex {
  const next = new Map<string, string[]>();
  for (const { source, target } of graph.edges) {
    (next.get(source) ?? next.set(source, []).get(source)!).push(target);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  let counter = 0;

  for (const start of graph.files.map((f) => f.id).sort()) {
    if (index.has(start)) continue;
    const work: { id: string; child: number }[] = [{ id: start, child: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const children = next.get(frame.id) ?? [];
      if (frame.child < children.length) {
        const child = children[frame.child++];
        if (!index.has(child)) {
          index.set(child, counter);
          low.set(child, counter);
          counter++;
          stack.push(child);
          onStack.add(child);
          work.push({ id: child, child: 0 });
        } else if (onStack.has(child)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(child)!));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].id;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.id)!));
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const group: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          group.push(member);
        } while (member !== frame.id);
        if (group.length > 1) groups.push(group.sort());
      }
    }
  }

  groups.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
  const groupOf = new Map<string, number>();
  groups.forEach((group, i) => group.forEach((id) => groupOf.set(id, i)));
  return { groups, groupOf };
}

export function cycleOf(cycles: CycleIndex, id: string): ReadonlySet<string> | null {
  const group = cycles.groupOf.get(id);
  return group === undefined ? null : new Set(cycles.groups[group]);
}

/** Groups a traversal by distance, for the list view. */
export function byDepth(map: ReadonlyMap<string, number>): [number, string[]][] {
  const levels = new Map<number, string[]>();
  for (const [id, depth] of map) {
    (levels.get(depth) ?? levels.set(depth, []).get(depth)!).push(id);
  }
  return [...levels.entries()].sort(([a], [b]) => a - b).map(([depth, ids]) => [depth, ids.sort()]);
}
