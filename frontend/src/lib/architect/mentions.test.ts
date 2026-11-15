import { describe, expect, it } from "vitest";
import { splitMentions } from "./mentions";

const known = new Set(["src/app.tsx", "src/utils/helper.ts", "utils/helper.ts", "index.ts"]);
const files = (text: string) =>
  splitMentions(text, known).flatMap((s) => (s.kind === "file" ? [s.path] : []));

describe("splitMentions", () => {
  it("links files the analysis contains, keeping the text around them", () => {
    const segments = splitMentions("See src/app.tsx, then src/utils/helper.ts.", known);
    expect(segments.map((s) => s.text).join("")).toBe("See src/app.tsx, then src/utils/helper.ts.");
    expect(files("See src/app.tsx, then src/utils/helper.ts.")).toEqual([
      "src/app.tsx",
      "src/utils/helper.ts",
    ]);
  });

  it("prefers the longest path", () => {
    expect(files("Look at src/utils/helper.ts")).toEqual(["src/utils/helper.ts"]);
  });

  it("never links invented paths or partial matches", () => {
    expect(files("src/secret/admin.ts and src/app.tsxx and mysrc/app.tsx")).toEqual([]);
  });

  it("links a bare file name only when the analysis has exactly that path", () => {
    expect(files("index.ts re-exports it")).toEqual(["index.ts"]);
  });
});
