import { parseCodeGraph, type CodeGraph } from "@/lib/graph/schema";
import raw from "./demo-graph.json";

/** Goes through the same validation real analysis output will. */
export function loadDemoGraph(): CodeGraph {
  return parseCodeGraph(raw);
}
