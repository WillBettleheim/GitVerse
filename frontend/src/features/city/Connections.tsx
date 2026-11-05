"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Building, Connection } from "@/lib/city/layout";

const SEGMENTS = 18;
const OUTGOING = new THREE.Color("#22d3ee");
const INCOMING = new THREE.Color("#a78bfa");

/** A rooftop-to-rooftop arc as line-segment pairs. `t` runs 0→1 from importer to imported. */
function appendArc(
  from: Building,
  to: Building,
  color: THREE.Color,
  positions: number[],
  colors: number[],
  progress: number[],
) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const lift = Math.max(from.height, to.height) + 1.5 + distance * 0.22;
  const point = (t: number): [number, number, number] => {
    const baseY = from.height + (to.height - from.height) * t;
    return [
      from.x + (to.x - from.x) * t,
      baseY + (lift - Math.max(baseY, 0)) * 4 * t * (1 - t),
      from.z + (to.z - from.z) * t,
    ];
  };
  for (let i = 0; i < SEGMENTS; i++) {
    const [t0, t1] = [i / SEGMENTS, (i + 1) / SEGMENTS];
    positions.push(...point(t0), ...point(t1));
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    progress.push(t0, t1);
  }
}

function buildGeometry(
  connections: readonly Connection[],
  byId: ReadonlyMap<string, Building>,
  colorFor: (connection: Connection) => THREE.Color,
) {
  const positions: number[] = [];
  const colors: number[] = [];
  const progress: number[] = [];
  for (const connection of connections) {
    const [from, to] = [byId.get(connection.source), byId.get(connection.target)];
    if (from && to) appendArc(from, to, colorFor(connection), positions, colors, progress);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aProgress", new THREE.Float32BufferAttribute(progress, 1));
  return geometry;
}

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute float aProgress;
  varying vec3 vColor;
  varying float vProgress;
  void main() {
    vColor = aColor;
    vProgress = aProgress;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uPulse;
  varying vec3 vColor;
  varying float vProgress;
  void main() {
    // Pulses travel from importer to imported, so direction is readable.
    float wave = pow(0.5 + 0.5 * sin(vProgress * 16.0 - uTime * 3.0), 3.0);
    float glow = mix(1.0, 0.45 + wave * 1.4, uPulse);
    gl_FragColor = vec4(vColor * glow, uOpacity);
    #include <colorspace_fragment>
  }
`;

interface ConnectionsProps {
  buildings: readonly Building[];
  connections: readonly Connection[];
  /** The file whose connections are highlighted. */
  activeId: string | null;
  animate: boolean;
}

export function Connections({ buildings, connections, activeId, animate }: ConnectionsProps) {
  const byId = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);

  const ambient = useMemo(
    () => buildGeometry(connections, byId, () => OUTGOING),
    [connections, byId],
  );

  const active = useMemo(() => {
    if (!activeId) return null;
    const related = connections.filter((c) => c.source === activeId || c.target === activeId);
    return buildGeometry(related, byId, (c) => (c.source === activeId ? OUTGOING : INCOMING));
  }, [connections, byId, activeId]);

  useEffect(() => () => ambient.dispose(), [ambient]);
  useEffect(() => () => active?.dispose(), [active]);
  return (
    <>
      <LineLayer geometry={ambient} opacity={activeId ? 0.05 : 0.2} pulse={0} animate={false} />
      {active && <LineLayer geometry={active} opacity={1} pulse={1} animate={animate} />}
    </>
  );
}

interface LineLayerProps {
  geometry: THREE.BufferGeometry;
  opacity: number;
  pulse: number;
  animate: boolean;
}

function LineLayer({ geometry, opacity, pulse, animate }: LineLayerProps) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const [uniforms] = useState(() => ({
    uTime: { value: 0 },
    uOpacity: { value: opacity },
    uPulse: { value: pulse },
  }));

  useFrame(({ clock }) => {
    if (!material.current) return;
    material.current.uniforms.uOpacity.value = opacity;
    if (animate) material.current.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <shaderMaterial
        ref={material}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </lineSegments>
  );
}
