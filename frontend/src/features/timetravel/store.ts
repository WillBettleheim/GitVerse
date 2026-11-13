import { create } from "zustand";
import type { CodeGraph } from "@/lib/graph/schema";
import type { Commit, SnapshotDiff } from "@/lib/timetravel/api";
import type { ChangeIndex } from "@/lib/timetravel/transition";

export type SnapshotStatus = "queued" | "running" | "ready" | "failed";
export type Speed = 0.5 | 1 | 2;

export interface Snapshot {
  status: SnapshotStatus;
  graph?: CodeGraph;
  error?: string;
  jobId?: string;
  filesParsed?: number;
  filesTotal?: number;
}

export interface DiffState {
  base: string;
  head: string;
  status: "loading" | "ready" | "failed";
  data?: SnapshotDiff;
  error?: string;
}

/** What the city should animate from and to. Bumped `id` means "play this one". */
export interface TransitionRequest {
  id: number;
  changes: ChangeIndex | null;
  edges: SnapshotDiff["edges"] | null;
}

interface TimeTravelState {
  repository: string | null;
  latestSha: string | null;
  commits: Commit[];
  page: number;
  hasMore: boolean;
  historyStatus: "idle" | "loading" | "ready" | "failed";
  historyError: string | null;
  snapshots: Record<string, Snapshot>;
  /** The commit on show. Null is the latest analysis. */
  viewing: string | null;
  /** A commit that was asked for and is still being analyzed. */
  pending: string | null;
  compare: { base: string | null; head: string | null } | null;
  diff: DiffState | null;
  transition: TransitionRequest | null;
  playing: boolean;
  speed: Speed;

  start: (repository: string, latest: CodeGraph) => void;
  setHistory: (commits: Commit[], page: number, hasMore: boolean) => void;
  setHistoryStatus: (status: TimeTravelState["historyStatus"], error?: string | null) => void;
  updateSnapshot: (sha: string, patch: Partial<Snapshot>) => void;
  setViewing: (sha: string | null, transition: Omit<TransitionRequest, "id"> | null) => void;
  setPending: (sha: string | null) => void;
  setDiff: (diff: DiffState | null) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: Speed) => void;
  setCompare: (compare: TimeTravelState["compare"]) => void;
  reset: () => void;
}

const initial = {
  repository: null,
  latestSha: null,
  commits: [],
  page: 0,
  hasMore: false,
  historyStatus: "idle" as const,
  historyError: null,
  snapshots: {},
  viewing: null,
  pending: null,
  compare: null,
  diff: null,
  transition: null,
  playing: false,
  speed: 1 as Speed,
};

export const useTimeTravelStore = create<TimeTravelState>((set) => ({
  ...initial,
  start: (repository, latest) => {
    const sha = latest.analysis?.repository.commitSha ?? null;
    set({
      ...initial,
      repository,
      latestSha: sha,
      snapshots: sha ? { [sha]: { status: "ready", graph: latest } } : {},
    });
  },
  setHistory: (commits, page, hasMore) =>
    set((s) => {
      const known = new Set(s.commits.map((c) => c.sha));
      return {
        commits: [...s.commits, ...commits.filter((c) => !known.has(c.sha))],
        page,
        hasMore,
        historyStatus: "ready",
        historyError: null,
      };
    }),
  setHistoryStatus: (historyStatus, historyError = null) => set({ historyStatus, historyError }),
  updateSnapshot: (sha, patch) =>
    set((s) => ({
      snapshots: { ...s.snapshots, [sha]: { ...s.snapshots[sha], ...patch } as Snapshot },
    })),
  setViewing: (viewing, transition) =>
    set((s) => ({
      viewing,
      pending: s.pending === viewing ? null : s.pending,
      transition: transition ? { id: (s.transition?.id ?? 0) + 1, ...transition } : s.transition,
    })),
  setPending: (pending) => set({ pending }),
  setDiff: (diff) => set({ diff }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setCompare: (compare) => set({ compare }),
  reset: () => set(initial),
}));

/** The sha actually on screen, with the latest analysis standing in for null. */
export function shownSha(state: { viewing: string | null; latestSha: string | null }) {
  return state.viewing ?? state.latestSha;
}

export const TRANSITION_MS = 1400;
export const DWELL_MS = 1100;
