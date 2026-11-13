import { create } from "zustand";
import type { ArchitectAnswer } from "@/lib/architect/api";

export interface Turn {
  id: number;
  question: string;
  /** The commit that was asked about. Answers stay tied to it when the view moves on. */
  commit: string;
  focus: string | null;
  status: "loading" | "done" | "error";
  answer?: ArchitectAnswer;
  error?: string;
  retryAfterSeconds?: number;
}

/** What an answer lights up in the city: its files and the relationships between them. */
export interface Spotlight {
  turnId: number;
  files: readonly string[];
  edges: readonly { source: string; target: string }[];
}

interface ArchitectState {
  turns: Turn[];
  spotlight: Spotlight | null;
  begin: (turn: Omit<Turn, "id" | "status">) => number;
  finish: (id: number, patch: Partial<Omit<Turn, "id">>) => void;
  setSpotlight: (spotlight: Spotlight | null) => void;
  reset: () => void;
}

let nextId = 1;

/** The files and relationships an answer points to, for highlighting. */
export function spotlightFor(turnId: number, answer: ArchitectAnswer): Spotlight | null {
  const files = [...new Set(answer.files.map((f) => f.path))];
  if (files.length === 0) return null;
  return {
    turnId,
    files,
    edges: answer.relationships.map(({ source, target }) => ({
      source,
      target,
    })),
  };
}

export const useArchitectStore = create<ArchitectState>((set) => ({
  turns: [],
  spotlight: null,
  begin: (turn) => {
    const id = nextId++;
    set((s) => ({ turns: [...s.turns, { ...turn, id, status: "loading" }] }));
    return id;
  },
  finish: (id, patch) =>
    set((s) => ({
      turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  setSpotlight: (spotlight) => set({ spotlight }),
  reset: () => set({ turns: [], spotlight: null }),
}));
