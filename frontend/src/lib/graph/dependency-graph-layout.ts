import type { Reach } from "./dependencies";

/**
 * Columns for the 2D dependency view: importers to the left, the selected file in the middle, its
 * imports to the right, one column per hop. Deterministic, so the view doesn't shuffle.
 */

export const MAX_PER_COLUMN = 30;

export interface GraphColumn {
  /** Negative for importers, 0 for the root, positive for imports. */
  depth: number;
  ids: string[];
  /** Files at this distance that weren't drawn, to keep the view readable. */
  hidden: number;
}

export function layoutDependencyGraph(reach: Reach): GraphColumn[] {
  const columns = new Map<number, string[]>();
  const add = (depth: number, id: string) =>
    (columns.get(depth) ?? columns.set(depth, []).get(depth)!).push(id);

  add(0, reach.root);
  for (const [id, depth] of reach.imports) add(depth, id);
  for (const [id, depth] of reach.importedBy) {
    // A file in a cycle with the root is both. It's shown once, on the import side.
    if (!reach.imports.has(id)) add(-depth, id);
  }

  return [...columns.entries()]
    .sort(([a], [b]) => a - b)
    .map(([depth, ids]) => {
      const sorted = ids.sort();
      return {
        depth,
        ids: sorted.slice(0, MAX_PER_COLUMN),
        hidden: Math.max(0, sorted.length - MAX_PER_COLUMN),
      };
    });
}
