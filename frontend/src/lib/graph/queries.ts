import type { CodeGraph } from "./schema";

export interface Adjacency {
  /** Files this file imports. */
  imports: ReadonlyMap<string, readonly string[]>;
  /** Files that import this file. */
  importedBy: ReadonlyMap<string, readonly string[]>;
}

export function buildAdjacency(graph: CodeGraph): Adjacency {
  const imports = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();
  for (const { source, target } of graph.edges) {
    (imports.get(source) ?? imports.set(source, []).get(source)!).push(target);
    (importedBy.get(target) ?? importedBy.set(target, []).get(target)!).push(source);
  }
  for (const list of [...imports.values(), ...importedBy.values()]) {
    list.sort();
  }
  return { imports, importedBy };
}

/** The file plus everything it directly imports or is imported by. */
export function neighbourhood(adjacency: Adjacency, id: string): Set<string> {
  return new Set([
    id,
    ...(adjacency.imports.get(id) ?? []),
    ...(adjacency.importedBy.get(id) ?? []),
  ]);
}
