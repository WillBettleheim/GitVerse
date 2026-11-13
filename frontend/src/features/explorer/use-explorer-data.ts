"use client";

import { useMemo } from "react";
import { relatedConnections } from "@/lib/city/arcs";
import type { CityLayout } from "@/lib/city/layout";
import {
  cycleOf,
  findCycles,
  reachEdges,
  traverse,
  type CycleIndex,
  type Reach,
  type RoleEdge,
} from "@/lib/graph/dependencies";
import type { Adjacency } from "@/lib/graph/queries";
import type { CodeGraph, FileNode } from "@/lib/graph/schema";
import { isSearching, searchFiles } from "@/lib/graph/search";
import { useExplorerStore } from "./store";

/**
 * Derived data shared by the canvas and the panels. Each piece is memoized on exactly what it
 * depends on, so a hover or camera move never recomputes a traversal or a search.
 */

export function useCycles(graph: CodeGraph): CycleIndex {
  return useMemo(() => findCycles(graph), [graph]);
}

export function useSearchResults(files: readonly FileNode[], adjacency: Adjacency) {
  const query = useExplorerStore((s) => s.query);
  const filters = useExplorerStore((s) => s.filters);
  return useMemo(() => {
    const active = isSearching(query, filters);
    const results = searchFiles(files, adjacency.importedBy, query, filters);
    return {
      active,
      results,
      matches: active ? new Set(results.map((f) => f.id)) : null,
    };
  }, [files, adjacency, query, filters]);
}

export interface SelectionReach {
  reach: Reach | null;
  cycle: ReadonlySet<string> | null;
}

export function useSelectionReach(
  adjacency: Adjacency,
  cycles: CycleIndex,
  selectedId: string | null,
): SelectionReach {
  const depth = useExplorerStore((s) => s.depth);
  const direction = useExplorerStore((s) => s.direction);
  return useMemo(
    () =>
      selectedId
        ? {
            reach: traverse(adjacency, selectedId, direction, depth),
            cycle: cycleOf(cycles, selectedId),
          }
        : { reach: null, cycle: null },
    [adjacency, cycles, selectedId, direction, depth],
  );
}

/** The edges to draw for the selection's traversal, or one hop around a hovered file. */
export function activeEdges(
  city: CityLayout,
  selection: SelectionReach,
  hoveredId: string | null,
): RoleEdge[] {
  if (selection.reach) return reachEdges(city.connections, selection.reach, selection.cycle);
  if (!hoveredId) return [];
  return relatedConnections(city.connections, hoveredId).map((c) => ({
    ...c,
    role: c.source === hoveredId ? "import" : "importer",
  }));
}
