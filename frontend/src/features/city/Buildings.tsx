"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { FILE_CATEGORIES } from "@/lib/graph/classify";
import type { Highlight, HighlightState } from "@/lib/city/highlight";
import type { Building } from "@/lib/city/layout";
import { createBuildingMaterial } from "./building-material";

const CLICK_DRAG_TOLERANCE_PX = 4;
const CYAN = new THREE.Color("#22d3ee");
const VIOLET = new THREE.Color("#a78bfa");
const WHITE = new THREE.Color("#ffffff");
const AMBER = new THREE.Color("#fbbf24");
const EMERALD = new THREE.Color("#34d399");
const SKY = new THREE.Color("#38bdf8");

/** Writes the colour a building gets in a highlight state. Reuses `out` to avoid allocation. */
export function applyHighlightColor(out: THREE.Color, base: string, state: HighlightState) {
  out.set(base);
  switch (state) {
    case "selected":
      return out.lerp(WHITE, 0.4).multiplyScalar(1.7);
    case "hovered":
      return out.lerp(WHITE, 0.25).multiplyScalar(1.5);
    case "dependency":
      return out.lerp(CYAN, 0.7).multiplyScalar(1.25);
    case "dependent":
      return out.lerp(VIOLET, 0.7).multiplyScalar(1.25);
    case "dependency-far":
      return out.lerp(CYAN, 0.45).multiplyScalar(0.7);
    case "dependent-far":
      return out.lerp(VIOLET, 0.45).multiplyScalar(0.7);
    case "cycle":
      return out.lerp(AMBER, 0.75).multiplyScalar(1.3);
    case "match":
      return out.lerp(WHITE, 0.3).multiplyScalar(1.45);
    case "added":
      return out.lerp(EMERALD, 0.75).multiplyScalar(1.35);
    case "modified":
      return out.lerp(AMBER, 0.6).multiplyScalar(1.2);
    case "renamed":
      return out.lerp(SKY, 0.7).multiplyScalar(1.3);
    case "dimmed":
      return out.multiplyScalar(0.14);
    default:
      return out;
  }
}

interface BuildingsProps {
  buildings: readonly Building[];
  highlight: Highlight;
  radius: number;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
}

/**
 * One instanced mesh, so draw calls don't grow with file count. Each building's tiers are
 * separate instances, and an index maps an instance back to its building.
 */
export const Buildings = memo(function Buildings({
  buildings,
  highlight,
  radius,
  onHover,
  onSelect,
}: BuildingsProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);

  const owners = useMemo(() => {
    const list: number[] = [];
    buildings.forEach((b, index) => b.tiers.forEach(() => list.push(index)));
    return Int32Array.from(list);
  }, [buildings]);

  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0); // Base at y=0, so scaling grows upward.
    const style = new Float32Array(owners.length * 3);
    owners.forEach((owner, index) => {
      const b = buildings[owner];
      style[index * 3] = FILE_CATEGORIES.indexOf(b.category);
      style[index * 3 + 1] = b.seed;
      style[index * 3 + 2] = b.landmark ? 1 : 0;
    });
    box.setAttribute("aStyle", new THREE.InstancedBufferAttribute(style, 3));
    return box;
  }, [buildings, owners]);

  const material = useMemo(() => createBuildingMaterial(radius), [radius]);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (const b of buildings) {
      for (const tier of b.tiers) {
        matrix.makeScale(tier.width, tier.height, tier.depth);
        matrix.setPosition(b.x, b.baseY + tier.y, b.z);
        target.setMatrixAt(index++, matrix);
      }
    }
    target.instanceMatrix.needsUpdate = true;
    target.computeBoundingSphere();
    target.computeBoundingBox();
  }, [buildings]);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const color = new THREE.Color();
    owners.forEach((owner, index) => {
      const b = buildings[owner];
      target.setColorAt(index, applyHighlightColor(color, b.color, highlight.stateOf(b.id)));
    });
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
    invalidate();
  }, [buildings, owners, highlight, invalidate]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const idAt = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (event.instanceId === undefined) return null;
    return buildings[owners[event.instanceId]]?.id ?? null;
  };

  if (owners.length === 0) return null;

  return (
    <instancedMesh
      key={owners.length}
      ref={mesh}
      args={[geometry, material, owners.length]}
      onPointerMove={(event) => {
        event.stopPropagation();
        onHover?.(idAt(event));
      }}
      onPointerOut={() => onHover?.(null)}
      onClick={(event) => {
        if (event.delta > CLICK_DRAG_TOLERANCE_PX) return;
        event.stopPropagation();
        const id = idAt(event);
        if (id) onSelect?.(id);
      }}
    />
  );
});
