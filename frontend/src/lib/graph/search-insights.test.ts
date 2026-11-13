import { describe, expect, it } from "vitest";
import demo from "@/features/demo/demo-graph.json";
import sample from "@/features/analysis/__fixtures__/analysis-sample.json";
import { findCycles } from "./dependencies";
import { areaOf, computeInsights } from "./insights";
import { buildAdjacency } from "./queries";
import { parseCodeGraph, type CodeGraph } from "./schema";
import { filterOptions, isSearching, NO_FILTERS, searchFiles } from "./search";

const graph = parseCodeGraph(demo);
const adjacency = buildAdjacency(graph);
const ids = (files: { id: string }[]) => files.map((f) => f.id);

describe("searchFiles", () => {
  const search = (query: string, filters = NO_FILTERS) =>
    ids(searchFiles(graph.files, adjacency.importedBy, query, filters));

  it("ranks exact names, then name prefixes, then names, then paths", () => {
    const files = [
      { id: "lib/cartx.ts", path: "lib/cartx.ts" },
      { id: "cart/index.ts", path: "cart/index.ts" },
      { id: "a/mycart.ts", path: "a/mycart.ts" },
      { id: "z/cart", path: "z/cart" },
    ].map((f) => ({ ...f, language: "ts", loc: 1, complexity: 1 }));
    expect(ids(searchFiles(files, new Map(), "cart", NO_FILTERS))).toEqual([
      "z/cart",
      "lib/cartx.ts",
      "a/mycart.ts",
      "cart/index.ts",
    ]);
  });

  it("matches case-insensitively on the whole path", () => {
    expect(search("SERVER/DB")).toEqual([
      "src/server/db/client.ts",
      "src/server/db/migrate.ts",
      "src/server/db/schema.ts",
    ]);
  });

  it("returns every file, in path order, with no query or filters", () => {
    const all = search("");
    expect(all).toHaveLength(graph.files.length);
    expect(all).toEqual([...all].sort());
  });

  it("filters by folder, including everything nested inside it", () => {
    const inServer = search("", { ...NO_FILTERS, folder: "src/server" });
    expect(inServer.length).toBeGreaterThan(5);
    expect(inServer.every((id) => id.startsWith("src/server/"))).toBe(true);
    expect(inServer).toContain("src/server/db/schema.ts");
  });

  it("treats the root folder as files directly at the root", () => {
    expect(search("", { ...NO_FILTERS, folder: "" })).toEqual(["next.config.ts", "package.json"]);
  });

  it("filters by language and metric thresholds together", () => {
    const result = searchFiles(graph.files, adjacency.importedBy, "", {
      ...NO_FILTERS,
      language: "typescript",
      minLoc: 300,
      minComplexity: 20,
    });
    expect(result.length).toBeGreaterThan(0);
    for (const f of result) {
      expect(f.language).toBe("typescript");
      expect(f.loc).toBeGreaterThanOrEqual(300);
      expect(f.complexity).toBeGreaterThanOrEqual(20);
    }
  });

  it("filters by how many files import each one", () => {
    const hubs = search("", { ...NO_FILTERS, minIncoming: 6 });
    for (const id of hubs) expect(adjacency.importedBy.get(id)!.length).toBeGreaterThanOrEqual(6);
    expect(hubs).toContain("src/components/Button.tsx");
  });

  it("combines a query with filters", () => {
    expect(search("page", { ...NO_FILTERS, folder: "src/app/cart" })).toEqual([
      "src/app/cart/page.tsx",
    ]);
  });
});

describe("isSearching", () => {
  it("is false only with no query and no filters", () => {
    expect(isSearching("", NO_FILTERS)).toBe(false);
    expect(isSearching("  ", NO_FILTERS)).toBe(false);
    expect(isSearching("a", NO_FILTERS)).toBe(true);
    expect(isSearching("", { ...NO_FILTERS, minLoc: 1 })).toBe(true);
    expect(isSearching("", { ...NO_FILTERS, folder: "" })).toBe(true);
  });
});

describe("filterOptions", () => {
  it("offers every folder at every depth with file counts, and every language", () => {
    const options = filterOptions(graph.files);
    const folders = Object.fromEntries(options.folders.map((f) => [f.path, f.files]));
    expect(folders[""]).toBe(2);
    expect(folders.src).toBe(graph.files.filter((f) => f.path.startsWith("src/")).length);
    expect(folders["src/server/db"]).toBe(3);
    expect(options.languages.map((l) => l.language)).toEqual(["typescript", "tsx", "json"]);
  });
});

describe("computeInsights", () => {
  const insights = computeInsights(graph, adjacency, findCycles(graph));

  it("counts files, edges and lines exactly", () => {
    expect(insights.files).toBe(46);
    expect(insights.edges).toBe(88);
    expect(insights.totalLoc).toBe(graph.files.reduce((s, f) => s + f.loc, 0));
    expect(insights.cycles).toBe(0);
  });

  it("ranks the most depended-upon files by real importer counts", () => {
    const top = insights.mostDependedUpon[0];
    expect(top.value).toBe(Math.max(...[...adjacency.importedBy.values()].map((l) => l.length)));
    for (const entry of insights.mostDependedUpon) {
      expect(entry.value).toBe(adjacency.importedBy.get(entry.id)!.length);
    }
  });

  it("ranks the largest files and complexity hotspots", () => {
    expect(insights.largest[0]).toEqual({ id: "src/server/services/pricingEngine.ts", value: 621 });
    expect(insights.hotspots[0]).toEqual({ id: "src/server/services/pricingEngine.ts", value: 67 });
    expect(insights.largest).toHaveLength(8);
  });

  it("reports no hotspots when there's no complexity data to rank", () => {
    const flat: CodeGraph = { ...graph, files: graph.files.map((f) => ({ ...f, complexity: 1 })) };
    expect(computeInsights(flat, adjacency, findCycles(flat)).hotspots).toEqual([]);
  });

  it("splits the code across areas, with shares that add up", () => {
    const total = insights.folders.reduce((sum, f) => sum + f.share, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(insights.folders.reduce((s, f) => s + f.files, 0)).toBe(46);
    const server = insights.folders.find((f) => f.folder === "src/server")!;
    expect(server.files).toBe(graph.files.filter((f) => f.path.startsWith("src/server/")).length);
  });

  it("counts imports that cross area boundaries", () => {
    const tests = insights.folders.find((f) => f.folder === "tests")!;
    expect(tests.outgoing).toBe(4);
  });

  it("agrees with the backend's numbers on real analysis output", () => {
    const real = parseCodeGraph(sample);
    const realInsights = computeInsights(real, buildAdjacency(real), findCycles(real));
    expect(realInsights.files).toBe(real.files.length);
    expect(realInsights.edges).toBe(real.edges.length);
    expect(realInsights.totalLoc).toBe(real.analysis!.totalLoc);
    expect(realInsights.cycles).toBe(real.analysis!.cycleCount);
  });
});

describe("areaOf", () => {
  it("looks one level past generic folder names", () => {
    expect(areaOf("src/server/db/client.ts")).toBe("src/server");
    expect(areaOf("packages/ui/src/button.tsx")).toBe("packages/ui");
    expect(areaOf("tests/a.test.ts")).toBe("tests");
    expect(areaOf("src/index.ts")).toBe("src");
    expect(areaOf("package.json")).toBe("(root)");
  });
});
