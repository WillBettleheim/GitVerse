import { describe, expect, it } from "vitest";
import { spacedMonthLabels } from "./TimelineBar";

const commit = (committedAt: string) => ({
  sha: "a".repeat(40),
  summary: "",
  message: "",
  author: null,
  committedAt,
  parents: [],
});

describe("spacedMonthLabels", () => {
  it("labels each new month, skipping one that would crowd the previous label", () => {
    const labels = spacedMonthLabels(
      [
        "2026-05-01T00:00:00Z",
        "2026-05-20T00:00:00Z",
        "2026-06-01T00:00:00Z",
        "2026-06-10T00:00:00Z",
        "2026-06-20T00:00:00Z",
        "2026-09-01T00:00:00Z",
        "2026-10-01T00:00:00Z",
      ].map(commit),
    );
    const shown = labels.filter((l): l is string => l !== null);
    // June starts two stops after May, too close; October one stop after September.
    expect(shown).toHaveLength(2);
    expect(labels[0]).not.toBeNull();
    expect(labels[2]).toBeNull();
    expect(labels[5]).not.toBeNull();
    expect(labels[6]).toBeNull();
  });
});
