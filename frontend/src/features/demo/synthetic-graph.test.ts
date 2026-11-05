import { describe, expect, it } from "vitest";
import { computeImportance } from "@/lib/graph/metrics";
import { codeGraphSchema } from "@/lib/graph/schema";
import { generateSyntheticGraph, isSyntheticSize, SYNTHETIC_SIZES } from "./synthetic-graph";

describe.each(SYNTHETIC_SIZES)("synthetic graph with %i files", (size) => {
  const graph = generateSyntheticGraph(size);

  it("has exactly the requested file count", () => {
    expect(graph.files).toHaveLength(size);
  });

  it("passes the shared schema", () => {
    expect(codeGraphSchema.safeParse(graph).success).toBe(true);
  });

  it("is labelled as demo data, never as analysis", () => {
    expect(graph.provenance.kind).toBe("demo");
    expect(graph.provenance.note).toMatch(/not the result of analyzing/i);
  });

  it("is the same every time", () => {
    expect(generateSyntheticGraph(size)).toEqual(graph);
  });

  it("has hub modules, like real dependency graphs", () => {
    const fanIns = [...computeImportance(graph).values()].map((i) => i.fanIn);
    const average = fanIns.reduce((a, b) => a + b, 0) / fanIns.length;
    expect(Math.max(...fanIns)).toBeGreaterThan(average * 5);
  });
});

describe("isSyntheticSize", () => {
  it("accepts only the supported sizes", () => {
    expect(isSyntheticSize(500)).toBe(true);
    expect(isSyntheticSize(501)).toBe(false);
    expect(isSyntheticSize(Number.NaN)).toBe(false);
  });
});
