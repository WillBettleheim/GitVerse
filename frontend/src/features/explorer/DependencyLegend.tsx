"use client";

import { useState } from "react";
import { useArchitectStore } from "@/features/architect/store";
import { LENSES, lensFiles, type LensKind } from "@/lib/city/lens";
import { useExplorerData } from "./explorer-data";
import { useExplorerStore } from "./store";

interface Entry {
  swatch: string;
  label: string;
}

/** How each visual property maps to the analysis. Every one is computed from real data. */
const ENCODINGS: { mark: string; meaning: string }[] = [
  { mark: "Height", meaning: "Cyclomatic complexity" },
  { mark: "Footprint", meaning: "Lines of code" },
  { mark: "Colour", meaning: "Top-level folder" },
  { mark: "Windows", meaning: "File type: source, test, config…" },
  { mark: "Beacon", meaning: "Key module: among the most depended on" },
  { mark: "Plots", meaning: "Folders, nested inside their parent" },
];

const LENS_ORDER: LensKind[] = ["complexity", "dependents", "cycles"];

/**
 * The map key: what is lit right now, how to read the city, and the hotspot lenses. Explains the
 * colours in play and only those.
 */
export function DependencyLegend({ inCycle, searching }: { inCycle: boolean; searching: boolean }) {
  const { insights, cycles } = useExplorerData();
  const selectedId = useExplorerStore((s) => s.selectedId);
  const hoveredId = useExplorerStore((s) => s.hoveredId);
  const depth = useExplorerStore((s) => s.depth);
  const direction = useExplorerStore((s) => s.direction);
  const lens = useExplorerStore((s) => s.lens);
  const setLens = useExplorerStore((s) => s.setLens);
  const spotlight = useArchitectStore((s) => s.spotlight);
  // Null follows the screen: open on larger screens, folded on phones, where space is scarce.
  const [open, setOpen] = useState<boolean | null>(null);
  const [showKey, setShowKey] = useState(false);

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
  } else if (lens !== "none") {
    entries.push({ swatch: "bg-hot", label: LENSES[lens].description });
    entries.push({ swatch: "bg-faint/40", label: "Everything else" });
  } else if (spotlight) {
    entries.push({ swatch: "bg-rose", label: "Named in AI Architect’s answer" });
    if (spotlight.edges.length > 0) {
      entries.push({ swatch: "bg-rose/60", label: "Arcs: imports the answer names" });
    }
    entries.push({ swatch: "bg-faint/40", label: "Not named" });
  } else {
    entries.push({ swatch: "bg-cyan", label: "Beacon: key module" });
    entries.push({ swatch: "bg-electric/60", label: "Arcs: imports" });
  }

  const lensSizes = Object.fromEntries(
    LENS_ORDER.map((kind) => [kind, lensFiles(kind, insights, cycles).size]),
  ) as Record<LensKind, number>;

  return (
    <div
      className={`glass pointer-events-auto absolute top-3 left-3 max-w-[calc(100%-1.5rem)] rounded-lg text-xs shadow-lg shadow-black/30 ${open === false ? "w-auto" : open === null ? "md:w-[15.5rem]" : "w-[15.5rem]"}`}
    >
      <button
        type="button"
        aria-expanded={open ?? undefined}
        onClick={() =>
          setOpen((v) => !(v ?? window.matchMedia("(min-width: 768px)").matches))
        }
        className="flex w-full items-center justify-between gap-3 px-3 py-2 font-mono text-[11px] tracking-wide text-muted uppercase hover:text-text"
      >
        Map key
        <span aria-hidden="true">
          {open === null ? (
            <>
              <span className="md:hidden">+</span>
              <span className="max-md:hidden">−</span>
            </>
          ) : open ? (
            "−"
          ) : (
            "+"
          )}
        </span>
      </button>
      {open !== false && (
        <div className={`space-y-3 px-3 pb-3 ${open === null ? "max-md:hidden" : ""}`}>
          <ul className="space-y-1" aria-label="Legend">
            {entries.map((entry) => (
              <li key={entry.label} className="flex items-center gap-2 text-muted">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-sm ${entry.swatch}`}
                />
                {entry.label}
              </li>
            ))}
            {(selectedId || hoveredId) && (
              <li className="pt-1 text-[11px] leading-snug text-faint">
                Arrows and pulses point from a file to what it imports.
              </li>
            )}
          </ul>

          <div role="group" aria-label="Hotspot lens">
            <p className="mb-1.5 font-mono text-[10px] tracking-wide text-faint uppercase">
              Hotspot lens
            </p>
            <div className="grid grid-cols-3 gap-1">
              {LENS_ORDER.map((kind) => {
                const empty = lensSizes[kind] === 0;
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={lens === kind}
                    disabled={empty}
                    title={
                      empty
                        ? kind === "cycles"
                          ? "No import cycles in this snapshot."
                          : "Nothing to rank in this snapshot."
                        : `${LENSES[kind].description} (${lensSizes[kind]})`
                    }
                    onClick={() => setLens(lens === kind ? "none" : kind)}
                    className="rounded border border-line px-1 py-1 text-[10px] text-muted transition-colors hover:border-faint hover:text-text disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:border-hot/60 aria-pressed:bg-hot/10 aria-pressed:text-hot"
                  >
                    {LENSES[kind].label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <button
              type="button"
              aria-expanded={showKey}
              onClick={() => setShowKey((v) => !v)}
              className="font-mono text-[10px] tracking-wide text-faint uppercase hover:text-text"
            >
              How to read the city {showKey ? "−" : "+"}
            </button>
            {showKey && (
              <dl className="mt-1.5 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
                {ENCODINGS.map((e) => (
                  <div key={e.mark} className="contents">
                    <dt className="text-text">{e.mark}</dt>
                    <dd className="text-muted">{e.meaning}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
