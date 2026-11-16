"use client";

import { useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { LazyCityCanvas } from "@/features/city/LazyCityCanvas";
import { generateCity } from "@/lib/city/layout";
import { buildAdjacency, type Adjacency } from "@/lib/graph/queries";
import type { CodeGraph } from "@/lib/graph/schema";
import { ApiStatus } from "./ApiStatus";
import { DependencyGraphView } from "./DependencyGraphView";
import { DependencyLegend } from "./DependencyLegend";
import { ExplorerDataProvider, useExplorerData } from "./explorer-data";
import { useSearchResults } from "./use-explorer-data";
import { CanvasToolbar } from "./CanvasToolbar";
import { DemoBanner } from "./DemoBanner";
import { FileNavigator } from "./FileNavigator";
import { Inspector } from "./Inspector";
import { savedLowPower, useExplorerStore, type PanelName } from "./store";

const WEBGL_FALLBACK = (
  <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center">
    <div className="max-w-sm">
      <p className="font-medium">The 3D view couldn’t start.</p>
      <p className="mt-2 text-sm text-muted">
        This browser or device didn’t provide WebGL. The file list and inspector still work.
      </p>
    </div>
  </div>
);

interface ExplorerShellProps {
  graph: CodeGraph;
  /** Extra header content, such as the demo dataset switcher. */
  headerSlot?: ReactNode;
  /** A bar along the bottom of the city, such as the time-travel timeline. */
  timeline?: ReactNode;
  /** AI Architect, shown as a second tab beside the inspector. Only for real analyses. */
  architect?: ReactNode;
}

/**
 * Subscribes to no selection state itself. The canvas, list and inspector each subscribe to what
 * they need, so a hover doesn't re-render the whole page.
 */
export function ExplorerShell({ graph, headerSlot, timeline, architect }: ExplorerShellProps) {
  const city = useMemo(() => generateCity(graph), [graph]);
  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);
  const reset = useExplorerStore((s) => s.reset);
  const lowPower = useExplorerStore((s) => s.lowPower);
  const setLowPower = useExplorerStore((s) => s.setLowPower);

  useEffect(() => reset, [reset]);
  // The saved choice is read after hydration, so the server and browser render the same markup.
  useEffect(() => {
    if (savedLowPower()) setLowPower(true);
  }, [setLowPower]);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-low-power", lowPower);
    return () => document.documentElement.removeAttribute("data-low-power");
  }, [lowPower]);
  useKeyboardShortcuts();

  return (
    <ExplorerDataProvider graph={graph} city={city} adjacency={adjacency}>
      <div className="animate-fade-in relative flex min-h-svh flex-col bg-void lg:h-svh lg:overflow-hidden">
        <header className="chrome holo-edge relative z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Logo />
            <span aria-hidden="true" className="hidden h-5 w-px bg-line sm:block" />
            <RepositoryIdentity graph={graph} />
            {headerSlot}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PanelToggles architect={Boolean(architect)} />
            <span className="hidden md:inline-flex">
              <ApiStatus />
            </span>
          </div>
        </header>

        <DemoBanner provenance={graph.provenance} />

        <Workspace>
          <main className="relative order-1 h-[64svh] shrink-0 overflow-hidden lg:order-2 lg:col-start-2 lg:row-start-1 lg:h-auto">
            <LazyCityCanvas graph={graph} city={city} mode="explorer" fallback={WEBGL_FALLBACK} />
            <MainOverlay />
            <CanvasToolbar omittedFileCount={city.omittedFileCount} raised={Boolean(timeline)} />
            {timeline}
          </main>

          <SidePanel
            name="files"
            label="Files"
            className="order-3 border-line lg:order-1 lg:col-start-1 lg:row-start-1 lg:border-r"
          >
            <FileNavigator />
          </SidePanel>

          <SidePanel
            name="details"
            label="Details"
            className="order-2 overflow-y-auto border-b border-line lg:order-3 lg:col-start-3 lg:row-start-1 lg:border-b-0 lg:border-l"
          >
            {architect ? <DetailsTabs architect={architect} /> : <Inspector />}
          </SidePanel>
        </Workspace>

        <SelectionAnnouncer adjacency={adjacency} />
      </div>
    </ExplorerDataProvider>
  );
}

