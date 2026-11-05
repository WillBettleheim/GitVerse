"use client";

import type { RefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

export interface LabelAnchor {
  key: string;
  text: string;
  active: boolean;
  position: readonly [number, number, number];
}

const scratch = new THREE.Vector3();

/**
 * Pins plain DOM labels to world positions by writing their transforms each frame. The overlay
 * renders one child per anchor, in order. This avoids a separate React root per label and never
 * re-renders React as the camera moves.
 */
export function LabelProjector({
  anchors,
  overlay,
}: {
  anchors: readonly LabelAnchor[];
  overlay: RefObject<HTMLDivElement | null>;
}) {
  useFrame(({ camera, size }) => {
    const elements = overlay.current?.children;
    if (!elements) return;
    anchors.forEach((anchor, index) => {
      const element = elements[index] as HTMLElement | undefined;
      if (!element) return;
      scratch.set(...anchor.position).project(camera);
      element.style.display = scratch.z > 1 ? "none" : "block";
      const x = (scratch.x * 0.5 + 0.5) * size.width;
      const y = (-scratch.y * 0.5 + 0.5) * size.height;
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });
  });
  return null;
}
