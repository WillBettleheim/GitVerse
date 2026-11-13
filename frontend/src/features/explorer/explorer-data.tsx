"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CityLayout } from "@/lib/city/layout";
import { findCycles, type CycleIndex } from "@/lib/graph/dependencies";
import { computeInsights, type Insights } from "@/lib/graph/insights";
import type { Adjacency } from "@/lib/graph/queries";
import type { CodeGraph, FileNode } from "@/lib/graph/schema";

/** Everything derived from one graph, computed once and shared by the panels. */
export interface ExplorerData {
  graph: CodeGraph;
  city: CityLayout;
  adjacency: Adjacency;
  cycles: CycleIndex;
  insights: Insights;
  files: ReadonlyMap<string, FileNode>;
}

const Context = createContext<ExplorerData | null>(null);

export function ExplorerDataProvider({
  graph,
  city,
  adjacency,
  children,
}: {
  graph: CodeGraph;
  city: CityLayout;
  adjacency: Adjacency;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    const cycles = findCycles(graph);
    return {
      graph,
      city,
      adjacency,
      cycles,
      insights: computeInsights(graph, adjacency, cycles),
      files: new Map(graph.files.map((f) => [f.id, f])),
    };
  }, [graph, city, adjacency]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useExplorerData(): ExplorerData {
  const value = useContext(Context);
  if (!value) throw new Error("useExplorerData must be used inside ExplorerDataProvider");
  return value;
}

export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const countFormat = new Intl.NumberFormat("en-US");
