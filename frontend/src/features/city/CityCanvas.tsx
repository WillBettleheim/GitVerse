"use client";

import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useExplorerStore } from "@/features/explorer/store";
import {
  activeEdges,
  useCycles,
  useSearchResults,
  useSelectionReach,
} from "@/features/explorer/use-explorer-data";
import { ambientOpacity, selectAmbientConnections } from "@/lib/city/arcs";
import { cameraDistance } from "@/lib/city/camera";
import { computeHighlight } from "@/lib/city/highlight";
import type { Building, CityLayout } from "@/lib/city/layout";
import {
  detectQualityTier,
  FrameGovernor,
  lowerTier,
  QUALITY_PRESETS,
  type QualityTier,
} from "@/lib/city/quality";
import { buildAdjacency } from "@/lib/graph/queries";
import type { CodeGraph } from "@/lib/graph/schema";
import { Beacons, GroundGlow } from "./BuildingAccents";
import { Buildings } from "./Buildings";
import { ExplorerRig, HeroRig } from "./CameraRig";
import { CanvasErrorBoundary } from "./CanvasErrorBoundary";
import { Connections } from "./Connections";
import { Districts } from "./Districts";
import { LabelProjector, type LabelAnchor } from "./LabelProjector";
import { Platform } from "./Platform";
import { useReducedMotion } from "./use-reduced-motion";

const BACKGROUND = "#05070f";
const HERO_CONNECTION_LIMIT = 150;
const TOOLTIP_OFFSET = 0.6;
const ACCENT_REFERENCE_RADIUS = 45;

interface CityCanvasProps {
  graph: CodeGraph;
  city: CityLayout;
  /** "hero" is the non-interactive landing page view. */
  mode: "hero" | "explorer";
  fallback: ReactNode;
}

function readDevice(fileCount: number): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return detectQualityTier({
    memoryGb: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    fileCount,
  });
}

export default function CityCanvas({ graph, city, mode, fallback }: CityCanvasProps) {
  const interactive = mode === "explorer";
  const container = useRef<HTMLDivElement>(null);
  const labelOverlay = useRef<HTMLDivElement>(null);
  const visible = useIsVisible(container);
  const reducedMotion = useReducedMotion();

  const selectedId = useExplorerStore((s) => (interactive ? s.selectedId : null));
  const hoveredId = useExplorerStore((s) => (interactive ? s.hoveredId : null));
  const showConnections = useExplorerStore((s) => !interactive || s.showConnections);
  const cinematicWanted = useExplorerStore((s) => interactive && s.cinematic);
  // The dependency graph view covers the city entirely, so the city needn't draw anything.
  const covered = useExplorerStore((s) => interactive && s.mainView === "graph");
  const command = useExplorerStore((s) => s.cameraCommand);
  const select = useExplorerStore((s) => s.select);
  const hover = useExplorerStore((s) => s.hover);
  const stopCinematic = useExplorerStore((s) => s.stopCinematic);
  const setRenderInfo = useExplorerStore((s) => s.setRenderInfo);

  const [tier, setTier] = useState<QualityTier>(() => readDevice(graph.files.length));
  const preset = QUALITY_PRESETS[tier];
  // Antialiasing is fixed when the WebGL context is created, so it keeps its first value.
  const [antialias] = useState(preset.antialias);

  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);
  const cycles = useCycles(graph);
  const search = useSearchResults(graph.files, adjacency);
  const selection = useSelectionReach(adjacency, cycles, selectedId);
  const matches = interactive ? search.matches : null;
  const highlight = useMemo(
    () =>
      computeHighlight(adjacency, selectedId, hoveredId, {
        reach: selection.reach,
        cycle: selection.cycle,
        matches,
      }),
    [adjacency, selectedId, hoveredId, selection, matches],
  );
  const active = useMemo(
    () => activeEdges(city, selection, hoveredId),
    [city, selection, hoveredId],
  );

  const byId = useMemo(() => new Map(city.buildings.map((b) => [b.id, b])), [city.buildings]);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const tooltipId = hoveredId ?? selectedId;
  const tooltipBuilding = tooltipId ? (byId.get(tooltipId) ?? null) : null;
  const activeBuilding = highlight.activeId ? byId.get(highlight.activeId) : undefined;

  const connectionLimit = interactive
    ? preset.ambientConnections
    : Math.min(preset.ambientConnections, HERO_CONNECTION_LIMIT);
  const ambient = useMemo(
    () => selectAmbientConnections(city.connections, city.buildings, connectionLimit),
    [city.connections, city.buildings, connectionLimit],
  );

  const districtLabels = useMemo(() => {
    if (!interactive) return [];
    return [...city.districts]
      .filter((d) => d.fileIds.length > 0 || d.level === 0)
      .sort((a, b) => b.width * b.depth - a.width * a.depth || (a.id < b.id ? -1 : 1))
      .slice(0, preset.districtLabels);
  }, [city.districts, interactive, preset.districtLabels]);

  const anchors = useMemo(() => {
    const list: LabelAnchor[] = districtLabels.map((d) => ({
      key: d.id,
      position: [d.x - d.width / 2, d.baseY + d.plateHeight, d.z + d.depth / 2],
      floating: false,
    }));
    if (tooltipBuilding) {
      list.push({
        key: "__tooltip",
        position: [
          tooltipBuilding.x,
          tooltipBuilding.baseY + tooltipBuilding.height + TOOLTIP_OFFSET,
          tooltipBuilding.z,
        ],
        floating: true,
      });
    }
    return list;
  }, [districtLabels, tooltipBuilding]);

  useEffect(() => {
    if (!interactive) return;
    setRenderInfo({
      tier,
      shownConnections: ambient.length,
      totalConnections: city.connections.length,
    });
  }, [interactive, tier, ambient.length, city.connections.length, setRenderInfo]);

  const cinematic = cinematicWanted && !reducedMotion;
  const pulsing = Boolean(highlight.activeId) && showConnections && !reducedMotion;
  const animated = interactive ? cinematic || pulsing : !reducedMotion;
  const frameloop = !visible || covered ? "never" : animated ? "always" : "demand";

  const distance = useMemo(() => cameraDistance(city.bounds), [city.bounds]);
  const dimmed = highlight.activeId !== null || matches !== null;
  // Bigger cities are viewed from further out, so beacons need more height to stay visible.
  const accentScale = Math.max(1, city.bounds.radius / ACCENT_REFERENCE_RADIUS);

  return (
    <div
      ref={container}
      className="absolute inset-0"
      style={{ cursor: !interactive ? undefined : hoveredId ? "pointer" : "grab" }}
    >
      <CanvasErrorBoundary fallback={fallback}>
        <Canvas
          orthographic
          dpr={preset.dpr}
          frameloop={frameloop}
          camera={{
            position: [distance, distance, distance],
            zoom: 1,
            near: 0.1,
            far: distance * 4,
          }}
          gl={{ antialias, powerPreference: "high-performance" }}
          onPointerMissed={() => {
            if (interactive) select(null);
          }}
          style={interactive ? undefined : { pointerEvents: "none" }}
          role="img"
          aria-label={
            interactive
              ? "3D city of the repository. The file list offers the same navigation by keyboard."
              : "3D city rendered from sample data."
          }
        >
          <color attach="background" args={[BACKGROUND]} />
          <Platform bounds={city.bounds} />
          <Districts
            districts={city.districts}
            activeDistrictId={activeBuilding?.districtId ?? null}
            dimmed={dimmed}
          />
          {preset.groundGlow && <GroundGlow buildings={city.buildings} dimmed={dimmed} />}
          <Buildings
            buildings={city.buildings}
            highlight={highlight}
            radius={city.bounds.radius}
            onHover={interactive ? hover : undefined}
            onSelect={interactive ? select : undefined}
          />
          <Beacons buildings={city.buildings} highlight={highlight} scale={accentScale} />
          {showConnections && (
            <Connections
              buildings={city.buildings}
              ambient={ambient}
              ambientOpacity={ambientOpacity(ambient.length)}
              active={active}
              segments={preset.arcSegments}
              animate={!reducedMotion}
            />
          )}
          <LabelProjector anchors={anchors} overlay={labelOverlay} />
          <QualityProbe onDecline={() => setTier(lowerTier)} />
          {process.env.NODE_ENV !== "production" && <RenderStats />}
          {interactive ? (
            <ExplorerRig
              bounds={city.bounds}
              selected={selected}
              command={command}
              cinematic={cinematic}
              reducedMotion={reducedMotion}
              onUserInteract={stopCinematic}
            />
          ) : (
            <HeroRig bounds={city.bounds} reducedMotion={reducedMotion} />
          )}
        </Canvas>
        <div
          ref={labelOverlay}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden select-none"
        >
          {districtLabels.map((d) => (
            <span
              key={d.id}
              className="absolute top-0 left-0 hidden rounded-sm bg-void/60 px-1 font-mono text-[10px] tracking-wide whitespace-nowrap text-slate-300/90 transition-opacity duration-150 max-md:invisible"
            >
              {d.label}
            </span>
          ))}
          {tooltipBuilding && <BuildingTooltip building={tooltipBuilding} />}
        </div>
      </CanvasErrorBoundary>
    </div>
  );
}

