import { describe, expect, it } from "vitest";
import demo from "@/features/demo/demo-graph.json";
import { generateSyntheticGraph, SYNTHETIC_SIZES } from "@/features/demo/synthetic-graph";
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

const directoryOf = (path: string) => (path.includes("/") ? path.replace(/\/[^/]+$/, "") : "");

const file = (path: string, loc = 10, complexity = 1) => ({
  id: path,
  path,
  language: "ts",
  loc,
  complexity,
});

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

  it("is also order-independent at 1,000 files", () => {
    const large = generateSyntheticGraph(1000);
    const reordered = { ...large, files: shuffled(large.files, 9), edges: shuffled(large.edges, 10) };
    expect(generateCity(reordered)).toEqual(generateCity(large));
  });

  it("keeps a known building at a known position", () => {
    // Pinned on purpose: an unintended layout change should fail here and be reviewed.
    const engine = generateCity(graph).buildings.find((b) =>
      b.id.endsWith("services/pricingEngine.ts"),
    );
    expect(engine).toMatchInlineSnapshot(`
      {
        "baseY": 0.48,
        "category": "source",
        "color": "#a855f7",
        "complexity": 67,
        "depth": 5.839,
        "districtId": "src/server/services",
        "fanIn": 3,
        "fanOut": 2,
        "height": 26,
        "id": "src/server/services/pricingEngine.ts",
        "importance": 0.6091,
        "landmark": false,
        "loc": 621,
        "name": "pricingEngine.ts",
        "path": "src/server/services/pricingEngine.ts",
        "seed": 0.644,
        "tiers": [
          {
            "depth": 5.839,
            "height": 17.68,
            "width": 7.236,
            "y": 0,
          },
          {
            "depth": 4.671,
            "height": 8.32,
            "width": 5.789,
            "y": 17.68,
          },
        ],
        "width": 7.236,
        "x": -24.003,
        "z": -26.706,
      }
    `);
  });
});

describe("stable IDs", () => {
  const ids = (g: CodeGraph) => generateCity(g).buildings.map((b) => b.id);

  it("uses the file ID as the building ID", () => {
    expect(ids(graph).sort()).toEqual(graph.files.map((f) => f.id).sort());
  });

  it("uses the folder path as the district ID", () => {
    const city = generateCity(graph);
    expect(city.districts.map((d) => d.id)).toContain("src/server/services");
  });

  it("keeps per-file variation when unrelated files change", () => {
    const before = generateCity({ ...graph, edges: [] }).buildings.find((b) => b.id === "src/lib/format.ts")!;
    const after = generateCity({
      ...graph,
      edges: [],
      files: [...graph.files, file("zzz/new-file.ts")],
    }).buildings.find((b) => b.id === "src/lib/format.ts")!;
    expect(after.seed).toBe(before.seed);
    expect(after.tiers).toEqual(before.tiers);
    expect(after.color).toBe(before.color);
    expect(after.category).toBe(before.category);
  });
});

describe("generateCity districts", () => {
  const city = generateCity(graph);
  const byId = new Map(city.districts.map((d) => [d.id, d]));

  it("creates one building per file", () => {
    expect(city.buildings).toHaveLength(graph.files.length);
  });

  it("gives every folder that holds files a district", () => {
    for (const f of graph.files) {
      expect(byId.has(directoryOf(f.path)), f.path).toBe(true);
    }
  });

  it("nests subfolders inside their parent's plot, one level higher", () => {
    const child = byId.get("src/server/db")!;
    const parent = byId.get(child.parentId!)!;
    expect(parent.id).toBe("src/server");
    expect(child.level).toBe(parent.level + 1);
    expect(child.baseY).toBeCloseTo(parent.baseY + parent.plateHeight, 3);
    expect(child.x - child.width / 2).toBeGreaterThanOrEqual(parent.x - parent.width / 2);
    expect(child.x + child.width / 2).toBeLessThanOrEqual(parent.x + parent.width / 2);
    expect(child.z - child.depth / 2).toBeGreaterThanOrEqual(parent.z - parent.depth / 2);
    expect(child.z + child.depth / 2).toBeLessThanOrEqual(parent.z + parent.depth / 2);
  });

  it("collapses folders that only wrap one subfolder", () => {
    const wrapped = generateCity({
      ...graph,
      edges: [],
      files: [file("a/b/c/x.ts"), file("a/b/c/y.ts")],
    });
    expect(wrapped.districts.map((d) => d.id)).toEqual(["a/b/c"]);
  });

  it("gives subfolders of one area the same hue", () => {
    expect(byId.get("src/server/db")!.color).toBe(byId.get("src/server/routes")!.color);
  });

  it("uses only palette colours", () => {
    for (const d of city.districts) expect(DISTRICT_PALETTE).toContain(d.color);
  });
});

