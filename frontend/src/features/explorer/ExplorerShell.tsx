"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { LazyCityCanvas } from "@/features/city/LazyCityCanvas";
import { generateCity } from "@/lib/city/layout";
import { buildAdjacency, type Adjacency } from "@/lib/graph/queries";
import type { CodeGraph } from "@/lib/graph/schema";
import { ApiStatus } from "./ApiStatus";
import { DependencyGraphView } from "./DependencyGraphView";
import { DependencyLegend } from "./DependencyLegend";
import { ExplorerDataProvider, useExplorerData } from "./explorer-data";
import { useSearchResults } from "./use-explorer-data";
import { CanvasToolbar } from "./CanvasToolbar";
import { DemoBanner } from "./DemoBanner";
import { FileNavigator } from "./FileNavigator";
import { Inspector } from "./Inspector";
import { useExplorerStore } from "./store";

const WEBGL_FALLBACK = (
  <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center">
    <div className="max-w-sm">
      <p className="font-medium">The 3D view couldn’t start.</p>
      <p className="mt-2 text-sm text-muted">
        This browser or device didn’t provide WebGL. The file list and inspector still work.
      </p>
    </div>
  </div>
);

interface ExplorerShellProps {
  graph: CodeGraph;
  /** Extra header content, such as the demo dataset switcher. */
  headerSlot?: ReactNode;
  /** A bar along the bottom of the city, such as the time-travel timeline. */
  timeline?: ReactNode;
}

/**
 * Subscribes to no selection state itself. The canvas, list and inspector each subscribe to what
 * they need, so a hover doesn't re-render the whole page.
 */
export function ExplorerShell({ graph, headerSlot, timeline }: ExplorerShellProps) {
  const city = useMemo(() => generateCity(graph), [graph]);
  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);
  const reset = useExplorerStore((s) => s.reset);

  useEffect(() => reset, [reset]);
  useKeyboardShortcuts();

  return (
    <ExplorerDataProvider graph={graph} city={city} adjacency={adjacency}>
      <div className="flex min-h-svh flex-col bg-void lg:h-svh lg:overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-ink px-4">
          <div className="flex min-w-0 items-center gap-4">
            <Logo />
            <span aria-hidden="true" className="h-4 w-px bg-line" />
            <span className="truncate font-mono text-xs text-muted">
              {graph.provenance.repository}
            </span>
            {headerSlot}
          </div>
          <ApiStatus />
        </header>

        <DemoBanner provenance={graph.provenance} />

        <div className="flex flex-1 flex-col lg:grid lg:min-h-0 lg:grid-cols-[17rem_minmax(0,1fr)_20rem]">
          <main className="relative order-1 h-[58svh] shrink-0 lg:order-2 lg:h-auto">
            <LazyCityCanvas graph={graph} city={city} mode="explorer" fallback={WEBGL_FALLBACK} />
            <MainOverlay />
            <CanvasToolbar omittedFileCount={city.omittedFileCount} raised={Boolean(timeline)} />
            {timeline}
          </main>

          <aside
            aria-label="Files"
            className="order-3 min-h-0 border-line bg-ink lg:order-1 lg:border-r"
          >
            <FileNavigator />
          </aside>

          <aside
            aria-label="Details"
            className="order-2 min-h-0 overflow-y-auto border-b border-line bg-ink lg:order-3 lg:border-b-0 lg:border-l"
          >
            <Inspector />
          </aside>
        </div>

        <SelectionAnnouncer adjacency={adjacency} />
      </div>
    </ExplorerDataProvider>
  );
}

/** The dependency graph view when chosen, and the legend over the city otherwise. */
function MainOverlay() {
  const { graph, adjacency, cycles } = useExplorerData();
  const mainView = useExplorerStore((s) => s.mainView);
  const selectedId = useExplorerStore((s) => s.selectedId);
  const search = useSearchResults(graph.files, adjacency);
  if (mainView === "graph") return <DependencyGraphView />;
  return (
    <DependencyLegend
      inCycle={selectedId !== null && cycles.groupOf.has(selectedId)}
      searching={search.active}
    />
  );
}

/** Tells screen reader users what a selection did, since the city itself can't. */
function SelectionAnnouncer({ adjacency }: { adjacency: Adjacency }) {
  const selectedId = useExplorerStore((s) => s.selectedId);
  const message = selectedId
    ? `Selected ${selectedId}. Imports ${adjacency.imports.get(selectedId)?.length ?? 0} files. Imported by ${adjacency.importedBy.get(selectedId)?.length ?? 0} files.`
    : "";
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}

function useKeyboardShortcuts() {
  const select = useExplorerStore((s) => s.select);
  const fitCamera = useExplorerStore((s) => s.fitCamera);
  const resetCamera = useExplorerStore((s) => s.resetCamera);
  const setMainView = useExplorerStore((s) => s.setMainView);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "Escape") {
        select(null);
        setMainView("city");
      } else if (event.key === "f") fitCamera();
      else if (event.key === "r") resetCamera();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [select, fitCamera, resetCamera, setMainView]);
}