const BuildingTooltip = memo(function BuildingTooltip({ building }: { building: Building }) {
  return (
    <div className="absolute top-0 left-0 z-10 hidden w-56 rounded-md border border-white/15 bg-void/95 p-2.5 shadow-lg shadow-black/40">
      <p className="truncate text-[13px] font-medium text-white">{building.name}</p>
      <p className="truncate font-mono text-[10px] text-faint">{building.path}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px]">
        <dt className="text-faint">Type</dt>
        <dd className="text-right text-text">{building.category}</dd>
        <dt className="text-faint">Lines</dt>
        <dd className="text-right text-text tabular-nums">{building.loc}</dd>
        <dt className="text-faint">Complexity</dt>
        <dd className="text-right text-text tabular-nums">{building.complexity}</dd>
        <dt className="text-cyan">Imports</dt>
        <dd className="text-right text-text tabular-nums">{building.fanOut}</dd>
        <dt className="text-violet">Imported by</dt>
        <dd className="text-right text-text tabular-nums">{building.fanIn}</dd>
      </dl>
      {building.landmark && (
        <p className="mt-2 border-t border-white/10 pt-1.5 text-[11px] text-cyan">
          Key module: among the most depended on
        </p>
      )}
    </div>
  );
});

/** Lowers quality if real frame times are too slow. */
function QualityProbe({ onDecline }: { onDecline: () => void }) {
  const governor = useRef(new FrameGovernor());
  useFrame((_, delta) => {
    if (governor.current.record(delta)) onDecline();
  });
  return null;
}

/** Development only: exposes renderer counters for checking performance. */
function RenderStats() {
  useFrame(({ gl }) => {
    const { calls, triangles, lines, frame } = gl.info.render;
    (window as unknown as { __GITVERSE_RENDER_STATS__: unknown }).__GITVERSE_RENDER_STATS__ = {
      calls,
      triangles,
      lines,
      frame,
    };
  });
  return null;
}

/** Stops rendering while off-screen, so a scrolled-away canvas doesn't burn GPU. */
function useIsVisible(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}
