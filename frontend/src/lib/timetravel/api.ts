import { z } from "zod";
import { AnalysisRequestError, apiRequest } from "@/lib/analysis/client";

const sha = z.string().regex(/^[0-9a-f]{40}$/);

export const commitSchema = z.object({
  sha,
  summary: z.string(),
  message: z.string(),
  author: z.string().nullable(),
  committedAt: z.string().nullable(),
  parents: z.array(sha),
});

const historySchema = z.object({
  repository: z.string(),
  defaultBranch: z.string(),
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  hasMore: z.boolean(),
  commits: z.array(commitSchema),
});

const measures = z.object({
  loc: z.number(),
  complexity: z.number(),
  incoming: z.number(),
  outgoing: z.number(),
});
const commitRef = z.object({
  sha,
  committedAt: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
});
const edge = z.object({ source: z.string(), target: z.string() });

/** Mirrors backend/app/schemas/diff.py. */
export const snapshotDiffSchema = z.object({
  repository: z.string(),
  base: commitRef,
  head: commitRef,
  files: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    modified: z.array(z.object({ path: z.string(), before: measures, after: measures })),
    renamed: z.array(z.object({ from: z.string(), to: z.string(), contentChanged: z.boolean() })),
    unchanged: z.number(),
    addedCount: z.number(),
    removedCount: z.number(),
    modifiedCount: z.number(),
    renamedCount: z.number(),
  }),
  edges: z.object({
    added: z.array(edge),
    removed: z.array(edge),
    unchanged: z.number(),
    addedCount: z.number(),
    removedCount: z.number(),
  }),
  metrics: z.array(
    z.object({
      name: z.string(),
      label: z.string(),
      before: z.number(),
      after: z.number(),
      delta: z.number(),
    }),
  ),
  renameDetection: z.object({
    method: z.enum(["github", "content", "github+content"]),
    complete: z.boolean(),
    note: z.string(),
  }),
});

export type Commit = z.infer<typeof commitSchema>;
export type History = z.infer<typeof historySchema>;
export type SnapshotDiff = z.infer<typeof snapshotDiffSchema>;

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AnalysisRequestError("The API returned an unexpected response.", 502);
  }
  return result.data;
}

export async function fetchHistory(repository: string, page: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ repository, page: String(page) });
  return parse(historySchema, await apiRequest(`/api/v1/history?${query}`, { signal }));
}

export async function fetchDiff(
  repository: string,
  base: string,
  head: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ repository, base, head });
  return parse(snapshotDiffSchema, await apiRequest(`/api/v1/compare?${query}`, { signal }));
}
