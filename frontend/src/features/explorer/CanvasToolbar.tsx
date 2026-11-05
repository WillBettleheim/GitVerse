"use client";

import { useReducedMotion } from "@/features/city/use-reduced-motion";
import { useExplorerStore } from "./store";

const button =
  "h-8 rounded border border-line bg-panel/90 px-3 font-mono text-xs text-muted backdrop-blur transition-colors hover:border-faint hover:text-text disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:text-muted aria-pressed:border-cyan/50 aria-pressed:text-cyan";

const countFormat = new Intl.NumberFormat("en-US");

export function CanvasToolbar({ omittedFileCount = 0 }: { omittedFileCount?: number }) {
  const showConnections = useExplorerStore((s) => s.showConnections);
  const cinematic = useExplorerStore((s) => s.cinematic);
  const renderInfo = useExplorerStore((s) => s.renderInfo);
  const toggleConnections = useExplorerStore((s) => s.toggleConnections);
  const toggleCinematic = useExplorerStore((s) => s.toggleCinematic);
  const resetCamera = useExplorerStore((s) => s.resetCamera);
  const fitCamera = useExplorerStore((s) => s.fitCamera);
  const reducedMotion = useReducedMotion();

  const hiddenConnections = renderInfo && renderInfo.shownConnections < renderInfo.totalConnections;

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
      <div className="pointer-events-auto flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={showConnections}
          onClick={toggleConnections}
          className={button}
        >
          Connections
        </button>
        <button type="button" onClick={fitCamera} className={button} aria-keyshortcuts="f">
          Fit to city
        </button>
        <button type="button" onClick={resetCamera} className={button} aria-keyshortcuts="r">
          Reset view
        </button>
        <button
          type="button"
          aria-pressed={cinematic}
          disabled={reducedMotion}
          title={reducedMotion ? "Off because your system asks for reduced motion." : undefined}
          onClick={toggleCinematic}
          className={button}
        >
          Cinematic
        </button>
      </div>
      <div className="hidden text-right font-mono text-[11px] leading-relaxed text-faint md:block">
        {omittedFileCount > 0 && (
          <p className="text-amber">
            Drawing the most important files: {countFormat.format(omittedFileCount)} not shown
          </p>
        )}
        {hiddenConnections && (
          <p>
            Showing {countFormat.format(renderInfo.shownConnections)} of{" "}
            {countFormat.format(renderInfo.totalConnections)} connections. Select a file for all of
            its own.
          </p>
        )}
        <p>
          Drag to orbit · Scroll to zoom · Right-drag to pan
          {renderInfo && ` · ${renderInfo.tier} quality`}
        </p>
      </div>
    </div>
  );
}
