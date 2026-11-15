import type { CycleIndex } from "@/lib/graph/dependencies";
import type { Insights } from "@/lib/graph/insights";

export type LensKind = "complexity" | "dependents" | "cycles";

export interface LensInfo {
  label: string;
  /** What lights up, said precisely enough to check against the inspector. */
  description: string;
}

export const LENSES: Record<LensKind, LensInfo> = {
  complexity: {
    label: "Complexity",
    description: "The most complex files, by cyclomatic complexity",
  },
  dependents: {
    label: "Depended on",
    description: "The files imported by the most other files",
  },
  cycles: {
    label: "Cycles",
    description: "Every file in an import cycle",
  },
};

/** The files a lens lights up. Every one comes from the analysis, never from a guess. */
export function lensFiles(
  lens: LensKind,
  insights: Pick<Insights, "hotspots" | "mostDependedUpon">,
  cycles: Pick<CycleIndex, "groupOf">,
): Set<string> {
  switch (lens) {
    case "complexity":
      return new Set(insights.hotspots.map((r) => r.id));
    case "dependents":
      return new Set(insights.mostDependedUpon.map((r) => r.id));
    case "cycles":
      return new Set(cycles.groupOf.keys());
  }
}
