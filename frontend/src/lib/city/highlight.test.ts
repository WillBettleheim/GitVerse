import { describe, expect, it } from "vitest";
import { buildAdjacency } from "@/lib/graph/queries";
import type { CodeGraph } from "@/lib/graph/schema";
import { traverse } from "@/lib/graph/dependencies";
import { computeHighlight } from "./highlight";

const file = (id: string) => ({ id, path: id, language: "ts", loc: 1, complexity: 1 });
const edge = (source: string, target: string) => ({ source, target, kind: "import" as const });

// a → b → c, d → b, b ⇄ e (a cycle), f is isolated
const graph: CodeGraph = {
  schemaVersion: 1,
  provenance: { kind: "demo", repository: "t/t", note: "" },
  files: ["a", "b", "c", "d", "e", "f"].map(file),
  edges: [edge("a", "b"), edge("b", "c"), edge("d", "b"), edge("b", "e"), edge("e", "b")],
};
const adjacency = buildAdjacency(graph);

describe("computeHighlight", () => {
  it("leaves everything normal when nothing is active", () => {
    const highlight = computeHighlight(adjacency, null, null);
    expect(highlight.activeId).toBeNull();
    expect(highlight.stateOf("a")).toBe("normal");
  });

  it("marks a selection, what it imports, what imports it, and dims the rest", () => {
    const highlight = computeHighlight(adjacency, "b", null);
    expect(highlight.activeId).toBe("b");
    expect(highlight.stateOf("b")).toBe("selected");
    expect(highlight.stateOf("c")).toBe("dependency");
    expect(highlight.stateOf("a")).toBe("dependent");
    expect(highlight.stateOf("d")).toBe("dependent");
    expect(highlight.stateOf("f")).toBe("dimmed");
  });

  it("only follows direct relationships", () => {
    expect(computeHighlight(adjacency, "c", null).stateOf("a")).toBe("dimmed");
  });

  it("shows relationships on hover when nothing is selected", () => {
    const highlight = computeHighlight(adjacency, null, "c");
    expect(highlight.activeId).toBe("c");
    expect(highlight.stateOf("c")).toBe("hovered");
    expect(highlight.stateOf("b")).toBe("dependent");
  });

  it("keeps the selection's relationships while hovering elsewhere", () => {
    const highlight = computeHighlight(adjacency, "b", "f");
    expect(highlight.activeId).toBe("b");
    expect(highlight.stateOf("b")).toBe("selected");
    expect(highlight.stateOf("c")).toBe("dependency");
    expect(highlight.stateOf("f")).toBe("hovered");
  });

  it("treats a cycle as a dependency", () => {
    expect(computeHighlight(adjacency, "b", null).stateOf("e")).toBe("dependency");
  });
});

describe("computeHighlight with a traversal", () => {
  const reach = traverse(adjacency, "b", "both", "all");

  it("separates direct relationships from farther ones", () => {
    const deep = traverse(adjacency, "a", "imports", "all");
    const highlight = computeHighlight(adjacency, "a", null, { reach: deep });
    expect(highlight.stateOf("b")).toBe("dependency");
    expect(highlight.stateOf("c")).toBe("dependency-far");
    expect(highlight.stateOf("f")).toBe("dimmed");
  });

  it("marks members of the selection's cycle", () => {
    const highlight = computeHighlight(adjacency, "b", null, { reach, cycle: new Set(["b", "e"]) });
    expect(highlight.stateOf("b")).toBe("selected");
    expect(highlight.stateOf("e")).toBe("cycle");
    expect(highlight.stateOf("c")).toBe("dependency");
  });

  it("ignores a traversal that belongs to a different file", () => {
    const highlight = computeHighlight(adjacency, "c", null, { reach });
    expect(highlight.stateOf("b")).toBe("dependent");
    expect(highlight.stateOf("a")).toBe("dimmed");
  });

  it("falls back to one hop on hover", () => {
    const highlight = computeHighlight(adjacency, null, "c", { reach });
    expect(highlight.stateOf("b")).toBe("dependent");
    expect(highlight.stateOf("a")).toBe("dimmed");
  });
});

describe("computeHighlight with search matches", () => {
  const matches = new Set(["a", "c"]);

  it("highlights matches and dims the rest when nothing is selected", () => {
    const highlight = computeHighlight(adjacency, null, null, { matches });
    expect(highlight.activeId).toBeNull();
    expect(highlight.stateOf("a")).toBe("match");
    expect(highlight.stateOf("b")).toBe("dimmed");
  });

  it("shows a hovered file's own relationships, even mid-search", () => {
    const highlight = computeHighlight(adjacency, null, "c", { matches });
    expect(highlight.activeId).toBe("c");
    expect(highlight.stateOf("c")).toBe("hovered");
    expect(highlight.stateOf("b")).toBe("dependent");
  });

  it("lets a selection take over from the search", () => {
    const highlight = computeHighlight(adjacency, "c", null, { matches });
    expect(highlight.stateOf("c")).toBe("selected");
    expect(highlight.stateOf("b")).toBe("dependent");
  });
});
