"use client";

import { useState } from "react";
import { useExplorerStore } from "./store";

interface Entry {
  swatch: string;
  label: string;
}

/** Explains the colours in play right now, and only those. */
export function DependencyLegend({ inCycle, searching }: { inCycle: boolean; searching: boolean }) {
  const selectedId = useExplorerStore((s) => s.selectedId);
  const hoveredId = useExplorerStore((s) => s.hoveredId);
  const depth = useExplorerStore((s) => s.depth);
  const direction = useExplorerStore((s) => s.direction);
  const [open, setOpen] = useState(true);

  const entries: Entry[] = [];
  if (selectedId || hoveredId) {
    entries.push({ swatch: "bg-white", label: selectedId ? "Selected file" : "Hovered file" });
    if (direction !== "importedBy" || !selectedId) {
      entries.push({ swatch: "bg-cyan", label: "Imports (depends on)" });
    }
    if (direction !== "imports" || !selectedId) {
      entries.push({ swatch: "bg-violet", label: "Imported by (depends on it)" });
    }
    if (selectedId && depth !== 1) {
      entries.push({ swatch: "bg-cyan/40", label: "Two or more hops away" });
    }
    if (selectedId && inCycle) entries.push({ swatch: "bg-amber", label: "Same import cycle" });
    entries.push({ swatch: "bg-faint/40", label: "Unrelated" });
  } else if (searching) {
    entries.push({ swatch: "bg-white", label: "Matches the search" });
    entries.push({ swatch: "bg-faint/40", label: "Doesn't match" });
  } else {
    entries.push({ swatch: "bg-cyan", label: "Beacon: key module" });
    entries.push({ swatch: "bg-electric/60", label: "Arcs: imports" });
  }

  return (
    <div className="pointer-events-auto absolute top-3 left-3 max-w-[15rem] rounded-md border border-line bg-panel/90 text-xs backdrop-blur">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-1.5 font-mono text-[11px] text-muted hover:text-text"
      >
        Legend
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <ul className="space-y-1 px-3 pb-2.5" aria-label="Legend">
          {entries.map((entry) => (
            <li key={entry.label} className="flex items-center gap-2 text-muted">
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-sm ${entry.swatch}`} />
              {entry.label}
            </li>
          ))}
          {(selectedId || hoveredId) && (
            <li className="pt-1 text-[11px] leading-snug text-faint">
              Arrows and pulses point from a file to what it imports.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
