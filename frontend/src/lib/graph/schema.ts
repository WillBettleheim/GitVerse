import { z } from "zod";

/**
 * The CodeGraph contract shared with the backend (backend/app/schemas/graph.py).
 * The backend's contract test validates the demo data against its own definition,
 * so a drift between the two fails CI.
 */

const cleanRelativePath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    "path must be a clean relative POSIX path",
  );

const fileNodeSchema = z.strictObject({
  id: z.string().min(1).max(1024),
  path: cleanRelativePath,
  language: z.string().min(1).max(40),
  loc: z.number().int().nonnegative(),
  complexity: z.number().int().nonnegative(),
});

const importEdgeSchema = z.strictObject({
  source: z.string(),
  target: z.string(),
  kind: z.literal("import"),
});

const provenanceSchema = z.strictObject({
  kind: z.enum(["demo", "analysis"]),
  repository: z.string().min(1).max(200),
  note: z.string().max(500),
});

export const codeGraphSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    provenance: provenanceSchema,
    files: z.array(fileNodeSchema),
    edges: z.array(importEdgeSchema),
  })
  .superRefine((graph, ctx) => {
    const ids = new Set<string>();
    for (const file of graph.files) {
      if (ids.has(file.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate file id: ${file.id}` });
      }
      ids.add(file.id);
    }
    for (const edge of graph.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target)) {
        ctx.addIssue({
          code: "custom",
          message: `edge references unknown file: ${edge.source} -> ${edge.target}`,
        });
      }
      if (edge.source === edge.target) {
        ctx.addIssue({ code: "custom", message: `self-import: ${edge.source}` });
      }
    }
  });

export type CodeGraph = z.infer<typeof codeGraphSchema>;
export type FileNode = CodeGraph["files"][number];
export type ImportEdge = CodeGraph["edges"][number];
export type Provenance = CodeGraph["provenance"];

/** Throws if the input isn't a valid graph. Nothing unvalidated reaches the renderer. */
export function parseCodeGraph(input: unknown): CodeGraph {
  return codeGraphSchema.parse(input);
}
