"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

export interface LabelAnchor {
  key: string;
  position: readonly [number, number, number];
  /** Centre above the point and keep inside the view, rather than hanging from it. */
  floating: boolean;
}

const scratch = new THREE.Vector3();
const LABEL_PADDING = 3;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const collides = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const EDGE_MARGIN = 8;
const FLOAT_GAP = 10;

/**
 * Pins plain DOM labels to world positions by writing their transforms each frame. The overlay
 * renders one child per anchor, in order. This avoids a separate React root per label and never
 * re-renders React as the camera moves. Anchors come in priority order: a label that would land
 * on an earlier one is hidden until the view makes room for it.
 */
export function LabelProjector({
  anchors,
  overlay,
}: {
  anchors: readonly LabelAnchor[];
  overlay: RefObject<HTMLDivElement | null>;
}) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => invalidate(), [anchors, invalidate]);
  // Label text doesn't change, so its size only needs measuring once.
  const sizes = useRef(new WeakMap<Element, { width: number; height: number }>());

  useFrame(({ camera, size }) => {
    const elements = overlay.current?.children;
    if (!elements) return;
    const placed: Rect[] = [];
    anchors.forEach((anchor, index) => {
      const element = elements[index] as HTMLElement | undefined;
      if (!element) return;
      scratch.set(...anchor.position).project(camera);
      element.style.display = "block";
      let x = (scratch.x * 0.5 + 0.5) * size.width;
      let y = (-scratch.y * 0.5 + 0.5) * size.height;
      if (anchor.floating) {
        const { offsetWidth: w, offsetHeight: h } = element;
        x = Math.min(size.width - w - EDGE_MARGIN, Math.max(EDGE_MARGIN, x - w / 2));
        y = y - h - FLOAT_GAP;
        // Flip underneath when there's no room above.
        if (y < EDGE_MARGIN) y = y + h + FLOAT_GAP * 2;
        y = Math.max(EDGE_MARGIN, Math.min(size.height - h - EDGE_MARGIN, y));
      }
      if (!anchor.floating) {
        let size = sizes.current.get(element);
        if (!size) {
          size = { width: element.offsetWidth, height: element.offsetHeight };
          sizes.current.set(element, size);
        }
        const rect = {
          x: x - LABEL_PADDING,
          y: y - LABEL_PADDING,
          width: size.width + LABEL_PADDING * 2,
          height: size.height + LABEL_PADDING * 2,
        };
        const free = !placed.some((other) => collides(rect, other));
        if (free) placed.push(rect);
        // Opacity, because the CSS class hides district labels on phones through visibility.
        element.style.opacity = free ? "1" : "0";
      }
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });
  });
  return null;
}
