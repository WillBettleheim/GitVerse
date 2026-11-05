"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Building } from "@/lib/city/layout";
import { createBuildingMaterial } from "./building-material";

const CLICK_DRAG_TOLERANCE_PX = 4;
const DIMMED = 0.22;
const HIGHLIGHT = 1.9;

interface BuildingsProps {
  buildings: readonly Building[];
  /** When set, buildings outside this set are dimmed. */
  focus: ReadonlySet<string> | null;
  emphasized: ReadonlySet<string>;
  fog: { color: string; near: number; far: number };
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
}

/** One instanced mesh, so draw calls don't grow with file count. */
export function Buildings({ buildings, focus, emphasized, fog, onHover, onSelect }: BuildingsProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0); // Base at y=0, so scaling grows upward.
    return box;
  }, []);
  const material = useMemo(
    () => createBuildingMaterial(fog.color, fog.near, fog.far),
    [fog.color, fog.near, fog.far],
  );

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const matrix = new THREE.Matrix4();
    buildings.forEach((b, index) => {
      matrix.makeScale(b.width, b.height, b.depth);
      matrix.setPosition(b.x, 0, b.z);
      target.setMatrixAt(index, matrix);
    });
    target.instanceMatrix.needsUpdate = true;
    target.computeBoundingSphere();
    target.computeBoundingBox();
  }, [buildings]);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const color = new THREE.Color();
    buildings.forEach((b, index) => {
      const intensity = emphasized.has(b.id) ? HIGHLIGHT : focus && !focus.has(b.id) ? DIMMED : 1;
      target.setColorAt(index, color.set(b.color).multiplyScalar(intensity));
    });
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
  }, [buildings, focus, emphasized]);

  useLayoutEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const idAt = (event: ThreeEvent<PointerEvent | MouseEvent>) =>
    event.instanceId === undefined ? null : (buildings[event.instanceId]?.id ?? null);

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, buildings.length]}
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
}
