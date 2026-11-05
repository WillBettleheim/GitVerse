import { describe, expect, it } from "vitest";
import { computeImportance, fnv1a, normalizeLog } from "./metrics";
import type { CodeGraph } from "./schema";

const file = (id: string, loc = 100, complexity = 5) => ({
  id,
  path: id,
  language: "ts",
  loc,
  complexity,
});
const edge = (source: string, target: string) => ({ source, target, kind: "import" as const });

function makeGraph(files: CodeGraph["files"], edges: CodeGraph["edges"]): CodeGraph {
  return {
    schemaVersion: 1,
    provenance: { kind: "demo", repository: "t/t", note: "" },
    files,
    edges,
  };
}

describe("normalizeLog", () => {
  it("maps into 0–1 and handles degenerate input", () => {
    expect(normalizeLog(0, 100)).toBe(0);
    expect(normalizeLog(100, 100)).toBe(1);
    expect(normalizeLog(500, 100)).toBe(1);
    expect(normalizeLog(5, 0)).toBe(0);
    expect(normalizeLog(-3, 10)).toBe(0);
  });

  it("is monotonic", () => {
    expect(normalizeLog(50, 100)).toBeGreaterThan(normalizeLog(10, 100));
  });
});

describe("fnv1a", () => {
  it("is stable and distinguishes inputs", () => {
    expect(fnv1a("src/a.ts")).toBe(fnv1a("src/a.ts"));
    expect(fnv1a("src/a.ts")).not.toBe(fnv1a("src/b.ts"));
  });
});

describe("computeImportance", () => {
  const graph = makeGraph(
    [file("hub.ts"), file("a.ts"), file("b.ts"), file("c.ts"), file("huge.ts", 5000, 80)],
    [edge("a.ts", "hub.ts"), edge("b.ts", "hub.ts"), edge("c.ts", "hub.ts"), edge("c.ts", "a.ts")],
  );

  it("counts fan-in and fan-out", () => {
    const hub = computeImportance(graph).get("hub.ts")!;
    expect(hub.fanIn).toBe(3);
    expect(hub.fanOut).toBe(0);
  });

  it("ranks the most depended-on module above a big isolated file", () => {
    const importance = computeImportance(graph);
    expect(importance.get("hub.ts")!.score).toBeGreaterThan(importance.get("huge.ts")!.score);
    expect(importance.get("hub.ts")!.landmark).toBe(true);
    expect(importance.get("huge.ts")!.landmark).toBe(false);
  });

  it("gives no landmarks when nothing has real fan-in", () => {
    const flat = makeGraph([file("a.ts"), file("b.ts")], [edge("a.ts", "b.ts")]);
    expect([...computeImportance(flat).values()].some((i) => i.landmark)).toBe(false);
  });

  it("discounts tests", () => {
    const withTest = makeGraph(
      [file("src/x.ts"), file("tests/x.test.ts"), file("y.ts")],
      [edge("y.ts", "src/x.ts"), edge("y.ts", "tests/x.test.ts")],
    );
    const importance = computeImportance(withTest);
    expect(importance.get("src/x.ts")!.score).toBeGreaterThan(
      importance.get("tests/x.test.ts")!.score,
    );
  });

  it("ignores input order", () => {
    const reversed = makeGraph([...graph.files].reverse(), [...graph.edges].reverse());
    expect(computeImportance(reversed).get("hub.ts")).toEqual(
      computeImportance(graph).get("hub.ts"),
    );
  });
});
