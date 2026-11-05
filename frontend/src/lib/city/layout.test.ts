import { describe, expect, it } from "vitest";
import demo from "@/features/demo/demo-graph.json";
import { parseCodeGraph, type CodeGraph } from "@/lib/graph/schema";
import { DISTRICT_PALETTE, footprintForLoc, generateCity, heightForComplexity } from "./layout";

const graph = parseCodeGraph(demo);

/** A fixed-seed shuffle, so a failure here is reproducible. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  let state = seed;
  for (let i = result.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const overlaps = (
  a: { x: number; z: number; width: number; depth: number },
  b: { x: number; z: number; width: number; depth: number },
) =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2;

describe("generateCity determinism", () => {
  it("produces identical output for repeated runs", () => {
    expect(JSON.stringify(generateCity(graph))).toBe(JSON.stringify(generateCity(graph)));
  });

  it.each([1, 2, 3, 4, 5])("ignores input ordering (seed %i)", (seed) => {
    const reordered: CodeGraph = {
      ...graph,
      files: shuffled(graph.files, seed),
      edges: shuffled(graph.edges, seed + 100),
    };
    expect(generateCity(reordered)).toEqual(generateCity(graph));
  });

  it("keeps a known building at a known position", () => {
    // Pinned on purpose: an unintended layout change should fail here and be reviewed.
    const engine = generateCity(graph).buildings.find((b) =>
      b.id.endsWith("services/pricingEngine.ts"),
    );
    expect(engine).toMatchInlineSnapshot(`
      {
        "color": "#3b82f6",
        "depth": 5.553,
        "districtId": "src/server/services",
        "height": 30,
        "id": "src/server/services/pricingEngine.ts",
        "name": "pricingEngine.ts",
        "path": "src/server/services/pricingEngine.ts",
        "width": 5.553,
        "x": -27.604,
        "z": -26.634,
      }
    `);
  });
});

describe("generateCity geometry", () => {
  const city = generateCity(graph);

  it("creates one building per file and one district per directory", () => {
    expect(city.buildings).toHaveLength(graph.files.length);
    const directories = new Set(
      graph.files.map((f) => (f.path.includes("/") ? f.path.replace(/\/[^/]+$/, "") : "")),
    );
    expect(city.districts.map((d) => d.id).sort()).toEqual([...directories].sort());
  });

  it("never overlaps two buildings", () => {
    for (let i = 0; i < city.buildings.length; i++) {
      for (let j = i + 1; j < city.buildings.length; j++) {
        const [a, b] = [city.buildings[i], city.buildings[j]];
        expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("never overlaps two districts", () => {
    for (let i = 0; i < city.districts.length; i++) {
      for (let j = i + 1; j < city.districts.length; j++) {
        const [a, b] = [city.districts[i], city.districts[j]];
        expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("keeps every building inside its district", () => {
    const districts = new Map(city.districts.map((d) => [d.id, d]));
    for (const b of city.buildings) {
      const d = districts.get(b.districtId)!;
      expect(b.x - b.width / 2).toBeGreaterThanOrEqual(d.x - d.width / 2);
      expect(b.x + b.width / 2).toBeLessThanOrEqual(d.x + d.width / 2);
      expect(b.z - b.depth / 2).toBeGreaterThanOrEqual(d.z - d.depth / 2);
      expect(b.z + b.depth / 2).toBeLessThanOrEqual(d.z + d.depth / 2);
    }
  });

  it("centres the city on the origin", () => {
    const edge = (pick: (d: (typeof city.districts)[number]) => number) =>
      city.districts.map(pick);
    const minX = Math.min(...edge((d) => d.x - d.width / 2));
    const maxX = Math.max(...edge((d) => d.x + d.width / 2));
    expect(minX + maxX).toBeCloseTo(0, 1);
  });

  it("uses the palette and keeps one colour per district", () => {
    for (const d of city.districts) {
      expect(DISTRICT_PALETTE).toContain(d.color);
    }
  });

  it("carries every import edge across", () => {
    expect(city.connections).toHaveLength(graph.edges.length);
  });
});

describe("generateCity edge cases", () => {
  const base: CodeGraph = { ...graph, files: [], edges: [] };

  it("handles an empty repository", () => {
    expect(generateCity(base)).toMatchObject({
      buildings: [],
      districts: [],
      bounds: { width: 0, depth: 0, maxHeight: 0, radius: 0 },
    });
  });

  it("groups root-level files into a (root) district", () => {
    const file = { id: "a.ts", path: "a.ts", language: "ts", loc: 10, complexity: 1 };
    expect(generateCity({ ...base, files: [file] }).districts[0].label).toBe("(root)");
  });

  it("keeps a district's colour stable when other files change", () => {
    const file = (path: string) => ({ id: path, path, language: "ts", loc: 10, complexity: 1 });
    const colorOfSrc = (paths: string[]) =>
      generateCity({ ...base, files: paths.map(file) }).districts.find((d) => d.id === "src")
        ?.color;
    expect(colorOfSrc(["src/a.ts"])).toBe(colorOfSrc(["src/a.ts", "lib/x.ts", "zed/y.ts"]));
  });
});

describe("metric scaling", () => {
  it("grows footprint with lines of code, then saturates", () => {
    expect(footprintForLoc(400)).toBeGreaterThan(footprintForLoc(100));
    expect(footprintForLoc(0)).toBeGreaterThan(0);
    expect(footprintForLoc(10_000_000)).toBe(footprintForLoc(20_000_000));
  });

  it("grows height with complexity, then saturates", () => {
    expect(heightForComplexity(20)).toBeGreaterThan(heightForComplexity(5));
    expect(heightForComplexity(0)).toBeGreaterThan(0);
    expect(heightForComplexity(100_000)).toBe(heightForComplexity(200_000));
  });
});
