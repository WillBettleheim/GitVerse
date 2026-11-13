import { describe, expect, it } from "vitest";
import demo from "@/features/demo/demo-graph.json";
import sample from "@/features/analysis/__fixtures__/analysis-sample.json";
import { generateSyntheticGraph } from "@/features/demo/synthetic-graph";
import { byDepth, cycleOf, findCycles, reachEdges, traverse, type Reach } from "./dependencies";
import { layoutDependencyGraph, MAX_PER_COLUMN } from "./dependency-graph-layout";
import { buildAdjacency } from "./queries";
import { parseCodeGraph, type CodeGraph } from "./schema";

const file = (id: string) => ({ id, path: id, language: "ts", loc: 1, complexity: 1 });
const edge = (source: string, target: string) => ({ source, target, kind: "import" as const });

/**
 *   a → b → c → d
 *   e → b
 *   c → f → c        (cycle c ⇄ f)
 *   x                (isolated)
 */
const graph: CodeGraph = {
  schemaVersion: 1,
  provenance: { kind: "demo", repository: "t/t", note: "" },
  files: ["a", "b", "c", "d", "e", "f", "x"].map(file),
  edges: [
    edge("a", "b"),
    edge("b", "c"),
    edge("c", "d"),
    edge("e", "b"),
    edge("c", "f"),
    edge("f", "c"),
  ],
};
const adjacency = buildAdjacency(graph);
const entries = (map: ReadonlyMap<string, number>) => Object.fromEntries([...map].sort());

describe("traverse", () => {
  it("finds one-hop imports and importers", () => {
    const reach = traverse(adjacency, "b", "both", 1);
    expect(entries(reach.imports)).toEqual({ c: 1 });
    expect(entries(reach.importedBy)).toEqual({ a: 1, e: 1 });
  });

  it("follows multiple hops with shortest distances", () => {
    const reach = traverse(adjacency, "a", "imports", 3);
    expect(entries(reach.imports)).toEqual({ b: 1, c: 2, d: 3, f: 3 });
    expect(reach.importedBy.size).toBe(0);
  });

  it("stops at the requested depth", () => {
    expect(entries(traverse(adjacency, "a", "imports", 2).imports)).toEqual({ b: 1, c: 2 });
  });

  it("follows everything reachable for 'all', without looping on cycles", () => {
    const reach = traverse(adjacency, "d", "importedBy", "all");
    expect(entries(reach.importedBy)).toEqual({ a: 3, b: 2, c: 1, e: 3, f: 2 });
  });

  it("never includes the root in its own results", () => {
    const reach = traverse(adjacency, "c", "both", "all");
    expect(reach.imports.has("c")).toBe(false);
    expect(reach.importedBy.has("c")).toBe(false);
  });

  it("returns nothing for an isolated file", () => {
    const reach = traverse(adjacency, "x", "both", "all");
    expect(reach.imports.size + reach.importedBy.size).toBe(0);
  });

  it("handles 1,000 files quickly", () => {
    const large = generateSyntheticGraph(1000);
    const largeAdjacency = buildAdjacency(large);
    const start = performance.now();
    for (const f of large.files.slice(0, 50)) traverse(largeAdjacency, f.id, "both", "all");
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("reachEdges", () => {
  it("keeps only the edges that lead one hop further, with their direction", () => {
    const reach = traverse(adjacency, "b", "both", 2);
    const edges = reachEdges(graph.edges, reach, null);
    expect(edges).toEqual(
      expect.arrayContaining([
        { source: "b", target: "c", role: "import" },
        { source: "c", target: "d", role: "import" },
        { source: "c", target: "f", role: "import" },
        { source: "a", target: "b", role: "importer" },
        { source: "e", target: "b", role: "importer" },
      ]),
    );
    expect(edges).toHaveLength(5);
  });

  it("marks edges inside the root's cycle", () => {
    const reach = traverse(adjacency, "c", "both", 1);
    const cycle = cycleOf(findCycles(graph), "c");
    const roles = reachEdges(graph.edges, reach, cycle).map(
      (e) => `${e.source}${e.target}:${e.role}`,
    );
    expect(roles.sort()).toEqual(["bc:importer", "cd:import", "cf:cycle", "fc:cycle"]);
  });
});

describe("findCycles", () => {
  it("finds strongly connected groups and indexes their members", () => {
    const cycles = findCycles(graph);
    expect(cycles.groups).toEqual([["c", "f"]]);
    expect(cycles.groupOf.get("f")).toBe(0);
    expect(cycles.groupOf.has("a")).toBe(false);
    expect(cycleOf(cycles, "a")).toBeNull();
  });

  it("agrees with the backend on real analysis output", () => {
    const real = parseCodeGraph(sample);
    expect(findCycles(real).groups.length).toBe(real.analysis!.cycleCount);
  });

  it("finds no cycles in the acyclic demo city", () => {
    expect(findCycles(parseCodeGraph(demo)).groups).toEqual([]);
  });

  it("survives a 10,000-long import chain without overflowing the stack", () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => `f${i}`);
    const chain = {
      files: ids.map(file),
      edges: [...ids.slice(1).map((id, i) => edge(ids[i], id)), edge(ids[9999], ids[0])],
    };
    expect(findCycles(chain).groups[0]).toHaveLength(10_000);
  });
});

describe("byDepth", () => {
  it("groups by distance in order, sorted within each level", () => {
    expect(
      byDepth(
        new Map([
          ["z", 2],
          ["a", 1],
          ["m", 2],
        ]),
      ),
    ).toEqual([
      [1, ["a"]],
      [2, ["m", "z"]],
    ]);
  });
});

describe("layoutDependencyGraph", () => {
  it("puts importers left, the root in the middle and imports right", () => {
    const columns = layoutDependencyGraph(traverse(adjacency, "b", "both", 2));
    expect(columns.map((c) => [c.depth, c.ids])).toEqual([
      [-1, ["a", "e"]],
      [0, ["b"]],
      [1, ["c"]],
      [2, ["d", "f"]],
    ]);
  });

  it("shows a file that's both an import and an importer only once", () => {
    const columns = layoutDependencyGraph(traverse(adjacency, "c", "both", 1));
    const all = columns.flatMap((c) => c.ids);
    expect(all.filter((id) => id === "f")).toHaveLength(1);
  });

  it("caps crowded columns and says how many were left out", () => {
    const imports = new Map(Array.from({ length: 45 }, (_, i) => [`m${i}`, 1] as const));
    const reach: Reach = { root: "r", imports, importedBy: new Map() };
    const column = layoutDependencyGraph(reach).find((c) => c.depth === 1)!;
    expect(column.ids).toHaveLength(MAX_PER_COLUMN);
    expect(column.hidden).toBe(45 - MAX_PER_COLUMN);
  });
});
