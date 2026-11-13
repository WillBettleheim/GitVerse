"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { arcPoint, arcTangent, roofOf, type Vec3 } from "@/lib/city/arcs";
import type { EdgeRole, RoleEdge } from "@/lib/graph/dependencies";
import type { Building, Connection } from "@/lib/city/layout";

const OUTGOING = new THREE.Color("#22d3ee");
const INCOMING = new THREE.Color("#a78bfa");
const CYCLE = new THREE.Color("#fbbf24");
const ROLE_COLORS: Record<EdgeRole, THREE.Color> = {
  import: OUTGOING,
  importer: INCOMING,
  cycle: CYCLE,
};
const colorForRole = (edge: Connection) => ROLE_COLORS[(edge as RoleEdge).role] ?? OUTGOING;
const ARROW_T = 0.86;
const ARROW_SIZE_PX = 13;
const UP = new THREE.Vector3(0, 1, 0);

/** Enough for any real file. A file with more still lists them all in the inspector. */
export const MAX_ACTIVE_CONNECTIONS = 240;

function buildArcGeometry(
  connections: readonly Connection[],
  byId: ReadonlyMap<string, Building>,
  segments: number,
  colorFor: (connection: Connection) => THREE.Color,
) {
  const positions: number[] = [];
  const colors: number[] = [];
  const progress: number[] = [];
  for (const connection of connections) {
    const [from, to] = [byId.get(connection.source), byId.get(connection.target)];
    if (!from || !to) continue;
    const [a, b] = [roofOf(from), roofOf(to)];
    const color = colorFor(connection);
    for (let i = 0; i < segments; i++) {
      const [t0, t1] = [i / segments, (i + 1) / segments];
      positions.push(...arcPoint(a, b, t0), ...arcPoint(a, b, t1));
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      progress.push(t0, t1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aProgress", new THREE.Float32BufferAttribute(progress, 1));
  return geometry;
}

const TUBE_SIDES = 5;
const TUBE_SEGMENTS = 24;
const TUBE_RADIUS_PX = 1.15;

/**
 * One merged mesh of tubes, because WebGL can't draw lines wider than a pixel. Vertices sit on the
 * arc's centre line and carry an outward direction, so the shader can hold them to a constant
 * width on screen at any zoom.
 */
function buildTubeGeometry(
  connections: readonly Connection[],
  byId: ReadonlyMap<string, Building>,
  colorFor: (connection: Connection) => THREE.Color,
) {
  const positions: number[] = [];
  const offsets: number[] = [];
  const colors: number[] = [];
  const progress: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  let base = 0;
  for (const connection of connections) {
    const [from, to] = [byId.get(connection.source), byId.get(connection.target)];
    if (!from || !to) continue;
    const [a, b] = [roofOf(from), roofOf(to)];
    const color = colorFor(connection);
    for (let i = 0; i <= TUBE_SEGMENTS; i++) {
      const t = i / TUBE_SEGMENTS;
      const center = arcPoint(a, b, t);
      tangent.set(...arcTangent(a, b, t));
      side.crossVectors(tangent, up);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      normal.crossVectors(side, tangent).normalize();
      for (let k = 0; k < TUBE_SIDES; k++) {
        const angle = (k / TUBE_SIDES) * Math.PI * 2;
        const [c, s] = [Math.cos(angle), Math.sin(angle)];
        positions.push(...center);
        offsets.push(
          side.x * c + normal.x * s,
          side.y * c + normal.y * s,
          side.z * c + normal.z * s,
        );
        colors.push(color.r, color.g, color.b);
        progress.push(t);
      }
    }
    for (let i = 0; i < TUBE_SEGMENTS; i++) {
      for (let k = 0; k < TUBE_SIDES; k++) {
        const next = (k + 1) % TUBE_SIDES;
        const [p, q] = [base + i * TUBE_SIDES, base + (i + 1) * TUBE_SIDES];
        indices.push(p + k, q + k, p + next, p + next, q + k, q + next);
      }
    }
    base += (TUBE_SEGMENTS + 1) * TUBE_SIDES;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aOffset", new THREE.Float32BufferAttribute(offsets, 3));
  geometry.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aProgress", new THREE.Float32BufferAttribute(progress, 1));
  geometry.setIndex(indices);
  // The centre line is close enough: these are never raycast, and only culling reads this.
  geometry.computeBoundingSphere();
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

const tubeVertexShader = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec3 aColor;
  attribute float aProgress;
  uniform float uRadiusPx;
  uniform float uViewportHeight;
  varying vec3 vColor;
  varying float vProgress;
  void main() {
    vColor = aColor;
    vProgress = aProgress;
    // For an orthographic camera, projectionMatrix[1][1] is 2 / (visible world height).
    float worldPerPixel = 2.0 / (projectionMatrix[1][1] * uViewportHeight);
    vec3 world = position + aOffset * uRadiusPx * worldPerPixel;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`;

/** Rotation and position come from the instance. Size is in pixels, so it holds at any zoom. */
const arrowVertexShader = /* glsl */ `
  uniform float uSizePx;
  uniform float uViewportHeight;
  varying vec3 vColor;
  void main() {
    vColor = instanceColor;
    float worldPerPixel = 2.0 / (projectionMatrix[1][1] * uViewportHeight);
    vec4 world = modelMatrix * instanceMatrix * vec4(position * uSizePx * worldPerPixel, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const arrowFragmentShader = /* glsl */ `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
    #include <colorspace_fragment>
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uPulse;
  varying vec3 vColor;
  varying float vProgress;
  void main() {
    // Brightening towards the imported file shows direction even when nothing moves.
    float ramp = 0.25 + vProgress * 0.75;
    // Pulses travel the same way when motion is allowed.
    float wave = pow(0.5 + 0.5 * sin(vProgress * 18.0 - uTime * 3.2), 3.0);
    float glow = mix(ramp, 0.5 + wave * 1.5, uPulse);
    gl_FragColor = vec4(vColor * glow, uOpacity);
    #include <colorspace_fragment>
  }
`;

interface ConnectionsProps {
  buildings: readonly Building[];
  /** Shown when nothing is active. May be a subset, for dense graphs. */
  ambient: readonly Connection[];
  ambientOpacity: number;
  /** The selection's or hover's edges, coloured by their role in the traversal. */
  active: readonly RoleEdge[];
  segments: number;
  animate: boolean;
}

export const Connections = memo(function Connections({
  buildings,
  ambient,
  ambientOpacity,
  active,
  segments,
  animate,
}: ConnectionsProps) {
  const byId = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);

  const ambientGeometry = useMemo(
    () => buildArcGeometry(ambient, byId, segments, () => OUTGOING),
    [ambient, byId, segments],
  );
  useEffect(() => () => ambientGeometry.dispose(), [ambientGeometry]);

  const related = useMemo(() => active.slice(0, MAX_ACTIVE_CONNECTIONS), [active]);
  const colorFor = colorForRole;
  const activeGeometry = useMemo(
    // Active arcs stay smooth at every quality tier: there are few of them.
    () => (related.length > 0 ? buildTubeGeometry(related, byId, colorFor) : null),
    [related, byId, colorFor],
  );
  useEffect(() => () => activeGeometry?.dispose(), [activeGeometry]);

  return (
    <>
      {ambient.length > 0 && (
        <LineLayer
          geometry={ambientGeometry}
          opacity={active.length > 0 ? ambientOpacity * 0.2 : ambientOpacity}
        />
      )}
      {activeGeometry && (
        <>
          <ActiveTubes geometry={activeGeometry} animate={animate} />
          <Arrowheads connections={related} byId={byId} colorFor={colorFor} />
        </>
      )}
    </>
  );
});

function LineLayer({ geometry, opacity }: { geometry: THREE.BufferGeometry; opacity: number }) {
  const [uniforms] = useState(() => ({
    uTime: { value: 0 },
    uOpacity: { value: opacity },
    uPulse: { value: 0 },
  }));

  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        uniforms-uOpacity-value={opacity}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </lineSegments>
  );
}

/** Drawn over the buildings, so an active file's links are never hidden behind a tower. */
function ActiveTubes({ geometry, animate }: { geometry: THREE.BufferGeometry; animate: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const viewportHeight = useThree((state) => state.size.height);
  const [uniforms] = useState(() => ({
    uTime: { value: 0 },
    uOpacity: { value: 1 },
    uPulse: { value: 1 },
    uRadiusPx: { value: TUBE_RADIUS_PX },
    uViewportHeight: { value: viewportHeight },
  }));

  useFrame(({ clock }) => {
    if (animate && material.current) material.current.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <mesh geometry={geometry} raycast={() => null} renderOrder={10}>
      <shaderMaterial
        ref={material}
        vertexShader={tubeVertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        uniforms-uViewportHeight-value={viewportHeight}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Direction that still reads with motion off, or in a still image. */
function Arrowheads({
  connections,
  byId,
  colorFor,
}: {
  connections: readonly Connection[];
  byId: ReadonlyMap<string, Building>;
  colorFor: (connection: Connection) => THREE.Color;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const viewportHeight = useThree((state) => state.size.height);
  const [uniforms] = useState(() => ({
    uSizePx: { value: ARROW_SIZE_PX },
    uViewportHeight: { value: viewportHeight },
  }));
  const geometry = useMemo(() => new THREE.ConeGeometry(0.38, 1, 8), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const dummy = new THREE.Object3D();
    const direction = new THREE.Vector3();
    connections.forEach((connection, index) => {
      const from = byId.get(connection.source);
      const to = byId.get(connection.target);
      if (!from || !to) return;
      const [a, b]: [Vec3, Vec3] = [roofOf(from), roofOf(to)];
      dummy.position.set(...arcPoint(a, b, ARROW_T));
      dummy.quaternion.setFromUnitVectors(UP, direction.set(...arcTangent(a, b, ARROW_T)));
      dummy.updateMatrix();
      target.setMatrixAt(index, dummy.matrix);
      target.setColorAt(index, colorFor(connection));
    });
    target.instanceMatrix.needsUpdate = true;
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
    invalidate();
  }, [connections, byId, colorFor, invalidate]);

  return (
    <instancedMesh
      key={connections.length}
      ref={mesh}
      args={[geometry, undefined, connections.length]}
      raycast={() => null}
      renderOrder={11}
    >
      <shaderMaterial
        vertexShader={arrowVertexShader}
        fragmentShader={arrowFragmentShader}
        uniforms={uniforms}
        uniforms-uViewportHeight-value={viewportHeight}
        toneMapped={false}
        depthTest={false}
        transparent
      />
    </instancedMesh>
  );
}
