import { afterEach, describe, expect, it, vi } from "vitest";
import sample from "@/features/analysis/__fixtures__/analysis-sample.json";
import answerSample from "@/features/architect/__fixtures__/answer-sample.json";
import demo from "@/features/demo/demo-graph.json";
import { AnalysisRequestError } from "@/lib/analysis/client";
import { sourceLineUrl } from "@/lib/analysis/source-link";
import { focusPose, framePose, ISO_AZIMUTH, ISO_ELEVATION } from "@/lib/city/camera";
import { computeHighlight } from "@/lib/city/highlight";
import type { Building } from "@/lib/city/layout";
import { buildAdjacency } from "@/lib/graph/queries";
import { parseCodeGraph } from "@/lib/graph/schema";
import { architectAnswerSchema, askArchitect } from "./api";

const graph = parseCodeGraph(sample);
const SHA = graph.analysis!.repository.commitSha;

afterEach(() => vi.unstubAllGlobals());

describe("the answer contract", () => {
  it("accepts the backend's own sample answer", () => {
    const parsed = architectAnswerSchema.parse(answerSample);
    expect(parsed.mode).toBe("ai");
    expect(parsed.claims.map((c) => c.basis)).toEqual(["verified", "inferred", "inferred"]);
    // Validation on the server already removed the invented file.
    expect(parsed.files.map((f) => f.path)).not.toContain("src/helpers/missing.ts");
  });

  it("only names files that exist in the matching analysis", () => {
    const parsed = architectAnswerSchema.parse(answerSample);
    const known = new Set(graph.files.map((f) => f.id));
    expect(parsed.commitSha).toBe(SHA);
    for (const file of parsed.files) expect(known.has(file.path)).toBe(true);
  });
});

describe("askArchitect", () => {
  function stubFetch(response: Response) {
    const fetch = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("sends the question with the selected file and the other analyzed commits", async () => {
    const fetch = stubFetch(new Response(JSON.stringify(answerSample), { status: 200 }));
    await askArchitect({
      repository: "acme/web-app",
      commit: SHA,
      question: "  What depends on this module?  ",
      focus: "src/utils/helper.ts",
      snapshots: [SHA, "b".repeat(40)],
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/architect\/questions$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      repository: "acme/web-app",
      commit: SHA,
      question: "What depends on this module?",
      focus: "src/utils/helper.ts",
      snapshots: ["b".repeat(40)],
    });
  });

  it("passes on the server's message and wait time", async () => {
    stubFetch(
      new Response(JSON.stringify({ detail: "Too many questions.", code: "rate_limited" }), {
        status: 429,
        headers: { "Retry-After": "12" },
      }),
    );
    const error = await askArchitect({ repository: "a/b", commit: SHA, question: "q" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AnalysisRequestError);
    expect((error as AnalysisRequestError).message).toBe("Too many questions.");
    expect((error as AnalysisRequestError).retryAfterSeconds).toBe(12);
  });

  it("rejects responses that don't match the contract", async () => {
    stubFetch(new Response(JSON.stringify({ answer: "trust me" }), { status: 200 }));
    await expect(askArchitect({ repository: "a/b", commit: SHA, question: "q" })).rejects.toThrow(
      "unexpected response",
    );
  });
});

describe("sourceLineUrl", () => {
  it("links to a line or a range at the analyzed commit", () => {
    const base = `https://github.com/acme/web-app/blob/${SHA}/src/app.tsx`;
    expect(sourceLineUrl(graph, "src/app.tsx", 4)).toBe(`${base}#L4`);
    expect(sourceLineUrl(graph, "src/app.tsx", 4, 9)).toBe(`${base}#L4-L9`);
  });

  it("refuses impossible lines, unknown files and sample data", () => {
    expect(sourceLineUrl(graph, "src/app.tsx", 0)).toBeNull();
    expect(sourceLineUrl(graph, "src/app.tsx", 5, 2)).toBeNull();
    expect(sourceLineUrl(graph, "src/nope.ts", 1)).toBeNull();
    expect(sourceLineUrl(parseCodeGraph(demo), "src/app/page.tsx", 1)).toBeNull();
  });
});

describe("framePose", () => {
  const current = { target: [0, 0, 0] as const, azimuth: 1, elevation: ISO_ELEVATION, zoom: 2 };
  const viewport = { width: 1000, height: 700 };
  const building = (x: number, z: number) =>
    ({ x, z, baseY: 0, width: 4, depth: 4, height: 10 }) as Building;

  it("centres a group of buildings and keeps the current angle", () => {
    const pose = framePose(
      [building(-20, 0), building(20, 10)],
      { ...current, target: [0, 0, 0] },
      viewport,
    )!;
    expect(pose.target[0]).toBeCloseTo(0);
    expect(pose.target[2]).toBeCloseTo(5);
    expect(pose.azimuth).toBe(1);
    expect(pose.elevation).toBe(ISO_ELEVATION);
  });

  it("never zooms in past what focusing on one of them would", () => {
    const close = [building(0, 0), building(1, 1)];
    const pose = framePose(close, { ...current, target: [0, 0, 0] }, viewport)!;
    const single = focusPose(close[0], { ...current, target: [0, 0, 0] }, viewport);
    expect(pose.zoom).toBeLessThanOrEqual(single.zoom);
  });

  it("frames a wide spread further out than a tight one", () => {
    const base = {
      ...current,
      target: [0, 0, 0] as [number, number, number],
      azimuth: ISO_AZIMUTH,
    };
    const tight = framePose([building(0, 0), building(10, 0)], base, viewport)!;
    const wide = framePose([building(-100, 0), building(100, 0)], base, viewport)!;
    expect(wide.zoom).toBeLessThan(tight.zoom);
  });

  it("does nothing for no buildings, and focuses a single one", () => {
    const base = { ...current, target: [0, 0, 0] as [number, number, number] };
    expect(framePose([], base, viewport)).toBeNull();
    expect(framePose([building(3, 3)], base, viewport)).toEqual(
      focusPose(building(3, 3), base, viewport),
    );
  });
});

describe("insight highlighting", () => {
  const adjacency = buildAdjacency(graph);
  const insights = new Set(["src/app.tsx", "src/utils/helper.ts"]);

  it("lights the files an answer names and dims the rest", () => {
    const highlight = computeHighlight(adjacency, null, null, { insights });
    expect(highlight.stateOf("src/app.tsx")).toBe("insight");
    expect(highlight.stateOf("src/index.ts")).toBe("dimmed");
  });

  it("gives way to a selection and to search results", () => {
    expect(
      computeHighlight(adjacency, "src/index.ts", null, { insights }).stateOf("src/app.tsx"),
    ).toBe("dependency");
    const matches = new Set(["src/index.ts"]);
    const searched = computeHighlight(adjacency, null, null, { insights, matches });
    expect(searched.stateOf("src/app.tsx")).toBe("dimmed");
    expect(searched.stateOf("src/index.ts")).toBe("match");
  });

  it("takes precedence over time travel changes", () => {
    const changes = new Map([["src/index.ts", "added" as const]]);
    const highlight = computeHighlight(adjacency, null, null, { insights, changes });
    expect(highlight.stateOf("src/index.ts")).toBe("dimmed");
  });
});
