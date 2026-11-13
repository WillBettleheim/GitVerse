import { describe, expect, it } from "vitest";
import demo from "@/features/demo/demo-graph.json";
import sample from "@/features/analysis/__fixtures__/analysis-sample.json";
import { parseCodeGraph, type CodeGraph } from "@/lib/graph/schema";
import { sourceUrl } from "./source-link";

const graph = parseCodeGraph(sample);
const SHA = graph.analysis!.repository.commitSha;

describe("sourceUrl", () => {
  it("links to the file at the exact analyzed commit", () => {
    expect(sourceUrl(graph, "src/app.tsx")).toBe(
      `https://github.com/acme/web-app/blob/${SHA}/src/app.tsx`,
    );
  });

  it("encodes each path segment without encoding the slashes", () => {
    const odd: CodeGraph = {
      ...graph,
      files: [...graph.files, { ...graph.files[0], id: "src/a b#c.ts", path: "src/a b#c.ts" }],
    };
    expect(sourceUrl(odd, "src/a b#c.ts")).toBe(
      `https://github.com/acme/web-app/blob/${SHA}/src/a%20b%23c.ts`,
    );
  });

  it("gives no link for sample data", () => {
    expect(sourceUrl(parseCodeGraph(demo), "src/app/page.tsx")).toBeNull();
  });

  it("gives no link for a file that wasn't analyzed", () => {
    expect(sourceUrl(graph, "src/not-there.ts")).toBeNull();
  });

  it("gives no link when the repository details don't validate", () => {
    const repository = { ...graph.analysis!.repository, fullName: "evil.example/../x" };
    const tampered = { ...graph, analysis: { ...graph.analysis!, repository } };
    expect(sourceUrl(tampered, "src/app.tsx")).toBeNull();
  });
});
