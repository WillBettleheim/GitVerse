"use client";

import { useEffect, useMemo } from "react";
import { Logo } from "@/components/Logo";
import { LazyCityCanvas } from "@/features/city/LazyCityCanvas";
import { generateCity } from "@/lib/city/layout";
import { buildAdjacency } from "@/lib/graph/queries";
import type { CodeGraph } from "@/lib/graph/schema";
import { ApiStatus } from "./ApiStatus";
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

export function ExplorerShell({ graph }: { graph: CodeGraph }) {
  const city = useMemo(() => generateCity(graph), [graph]);
  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);

  const selectedId = useExplorerStore((s) => s.selectedId);
  const hoveredId = useExplorerStore((s) => s.hoveredId);
  const showConnections = useExplorerStore((s) => s.showConnections);
  const cameraResetCount = useExplorerStore((s) => s.cameraResetCount);
  const select = useExplorerStore((s) => s.select);
  const hover = useExplorerStore((s) => s.hover);
  const reset = useExplorerStore((s) => s.reset);

  useEffect(() => reset, [reset]);

  return (
    <div className="flex min-h-svh flex-col bg-void lg:h-svh lg:overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-ink px-4">
        <div className="flex min-w-0 items-center gap-4">
          <Logo />
          <span aria-hidden="true" className="h-4 w-px bg-line" />
          <span className="truncate font-mono text-xs text-muted">{graph.provenance.repository}</span>
        </div>
        <ApiStatus />
      </header>

      <DemoBanner provenance={graph.provenance} />

      <div className="flex flex-1 flex-col lg:grid lg:min-h-0 lg:grid-cols-[17rem_minmax(0,1fr)_20rem]">
        <main className="relative order-1 h-[58svh] shrink-0 lg:order-2 lg:h-auto">
          <LazyCityCanvas
            graph={graph}
            city={city}
            fallback={WEBGL_FALLBACK}
            selection={{
              selectedId,
              hoveredId,
              showConnections,
              cameraResetCount,
              onHover: hover,
              onSelect: select,
            }}
          />
          <CanvasToolbar />
        </main>

        <aside
          aria-label="Files"
          className="order-3 min-h-0 border-line bg-ink lg:order-1 lg:border-r"
        >
          <FileNavigator city={city} />
        </aside>

        <aside
          aria-label="Details"
          className="order-2 min-h-0 overflow-y-auto border-b border-line bg-ink lg:order-3 lg:border-b-0 lg:border-l"
        >
          <Inspector graph={graph} city={city} adjacency={adjacency} />
        </aside>
      </div>
    </div>
  );
}
