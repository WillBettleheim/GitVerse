import { create } from "zustand";
import type { QualityTier } from "@/lib/city/quality";
import type { DepthSetting, Direction } from "@/lib/graph/dependencies";
import { NO_FILTERS, type SearchFilters } from "@/lib/graph/search";

export type MainView = "city" | "graph";
/** The side panel's tabs: the file inspector and insights, or AI Architect. */
export type DetailsTab = "details" | "architect";
/** Side panels that can be collapsed to give the city more room. */
export type PanelName = "files" | "details";
/**
 * A lens lights up one kind of architectural hotspot, each counted from the graph: the most
 * complex files, the most depended upon, or every file in an import cycle.
 */
export type Lens = "none" | "complexity" | "dependents" | "cycles";

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
  panels: Record<PanelName, boolean>;
  lens: Lens;
  /** Fewer effects for slow devices or batteries. Every analysis feature stays available. */
  lowPower: boolean;
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
  togglePanel: (panel: PanelName) => void;
  /** Opens the side panel on AI Architect. */
  openArchitect: () => void;
  setLens: (lens: Lens) => void;
  setLowPower: (lowPower: boolean) => void;
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
  panels: { files: true, details: true } as Record<PanelName, boolean>,
  lens: "none" as Lens,
  lowPower: false,
  showConnections: true,
  cinematic: false,
  cameraCommand: { type: "reset", count: 0 } as CameraCommand,
  renderInfo: null,
};

export const LOW_POWER_KEY = "gitverse:low-power";

/** The saved low-power choice, read once in the browser. */
export function savedLowPower(): boolean {
  try {
    return localStorage.getItem(LOW_POWER_KEY) === "1";
  } catch {
    return false;
  }
}

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
  togglePanel: (panel) => set((s) => ({ panels: { ...s.panels, [panel]: !s.panels[panel] } })),
  openArchitect: () =>
    set((s) => ({ detailsTab: "architect", panels: { ...s.panels, details: true } })),
  setLens: (lens) => set({ lens }),
  setLowPower: (lowPower) => {
    try {
      localStorage.setItem(LOW_POWER_KEY, lowPower ? "1" : "0");
    } catch {
      // Private browsing or blocked storage: the setting just won't be remembered.
    }
    set((s) => ({ lowPower, cinematic: lowPower ? false : s.cinematic }));
  },
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
  // Low power is a device preference, so leaving a repository doesn't turn it off.
  reset: () => set((s) => ({ ...initial, lowPower: s.lowPower })),
}));
