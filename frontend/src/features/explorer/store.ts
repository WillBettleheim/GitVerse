import { create } from "zustand";
import type { QualityTier } from "@/lib/city/quality";
import type { DepthSetting, Direction } from "@/lib/graph/dependencies";
import { NO_FILTERS, type SearchFilters } from "@/lib/graph/search";

export type MainView = "city" | "graph";
/** The side panel's tabs: the file inspector and insights, or AI Architect. */
export type DetailsTab = "details" | "architect";

export interface CameraCommand {
  /**
   * "reset" returns to the isometric home view. "fit" frames the city from the current angle.
   * "frame" frames just the files in `ids`, from the current angle.
   */
  type: "reset" | "fit" | "frame";
  /** Bumped per request, so repeating the same command still takes effect. */
  count: number;
  ids?: readonly string[];
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
  filters: SearchFilters;
  /** How far, and which way, the selection's dependencies are followed. */
  depth: DepthSetting;
  direction: Direction;
  mainView: MainView;
  detailsTab: DetailsTab;
  showConnections: boolean;
  cinematic: boolean;
  cameraCommand: CameraCommand;
  renderInfo: RenderInfo | null;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setQuery: (query: string) => void;
  setFilters: (filters: Partial<SearchFilters>) => void;
  clearSearch: () => void;
  setDepth: (depth: DepthSetting) => void;
  setDirection: (direction: Direction) => void;
  setMainView: (view: MainView) => void;
  setDetailsTab: (tab: DetailsTab) => void;
  /** Breadcrumb navigation: clears the selection and narrows the search to a folder. */
  showFolder: (folder: string | null) => void;
  toggleConnections: () => void;
  toggleCinematic: () => void;
  stopCinematic: () => void;
  resetCamera: () => void;
  fitCamera: () => void;
  /** Frames a group of files, such as those an AI Architect answer names. */
  frameFiles: (ids: readonly string[]) => void;
  setRenderInfo: (info: RenderInfo) => void;
  reset: () => void;
}

const initial = {
  selectedId: null,
  hoveredId: null,
  query: "",
  filters: NO_FILTERS,
  depth: 1 as DepthSetting,
  direction: "both" as Direction,
  mainView: "city" as MainView,
  detailsTab: "details" as DetailsTab,
  showConnections: true,
  cinematic: false,
  cameraCommand: { type: "reset", count: 0 } as CameraCommand,
  renderInfo: null,
};

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  ...initial,
  // Selecting takes over the camera, so it ends any overview flight.
  select: (selectedId) => set(selectedId ? { selectedId, cinematic: false } : { selectedId }),
  // Hover fires on every pointer move. Only a real change should notify anyone.
  hover: (hoveredId) => {
    if (get().hoveredId !== hoveredId) set({ hoveredId });
  },
  setQuery: (query) => set({ query }),
  setFilters: (filters) => set((s) => ({ filters: { ...s.filters, ...filters } })),
  clearSearch: () => set({ query: "", filters: NO_FILTERS }),
  setDepth: (depth) => set({ depth }),
  setDirection: (direction) => set({ direction }),
  setMainView: (mainView) => set({ mainView }),
  setDetailsTab: (detailsTab) => set({ detailsTab }),
  showFolder: (folder) => set((s) => ({ selectedId: null, filters: { ...s.filters, folder } })),
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
  frameFiles: (ids) =>
    set((s) => ({
      selectedId: null,
      cinematic: false,
      mainView: "city",
      cameraCommand: { type: "frame", count: s.cameraCommand.count + 1, ids: [...ids] },
    })),
  setRenderInfo: (renderInfo) => set({ renderInfo }),
  reset: () => set(initial),
}));
