import { describe, expect, it } from "vitest";
import { generateCity } from "@/lib/city/layout";
import type { CodeGraph } from "@/lib/graph/schema";
import diffSample from "@/features/timetravel/__fixtures__/diff-sample.json";
import { snapshotDiffSchema } from "./api";
import { nextPlayable, pickRepresentative, playbackStart, stepCommit } from "./snapshots";
import { buildTransition, changeIndex, changeIndexFromCities, ease, lerpBox } from "./transition";

const file = (path: string, loc = 20, complexity = 2) => ({
  id: path,
  path,
  language: "typescript",
  loc,
  complexity,
});
const graphOf = (files: ReturnType<typeof file>[]): CodeGraph => ({
  schemaVersion: 1,
  provenance: { kind: "demo", repository: "t/t", note: "" },
  files,
  edges: [],
});

describe("backend diff contract", () => {
  it("parses a real diff produced from the git fixture", () => {
    const diff = snapshotDiffSchema.parse(diffSample);
    expect(diff.files.renamed).toEqual([
      { from: "src/util.ts", to: "src/helpers.ts", contentChanged: false },
    ]);
    expect(diff.head.message).toBe("Move util to helpers and drop c");
  });
});

describe("pickRepresentative", () => {
  const commits = Array.from({ length: 30 }, (_, i) => `c${i}`);

  it("always includes the newest and oldest, evenly spaced", () => {
    const picked = pickRepresentative(commits, 6);
    expect(picked).toHaveLength(6);
    expect(picked[0]).toBe("c0");
    expect(picked[5]).toBe("c29");
    expect(picked).toEqual(["c0", "c6", "c12", "c17", "c23", "c29"]);
  });

  it("takes everything when there are few commits", () => {
    expect(pickRepresentative(["a", "b"], 6)).toEqual(["a", "b"]);
  });
});

describe("playback order", () => {
  const timeline = ["c4", "c3", "c2", "c1", "c0"]; // newest first

  it("starts at the oldest analyzed commit", () => {
    expect(playbackStart(timeline, new Set(["c3", "c1"]))).toBe("c1");
  });

  it("moves forward in time, skipping commits that weren't analyzed", () => {
    const ready = new Set(["c4", "c2", "c0"]);
    expect(nextPlayable(timeline, ready, "c0")).toBe("c2");
    expect(nextPlayable(timeline, ready, "c2")).toBe("c4");
    expect(nextPlayable(timeline, ready, "c4")).toBeNull();
  });

  it("treats the latest view as the end", () => {
    expect(nextPlayable(timeline, new Set(timeline), null)).toBeNull();
  });

  it("steps to neighbouring commits for keyboard navigation", () => {
    expect(stepCommit(timeline, "c2", "older")).toBe("c1");
    expect(stepCommit(timeline, "c2", "newer")).toBe("c3");
    expect(stepCommit(timeline, "c0", "older")).toBeNull();
    expect(stepCommit(timeline, null, "older")).toBe("c3");
  });
});

describe("buildTransition", () => {
  const before = generateCity(
    graphOf([file("src/a.ts"), file("src/b.ts"), file("src/util.ts"), file("src/c.ts")]),
  );
  const after = generateCity(
    graphOf([
      file("src/a.ts"),
      file("src/b.ts", 200, 30),
      file("src/helpers.ts"),
      file("src/d.ts"),
    ]),
  );
  const changes = changeIndex(
    snapshotDiffSchema.parse({
      ...diffSample,
      files: {
        ...diffSample.files,
        added: ["src/d.ts"],
        removed: ["src/c.ts"],
        modified: [
          {
            path: "src/b.ts",
            before: { loc: 20, complexity: 2, incoming: 0, outgoing: 0 },
            after: { loc: 200, complexity: 30, incoming: 0, outgoing: 0 },
          },
        ],
        renamed: [{ from: "src/util.ts", to: "src/helpers.ts", contentChanged: false }],
      },
    }),
  );
  const plan = buildTransition(before, after, changes);
  const byId = new Map(plan.buildings.map((b) => [b.id, b]));

  it("keeps one building per file, matched across renames", () => {
    expect([...byId.keys()].sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/helpers.ts",
    ]);
    expect(byId.get("src/helpers.ts")!.change).toBe("renamed");
  });

  it("grows added files from the ground and sinks removed ones", () => {
    const added = byId.get("src/d.ts")!;
    expect(added.change).toBe("added");
    expect(added.tiers.every((t) => t.from.height === 0 && t.to.height > 0)).toBe(true);

    const removed = byId.get("src/c.ts")!;
    expect(removed.change).toBe("removed");
    expect(removed.tiers.every((t) => t.from.height > 0 && t.to.height === 0)).toBe(true);
  });

  it("resizes modified files", () => {
    const b = byId.get("src/b.ts")!;
    expect(b.change).toBe("modified");
    const height = (key: "from" | "to") =>
      Math.max(...b.tiers.map((t) => t[key].y + t[key].height));
    expect(height("to")).toBeGreaterThan(height("from"));
  });

  it("starts and ends exactly on the two layouts", () => {
    const unchanged = byId.get("src/a.ts")!;
    const start = before.buildings.find((x) => x.id === "src/a.ts")!;
    const end = after.buildings.find((x) => x.id === "src/a.ts")!;
    expect(unchanged.tiers[0].from.x).toBe(start.x);
    expect(unchanged.tiers[0].to.x).toBe(end.x);
    expect(lerpBox(unchanged.tiers[0].from, unchanged.tiers[0].to, 0)).toEqual(
      unchanged.tiers[0].from,
    );
    expect(lerpBox(unchanged.tiers[0].from, unchanged.tiers[0].to, 1)).toEqual(
      unchanged.tiers[0].to,
    );
  });

  it("transitions districts that appear and disappear", () => {
    const outer = buildTransition(
      generateCity(graphOf([file("old/x.ts")])),
      generateCity(graphOf([file("new/y.ts")])),
      { renames: new Map(), kinds: new Map() },
    );
    const old = outer.districts.find((d) => d.id === "old")!;
    const fresh = outer.districts.find((d) => d.id === "new")!;
    expect(old.to.width).toBe(0);
    expect(fresh.from.width).toBe(0);
    expect(fresh.to.width).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(buildTransition(before, after, changes)).toEqual(plan);
  });
});

describe("changeIndexFromCities", () => {
  it("falls back to path identity without guessing renames", () => {
    const a = generateCity(graphOf([file("x.ts"), file("y.ts")]));
    const b = generateCity(graphOf([file("x.ts", 99), file("z.ts")]));
    const index = changeIndexFromCities(a, b);
    expect(index.renames.size).toBe(0);
    expect(index.kinds.get("x.ts")).toBe("modified");
    expect(index.kinds.get("z.ts")).toBe("added");
    expect(index.kinds.get("y.ts")).toBe("removed");
  });
});

describe("ease", () => {
  it("clamps and eases", () => {
    expect(ease(-1)).toBe(0);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(2)).toBe(1);
    expect(ease(0.1)).toBeLessThan(0.1);
  });
});
