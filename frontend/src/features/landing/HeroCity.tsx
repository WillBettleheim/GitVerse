"use client";

import { useMemo } from "react";
import { LazyCityCanvas } from "@/features/city/LazyCityCanvas";
import { generateCity } from "@/lib/city/layout";
import type { CodeGraph } from "@/lib/graph/schema";

export function HeroCity({ graph }: { graph: CodeGraph }) {
  const city = useMemo(() => generateCity(graph), [graph]);
  // The hero is decoration: without WebGL it falls back to the plain background.
  return <LazyCityCanvas graph={graph} city={city} mode="hero" fallback={null} />;
}