/** The grid of panels. A collapsed side panel gives its width to the city. */
function Workspace({ children }: { children: ReactNode }) {
  const panels = useExplorerStore((s) => s.panels);
  const columns = `${panels.files ? "17rem" : "0"} minmax(0,1fr) ${panels.details ? "22rem" : "0"}`;
  return (
    <div
      className="flex flex-1 flex-col lg:grid lg:min-h-0 lg:[grid-template-columns:var(--columns)] lg:transition-[grid-template-columns] lg:duration-300"
      style={{ "--columns": columns } as CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * A side panel. Collapsing hides it on large screens only: on small screens the panels stack
 * below the city, so there is nothing to make room for. `relative` keeps absolutely positioned
 * descendants, such as screen-reader text, from escaping and scrolling the page.
 */
function SidePanel({
  name,
  label,
  className,
  children,
}: {
  name: PanelName;
  label: string;
  className: string;
  children: ReactNode;
}) {
  const open = useExplorerStore((s) => s.panels[name]);
  return (
    <aside
      aria-label={label}
      id={`panel-${name}`}
      className={`relative min-h-0 min-w-0 bg-ink ${open ? "" : "lg:hidden"} ${className}`}
    >
      {children}
    </aside>
  );
}

/** The repository, its owner, and where the data came from. */
function RepositoryIdentity({ graph }: { graph: CodeGraph }) {
  const [owner, name] = graph.provenance.repository.split("/", 2);
  const sample = graph.provenance.kind === "demo";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="hidden h-6 w-6 shrink-0 place-items-center rounded-md border border-line bg-raised font-mono text-[11px] text-cyan sm:grid"
      >
        {(name ?? owner ?? "?").charAt(0).toUpperCase()}
      </span>
      {/* The page's main heading: which repository this city is. */}
      <h1 className="min-w-0 truncate text-sm font-normal">
        {name ? (
          <>
            <span className="text-muted">{owner}</span>
            <span className="text-faint"> / </span>
            <span className="font-medium text-text">{name}</span>
          </>
        ) : (
          <span className="font-medium text-text">{owner}</span>
        )}
      </h1>
      {sample && (
        <span className="shrink-0 rounded border border-amber/40 px-1.5 font-mono text-[10px] text-amber">
          Sample
        </span>
      )}
    </div>
  );
}

const toggle =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 font-mono text-[11px] text-muted transition-colors hover:border-faint hover:text-text aria-pressed:border-cyan/40 aria-pressed:bg-cyan/5 aria-pressed:text-text";

/** Show or hide the side panels, and jump to AI Architect. Large screens only. */
function PanelToggles({ architect }: { architect: boolean }) {
  const panels = useExplorerStore((s) => s.panels);
  const togglePanel = useExplorerStore((s) => s.togglePanel);
  const openArchitect = useExplorerStore((s) => s.openArchitect);
  const tab = useExplorerStore((s) => s.detailsTab);
  return (
    <div className="hidden items-center gap-1.5 lg:flex">
      <button
        type="button"
        aria-pressed={panels.files}
        aria-controls="panel-files"
        aria-keyshortcuts="["
        title="Show or hide the file explorer ( [ )"
        onClick={() => togglePanel("files")}
        className={toggle}
      >
        <PanelIcon side="left" /> Files
      </button>
      {architect && (
        <button
          type="button"
          aria-pressed={panels.details && tab === "architect"}
          onClick={openArchitect}
          title="Ask AI Architect about this repository"
          className={`${toggle} aria-pressed:border-rose/50 aria-pressed:bg-rose/10`}
        >
          <span aria-hidden="true" className="text-rose">
            ✦
          </span>
          Ask AI
        </button>
      )}
      <button
        type="button"
        aria-pressed={panels.details}
        aria-controls="panel-details"
        aria-keyshortcuts="]"
        title="Show or hide the inspector ( ] )"
        onClick={() => togglePanel("details")}
        className={toggle}
      >
        Inspector <PanelIcon side="right" />
      </button>
    </div>
  );
}

function PanelIcon({ side }: { side: "left" | "right" }) {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" />
      <rect
        x={side === "left" ? 2 : 10}
        y="3"
        width="4"
        height="10"
        rx="1"
        fill="currentColor"
        opacity="0.55"
      />
    </svg>
  );
}

/**
 * The inspector and AI Architect as tabs. Both stay mounted, so an answer still arrives while
 * the other tab is open.
 */
function DetailsTabs({ architect }: { architect: ReactNode }) {
  const tab = useExplorerStore((s) => s.detailsTab);
  const setTab = useExplorerStore((s) => s.setDetailsTab);
  const tabs = [
    { id: "details", label: "Details", panel: <Inspector /> },
    { id: "architect", label: "AI Architect", panel: architect },
  ] as const;
  return (
    <>
      <div
        role="tablist"
        aria-label="Side panel"
        className="chrome sticky top-0 z-10 flex border-b border-line"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`details-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`details-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className="flex-1 border-b-2 border-transparent px-3 py-2.5 font-mono text-[11px] tracking-wide text-muted uppercase transition-colors hover:text-text aria-selected:border-cyan aria-selected:text-text"
          >
            {t.id === "architect" && (
              <span aria-hidden="true" className="mr-1.5 text-rose">
                ✦
              </span>
            )}
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`details-panel-${t.id}`}
          aria-labelledby={`details-tab-${t.id}`}
          hidden={tab !== t.id}
        >
          {t.panel}
        </div>
      ))}
    </>
  );
}

/** The dependency graph view when chosen, and the legend over the city otherwise. */
function MainOverlay() {
  const { graph, adjacency, cycles } = useExplorerData();
  const mainView = useExplorerStore((s) => s.mainView);
  const selectedId = useExplorerStore((s) => s.selectedId);
  const search = useSearchResults(graph.files, adjacency);
  if (mainView === "graph") return <DependencyGraphView />;
  return (
    <DependencyLegend
      inCycle={selectedId !== null && cycles.groupOf.has(selectedId)}
      searching={search.active}
    />
  );
}

/** Tells screen reader users what a selection did, since the city itself can't. */
function SelectionAnnouncer({ adjacency }: { adjacency: Adjacency }) {
  const selectedId = useExplorerStore((s) => s.selectedId);
  const message = selectedId
    ? `Selected ${selectedId}. Imports ${adjacency.imports.get(selectedId)?.length ?? 0} files. Imported by ${adjacency.importedBy.get(selectedId)?.length ?? 0} files.`
    : "";
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}

function useKeyboardShortcuts() {
  const select = useExplorerStore((s) => s.select);
  const fitCamera = useExplorerStore((s) => s.fitCamera);
  const resetCamera = useExplorerStore((s) => s.resetCamera);
  const setMainView = useExplorerStore((s) => s.setMainView);
  const togglePanel = useExplorerStore((s) => s.togglePanel);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]"))
        return;
      if (event.key === "Escape") {
        select(null);
        setMainView("city");
      } else if (event.key === "f") fitCamera();
      else if (event.key === "r") resetCamera();
      else if (event.key === "[") togglePanel("files");
      else if (event.key === "]") togglePanel("details");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [select, fitCamera, resetCamera, setMainView, togglePanel]);
}