describe.each(["demo", ...SYNTHETIC_SIZES] as const)("geometry invariants (%s)", (dataset) => {
  const source = dataset === "demo" ? graph : generateSyntheticGraph(dataset);
  const city = generateCity(source);
  const districts = new Map(city.districts.map((d) => [d.id, d]));

  it("draws every file and carries every import", () => {
    expect(city.buildings).toHaveLength(source.files.length);
    expect(city.connections).toHaveLength(source.edges.length);
    expect(city.omittedFileCount).toBe(0);
  });

  it("never overlaps two buildings", () => {
    // Sorted sweep, as all pairs would be slow at 1,000 files.
    const sorted = [...city.buildings].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].x - sorted[i].x > 8) break;
        expect(overlaps(sorted[i], sorted[j]), `${sorted[i].id} / ${sorted[j].id}`).toBe(false);
      }
    }
  });

  it("never overlaps sibling districts", () => {
    const siblings = new Map<string | null, typeof city.districts>();
    for (const d of city.districts) {
      siblings.set(d.parentId, [...(siblings.get(d.parentId) ?? []), d]);
    }
    for (const group of siblings.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          expect(overlaps(group[i], group[j]), `${group[i].id} / ${group[j].id}`).toBe(false);
        }
      }
    }
  });

  it("keeps every building inside its district, standing on its plate", () => {
    for (const b of city.buildings) {
      const d = districts.get(b.districtId)!;
      expect(b.x - b.width / 2).toBeGreaterThanOrEqual(d.x - d.width / 2 - 0.002);
      expect(b.x + b.width / 2).toBeLessThanOrEqual(d.x + d.width / 2 + 0.002);
      expect(b.z - b.depth / 2).toBeGreaterThanOrEqual(d.z - d.depth / 2 - 0.002);
      expect(b.z + b.depth / 2).toBeLessThanOrEqual(d.z + d.depth / 2 + 0.002);
      expect(b.baseY).toBeCloseTo(d.baseY + d.plateHeight, 2);
    }
  });

  it("generates tiers that stack to the building's height and step inward", () => {
    for (const b of city.buildings) {
      const top = b.tiers[b.tiers.length - 1];
      expect(top.y + top.height).toBeCloseTo(b.height, 1);
      expect(b.tiers[0].y).toBe(0);
      for (let i = 1; i < b.tiers.length; i++) {
        expect(b.tiers[i].y).toBeGreaterThanOrEqual(b.tiers[i - 1].y);
        expect(b.tiers[i].width).toBeLessThanOrEqual(b.tiers[i - 1].width);
      }
    }
  });

  it("centres the city on the origin", () => {
    const left = Math.min(...city.buildings.map((b) => b.x - b.width / 2));
    const right = Math.max(...city.buildings.map((b) => b.x + b.width / 2));
    expect(Math.abs(left + right)).toBeLessThan(city.bounds.width * 0.1);
  });

  it("stays roughly square", () => {
    const aspect = city.bounds.width / city.bounds.depth;
    expect(aspect).toBeGreaterThan(0.5);
    expect(aspect).toBeLessThan(2);
  });
});

