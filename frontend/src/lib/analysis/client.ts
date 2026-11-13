import { z } from "zod";
import { API_URL } from "@/lib/config";
import { parseCodeGraph, repositoryInfoSchema, type CodeGraph } from "@/lib/graph/schema";

export const STAGES = [
  "queued",
  "fetching_metadata",
  "downloading",
  "reading_archive",
  "parsing",
  "building_graph",
  "complete",
  "failed",
] as const;

export type Stage = (typeof STAGES)[number];

const jobSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  requested: z.string(),
  status: z.enum(["queued", "running", "complete", "failed"]),
  createdAt: z.string(),
  progress: z.object({
    stage: z.enum(STAGES),
    filesTotal: z.number().int().nonnegative(),
    filesParsed: z.number().int().nonnegative(),
  }),
  repository: repositoryInfoSchema.nullable(),
  cached: z.boolean(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});

export type AnalysisJob = z.infer<typeof jobSchema>;

/** A failure with a message that's safe and useful to show as-is. */
export class AnalysisRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AnalysisRequestError";
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AnalysisRequestError(
      "Couldn't reach the GitVerse API. Check that the backend is running.",
      0,
    );
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after")) || undefined;
    throw new AnalysisRequestError(await errorMessage(response), response.status, retryAfter);
  }
  return response.json();
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Fall through to a generic message.
  }
  return `The API returned an error (${response.status}).`;
}

function parseJob(data: unknown): AnalysisJob {
  const parsed = jobSchema.safeParse(data);
  if (!parsed.success) {
    throw new AnalysisRequestError("The API returned an unexpected response.", 502);
  }
  return parsed.data;
}

export async function startAnalysis(repository: string, signal?: AbortSignal) {
  return parseJob(
    await request("/api/v1/analyses", {
      method: "POST",
      body: JSON.stringify({ repository }),
      signal,
    }),
  );
}

export async function getAnalysis(id: string, signal?: AbortSignal) {
  return parseJob(await request(`/api/v1/analyses/${encodeURIComponent(id)}`, { signal }));
}

/** Validated with the same schema as demo data, so nothing unchecked reaches the renderer. */
export async function getAnalysisGraph(id: string, signal?: AbortSignal): Promise<CodeGraph> {
  const data = await request(`/api/v1/analyses/${encodeURIComponent(id)}/graph`, { signal });
  try {
    return parseCodeGraph(data);
  } catch {
    throw new AnalysisRequestError("The analysis result didn't match the expected format.", 502);
  }
}
