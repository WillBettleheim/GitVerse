import { create } from "zustand";

interface ExplorerState {
  selectedId: string | null;
  hoveredId: string | null;
  query: string;
  showConnections: boolean;
  /** Bumped to ask the camera to return home. */
  cameraResetCount: number;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setQuery: (query: string) => void;
  toggleConnections: () => void;
  resetCamera: () => void;
  reset: () => void;
}

const initial = {
  selectedId: null,
  hoveredId: null,
  query: "",
  showConnections: true,
  cameraResetCount: 0,
};

export const useExplorerStore = create<ExplorerState>((set) => ({
  ...initial,
  select: (selectedId) => set({ selectedId }),
  hover: (hoveredId) => set({ hoveredId }),
  setQuery: (query) => set({ query }),
  toggleConnections: () => set((s) => ({ showConnections: !s.showConnections })),
  resetCamera: () => set((s) => ({ selectedId: null, cameraResetCount: s.cameraResetCount + 1 })),
  reset: () => set(initial),
}));
