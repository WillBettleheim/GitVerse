import type { Reach } from "@/lib/graph/dependencies";
import type { ChangeKind } from "@/lib/timetravel/transition";
import type { Adjacency } from "@/lib/graph/queries";

export type HighlightState =
  | "normal"
  | "dimmed"
  | "selected"
  | "hovered"
  /** The active file imports this one directly. */
  | "dependency"
  /** This one imports the active file directly. */
  | "dependent"
  /** Reached through imports, two or more hops away. */
  | "dependency-far"
  /** Imports the active file through two or more hops. */
  | "dependent-far"
  /** In the same import cycle as the selected file. */
  | "cycle"
  /** Matches the current search, with nothing selected. */
  | "match"
  /** Named by AI Architect's latest answer, with nothing selected or searched. */
  | "insight"
  /** Time travel: what happened to this file since the previous snapshot. */
  | "added"
  | "modified"
  | "renamed";

export interface Highlight {
  /** The file whose relationships are shown: the selection, or else whatever is hovered. */
  activeId: string | null;
  stateOf: (id: string) => HighlightState;
}

export interface HighlightContext {
  /** The selection's traversal at the chosen depth and direction. Without it, one hop. */
  reach?: Reach | null;
  /** Members of the selection's import cycle, if it's in one. */
  cycle?: ReadonlySet<string> | null;
  /** Search results. When set and nothing is selected, everything else dims. */
  matches?: ReadonlySet<string> | null;
  /** Files AI Architect pointed to. Shown when nothing is selected, hovered or searched. */
  insights?: ReadonlySet<string> | null;
  /** Time travel changes. Shown when nothing is selected, hovered or searched. */
  changes?: ReadonlyMap<string, ChangeKind> | null;
}

export function computeHighlight(
  adjacency: Adjacency,
  selectedId: string | null,
  hoveredId: string | null,
  context: HighlightContext = {},
): Highlight {
  const activeId = selectedId ?? hoveredId;
  if (!activeId) {
    const matches = context.matches;
    const changes = context.changes;
    const insights = context.insights;
    if (!matches && insights && insights.size > 0) {
      return { activeId: null, stateOf: (id) => (insights.has(id) ? "insight" : "dimmed") };
    }
    if (!matches && changes) {
      return {
        activeId: null,
        stateOf: (id) => {
          const kind = changes.get(id);
          return kind === "added" || kind === "modified" || kind === "renamed" ? kind : "normal";
        },
      };
    }
    if (!matches) return { activeId: null, stateOf: () => "normal" };
    return {
      activeId: null,
      stateOf: (id) => (matches.has(id) ? "match" : "dimmed"),
    };
  }

  const states = new Map<string, HighlightState>();
  const reach = selectedId && context.reach?.root === selectedId ? context.reach : null;
  if (reach) {
    for (const [id, depth] of reach.importedBy)
      states.set(id, depth === 1 ? "dependent" : "dependent-far");
    // A file reached both ways is in a cycle with the root. Imports win, as that's what it needs.
    for (const [id, depth] of reach.imports)
      states.set(id, depth === 1 ? "dependency" : "dependency-far");
    for (const id of context.cycle ?? []) states.set(id, "cycle");
  } else {
    for (const id of adjacency.importedBy.get(activeId) ?? []) states.set(id, "dependent");
    // A file in both lists is a cycle. Dependency wins, as it's what the active file needs.
    for (const id of adjacency.imports.get(activeId) ?? []) states.set(id, "dependency");
  }
  states.set(activeId, selectedId ? "selected" : "hovered");
  // Hovering elsewhere while something is selected marks that building without losing the selection.
  if (selectedId && hoveredId && hoveredId !== selectedId) states.set(hoveredId, "hovered");

  return { activeId, stateOf: (id) => states.get(id) ?? "dimmed" };
}
