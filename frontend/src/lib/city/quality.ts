export type QualityTier = "high" | "medium" | "low";

export interface QualityPreset {
  dpr: [number, number];
  antialias: boolean;
  arcSegments: number;
  /** How many connections show when nothing is selected. */
  ambientConnections: number;
  districtLabels: number;
  groundGlow: boolean;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  high: {
    dpr: [1, 2],
    antialias: true,
    arcSegments: 18,
    ambientConnections: 1200,
    districtLabels: 28,
    groundGlow: true,
  },
  medium: {
    dpr: [1, 1.5],
    antialias: true,
    arcSegments: 12,
    ambientConnections: 500,
    districtLabels: 18,
    groundGlow: true,
  },
  low: {
    dpr: [1, 1],
    antialias: false,
    arcSegments: 6,
    ambientConnections: 150,
    districtLabels: 10,
    groundGlow: false,
  },
};

export interface DeviceInfo {
  /** navigator.deviceMemory, in GB. Not every browser reports it. */
  memoryGb?: number;
  cores?: number;
  coarsePointer?: boolean;
  fileCount: number;
}

/** A first guess from what the browser reports. FrameGovernor corrects it from real frame times. */
export function detectQualityTier({ memoryGb, cores, coarsePointer, fileCount }: DeviceInfo): QualityTier {
  if ((memoryGb !== undefined && memoryGb <= 2) || (cores !== undefined && cores <= 2)) return "low";
  const modest = (memoryGb !== undefined && memoryGb <= 4) || (cores !== undefined && cores <= 4);
  if (modest || coarsePointer || fileCount > 2000) return "medium";
  return "high";
}

export function lowerTier(tier: QualityTier): QualityTier {
  return tier === "high" ? "medium" : "low";
}

/**
 * Decides when to step quality down, from frame times. Only consecutive frames count: rendering
 * is on demand, so a long gap means the scene was idle rather than slow. It never steps back up,
 * because a tier that oscillates is more distracting than a slightly softer image.
 */
export class FrameGovernor {
  private total = 0;
  private frames = 0;

  constructor(
    private readonly windowFrames = 90,
    private readonly minFps = 26,
    private readonly idleGapSeconds = 0.25,
  ) {}

  /** Returns true when the last window averaged too slow. */
  record(deltaSeconds: number): boolean {
    if (deltaSeconds > this.idleGapSeconds) {
      this.total = 0;
      this.frames = 0;
      return false;
    }
    this.total += deltaSeconds;
    this.frames += 1;
    if (this.frames < this.windowFrames) return false;
    const averageFps = this.frames / this.total;
    this.total = 0;
    this.frames = 0;
    return averageFps < this.minFps;
  }
}
