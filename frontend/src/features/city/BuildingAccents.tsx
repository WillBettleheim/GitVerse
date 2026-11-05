"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { Highlight } from "@/lib/city/highlight";
import type { Building } from "@/lib/city/layout";

const BEACON_WIDTH = 0.28;
const BEACON_MIN_WIDTH_PX = 2.5;
const BEACON_HEIGHT = 4;
const GLOW_SCALE = 2.6;

const beaconVertex = /* glsl */ `
  uniform float uMinWidthPx;
  uniform float uWidth;
  uniform float uViewportHeight;
  varying vec3 vTint;
  void main() {
    vTint = instanceColor;
    float worldPerPixel = 2.0 / (projectionMatrix[1][1] * uViewportHeight);
    // A fixed world width up close, but never thinner than a visible line from far out.
    float width = max(uWidth, uMinWidthPx * worldPerPixel);
    vec3 local = vec3(position.x * width, position.y, position.z * width);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(local, 1.0);
  }
`;

const beaconFragment = /* glsl */ `
  varying vec3 vTint;
  void main() {
    gl_FragColor = vec4(vTint, 1.0);
    #include <colorspace_fragment>
  }
`;

/** A slim light rising from each landmark's roof, marking the most depended-on modules. */
export const Beacons = memo(function Beacons({
  buildings,
  highlight,
  scale,
}: {
  buildings: readonly Building[];
  highlight: Highlight;
  scale: number;
}) {
  const landmarks = useMemo(() => buildings.filter((b) => b.landmark), [buildings]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const viewportHeight = useThree((state) => state.size.height);
  const [uniforms] = useState(() => ({
    uMinWidthPx: { value: BEACON_MIN_WIDTH_PX },
    uWidth: { value: BEACON_WIDTH },
    uViewportHeight: { value: viewportHeight },
  }));

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
    const color = new THREE.Color();
    landmarks.forEach((b, index) => {
      // Width is set in the shader.
      matrix.makeScale(1, BEACON_HEIGHT * Math.sqrt(scale), 1);
      matrix.setPosition(b.x, b.baseY + b.height, b.z);
      target.setMatrixAt(index, matrix);
      const dimmed = highlight.stateOf(b.id) === "dimmed";
      target.setColorAt(index, color.set(b.color).lerp(WHITE, 0.3).multiplyScalar(dimmed ? 0.12 : 1.15));
    });
    target.instanceMatrix.needsUpdate = true;
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
    invalidate();
  }, [landmarks, highlight, scale, invalidate]);

  if (landmarks.length === 0) return null;

  return (
    <instancedMesh
      key={landmarks.length}
      ref={mesh}
      args={[geometry, undefined, landmarks.length]}
      raycast={() => null}
    >
      <shaderMaterial
        vertexShader={beaconVertex}
        fragmentShader={beaconFragment}
        uniforms={uniforms}
        uniforms-uViewportHeight-value={viewportHeight}
        toneMapped={false}
      />
    </instancedMesh>
  );
});

const WHITE = new THREE.Color("#ffffff");

const glowVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vTint;
  void main() {
    vUv = uv;
    vTint = instanceColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const glowFragment = /* glsl */ `
  uniform float uIntensity;
  varying vec2 vUv;
  varying vec3 vTint;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float falloff = pow(max(0.0, 1.0 - d), 2.0);
    gl_FragColor = vec4(vTint, falloff * uIntensity);
    #include <colorspace_fragment>
  }
`;

/** A soft pool of light at each building's foot. Cheap stand-in for a bloom pass. */
export const GroundGlow = memo(function GroundGlow({
  buildings,
  dimmed,
}: {
  buildings: readonly Building[];
  dimmed: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const [uniforms] = useState(() => ({ uIntensity: { value: 0.3 } }));

  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    return plane;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    buildings.forEach((b, index) => {
      matrix.makeScale(b.width * GLOW_SCALE, 1, b.depth * GLOW_SCALE);
      matrix.setPosition(b.x, b.baseY + 0.02, b.z);
      target.setMatrixAt(index, matrix);
      target.setColorAt(index, color.set(b.color));
    });
    target.instanceMatrix.needsUpdate = true;
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
    invalidate();
  }, [buildings, invalidate]);

  if (buildings.length === 0) return null;

  return (
    <instancedMesh
      key={buildings.length}
      ref={mesh}
      args={[geometry, undefined, buildings.length]}
      raycast={() => null}
    >
      <shaderMaterial
        vertexShader={glowVertex}
        fragmentShader={glowFragment}
        uniforms={uniforms}
        uniforms-uIntensity-value={dimmed ? 0.08 : 0.3}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </instancedMesh>
  );
});
