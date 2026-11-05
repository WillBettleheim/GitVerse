import { classifyFile } from "./classify";
import type { CodeGraph } from "./schema";

export interface FileImportance {
  /** 0–1. Mostly how many files depend on this one. */
  score: number;
  fanIn: number;
  fanOut: number;
  /** One of the graph's most important modules, drawn with a beacon. */
  landmark: boolean;
}

const LANDMARK_SHARE = 0.05;
const MAX_LANDMARKS = 40;
const MIN_LANDMARK_FAN_IN = 2;

/** Log scaling keeps one giant file from flattening everything else. Returns 0–1. */
export function normalizeLog(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, Math.log1p(Math.max(0, value)) / Math.log1p(max));
}

/** FNV-1a: a stable hash, so per-file variation depends on the ID and not on input order. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A heuristic from the graph's own numbers: fan-in dominates, because a module many others
 * depend on is architecturally central whatever its size. Tests are discounted, since being
 * large and complex doesn't make a test central.
 */
export function computeImportance(graph: CodeGraph): Map<string, FileImportance> {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const { source, target } of graph.edges) {
    fanOut.set(source, (fanOut.get(source) ?? 0) + 1);
    fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
  }

  const maxOf = (values: Iterable<number>) => Math.max(1, ...values);
  const maxIn = maxOf(fanIn.values());
  const maxOut = maxOf(fanOut.values());
  const maxComplexity = maxOf(graph.files.map((f) => f.complexity));
  const maxLoc = maxOf(graph.files.map((f) => f.loc));

  const scored = graph.files.map((file) => {
    const incoming = fanIn.get(file.id) ?? 0;
    const outgoing = fanOut.get(file.id) ?? 0;
    const raw =
      // Linear on purpose: the gap between 3 and 8 importers should count in full.
      0.55 * (incoming / maxIn) +
      0.1 * normalizeLog(outgoing, maxOut) +
      0.2 * normalizeLog(file.complexity, maxComplexity) +
      0.15 * normalizeLog(file.loc, maxLoc);
    const weight = classifyFile(file.path) === "test" ? 0.4 : 1;
    return { id: file.id, score: Math.round(raw * weight * 10000) / 10000, incoming, outgoing };
  });

  const landmarkCount = Math.min(
    MAX_LANDMARKS,
    Math.max(1, Math.ceil(graph.files.length * LANDMARK_SHARE)),
  );
  const landmarks = new Set(
    scored
      .filter((file) => file.incoming >= MIN_LANDMARK_FAN_IN)
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, landmarkCount)
      .map((file) => file.id),
  );

  return new Map(
    scored.map((file) => [
      file.id,
      {
        score: file.score,
        fanIn: file.incoming,
        fanOut: file.outgoing,
        landmark: landmarks.has(file.id),
      },
    ]),
  );
}
