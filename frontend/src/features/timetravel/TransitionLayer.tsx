"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { createBuildingMaterial } from "@/features/city/building-material";
import { createPlateMaterial } from "@/features/city/Districts";
import { arcPoint, roofOf } from "@/lib/city/arcs";
import type { Building, CityLayout } from "@/lib/city/layout";
import { FILE_CATEGORIES } from "@/lib/graph/classify";
import {
  ease,
  lerpBox,
  type Box,
  type ChangeKind,
  type TransitionPlan,
} from "@/lib/timetravel/transition";

export const CHANGE_COLORS: Record<ChangeKind, string | null> = {
  added: "#34d399",
  removed: "#fb7185",
  modified: "#fbbf24",
  renamed: "#38bdf8",
  unchanged: null,
};
const ARC_SEGMENTS = 16;
/** A box can't have zero height in a matrix the renderer inverts. */
const MIN_SCALE = 1e-4;

function writeBox(matrix: THREE.Matrix4, box: Box) {
  matrix.makeScale(
    Math.max(box.width, MIN_SCALE),
    Math.max(box.height, MIN_SCALE),
    Math.max(box.depth, MIN_SCALE),
  );
  matrix.setPosition(box.x, box.y, box.z);
}

function arcs(edges: readonly { source: string; target: string }[], city: CityLayout) {
  const byId = new Map(city.buildings.map((b) => [b.id, b]));
  const positions: number[] = [];
  for (const { source, target } of edges) {
    const a = byId.get(source);
    const b = byId.get(target);
    if (!a || !b) continue;
    const [from, to] = [roofOf(a), roofOf(b)];
    for (let i = 0; i < ARC_SEGMENTS; i++) {
      positions.push(
        ...arcPoint(from, to, i / ARC_SEGMENTS),
        ...arcPoint(from, to, (i + 1) / ARC_SEGMENTS),
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

interface TransitionLayerProps {
  plan: TransitionPlan;
  from: CityLayout;
  to: CityLayout;
  /** Dependencies that went away (in the old layout) and appeared (in the new one). */
  removedEdges: readonly { source: string; target: string }[];
  addedEdges: readonly { source: string; target: string }[];
  durationMs: number;
  radius: number;
  onDone: () => void;
}

/**
 * Plays one step of history: buildings move with their districts, added files rise, removed ones
 * sink, changed ones resize, and dependency arcs fade out or in. Every frame only rewrites
 * instance matrices; nothing is rebuilt.
 */
export function TransitionLayer({
  plan,
  from,
  to,
  removedEdges,
  addedEdges,
  durationMs,
  radius,
  onDone,
}: TransitionLayerProps) {
  const buildings = useRef<THREE.InstancedMesh>(null);
  const plates = useRef<THREE.InstancedMesh>(null);
  const removedLines = useRef<THREE.LineBasicMaterial>(null);
  const addedLines = useRef<THREE.LineBasicMaterial>(null);
  const started = useRef<number | null>(null);
  const finished = useRef(false);
  const invalidate = useThree((s) => s.invalidate);

  const tiers = useMemo(
    () => plan.buildings.flatMap((b) => b.tiers.map((tier) => ({ ...tier, building: b }))),
    [plan],
  );

  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const style = new Float32Array(tiers.length * 3);
    tiers.forEach((tier, i) => {
      const b: Building = tier.building.style;
      style[i * 3] = FILE_CATEGORIES.indexOf(b.category);
      style[i * 3 + 1] = b.seed;
      style[i * 3 + 2] = b.landmark ? 1 : 0;
    });
    box.setAttribute("aStyle", new THREE.InstancedBufferAttribute(style, 3));
    return box;
  }, [tiers]);
  const plateGeometry = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    return box;
  }, []);
  const material = useMemo(() => createBuildingMaterial(radius), [radius]);
  const plateMaterial = useMemo(() => createPlateMaterial(), []);
  const removedGeometry = useMemo(() => arcs(removedEdges, from), [removedEdges, from]);
  const addedGeometry = useMemo(() => arcs(addedEdges, to), [addedEdges, to]);

  useEffect(
    () => () => {
      for (const disposable of [
        geometry,
        plateGeometry,
        material,
        plateMaterial,
        removedGeometry,
        addedGeometry,
      ]) {
        disposable.dispose();
      }
    },
    [geometry, plateGeometry, material, plateMaterial, removedGeometry, addedGeometry],
  );

  // Colours are fixed for the whole step: change shows through tint, motion through position.
  useLayoutEffect(() => {
    const mesh = buildings.current;
    if (!mesh) return;
    const color = new THREE.Color();
    tiers.forEach((tier, i) => {
      const tint = CHANGE_COLORS[tier.building.change];
      color.set(tier.building.color);
      if (tint) color.lerp(new THREE.Color(tint), 0.75).multiplyScalar(1.35);
      mesh.setColorAt(i, color);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const plateMesh = plates.current;
    if (plateMesh) {
      plan.districts.forEach((d, i) => plateMesh.setColorAt(i, color.set(d.color)));
      if (plateMesh.instanceColor) plateMesh.instanceColor.needsUpdate = true;
    }
    started.current = null;
    finished.current = false;
    invalidate();
  }, [tiers, plan, invalidate]);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime * 1000;
    started.current ??= now;
    const progress = Math.min(1, (now - started.current) / durationMs);
    const t = ease(progress);
    const matrix = new THREE.Matrix4();

    const mesh = buildings.current;
    if (mesh) {
      tiers.forEach((tier, i) => {
        writeBox(matrix, lerpBox(tier.from, tier.to, t));
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    const plateMesh = plates.current;
    if (plateMesh) {
      plan.districts.forEach((d, i) => {
        writeBox(matrix, lerpBox(d.from, d.to, t));
        plateMesh.setMatrixAt(i, matrix);
      });
      plateMesh.instanceMatrix.needsUpdate = true;
    }
    if (removedLines.current) removedLines.current.opacity = 0.9 * (1 - t);
    if (addedLines.current) addedLines.current.opacity = 0.9 * t;

    if (progress >= 1 && !finished.current) {
      finished.current = true;
      onDone();
    }
  });

  return (
    <group>
      {plan.districts.length > 0 && (
        <instancedMesh
          key={`plates-${plan.districts.length}`}
          ref={plates}
          args={[plateGeometry, plateMaterial, plan.districts.length]}
          raycast={() => null}
        />
      )}
      {tiers.length > 0 && (
        <instancedMesh
          key={`tiers-${tiers.length}`}
          ref={buildings}
          args={[geometry, material, tiers.length]}
          raycast={() => null}
        />
      )}
      <lineSegments geometry={removedGeometry} raycast={() => null}>
        <lineBasicMaterial
          ref={removedLines}
          color={CHANGE_COLORS.removed!}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </lineSegments>
      <lineSegments geometry={addedGeometry} raycast={() => null}>
        <lineBasicMaterial
          ref={addedLines}
          color={CHANGE_COLORS.added!}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}
