"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import { buildAdjacency, neighbourhood } from "@/lib/graph/queries";
import type { CodeGraph } from "@/lib/graph/schema";
import type { CityLayout } from "@/lib/city/layout";
import { Buildings } from "./Buildings";
import { HERO_SCALE, HeroRig, OrbitRig, homePosition } from "./CameraRig";
import { CanvasErrorBoundary } from "./CanvasErrorBoundary";
import { Connections } from "./Connections";
import { Districts } from "./Districts";
import { LabelProjector, type LabelAnchor } from "./LabelProjector";
import { useReducedMotion } from "./use-reduced-motion";

const BACKGROUND = "#05070f";
const EMPTY = new Set<string>();
const ACTIVE_LABEL = "__active";

interface Selection {
  selectedId: string | null;
  hoveredId: string | null;
  showConnections: boolean;
  cameraResetCount: number;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

interface CityCanvasProps {
  graph: CodeGraph;
  city: CityLayout;
  /** Omit for the non-interactive landing page view. */
  selection?: Selection;
  fallback: ReactNode;
}

export default function CityCanvas({ graph, city, selection, fallback }: CityCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const visible = useIsVisible(container);
  const reducedMotion = useReducedMotion();
  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);

  const selectedId = selection?.selectedId ?? null;
  const activeId = selectedId ?? selection?.hoveredId ?? null;
  const focus = useMemo(
    () => (activeId ? neighbourhood(adjacency, activeId) : null),
    [adjacency, activeId],
  );
  const emphasized = useMemo(() => (activeId ? new Set([activeId]) : EMPTY), [activeId]);

  const byId = useMemo(() => new Map(city.buildings.map((b) => [b.id, b])), [city.buildings]);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const labelled = activeId ? (byId.get(activeId) ?? null) : null;

  const fog = useMemo(
    () => ({
      color: BACKGROUND,
      near: Math.max(city.bounds.radius, 10) * 1.6,
      far: Math.max(city.bounds.radius, 10) * 4.2,
    }),
    [city.bounds.radius],
  );
  const home = useMemo(() => homePosition(city.bounds, HERO_SCALE), [city.bounds]);

  const showDistrictLabels = Boolean(selection);
  const anchors = useMemo(() => {
    const list: LabelAnchor[] = showDistrictLabels
      ? city.districts.map((d) => ({
          key: d.id,
          text: d.label,
          active: false,
          position: [d.x - d.width / 2, 0.1, d.z + d.depth / 2],
        }))
      : [];
    if (labelled) {
      list.push({
        key: ACTIVE_LABEL,
        text: labelled.name,
        active: true,
        position: [labelled.x, labelled.height + 0.8, labelled.z],
      });
    }
    return list;
  }, [city.districts, showDistrictLabels, labelled]);
  const labelOverlay = useRef<HTMLDivElement>(null);

  return (
    <div ref={container} className="absolute inset-0">
      <CanvasErrorBoundary fallback={fallback}>
        <Canvas
          dpr={[1, 2]}
          frameloop={visible ? "always" : "never"}
          camera={{ position: home.toArray(), fov: 42, near: 0.5, far: fog.far * 2 }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onPointerMissed={() => selection?.onSelect(null)}
          style={selection ? undefined : { pointerEvents: "none" }}
          aria-label="3D city visualization"
        >
          <color attach="background" args={[BACKGROUND]} />
          <Grid
            position={[0, -0.01, 0]}
            infiniteGrid
            cellSize={2}
            cellThickness={0.5}
            cellColor="#101a33"
            sectionSize={10}
            sectionThickness={0.9}
            sectionColor="#1b2b52"
            fadeDistance={fog.far}
            fadeStrength={1.5}
          />
          <Districts districts={city.districts} />
          <Buildings
            buildings={city.buildings}
            focus={focus}
            emphasized={emphasized}
            fog={fog}
            onHover={selection?.onHover}
            onSelect={selection?.onSelect}
          />
          {(selection?.showConnections ?? true) && (
            <Connections
              buildings={city.buildings}
              connections={city.connections}
              activeId={activeId}
              animate={!reducedMotion}
            />
          )}
          <LabelProjector anchors={anchors} overlay={labelOverlay} />
          {selection ? (
            <OrbitRig
              bounds={city.bounds}
              focus={selected}
              resetCount={selection.cameraResetCount}
              reducedMotion={reducedMotion}
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
          {anchors.map((anchor) => (
            <span
              key={anchor.key}
              className={`absolute top-0 left-0 hidden font-mono whitespace-nowrap ${
                anchor.active
                  ? "z-10 -translate-x-1/2 -translate-y-full rounded border border-white/15 bg-void/90 px-2 py-1 text-[11px] text-white"
                  : "pt-1 text-[10px] tracking-wide text-slate-400/90 max-md:invisible"
              }`}
            >
              {anchor.text}
            </span>
          ))}
        </div>
      </CanvasErrorBoundary>
    </div>
  );
}

/** Stops rendering while off-screen, so a scrolled-away canvas doesn't burn GPU. */
function useIsVisible(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}
