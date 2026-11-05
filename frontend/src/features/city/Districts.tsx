"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { District } from "@/lib/city/layout";

const PLATE_Y = 0.02;
const BORDER_Y = 0.05;

/** All district outlines share one geometry. */
function buildBorders(districts: readonly District[]) {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  for (const d of districts) {
    const [x0, x1] = [d.x - d.width / 2, d.x + d.width / 2];
    const [z0, z1] = [d.z - d.depth / 2, d.z + d.depth / 2];
    positions.push(
      x0, BORDER_Y, z0, x1, BORDER_Y, z0,
      x1, BORDER_Y, z0, x1, BORDER_Y, z1,
      x1, BORDER_Y, z1, x0, BORDER_Y, z1,
      x0, BORDER_Y, z1, x0, BORDER_Y, z0,
    );
    color.set(d.color).multiplyScalar(0.7);
    for (let i = 0; i < 8; i++) colors.push(color.r, color.g, color.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

export function Districts({ districts }: { districts: readonly District[] }) {
  const borders = useMemo(() => buildBorders(districts), [districts]);
  useEffect(() => () => borders.dispose(), [borders]);

  return (
    <group>
      {districts.map((d) => (
        <mesh key={d.id} position={[d.x, PLATE_Y, d.z]} rotation-x={-Math.PI / 2} raycast={() => null}>
          <planeGeometry args={[d.width, d.depth]} />
          <meshBasicMaterial color={d.color} transparent opacity={0.05} depthWrite={false} />
        </mesh>
      ))}
      <lineSegments geometry={borders} raycast={() => null}>
        <lineBasicMaterial vertexColors transparent opacity={0.8} />
      </lineSegments>
    </group>
  );
}
