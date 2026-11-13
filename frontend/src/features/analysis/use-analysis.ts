"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AnalysisRequestError,
  getAnalysis,
  getAnalysisGraph,
  startAnalysis,
  type AnalysisJob,
} from "@/lib/analysis/client";
import type { CodeGraph } from "@/lib/graph/schema";

export type AnalysisState =
  | { phase: "starting" }
  | { phase: "running"; job: AnalysisJob }
  | { phase: "complete"; job: AnalysisJob; graph: CodeGraph }
  | { phase: "error"; message: string; job?: AnalysisJob; retryAfterSeconds?: number };

const POLL_MS = 700;
/** The backend enforces its own time limit. This only stops a client polling a lost job forever. */
const GIVE_UP_MS = 5 * 60 * 1000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/** Starts an analysis, polls it to completion, and fetches the validated graph. */
export function useAnalysis(repository: string) {
  const [state, setState] = useState<AnalysisState>({ phase: "starting" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      setState({ phase: "starting" });
      const started = Date.now();
      let job = await startAnalysis(repository, signal);
      while (job.status === "queued" || job.status === "running") {
        setState({ phase: "running", job });
        if (Date.now() - started > GIVE_UP_MS) {
          throw new AnalysisRequestError("The analysis is taking too long. Try again later.", 0);
        }
        await sleep(POLL_MS, signal);
        job = await getAnalysis(job.id, signal);
      }
      if (job.status === "failed") {
        setState({
          phase: "error",
          job,
          message: job.error?.message ?? "The analysis failed.",
        });
        return;
      }
      const graph = await getAnalysisGraph(job.id, signal);
      setState({ phase: "complete", job, graph });
    })().catch((error: unknown) => {
      if (signal.aborted) return;
      if (error instanceof AnalysisRequestError) {
        setState({
          phase: "error",
          message: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        });
      } else {
        setState({ phase: "error", message: "Something went wrong while loading the analysis." });
      }
    });

    return () => controller.abort();
  }, [repository, attempt]);

  return { state, retry };
}
