import { describe, expect, it } from "vitest";
import { lensFiles } from "./lens";

const insights = {
  hotspots: [
    { id: "a.ts", value: 30 },
    { id: "b.ts", value: 12 },
  ],
  mostDependedUpon: [{ id: "c.ts", value: 9 }],
};
const cycles = {
  groupOf: new Map([
    ["d.ts", 0],
    ["e.ts", 0],
  ]),
};

describe("lensFiles", () => {
  it("takes each lens from the analysis's own rankings", () => {
    expect(lensFiles("complexity", insights, cycles)).toEqual(new Set(["a.ts", "b.ts"]));
    expect(lensFiles("dependents", insights, cycles)).toEqual(new Set(["c.ts"]));
    expect(lensFiles("cycles", insights, cycles)).toEqual(new Set(["d.ts", "e.ts"]));
  });

  it("is empty when there is nothing to show", () => {
    expect(lensFiles("cycles", insights, { groupOf: new Map() }).size).toBe(0);
  });
});

describe("lens highlighting", () => {
  it("lights the lens's files, and gives way to a selection", async () => {
    const { computeHighlight } = await import("./highlight");
    const { buildAdjacency } = await import("@/lib/graph/queries");
    const file = (id: string) => ({ id, path: id, language: "ts", loc: 1, complexity: 1 });
    const adjacency = buildAdjacency({
      schemaVersion: 1,
      provenance: { kind: "demo", repository: "t/t", note: "" },
      files: ["a.ts", "b.ts"].map(file),
      edges: [{ source: "a.ts", target: "b.ts", kind: "import" }],
    });
    const lens = new Set(["a.ts"]);
    const lit = computeHighlight(adjacency, null, null, { lens, insights: new Set(["b.ts"]) });
    expect(lit.stateOf("a.ts")).toBe("lens");
    expect(lit.stateOf("b.ts")).toBe("dimmed");
    expect(computeHighlight(adjacency, "b.ts", null, { lens }).stateOf("a.ts")).toBe("dependent");
  });
});
