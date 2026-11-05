import type { Adjacency } from "@/lib/graph/queries";

export type HighlightState =
  | "normal"
  | "dimmed"
  | "selected"
  | "hovered"
  /** The active file imports this one. */
  | "dependency"
  /** This one imports the active file. */
  | "dependent";

export interface Highlight {
  /** The file whose relationships are shown: the selection, or else whatever is hovered. */
  activeId: string | null;
  stateOf: (id: string) => HighlightState;
}

export function computeHighlight(
  adjacency: Adjacency,
  selectedId: string | null,
  hoveredId: string | null,
): Highlight {
  const activeId = selectedId ?? hoveredId;
  if (!activeId) return { activeId: null, stateOf: () => "normal" };

  const states = new Map<string, HighlightState>();
  for (const id of adjacency.importedBy.get(activeId) ?? []) states.set(id, "dependent");
  // A file in both lists is a cycle. Dependency wins, as it's what the active file needs.
  for (const id of adjacency.imports.get(activeId) ?? []) states.set(id, "dependency");
  states.set(activeId, selectedId ? "selected" : "hovered");
  // Hovering elsewhere while something is selected marks that building without losing the selection.
  if (selectedId && hoveredId && hoveredId !== selectedId) states.set(hoveredId, "hovered");

  return { activeId, stateOf: (id) => states.get(id) ?? "dimmed" };
}
