/**
 * Reproducible CPU benchmarks for the frontend pipeline on deterministic synthetic graphs.
 *
 *   npm run bench
 *
 * Synthetic data only: these graphs are generated, seeded and labelled as sample data. They
 * measure the code paths the browser runs before and around rendering, not GPU work.
 */
import { performance } from "node:perf_hooks";
import { generateSyntheticGraph, SYNTHETIC_SIZES } from "@/features/demo/synthetic-graph";
import { selectAmbientConnections } from "@/lib/city/arcs";
import { computeHighlight } from "@/lib/city/highlight";
import { generateCity } from "@/lib/city/layout";
import { findCycles, traverse } from "@/lib/graph/dependencies";
import { computeInsights } from "@/lib/graph/insights";
import { buildAdjacency } from "@/lib/graph/queries";
import { parseCodeGraph, type CodeGraph } from "@/lib/graph/schema";
import { NO_FILTERS, searchFiles } from "@/lib/graph/search";
import { buildTransition, changeIndexFromCities } from "@/lib/timetravel/transition";

const RUNS = Number(process.env.BENCH_RUNS ?? 7);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Median wall time in ms over RUNS runs, after one warm-up. */
function time<T>(fn: () => T): number {
  fn();
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

/** The same repository one commit later: some files grow, some vanish, a few appear. */
function evolve(graph: CodeGraph): CodeGraph {
  const files = graph.files
    .filter((_, i) => i % 23 !== 0)
    .map((f, i) => (i % 7 === 0 ? { ...f, loc: f.loc + 40, complexity: f.complexity + 2 } : f));
  const added = graph.files.slice(0, Math.max(1, graph.files.length / 50)).map((f, i) => ({
    ...f,
    id: `src/new/added${i}.ts`,
    path: `src/new/added${i}.ts`,
  }));
  const ids = new Set([...files, ...added].map((f) => f.id));
  return {
    ...graph,
    files: [...files, ...added],
    edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}

const rows: Record<string, number | string>[] = [];
for (const size of SYNTHETIC_SIZES) {
  const graph = generateSyntheticGraph(size);
  const json = JSON.stringify(graph);
  const city = generateCity(graph);
  const adjacency = buildAdjacency(graph);
  const cycles = findCycles(graph);
  const hub = [...adjacency.importedBy.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  const next = evolve(graph);
  const nextCity = generateCity(next);

  rows.push({
    files: size,
    edges: graph.edges.length,
    "payload KB": Math.round(json.length / 1024),
    "parse+validate": time(() => parseCodeGraph(JSON.parse(json))),
    "city layout": time(() => generateCity(graph)),
    adjacency: time(() => buildAdjacency(graph)),
    cycles: time(() => findCycles(graph)),
    insights: time(() => computeInsights(graph, adjacency, cycles)),
    "search 'billing'": time(() => searchFiles(graph.files, adjacency.importedBy, "billing", NO_FILTERS)),
    "traverse all": time(() => traverse(adjacency, hub, "both", "all")),
    "highlight": time(() => {
      const h = computeHighlight(adjacency, hub, null);
      for (const b of city.buildings) h.stateOf(b.id);
    }),
    "ambient arcs": time(() => selectAmbientConnections(city.connections, city.buildings, 1200)),
    "transition plan": time(() =>
      buildTransition(city, nextCity, changeIndexFromCities(city, nextCity)),
    ),
  });
}

const format = (v: number | string) => (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : String(v));
console.log(`Frontend pipeline, synthetic graphs, median of ${RUNS} runs (ms unless noted)`);
console.log(`Node ${process.version}, ${process.platform} ${process.arch}`);
console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, format(v)]))));
