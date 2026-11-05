import { describe, expect, it } from "vitest";
import demo from "@/features/demo/demo-graph.json";
import { parseCodeGraph } from "./schema";

const clone = () => structuredClone(demo) as typeof demo;

describe("parseCodeGraph", () => {
  it("accepts the demo graph and preserves its demo provenance", () => {
    expect(parseCodeGraph(demo).provenance.kind).toBe("demo");
  });

  it("rejects edges pointing at unknown files", () => {
    const graph = clone();
    graph.edges.push({ source: graph.files[0].id, target: "missing.ts", kind: "import" });
    expect(() => parseCodeGraph(graph)).toThrow(/unknown file/);
  });

  it("rejects self-imports", () => {
    const graph = clone();
    graph.edges.push({ source: graph.files[0].id, target: graph.files[0].id, kind: "import" });
    expect(() => parseCodeGraph(graph)).toThrow(/self-import/);
  });

  it("rejects duplicate file ids", () => {
    const graph = clone();
    graph.files.push(graph.files[0]);
    expect(() => parseCodeGraph(graph)).toThrow(/duplicate/);
  });

  it.each(["/etc/passwd", "../secret", "a/../b", "a//b", "a\\b", "./a"])(
    "rejects unsafe path %s",
    (path) => {
      const graph = clone();
      graph.files[0].path = path;
      expect(() => parseCodeGraph(graph)).toThrow(/clean relative/);
    },
  );

  it("rejects unknown provenance kinds and unknown fields", () => {
    const badKind = clone();
    (badKind.provenance as { kind: string }).kind = "real";
    expect(() => parseCodeGraph(badKind)).toThrow();
    expect(() => parseCodeGraph({ ...clone(), extra: true })).toThrow();
  });
});
