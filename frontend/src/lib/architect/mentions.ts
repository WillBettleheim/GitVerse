export type Segment = { kind: "text"; text: string } | { kind: "file"; text: string; path: string };

const BOUNDARY = /[\w./@-]/;

/**
 * Splits an answer into plain text and mentions of files that exist in the analysis, so each
 * mention can link to its building. Only exact paths in `known` are linked: a path the model
 * invented stays plain text, so a link always leads somewhere real.
 */
export function splitMentions(text: string, known: ReadonlySet<string>): Segment[] {
  // Longest first, so "src/a/b.ts" wins over "a/b.ts" when both exist.
  const paths = [...known]
    .filter((p) => p.includes("/") || p.includes("."))
    .sort((a, b) => b.length - a.length);
  const segments: Segment[] = [];
  let plain = "";
  let index = 0;
  outer: while (index < text.length) {
    if (index === 0 || !BOUNDARY.test(text[index - 1])) {
      for (const path of paths) {
        if (!text.startsWith(path, index)) continue;
        const after = text[index + path.length];
        // A trailing full stop ends a sentence, not the path.
        if (after !== undefined && BOUNDARY.test(after) && after !== ".") continue;
        if (plain) segments.push({ kind: "text", text: plain });
        plain = "";
        segments.push({ kind: "file", text: path, path });
        index += path.length;
        continue outer;
      }
    }
    plain += text[index];
    index += 1;
  }
  if (plain) segments.push({ kind: "text", text: plain });
  return segments;
}
