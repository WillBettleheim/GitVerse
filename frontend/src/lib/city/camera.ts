import type { Vec3 } from "./arcs";
import type { Building, CityLayout } from "./layout";

/**
 * Camera maths with no Three.js dependency. A pose describes an orthographic view: where it looks,
 * from which direction, and at what zoom (screen pixels per world unit).
 */

/** The true isometric view: 45° around, and ~35.26° above the ground. */
export const ISO_AZIMUTH = Math.PI / 4;
export const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);

const FIT_PADDING = 1.08;
const MIN_FIT_SIZE = 10;

export interface CameraPose {
  target: Vec3;
  azimuth: number;
  elevation: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Direction from the target towards the camera. */
function viewDirection(azimuth: number, elevation: number): Vec3 {
  const flat = Math.cos(elevation);
  return [flat * Math.sin(azimuth), Math.sin(elevation), flat * Math.cos(azimuth)];
}

/** With an orthographic camera, distance only has to clear the geometry. */
export function cameraDistance(bounds: CityLayout["bounds"]): number {
  return Math.max(bounds.radius + bounds.maxHeight, 40) * 3;
}

export function positionForPose(pose: CameraPose, distance: number): Vec3 {
  const [x, y, z] = viewDirection(pose.azimuth, pose.elevation);
  return [pose.target[0] + x * distance, pose.target[1] + y * distance, pose.target[2] + z * distance];
}

export function poseFromCamera(position: Vec3, target: Vec3, zoom: number): CameraPose {
  const dx = position[0] - target[0];
  const dy = position[1] - target[1];
  const dz = position[2] - target[2];
  return {
    target,
    azimuth: Math.atan2(dx, dz),
    elevation: Math.atan2(dy, Math.hypot(dx, dz)),
    zoom,
  };
}

/** Frames the whole city from the given direction, measuring the corners on screen. */
export function fitPose(
  bounds: CityLayout["bounds"],
  viewport: Viewport,
  azimuth = ISO_AZIMUTH,
  elevation = ISO_ELEVATION,
): CameraPose {
  const halfWidth = Math.max(bounds.width, MIN_FIT_SIZE) / 2;
  const halfDepth = Math.max(bounds.depth, MIN_FIT_SIZE) / 2;
  const height = bounds.maxHeight;

  // Screen axes: right is horizontal, and up is perpendicular to it and the view direction.
  const lift = Math.sin(elevation);
  const right: Vec3 = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
  const up: Vec3 = [-lift * Math.sin(azimuth), Math.cos(elevation), -lift * Math.cos(azimuth)];

  let extentX = 0;
  let extentY = 0;
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [-height / 2, height / 2]) {
      for (const z of [-halfDepth, halfDepth]) {
        extentX = Math.max(extentX, Math.abs(x * right[0] + z * right[2]));
        extentY = Math.max(extentY, Math.abs(x * up[0] + y * up[1] + z * up[2]));
      }
    }
  }

  const zoom = Math.min(
    viewport.width / (2 * extentX * FIT_PADDING),
    viewport.height / (2 * extentY * FIT_PADDING),
  );
  return { target: [0, height / 2, 0], azimuth, elevation, zoom };
}

export function zoomLimits(fitZoom: number) {
  return { min: fitZoom * 0.5, max: fitZoom * 16 };
}

/** Centres a building, zooming in if needed but never pulling back from a closer view. */
export function focusPose(building: Building, current: CameraPose, viewport: Viewport): CameraPose {
  const subject = Math.max(building.width * 6, building.depth * 6, building.height * 2.4, 24);
  const wanted = Math.min(viewport.width, viewport.height) / subject;
  return {
    target: [building.x, building.baseY + building.height / 2, building.z],
    azimuth: current.azimuth,
    elevation: current.elevation,
    zoom: Math.max(current.zoom, wanted),
  };
}

/** Wraps to (-π, π], so azimuth always turns the short way round. */
function shortestAngle(from: number, to: number): number {
  const turn = (to - from) % (Math.PI * 2);
  if (turn > Math.PI) return turn - Math.PI * 2;
  if (turn <= -Math.PI) return turn + Math.PI * 2;
  return turn;
}

export function interpolatePose(from: CameraPose, to: CameraPose, amount: number): CameraPose {
  const mix = (a: number, b: number) => a + (b - a) * amount;
  return {
    target: [
      mix(from.target[0], to.target[0]),
      mix(from.target[1], to.target[1]),
      mix(from.target[2], to.target[2]),
    ],
    azimuth: from.azimuth + shortestAngle(from.azimuth, to.azimuth) * amount,
    elevation: mix(from.elevation, to.elevation),
    // Geometric, so zooming feels even at every scale.
    zoom: from.zoom * (to.zoom / from.zoom) ** amount,
  };
}

export function posesClose(a: CameraPose, b: CameraPose): boolean {
  return (
    Math.hypot(a.target[0] - b.target[0], a.target[1] - b.target[1], a.target[2] - b.target[2]) <
      0.02 &&
    Math.abs(shortestAngle(a.azimuth, b.azimuth)) < 0.001 &&
    Math.abs(a.elevation - b.elevation) < 0.001 &&
    Math.abs(a.zoom / b.zoom - 1) < 0.002
  );
}

const CINEMATIC_SPEED = 0.14;
const CINEMATIC_SWAY = 0.09;
const CINEMATIC_BREATH = 0.05;

/** The overview flight: a slow orbit with a gentle rise and fall. A pure function of time. */
export function cinematicPose(base: CameraPose, elapsedSeconds: number): CameraPose {
  const phase = elapsedSeconds * CINEMATIC_SPEED;
  return {
    target: base.target,
    azimuth: base.azimuth + phase,
    elevation: base.elevation + Math.sin(phase * 0.7) * CINEMATIC_SWAY,
    zoom: base.zoom * (1 + Math.sin(phase * 0.5) * CINEMATIC_BREATH),
  };
}

/** Exponential smoothing that behaves the same at any frame rate. */
export function smoothingAmount(deltaSeconds: number, rate = 4.5): number {
  return 1 - Math.exp(-Math.min(deltaSeconds, 0.1) * rate);
}
