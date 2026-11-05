"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Building, CityLayout } from "@/lib/city/layout";

export const HERO_SCALE = 0.78;
const EXPLORER_SCALE = 1.5;

/** Backs off in tall viewports, so the whole city still fits horizontally. */
function explorerScale(aspect: number) {
  return EXPLORER_SCALE / Math.min(1, aspect);
}

/** A fixed three-quarter view scaled to the city, so every city opens the same way. */
export function homePosition(bounds: CityLayout["bounds"], scale = 1) {
  const distance = Math.max(bounds.radius, 10) * scale;
  return new THREE.Vector3(distance * 0.82, distance * 0.78 + bounds.maxHeight * 0.4, distance * 0.98);
}

interface OrbitRigProps {
  bounds: CityLayout["bounds"];
  focus: Building | null;
  resetCount: number;
  reducedMotion: boolean;
}

export function OrbitRig({ bounds, focus, resetCount, reducedMotion }: OrbitRigProps) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((state) => state.camera);
  const get = useThree((state) => state.get);

  // Where the camera is gliding to. Cleared once it lands or the user takes over.
  const glide = useRef<{ target: THREE.Vector3; position: THREE.Vector3 | null } | null>(null);

  useLayoutEffect(() => {
    const { camera: current, size } = get();
    current.position.copy(homePosition(bounds, explorerScale(size.width / size.height)));
  }, [bounds, get]);

  useEffect(() => {
    if (!focus) return;
    glide.current = {
      target: new THREE.Vector3(focus.x, focus.height * 0.5, focus.z),
      position: null,
    };
  }, [focus]);

  useEffect(() => {
    if (resetCount === 0) return;
    const { size } = get();
    glide.current = {
      target: new THREE.Vector3(0, 0, 0),
      position: homePosition(bounds, explorerScale(size.width / size.height)),
    };
  }, [resetCount, bounds, get]);

  useFrame((_, delta) => {
    const current = glide.current;
    const orbit = controls.current;
    if (!current || !orbit) return;

    const amount = reducedMotion ? 1 : 1 - Math.exp(-delta * 4);
    orbit.target.lerp(current.target, amount);
    if (current.position) camera.position.lerp(current.position, amount);
    orbit.update();

    const settled =
      orbit.target.distanceTo(current.target) < 0.02 &&
      (!current.position || camera.position.distanceTo(current.position) < 0.05);
    if (settled) glide.current = null;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      maxPolarAngle={Math.PI / 2.1}
      minDistance={8}
      maxDistance={Math.max(bounds.radius, 10) * 4}
      onStart={() => {
        glide.current = null;
      }}
    />
  );
}

/** Slow, non-interactive orbit for the landing page. Still when reduced motion is requested. */
export function HeroRig({ bounds, reducedMotion }: { bounds: CityLayout["bounds"]; reducedMotion: boolean }) {
  const home = useRef(homePosition(bounds, HERO_SCALE));
  const { camera } = useThree();

  useFrame(({ clock }) => {
    const angle = Math.atan2(home.current.x, home.current.z) + (reducedMotion ? 0 : clock.elapsedTime * 0.035);
    const radius = Math.hypot(home.current.x, home.current.z);
    camera.position.set(Math.sin(angle) * radius, home.current.y, Math.cos(angle) * radius);
    camera.lookAt(0, bounds.maxHeight * 0.1, 0);
  });

  return null;
}
