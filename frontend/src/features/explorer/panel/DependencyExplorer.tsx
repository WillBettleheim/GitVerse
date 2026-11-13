"use client";

import { useMemo } from "react";
import { byDepth, type DepthSetting, type Direction, type Reach } from "@/lib/graph/dependencies";
import { countFormat, fileName } from "../explorer-data";
import { useExplorerStore } from "../store";

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "imports", label: "Imports →" },
  { value: "importedBy", label: "← Imported by" },
];
const DEPTHS: { value: DepthSetting; label: string }[] = [
  { value: 1, label: "1 hop" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: "all", label: "All" },
];
const LEVEL_LIMIT = 60;

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md border border-line p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className="min-w-0 flex-1 rounded px-2 py-1 font-mono text-[11px] whitespace-nowrap text-muted transition-colors hover:text-text aria-pressed:bg-raised aria-pressed:text-cyan"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Level({
  title,
  arrow,
  tone,
  levels,
  cycle,
}: {
  title: string;
  arrow: string;
  tone: string;
  levels: [number, string[]][];
  cycle: ReadonlySet<string> | null;
}) {
  const select = useExplorerStore((s) => s.select);
  const total = levels.reduce((sum, [, ids]) => sum + ids.length, 0);
  return (
    <section className="mt-4">
      <h4 className="flex items-baseline gap-2 text-sm font-medium">
        <span aria-hidden="true" className={tone}>
          {arrow}
        </span>
        {title}
        <span className="font-mono text-xs text-faint">{countFormat.format(total)}</span>
      </h4>
      {total === 0 ? (
        <p className="mt-1 text-sm text-faint">None.</p>
      ) : (
        levels.map(([depth, ids]) => (
          <div key={depth} className="mt-2">
            <p className="font-mono text-[10px] tracking-wide text-faint uppercase">
              {depth === 1 ? "Direct" : `${depth} hops`}
            </p>
            <ul className="mt-0.5">
              {ids.slice(0, LEVEL_LIMIT).map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    title={id}
                    onClick={() => select(id)}
                    className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-raised"
                  >
                    <span className={`shrink-0 text-xs ${tone}`} aria-hidden="true">
                      {arrow}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                      {fileName(id)}
                    </span>
                    {cycle?.has(id) && (
                      <span className="shrink-0 font-mono text-[10px] text-amber">cycle</span>
                    )}
                    <span className="min-w-0 max-w-[45%] shrink truncate font-mono text-[10px] text-faint">
                      {id.slice(0, id.lastIndexOf("/") + 1)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {ids.length > LEVEL_LIMIT && (
              <p className="px-1 text-[11px] text-faint">
                and {countFormat.format(ids.length - LEVEL_LIMIT)} more at this distance
              </p>
            )}
          </div>
        ))
      )}
    </section>
  );
}

/** Direction and depth controls, plus the list view of a traversal. */
export function DependencyExplorer({
  reach,
  cycle,
}: {
  reach: Reach;
  cycle: ReadonlySet<string> | null;
}) {
  const depth = useExplorerStore((s) => s.depth);
  const direction = useExplorerStore((s) => s.direction);
  const mainView = useExplorerStore((s) => s.mainView);
  const setDepth = useExplorerStore((s) => s.setDepth);
  const setDirection = useExplorerStore((s) => s.setDirection);
  const setMainView = useExplorerStore((s) => s.setMainView);

  const imports = useMemo(() => byDepth(reach.imports), [reach]);
  const importers = useMemo(() => byDepth(reach.importedBy), [reach]);

  return (
    <section className="mt-6 border-t border-line pt-4" aria-label="Dependencies">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Dependencies</h3>
        <button
          type="button"
          onClick={() => setMainView(mainView === "graph" ? "city" : "graph")}
          className="font-mono text-[11px] text-cyan hover:text-text"
        >
          {mainView === "graph" ? "Back to the city" : "Open as graph"}
        </button>
      </div>
      <div className="mt-3 space-y-2">
        <Segmented
          label="Direction"
          options={DIRECTIONS}
          value={direction}
          onChange={setDirection}
        />
        <Segmented label="Depth" options={DEPTHS} value={depth} onChange={setDepth} />
      </div>
      {direction !== "importedBy" && (
        <Level title="Depends on" arrow="→" tone="text-cyan" levels={imports} cycle={cycle} />
      )}
      {direction !== "imports" && (
        <Level
          title="Depended on by"
          arrow="←"
          tone="text-violet"
          levels={importers}
          cycle={cycle}
        />
      )}
    </section>
  );
}
