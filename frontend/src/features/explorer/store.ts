import { create } from "zustand";
import type { QualityTier } from "@/lib/city/quality";

export interface CameraCommand {
  /** "reset" returns to the isometric home view. "fit" frames the city from the current angle. */
  type: "reset" | "fit";
  /** Bumped per request, so repeating the same command still takes effect. */
  count: number;
}

export interface RenderInfo {
  tier: QualityTier;
  shownConnections: number;
  totalConnections: number;
}

interface ExplorerState {
  selectedId: string | null;
  hoveredId: string | null;
  query: string;
  showConnections: boolean;
  cinematic: boolean;
  cameraCommand: CameraCommand;
  renderInfo: RenderInfo | null;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setQuery: (query: string) => void;
  toggleConnections: () => void;
  toggleCinematic: () => void;
  stopCinematic: () => void;
  resetCamera: () => void;
  fitCamera: () => void;
  setRenderInfo: (info: RenderInfo) => void;
  reset: () => void;
}

const initial = {
  selectedId: null,
  hoveredId: null,
  query: "",
  showConnections: true,
  cinematic: false,
  cameraCommand: { type: "reset", count: 0 } as CameraCommand,
  renderInfo: null,
};

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  ...initial,
  // Selecting takes over the camera, so it ends any overview flight.
  select: (selectedId) =>
    set(selectedId ? { selectedId, cinematic: false } : { selectedId }),
  // Hover fires on every pointer move. Only a real change should notify anyone.
  hover: (hoveredId) => {
    if (get().hoveredId !== hoveredId) set({ hoveredId });
  },
  setQuery: (query) => set({ query }),
  toggleConnections: () => set((s) => ({ showConnections: !s.showConnections })),
  toggleCinematic: () =>
    set((s) => (s.cinematic ? { cinematic: false } : { cinematic: true, selectedId: null })),
  stopCinematic: () => {
    if (get().cinematic) set({ cinematic: false });
  },
  resetCamera: () =>
    set((s) => ({
      selectedId: null,
      cinematic: false,
      cameraCommand: { type: "reset", count: s.cameraCommand.count + 1 },
    })),
  fitCamera: () =>
    set((s) => ({
      cinematic: false,
      cameraCommand: { type: "fit", count: s.cameraCommand.count + 1 },
    })),
  setRenderInfo: (renderInfo) => set({ renderInfo }),
  reset: () => set(initial),
}));
