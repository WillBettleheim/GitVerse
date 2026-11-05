"use client";

import { useExplorerStore } from "./store";

const button =
  "h-8 rounded border border-line bg-panel/90 px-3 font-mono text-xs text-muted backdrop-blur transition-colors hover:border-faint hover:text-text aria-pressed:border-cyan/50 aria-pressed:text-cyan";

export function CanvasToolbar() {
  const showConnections = useExplorerStore((s) => s.showConnections);
  const toggleConnections = useExplorerStore((s) => s.toggleConnections);
  const resetCamera = useExplorerStore((s) => s.resetCamera);

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
      <div className="pointer-events-auto flex gap-2">
        <button
          type="button"
          aria-pressed={showConnections}
          onClick={toggleConnections}
          className={button}
        >
          Connections
        </button>
        <button type="button" onClick={resetCamera} className={button}>
          Reset view
        </button>
      </div>
      <p className="hidden font-mono text-[11px] text-faint md:block">
        Drag to orbit · Scroll to zoom · Right-drag to pan · Click a building
      </p>
    </div>
  );
}
