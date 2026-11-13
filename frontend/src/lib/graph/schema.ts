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

const count = z.number().int().nonnegative();

/** Measured from the syntax tree. Demo data has none, because it has no real source. */
const fileMetricsSchema = z.strictObject({
  totalLines: count,
  functions: count,
  classes: count,
  exports: count,
  localDependencies: count,
  incomingDependencies: count,
  externalImports: count,
  unresolvedImports: count,
  parseError: z.boolean(),
});

const fileNodeSchema = z.strictObject({
  id: z.string().min(1).max(1024),
  path: cleanRelativePath,
  language: z.string().min(1).max(40),
  /** Lines with code, excluding blank and comment-only lines. */
  loc: count,
  /** File-level cyclomatic complexity. */
  complexity: count,
  metrics: fileMetricsSchema.optional(),
});

const importEdgeSchema = z.strictObject({
  source: z.string(),
  target: z.string(),
  kind: z.literal("import"),
  /** Every import along this edge is `import type`. */
  typeOnly: z.boolean().optional(),
});

export const repositoryInfoSchema = z.strictObject({
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  url: z.string(),
  description: z.string().nullable().optional(),
  defaultBranch: z.string(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  stars: count,
  forks: count,
  primaryLanguage: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  archived: z.boolean(),
});

const analysisSummarySchema = z.strictObject({
  repository: repositoryInfoSchema,
  analyzerVersion: z.string(),
  analyzedAt: z.string(),
  languages: z.record(z.string(), count),
  totalLoc: count,
  externalDependencies: z.array(
    z.strictObject({ name: z.string(), kind: z.enum(["package", "builtin"]), importers: count }),
  ),
  unresolvedImports: z.array(
    z.strictObject({
      source: z.string(),
      specifier: z.string(),
      line: z.number().int().positive(),
      reason: z.string(),
    }),
  ),
  unresolvedImportCount: count,
  cycles: z.array(z.strictObject({ files: z.array(z.string()).min(1), typeOnly: z.boolean() })),
  cycleCount: count,
  hubs: z.array(z.strictObject({ id: z.string(), incoming: count, outgoing: count })),
  skippedFiles: z.record(z.string(), count),
  filesWithParseErrors: count,
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
    analysis: analysisSummarySchema.optional(),
  })
  .superRefine((graph, ctx) => {
    if (graph.analysis && graph.provenance.kind !== "analysis") {
      ctx.addIssue({
        code: "custom",
        message: "only analysis output may carry an analysis summary",
      });
    }
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
export type AnalysisSummary = NonNullable<CodeGraph["analysis"]>;
export type RepositoryInfo = z.infer<typeof repositoryInfoSchema>;

/** Throws if the input isn't a valid graph. Nothing unvalidated reaches the renderer. */
export function parseCodeGraph(input: unknown): CodeGraph {
  return codeGraphSchema.parse(input);
}
