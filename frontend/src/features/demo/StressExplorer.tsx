"use client";

import { useMemo } from "react";
import { ExplorerShell } from "@/features/explorer/ExplorerShell";
import { DatasetSwitcher } from "./DatasetSwitcher";
import { generateSyntheticGraph, type SyntheticSize } from "./synthetic-graph";

/** Generated in the browser, so a large graph isn't serialized into the page's HTML. */
export function StressExplorer({ size }: { size: SyntheticSize }) {
  const graph = useMemo(() => generateSyntheticGraph(size), [size]);
  return <ExplorerShell key={size} graph={graph} headerSlot={<DatasetSwitcher current={size} />} />;
}
