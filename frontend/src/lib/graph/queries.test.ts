import { describe, expect, it } from "vitest";
import type { CodeGraph } from "./schema";
import { buildAdjacency, neighbourhood } from "./queries";

const file = (id: string) => ({ id, path: id, language: "ts", loc: 1, complexity: 1 });
const edge = (source: string, target: string) => ({ source, target, kind: "import" as const });

const graph: CodeGraph = {
  schemaVersion: 1,
  provenance: { kind: "demo", repository: "t/t", note: "" },
  files: ["a", "b", "c", "d"].map(file),
  edges: [edge("a", "c"), edge("a", "b"), edge("b", "c")],
};

describe("buildAdjacency", () => {
  const adjacency = buildAdjacency(graph);

  it("indexes both directions in sorted order", () => {
    expect(adjacency.imports.get("a")).toEqual(["b", "c"]);
    expect(adjacency.importedBy.get("c")).toEqual(["a", "b"]);
  });

  it("gives a file its direct neighbours only", () => {
    expect([...neighbourhood(adjacency, "b")].sort()).toEqual(["a", "b", "c"]);
    expect([...neighbourhood(adjacency, "d")]).toEqual(["d"]);
  });
});
