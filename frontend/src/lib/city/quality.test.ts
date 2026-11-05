import { describe, expect, it } from "vitest";
import { detectQualityTier, FrameGovernor, lowerTier, QUALITY_PRESETS } from "./quality";

describe("detectQualityTier", () => {
  it("uses high quality on capable hardware", () => {
    expect(detectQualityTier({ memoryGb: 16, cores: 10, fileCount: 500 })).toBe("high");
  });

  it("assumes capable hardware when the browser doesn't report it", () => {
    expect(detectQualityTier({ fileCount: 100 })).toBe("high");
  });

  it("drops to low on very weak devices", () => {
    expect(detectQualityTier({ memoryGb: 2, cores: 8, fileCount: 100 })).toBe("low");
    expect(detectQualityTier({ memoryGb: 8, cores: 2, fileCount: 100 })).toBe("low");
  });

  it("uses medium for phones, modest hardware and very large graphs", () => {
    expect(detectQualityTier({ memoryGb: 8, cores: 8, coarsePointer: true, fileCount: 100 })).toBe("medium");
    expect(detectQualityTier({ memoryGb: 4, cores: 8, fileCount: 100 })).toBe("medium");
    expect(detectQualityTier({ memoryGb: 16, cores: 12, fileCount: 3000 })).toBe("medium");
  });
});

describe("presets", () => {
  it("cost less at each lower tier", () => {
    const { high, medium, low } = QUALITY_PRESETS;
    expect(medium.ambientConnections).toBeLessThan(high.ambientConnections);
    expect(low.ambientConnections).toBeLessThan(medium.ambientConnections);
    expect(medium.arcSegments).toBeLessThan(high.arcSegments);
    expect(low.arcSegments).toBeLessThan(medium.arcSegments);
    expect(low.dpr[1]).toBeLessThan(high.dpr[1]);
  });
});

describe("lowerTier", () => {
  it("steps down and stops at low", () => {
    expect(lowerTier("high")).toBe("medium");
    expect(lowerTier("medium")).toBe("low");
    expect(lowerTier("low")).toBe("low");
  });
});

describe("FrameGovernor", () => {
  const run = (governor: FrameGovernor, delta: number, frames: number) => {
    let declined = false;
    for (let i = 0; i < frames; i++) declined = governor.record(delta) || declined;
    return declined;
  };

  it("does nothing at a healthy frame rate", () => {
    expect(run(new FrameGovernor(30), 1 / 60, 300)).toBe(false);
  });

  it("asks to step down after a slow window", () => {
    expect(run(new FrameGovernor(30), 1 / 15, 30)).toBe(true);
  });

  it("waits for a full window before judging", () => {
    expect(run(new FrameGovernor(30), 1 / 15, 29)).toBe(false);
  });

  it("doesn't mistake idle gaps from on-demand rendering for slowness", () => {
    const governor = new FrameGovernor(30);
    let declined = false;
    for (let i = 0; i < 300; i++) {
      declined = governor.record(i % 5 === 0 ? 2 : 1 / 60) || declined;
    }
    expect(declined).toBe(false);
  });

  it("starts a new window after deciding", () => {
    const governor = new FrameGovernor(30);
    expect(run(governor, 1 / 15, 30)).toBe(true);
    expect(run(governor, 1 / 60, 30)).toBe(false);
  });
});