describe("visual treatment", () => {
  const city = generateCity(graph);
  const get = (id: string) => city.buildings.find((b) => b.id === id)!;

  it("classifies buildings by file type", () => {
    expect(get("tests/cartStore.test.ts").category).toBe("test");
    expect(get("package.json").category).toBe("config");
    expect(get("src/store/cartStore.ts").category).toBe("source");
  });

  it("gives landmarks extra massing", () => {
    const landmarks = city.buildings.filter((b) => b.landmark);
    expect(landmarks.length).toBeGreaterThan(0);
    for (const b of landmarks) expect(b.tiers).toHaveLength(3);
  });

  it("marks a heavily imported module as a landmark", () => {
    expect(get("src/server/db/schema.ts").landmark).toBe(true);
  });
});

describe("generateCity limits and edge cases", () => {
  const base: CodeGraph = { ...graph, files: [], edges: [] };

  it("handles an empty repository", () => {
    expect(generateCity(base)).toMatchObject({
      buildings: [],
      districts: [],
      bounds: { width: 0, depth: 0, maxHeight: 0, radius: 0 },
    });
  });

  it("groups root-level files into a (root) district", () => {
    expect(generateCity({ ...base, files: [file("a.ts")] }).districts[0].label).toBe("(root)");
  });

  it("keeps a district's colour stable when other files change", () => {
    const colorOfSrc = (paths: string[]) =>
      generateCity({ ...base, files: paths.map((p) => file(p)) }).districts.find((d) => d.id === "src")
        ?.color;
    expect(colorOfSrc(["src/a.ts"])).toBe(colorOfSrc(["src/a.ts", "lib/x.ts", "zed/y.ts"]));
  });

  it("drops the least important files past the limit and reports how many", () => {
    const large = generateSyntheticGraph(500);
    const city = generateCity(large, { maxBuildings: 100 });
    expect(city.buildings).toHaveLength(100);
    expect(city.omittedFileCount).toBe(400);

    const drawn = new Set(city.buildings.map((b) => b.id));
    for (const c of city.connections) {
      expect(drawn.has(c.source) && drawn.has(c.target)).toBe(true);
    }
    const lowestKept = Math.min(...city.buildings.map((b) => b.importance));
    const full = generateCity(large);
    const highestDropped = Math.max(
      ...full.buildings.filter((b) => !drawn.has(b.id)).map((b) => b.importance),
    );
    expect(lowestKept).toBeGreaterThanOrEqual(highestDropped);
  });

  it("generates 1,000 files quickly enough for interactive use", () => {
    const large = generateSyntheticGraph(1000);
    const start = performance.now();
    generateCity(large);
    // Generous, to stay stable on slow CI. Typically far less.
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("metric normalization", () => {
  it("grows footprint with lines of code, bounded by the graph's maximum", () => {
    expect(footprintForLoc(400, 1000)).toBeGreaterThan(footprintForLoc(100, 1000));
    expect(footprintForLoc(0, 1000)).toBeGreaterThan(0);
    expect(footprintForLoc(1000, 1000)).toBe(footprintForLoc(5000, 5000));
  });

  it("grows height with complexity, bounded by the graph's maximum", () => {
    expect(heightForComplexity(20, 100)).toBeGreaterThan(heightForComplexity(5, 100));
    expect(heightForComplexity(0, 100)).toBeGreaterThan(0);
    expect(heightForComplexity(100, 100)).toBe(heightForComplexity(5000, 5000));
  });

  it("is relative to the repository being drawn", () => {
    expect(heightForComplexity(50, 100)).toBeGreaterThan(heightForComplexity(50, 10_000));
  });

  it("doesn't turn a tiny repository's biggest file into a skyscraper", () => {
    expect(heightForComplexity(2, 2)).toBeLessThan(heightForComplexity(100, 100) / 2);
  });
});
