"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  AnalysisRequestError,
  cancelAnalysis,
  getAnalysis,
  getAnalysisGraph,
  startAnalysis,
} from "@/lib/analysis/client";
import type { CodeGraph } from "@/lib/graph/schema";
import { fetchDiff, fetchHistory } from "@/lib/timetravel/api";
import { nextPlayable, pickRepresentative, playbackStart } from "@/lib/timetravel/snapshots";
import { changeIndex } from "@/lib/timetravel/transition";
import { DWELL_MS, shownSha, TRANSITION_MS, useTimeTravelStore } from "./store";

const POLL_MS = 800;
/** At most this many snapshots are analyzed at once from one browser. */
const CONCURRENCY = 2;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

const message = (error: unknown) =>
  error instanceof AnalysisRequestError ? error.message : "Something went wrong.";

/**
 * Loads history, analyzes snapshots on demand with bounded concurrency, and moves the view
 * between them. Everything stops, and queued analyses are cancelled, on unmount.
 */
export function useTimeTravel(latest: CodeGraph) {
  const repository = latest.analysis?.repository.fullName ?? null;
  const controller = useRef<AbortController | null>(null);
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const jobIds = useRef(new Set<string>());

  const state = useTimeTravelStore;
  // The queue restarts itself when an analysis finishes, through this ref.
  const pumpRef = useRef<(() => void) | null>(null);

  const pump = useCallback(() => {
    const signal = controller.current?.signal;
    const repo = state.getState().repository;
    if (!signal || !repo) return;
    while (active.current < CONCURRENCY && queue.current.length > 0) {
      const sha = queue.current.shift()!;
      active.current += 1;
      void analyzeSnapshot(repo, sha, signal).finally(() => {
        active.current -= 1;
        pumpRef.current?.();
      });
    }

    async function analyzeSnapshot(repo: string, sha: string, abort: AbortSignal) {
      const { updateSnapshot } = state.getState();
      try {
        let job = await startAnalysis(repo, abort, sha);
        jobIds.current.add(job.id);
        updateSnapshot(sha, { status: "running", jobId: job.id });
        while (job.status === "queued" || job.status === "running") {
          await sleep(POLL_MS, abort);
          job = await getAnalysis(job.id, abort);
          updateSnapshot(sha, {
            filesParsed: job.progress.filesParsed,
            filesTotal: job.progress.filesTotal,
          });
        }
        jobIds.current.delete(job.id);
        if (job.status === "failed") {
          updateSnapshot(sha, {
            status: "failed",
            error: job.error?.message ?? "Analysis failed.",
          });
          return;
        }
        const graph = await getAnalysisGraph(job.id, abort);
        updateSnapshot(sha, { status: "ready", graph });
      } catch (error) {
        if (abort.aborted) return;
        updateSnapshot(sha, { status: "failed", error: message(error) });
      }
    }
  }, [state]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  /** Queues a commit for analysis unless it's ready, loading or already queued. */
  const request = useCallback(
    (sha: string) => {
      const snapshot = state.getState().snapshots[sha];
      if (snapshot && snapshot.status !== "failed") return;
      state.getState().updateSnapshot(sha, { status: "queued", error: undefined });
      queue.current.push(sha);
      pump();
    },
    [pump, state],
  );

  /** Shows a commit, animating from whatever's on screen, with changes from the backend diff. */
  const show = useCallback(
    async (target: string, options: { from?: string; animate?: boolean } = {}) => {
      const signal = controller.current?.signal;
      const s = state.getState();
      if (!signal || !s.repository) return;
      const from = options.from ?? shownSha(s);
      const latest = target === s.latestSha ? null : target;
      if (!from || from === target || options.animate === false) {
        s.setViewing(latest, null);
        return;
      }
      s.setDiff({ base: from, head: target, status: "loading" });
      try {
        const diff = await fetchDiff(s.repository, from, target, signal);
        state.getState().setDiff({ base: from, head: target, status: "ready", data: diff });
        state.getState().setViewing(latest, { changes: changeIndex(diff), edges: diff.edges });
      } catch (error) {
        if (signal.aborted) return;
        // The city can still animate by path; renames just aren't known.
        state
          .getState()
          .setDiff({ base: from, head: target, status: "failed", error: message(error) });
        state.getState().setViewing(latest, { changes: null, edges: null });
      }
    },
    [state],
  );

  /** Selects a commit: shows it now if analyzed, or as soon as its analysis finishes. */
  const select = useCallback(
    (sha: string) => {
      const s = state.getState();
      if (s.snapshots[sha]?.status === "ready") {
        s.setPending(null);
        void show(sha);
      } else {
        s.setPending(sha);
        request(sha);
      }
    },
    [request, show, state],
  );

  const loadMore = useCallback(async () => {
    const signal = controller.current?.signal;
    const s = state.getState();
    if (!signal || !s.repository || s.historyStatus === "loading") return;
    s.setHistoryStatus("loading");
    try {
      const page = await fetchHistory(s.repository, s.page + 1, signal);
      state.getState().setHistory(page.commits, page.page, page.hasMore);
      return page;
    } catch (error) {
      if (!signal.aborted) state.getState().setHistoryStatus("failed", message(error));
    }
  }, [state]);

  // Start: first history page, then a handful of representative snapshots, never all of them.
  useEffect(() => {
    if (!repository) return;
    controller.current = new AbortController();
    state.getState().start(repository, latest);
    void loadMore().then((page) => {
      if (page) for (const commit of pickRepresentative(page.commits)) request(commit.sha);
    });
    const ids = jobIds.current;
    return () => {
      controller.current?.abort();
      queue.current = [];
      active.current = 0;
      for (const id of ids) void cancelAnalysis(id);
      ids.clear();
      state.getState().reset();
    };
    // Only a different repository restarts time travel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  // A pending selection is shown the moment its snapshot is ready.
  const pending = useTimeTravelStore((s) => s.pending);
  const pendingReady = useTimeTravelStore((s) =>
    s.pending ? s.snapshots[s.pending]?.status === "ready" : false,
  );
  useEffect(() => {
    if (pending && pendingReady) {
      state.getState().setPending(null);
      void show(pending);
    }
  }, [pending, pendingReady, show, state]);

  // Playback: through analyzed commits, oldest to newest, then stop.
  const playing = useTimeTravelStore((s) => s.playing);
  const speed = useTimeTravelStore((s) => s.speed);
  const viewing = useTimeTravelStore((s) => s.viewing);
  // Whether this play-through has begun. Without it, arriving back at the latest commit would
  // look like a fresh start and loop forever.
  const started = useRef(false);
  useEffect(() => {
    if (!playing) started.current = false;
  }, [playing]);
  useEffect(() => {
    if (!playing) return;
    const s = state.getState();
    const timeline = s.commits.map((c) => c.sha);
    const ready = new Set(
      Object.entries(s.snapshots)
        .filter(([, snapshot]) => snapshot.status === "ready")
        .map(([sha]) => sha),
    );
    const current = shownSha(s);
    const atStart = !started.current && s.viewing === null;
    started.current = true;
    const next = atStart ? playbackStart(timeline, ready) : nextPlayable(timeline, ready, current);
    if (!next || next === current) {
      s.setPlaying(false);
      return;
    }
    const delay = atStart ? 0 : (TRANSITION_MS + DWELL_MS) / speed;
    const timer = setTimeout(() => void show(next, { animate: !atStart }), delay);
    return () => clearTimeout(timer);
  }, [playing, speed, viewing, show, state]);

  return { select, loadMore, request, show };
}

export type TimeTravelControls = ReturnType<typeof useTimeTravel>;
