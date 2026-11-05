import { parseCodeGraph, type CodeGraph, type FileNode, type ImportEdge } from "@/lib/graph/schema";

/**
 * Generated graphs for exercising the renderer at scale. They're test data, not analysis, and
 * they're labelled "demo" like all other sample data. Seeded, so each size is always the same.
 */

export const SYNTHETIC_SIZES = [100, 500, 1000] as const;
export type SyntheticSize = (typeof SYNTHETIC_SIZES)[number];

export function isSyntheticSize(value: number): value is SyntheticSize {
  return (SYNTHETIC_SIZES as readonly number[]).includes(value);
}

const AREAS: Record<string, readonly string[]> = {
  "src/api": ["routes", "middleware", "serializers"],
  "src/core": ["domain", "events", "policies", "scheduling"],
  "src/services": ["billing", "identity", "search", "notifications", "reporting"],
  "src/ui": ["components", "layouts", "hooks", "pages", "theme"],
  "src/data": ["models", "repositories", "migrations"],
  "src/utils": ["format", "net", "collections"],
  tests: ["unit", "integration"],
  docs: ["guides", "reference"],
  config: ["deploy", "ci"],
};

const EXTENSION_BY_AREA: Record<string, string> = {
  tests: "test.ts",
  docs: "md",
  config: "yaml",
};
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  "test.ts": "typescript",
  md: "markdown",
  yaml: "yaml",
  css: "css",
  sql: "sql",
};

/** mulberry32: small, seedable, and identical on every platform. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function extensionFor(area: string, sub: string): string {
  if (EXTENSION_BY_AREA[area]) return EXTENSION_BY_AREA[area];
  if (sub === "theme") return "css";
  if (sub === "migrations") return "sql";
  return "ts";
}

export function generateSyntheticGraph(size: SyntheticSize): CodeGraph {
  const random = seededRandom(size * 7919);

  const leaves = Object.entries(AREAS).flatMap(([area, subs]) =>
    subs.map((sub) => ({ area, sub })),
  );
  // Bigger repositories have more folders, not just fuller ones.
  const shards = Math.max(1, Math.round(size / 150));

  const files: FileNode[] = [];
  let leafIndex = 0;
  while (files.length < size) {
    const { area, sub } = leaves[leafIndex % leaves.length];
    const shard = Math.floor(leafIndex / leaves.length) % shards;
    const extension = extensionFor(area, sub);
    const folder = shards > 1 ? `${area}/${sub}/part${shard}` : `${area}/${sub}`;
    const path = `${folder}/${sub}${files.length}.${extension}`;
    // Skewed like real code: most files are small, and a few are very large.
    const loc = Math.round(12 + random() ** 3 * 1400);
    const complexity = Math.round(1 + (loc / 40) * (0.4 + random()));
    files.push({
      id: path,
      path,
      language: LANGUAGE_BY_EXTENSION[extension],
      loc,
      complexity,
    });
    leafIndex += 1;
  }

  // Each file imports a few earlier ones, favouring a small set of hubs, which makes the
  // long-tailed fan-in that real dependency graphs have.
  const importable = files.filter((f) => f.language === "typescript" && !f.path.endsWith(".test.ts"));
  const hubCount = Math.max(3, Math.round(importable.length * 0.03));
  const edges: ImportEdge[] = [];
  for (const file of files) {
    if (file.language !== "typescript") continue;
    const count = 1 + Math.floor(random() * 4);
    const seen = new Set<string>([file.id]);
    for (let i = 0; i < count; i++) {
      const pool = random() < 0.4 ? hubCount : importable.length;
      const target = importable[Math.floor(random() * pool)];
      if (seen.has(target.id)) continue;
      seen.add(target.id);
      edges.push({ source: file.id, target: target.id, kind: "import" });
    }
  }

  return parseCodeGraph({
    schemaVersion: 1,
    provenance: {
      kind: "demo",
      repository: `synthetic/stress-${size}`,
      note: `Generated stress-test data with ${size} files. Not the result of analyzing any real repository.`,
    },
    files,
    edges,
  });
}
