import type { Reach } from "@/lib/graph/dependencies";
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
  | "match";

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
