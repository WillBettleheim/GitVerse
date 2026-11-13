"use client";

import { useEffect, useMemo, useRef } from "react";
import type * as THREE from "three";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  cameraDistance,
  cinematicPose,
  fitPose,
  framePose,
  focusPose,
  interpolatePose,
  ISO_ELEVATION,
  poseFromCamera,
  posesClose,
  positionForPose,
  smoothingAmount,
  zoomLimits,
  type CameraPose,
} from "@/lib/city/camera";
import type { Building, CityLayout } from "@/lib/city/layout";
import type { CameraCommand } from "@/features/explorer/store";

const HERO_ZOOM = 1.2;
const HERO_SPEED = 0.04;
const CINEMATIC_FOLLOW_RATE = 1.8;

function applyPose(
  camera: THREE.Camera,
  orbit: OrbitControlsImpl | null,
  pose: CameraPose,
  distance: number,
) {
  camera.position.set(...positionForPose(pose, distance));
  (camera as THREE.OrthographicCamera).zoom = pose.zoom;
  (camera as THREE.OrthographicCamera).updateProjectionMatrix();
  if (orbit) {
    orbit.target.set(...pose.target);
    orbit.update();
  } else {
    camera.lookAt(...pose.target);
  }
}

function readPose(camera: THREE.Camera, orbit: OrbitControlsImpl): CameraPose {
  return poseFromCamera(
    camera.position.toArray() as CameraPose["target"],
    orbit.target.toArray() as CameraPose["target"],
    (camera as THREE.OrthographicCamera).zoom,
  );
}

interface ExplorerRigProps {
  bounds: CityLayout["bounds"];
  selected: Building | null;
  command: CameraCommand;
  /** The buildings a "frame" command asks for. */
  framed: readonly Building[];
  cinematic: boolean;
  reducedMotion: boolean;
  onUserInteract: () => void;
}

export function ExplorerRig({
  bounds,
  selected,
  command,
  framed,
  cinematic,
  reducedMotion,
  onUserInteract,
}: ExplorerRigProps) {
  const controls = useRef<OrbitControlsImpl>(null);
  const get = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);

  const viewport = useMemo(() => ({ width, height }), [width, height]);
  const distance = useMemo(() => cameraDistance(bounds), [bounds]);
  const home = useMemo(() => fitPose(bounds, viewport), [bounds, viewport]);
  const limits = zoomLimits(home.zoom);

  /** Applied immediately on the next frame. */
  const jump = useRef<CameraPose | null>(null);
  /** Glided towards, then cleared. */
  const goal = useRef<CameraPose | null>(null);
  const flight = useRef<{ base: CameraPose; elapsed: number } | null>(null);
  /** Once the user has placed the view, resizing shouldn't take it away from them. */
  const userMoved = useRef(false);

  // A new layout (another snapshot, a resize) re-frames the city from the current angle, so
  // time travel keeps the orientation the user chose. Without a user camera move, it stays home.
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) {
      jump.current = home;
    } else if (!userMoved.current) {
      const current = readPose(get().camera, orbit);
      jump.current = fitPose(bounds, viewport, current.azimuth, current.elevation);
    } else {
      return;
    }
    invalidate();
  }, [home, bounds, viewport, get, invalidate]);

  useEffect(() => {
    if (!selected || !controls.current) return;
    userMoved.current = true;
    goal.current = focusPose(selected, readPose(get().camera, controls.current), viewport);
    invalidate();
  }, [selected, viewport, get, invalidate]);

  useEffect(() => {
    if (command.count === 0 || !controls.current) return;
    if (command.type === "reset") {
      userMoved.current = false;
      goal.current = home;
    } else if (command.type === "frame") {
      const pose = framePose(framed, readPose(get().camera, controls.current), viewport);
      if (!pose) return;
      userMoved.current = true;
      goal.current = pose;
    } else {
      // Fit keeps the angle the user chose.
      const current = readPose(get().camera, controls.current);
      goal.current = fitPose(bounds, viewport, current.azimuth, current.elevation);
    }
    invalidate();
    // Only a new command should trigger this, not a resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command.count]);

  useFrame((state, delta) => {
    const orbit = controls.current;
    if (!orbit) return;

    if (jump.current) {
      applyPose(state.camera, orbit, jump.current, distance);
      jump.current = null;
    }

    if (cinematic) {
      goal.current = null;
      const current = readPose(state.camera, orbit);
      flight.current ??= {
        base: { ...home, azimuth: current.azimuth, elevation: ISO_ELEVATION },
        elapsed: 0,
      };
      flight.current.elapsed += Math.min(delta, 0.1);
      const pose = cinematicPose(flight.current.base, flight.current.elapsed);
      applyPose(
        state.camera,
        orbit,
        interpolatePose(current, pose, smoothingAmount(delta, CINEMATIC_FOLLOW_RATE)),
        distance,
      );
      return;
    }
    flight.current = null;

    if (goal.current) {
      const current = readPose(state.camera, orbit);
      const next = reducedMotion
        ? goal.current
        : interpolatePose(current, goal.current, smoothingAmount(delta));
      applyPose(state.camera, orbit, next, distance);
      if (posesClose(next, goal.current)) {
        applyPose(state.camera, orbit, goal.current, distance);
        goal.current = null;
      }
      state.invalidate();
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={!reducedMotion}
      dampingFactor={0.1}
      screenSpacePanning={false}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI / 2.15}
      minZoom={limits.min}
      maxZoom={limits.max}
      onStart={() => {
        goal.current = null;
        userMoved.current = true;
        onUserInteract();
      }}
    />
  );
}

/** Slow, non-interactive orbit for the landing page. Still when reduced motion is requested. */
export function HeroRig({
  bounds,
  reducedMotion,
}: {
  bounds: CityLayout["bounds"];
  reducedMotion: boolean;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const distance = useMemo(() => cameraDistance(bounds), [bounds]);
  useEffect(() => invalidate(), [invalidate]);

  useFrame((state) => {
    const fit = fitPose(bounds, state.size);
    const pose: CameraPose = {
      ...fit,
      zoom: fit.zoom * HERO_ZOOM,
      azimuth: fit.azimuth + (reducedMotion ? 0 : state.clock.elapsedTime * HERO_SPEED),
    };
    applyPose(state.camera, null, pose, distance);
  });

  return null;
}
