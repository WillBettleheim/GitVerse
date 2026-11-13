import { z } from "zod";
import { AnalysisRequestError, apiRequest } from "@/lib/analysis/client";

const lineSpan = z.object({
  start: z.number().int().positive(),
  end: z.number().int().positive(),
  label: z.string(),
});
const edgeView = z.object({
  source: z.string(),
  target: z.string(),
  line: z.number().int().positive().nullable().optional(),
  typeOnly: z.boolean().optional(),
});

/** Mirrors backend/app/schemas/assistant.py. */
export const architectAnswerSchema = z.object({
  mode: z.enum(["ai", "evidence_only", "insufficient_evidence"]),
  question: z.string(),
  repository: z.string(),
  commitSha: z.string(),
  answer: z.string().nullable(),
  claims: z.array(
    z.object({
      text: z.string(),
      basis: z.enum(["verified", "inferred"]),
      evidence: z.array(z.string()),
      downgraded: z.boolean(),
    }),
  ),
  files: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
      evidence: z.array(z.string()),
      lines: z.array(lineSpan),
    }),
  ),
  relationships: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      line: z.number().int().positive().nullable().optional(),
      typeOnly: z.boolean(),
    }),
  ),
  uncertainty: z.string().nullable(),
  sufficientEvidence: z.boolean(),
  evidence: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      facts: z.array(z.string()),
      path: z.string().nullable().optional(),
      lineStart: z.number().int().positive().nullable().optional(),
      lineEnd: z.number().int().positive().nullable().optional(),
      snippet: z.string().nullable().optional(),
      files: z.array(z.string()),
      edges: z.array(edgeView),
    }),
  ),
  notes: z.array(z.string()),
  search: z.object({
    terms: z.array(z.string()),
    intents: z.array(z.string()),
    target: z.string().nullable(),
  }),
  model: z.string().nullable().optional(),
});

export type ArchitectAnswer = z.infer<typeof architectAnswerSchema>;
export type Evidence = ArchitectAnswer["evidence"][number];
export type LineSpan = z.infer<typeof lineSpan>;

export const MAX_QUESTION_LENGTH = 500;

export interface QuestionInput {
  repository: string;
  commit: string;
  question: string;
  /** The file selected in the explorer, used as the subject of "this module" questions. */
  focus?: string | null;
  /** Other analyzed commits, for questions about change over time. */
  snapshots?: string[];
}

export async function askArchitect(input: QuestionInput, signal?: AbortSignal) {
  const body = {
    repository: input.repository,
    commit: input.commit,
    question: input.question.trim().slice(0, MAX_QUESTION_LENGTH),
    ...(input.focus ? { focus: input.focus } : {}),
    snapshots: (input.snapshots ?? []).filter((s) => s !== input.commit).slice(0, 8),
  };
  const data = await apiRequest("/api/v1/architect/questions", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
  const parsed = architectAnswerSchema.safeParse(data);
  if (!parsed.success) {
    throw new AnalysisRequestError("AI Architect returned an unexpected response.", 502);
  }
  return parsed.data;
}
