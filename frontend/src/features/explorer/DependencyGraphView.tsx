"use client";

import { useMemo } from "react";
import { reachEdges, type EdgeRole } from "@/lib/graph/dependencies";
import { layoutDependencyGraph } from "@/lib/graph/dependency-graph-layout";
import { countFormat, fileName, useExplorerData } from "./explorer-data";
import { useExplorerStore } from "./store";
import { useSelectionReach } from "./use-explorer-data";

const COLUMN_WIDTH = 210;
const COLUMN_GAP = 70;
const ROW_HEIGHT = 34;
const NODE_HEIGHT = 26;
const HEADER = 40;
const PADDING = 24;

const EDGE_COLORS: Record<EdgeRole, string> = {
  import: "#22d3ee",
  importer: "#a78bfa",
  cycle: "#fbbf24",
};

function columnLabel(depth: number): string {
  if (depth === 0) return "Selected";
  const hops = Math.abs(depth) === 1 ? "direct" : `${Math.abs(depth)} hops`;
  return depth < 0 ? `← Imported by (${hops})` : `Imports → (${hops})`;
}

/**
 * The selection's dependencies as a flat, left-to-right graph: an alternative to the city that
 * makes direction and distance explicit. Every node is a button, so it works by keyboard.
 */
export function DependencyGraphView() {
  const { adjacency, cycles, city } = useExplorerData();
  const selectedId = useExplorerStore((s) => s.selectedId);
  const select = useExplorerStore((s) => s.select);
  const setMainView = useExplorerStore((s) => s.setMainView);
  const { reach, cycle } = useSelectionReach(adjacency, cycles, selectedId);

  const layout = useMemo(() => {
    if (!reach) return null;
    const columns = layoutDependencyGraph(reach);
    const tallest = Math.max(...columns.map((c) => c.ids.length + (c.hidden ? 1 : 0)));
    const height = HEADER + PADDING * 2 + tallest * ROW_HEIGHT;
    const position = new Map<string, { x: number; y: number }>();
    columns.forEach((column, index) => {
      const x = PADDING + index * (COLUMN_WIDTH + COLUMN_GAP);
      const offset = ((tallest - column.ids.length) * ROW_HEIGHT) / 2;
      column.ids.forEach((id, row) => {
        position.set(id, { x, y: HEADER + PADDING + offset + row * ROW_HEIGHT });
      });
    });
    const edges = reachEdges(city.connections, reach, cycle).filter(
      (e) => position.has(e.source) && position.has(e.target),
    );
    const width = PADDING * 2 + columns.length * COLUMN_WIDTH + (columns.length - 1) * COLUMN_GAP;
    return { columns, position, edges, width, height, tallest };
  }, [reach, cycle, city.connections]);

  return (
    // Above the city's labels and toolbar, which belong to the 3D view.
    <div className="absolute inset-0 z-30 flex flex-col bg-void">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
        <p className="text-sm">
          <span className="font-medium">Dependency graph</span>
          {selectedId && (
            <span className="ml-2 font-mono text-xs text-faint">{fileName(selectedId)}</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setMainView("city")}
          className="h-8 rounded border border-line px-3 font-mono text-xs text-muted hover:text-text"
        >
          Back to the city
        </button>
      </div>

      {!layout ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-faint">
          Select a file to see its dependency graph.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto" role="region" aria-label="Dependency graph">
          <div className="relative" style={{ width: layout.width, height: layout.height }}>
            <svg
              width={layout.width}
              height={layout.height}
              className="absolute inset-0"
              aria-hidden="true"
            >
              <defs>
                {Object.entries(EDGE_COLORS).map(([role, color]) => (
                  <marker
                    key={role}
                    id={`arrow-${role}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M0,0 L10,5 L0,10 z" fill={color} />
                  </marker>
                ))}
              </defs>
              {layout.edges.map((edge) => {
                const from = layout.position.get(edge.source)!;
                const to = layout.position.get(edge.target)!;
                const fromRight = from.x < to.x;
                const x1 = fromRight ? from.x + COLUMN_WIDTH : from.x;
                const x2 = fromRight ? to.x : to.x + COLUMN_WIDTH;
                const y1 = from.y + NODE_HEIGHT / 2;
                const y2 = to.y + NODE_HEIGHT / 2;
                const bend = Math.max(30, Math.abs(x2 - x1) / 2);
                const c1 = fromRight ? x1 + bend : x1 - bend;
                const c2 = fromRight ? x2 - bend : x2 + bend;
                return (
                  <path
                    key={`${edge.source}>${edge.target}`}
                    d={`M${x1},${y1} C${c1},${y1} ${c2},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke={EDGE_COLORS[edge.role]}
                    strokeOpacity={0.65}
                    strokeWidth={1.25}
                    markerEnd={`url(#arrow-${edge.role})`}
                  />
                );
              })}
            </svg>

            {layout.columns.map((column, index) => (
              <p
                key={column.depth}
                className="absolute truncate font-mono text-[10px] tracking-wide text-faint uppercase"
                style={{
                  left: PADDING + index * (COLUMN_WIDTH + COLUMN_GAP),
                  top: 14,
                  width: COLUMN_WIDTH,
                }}
              >
                {columnLabel(column.depth)}
              </p>
            ))}

            {layout.columns.flatMap((column) =>
              column.ids.map((id) => {
                const { x, y } = layout.position.get(id)!;
                const tone =
                  column.depth === 0
                    ? "border-white/40 bg-raised text-white"
                    : cycle?.has(id)
                      ? "border-amber/50 text-amber hover:bg-amber/10"
                      : column.depth > 0
                        ? "border-cyan/35 text-text hover:bg-cyan/10"
                        : "border-violet/35 text-text hover:bg-violet/10";
                return (
                  <button
                    key={id}
                    type="button"
                    title={id}
                    aria-current={column.depth === 0 ? "true" : undefined}
                    onClick={() => select(id)}
                    className={`absolute truncate rounded border px-2 text-left text-xs transition-colors ${tone}`}
                    style={{ left: x, top: y, width: COLUMN_WIDTH, height: NODE_HEIGHT }}
                  >
                    {fileName(id)}
                  </button>
                );
              }),
            )}

            {layout.columns.map((column, index) =>
              column.hidden > 0 ? (
                <p
                  key={`hidden-${column.depth}`}
                  className="absolute px-2 font-mono text-[11px] text-faint"
                  style={{
                    left: PADDING + index * (COLUMN_WIDTH + COLUMN_GAP),
                    top:
                      HEADER +
                      PADDING +
                      ((layout.tallest - column.ids.length) * ROW_HEIGHT) / 2 +
                      column.ids.length * ROW_HEIGHT,
                  }}
                >
                  +{countFormat.format(column.hidden)} more
                </p>
              ) : null,
            )}
          </div>
        </div>
      )}
    </div>
  );
}
