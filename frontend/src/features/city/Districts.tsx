"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { District } from "@/lib/city/layout";

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalLocal;
  varying vec3 vSize;
  varying vec3 vTint;
  void main() {
    vLocal = position;
    vNormalLocal = normal;
    vSize = vec3(
      length(instanceMatrix[0].xyz),
      length(instanceMatrix[1].xyz),
      length(instanceMatrix[2].xyz)
    );
    vTint = instanceColor;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uDim;
  varying vec3 vLocal;
  varying vec3 vNormalLocal;
  varying vec3 vSize;
  varying vec3 vTint;
  void main() {
    vec3 color;
    if (vNormalLocal.y > 0.5) {
      vec2 toEdge = (0.5 - abs(vLocal.xz)) * vSize.xz;
      float edge = min(toEdge.x, toEdge.y);
      float rim = 1.0 - smoothstep(0.0, 0.16, edge);
      float wash = (1.0 - smoothstep(0.0, 2.2, edge)) * 0.05;
      color = vTint * (0.04 + wash + rim * 0.8);
    } else {
      color = vTint * 0.3;
    }
    gl_FragColor = vec4(color * uDim, 1.0);
    #include <colorspace_fragment>
  }
`;

interface DistrictsProps {
  districts: readonly District[];
  activeDistrictId: string | null;
  dimmed: boolean;
}

/** Terraced plots, one level higher per folder depth. All one instanced mesh. */
export const Districts = memo(function Districts({
  districts,
  activeDistrictId,
  dimmed,
}: DistrictsProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const [uniforms] = useState(() => ({ uDim: { value: 1 } }));

  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    return box;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const matrix = new THREE.Matrix4();
    districts.forEach((d, index) => {
      matrix.makeScale(d.width, d.plateHeight, d.depth);
      matrix.setPosition(d.x, d.baseY, d.z);
      target.setMatrixAt(index, matrix);
    });
    target.instanceMatrix.needsUpdate = true;
  }, [districts]);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const color = new THREE.Color();
    districts.forEach((d, index) => {
      // Plates dim with the city, except the one holding the active file.
      const boost = d.id === activeDistrictId ? (dimmed ? 3 : 1.5) : 1;
      target.setColorAt(index, color.set(d.color).multiplyScalar(boost));
    });
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
    invalidate();
  }, [districts, activeDistrictId, dimmed, invalidate]);

  if (districts.length === 0) return null;

  return (
    <instancedMesh
      key={districts.length}
      ref={mesh}
      args={[geometry, undefined, districts.length]}
      raycast={() => null}
    >
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        uniforms-uDim-value={dimmed ? 0.45 : 1}
        toneMapped={false}
      />
    </instancedMesh>
  );
});
