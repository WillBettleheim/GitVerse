import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cinematicPose,
  fitPose,
  focusPose,
  interpolatePose,
  ISO_AZIMUTH,
  ISO_ELEVATION,
  poseFromCamera,
  posesClose,
  positionForPose,
  smoothingAmount,
  zoomLimits,
} from "./camera";
import type { Building } from "./layout";

const bounds = { width: 100, depth: 80, maxHeight: 30, radius: 64 };
const viewport = { width: 1000, height: 700 };

const building = (overrides: Partial<Building> = {}) =>
  ({ x: 10, z: -5, baseY: 0.2, width: 3, depth: 3, height: 12, ...overrides }) as Building;

/** Projects with a real Three.js camera, so the maths is checked against what the renderer does. */
function projectCorners(pose: ReturnType<typeof fitPose>, distance = 500) {
  const camera = new THREE.OrthographicCamera(
    -viewport.width / 2,
    viewport.width / 2,
    viewport.height / 2,
    -viewport.height / 2,
    0.1,
    5000,
  );
  camera.zoom = pose.zoom;
  camera.position.set(...positionForPose(pose, distance));
  camera.lookAt(...pose.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const points: THREE.Vector3[] = [];
  for (const x of [-bounds.width / 2, bounds.width / 2]) {
    for (const y of [0, bounds.maxHeight]) {
      for (const z of [-bounds.depth / 2, bounds.depth / 2]) {
        points.push(new THREE.Vector3(x, y, z).project(camera));
      }
    }
  }
  return points;
}

describe("isometric defaults", () => {
  it("uses the true isometric angles", () => {
    expect((ISO_AZIMUTH * 180) / Math.PI).toBeCloseTo(45, 5);
    expect((ISO_ELEVATION * 180) / Math.PI).toBeCloseTo(35.264, 2);
  });
});

describe("poses", () => {
  it("round-trips through a camera position", () => {
    const pose = { target: [3, 4, 5] as [number, number, number], azimuth: 1.1, elevation: 0.6, zoom: 8 };
    const back = poseFromCamera(positionForPose(pose, 400), pose.target, pose.zoom);
    expect(back.azimuth).toBeCloseTo(pose.azimuth, 6);
    expect(back.elevation).toBeCloseTo(pose.elevation, 6);
  });
});

describe("fitPose", () => {
  it.each([
    [ISO_AZIMUTH, ISO_ELEVATION],
    [0, 0.5],
    [2.5, 1.1],
    [-1.2, 0.3],
  ])("keeps every corner on screen from azimuth %d, elevation %d", (azimuth, elevation) => {
    const points = projectCorners(fitPose(bounds, viewport, azimuth, elevation));
    for (const point of points) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(1);
    }
  });

  it("fills the view along its tighter axis", () => {
    const points = projectCorners(fitPose(bounds, viewport));
    const extent = Math.max(...points.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
    expect(extent).toBeGreaterThan(0.85);
  });

  it("zooms out for a narrower viewport", () => {
    expect(fitPose(bounds, { width: 400, height: 700 }).zoom).toBeLessThan(fitPose(bounds, viewport).zoom);
  });

  it("zooms out for a larger city", () => {
    const larger = { width: 300, depth: 300, maxHeight: 30, radius: 212 };
    expect(fitPose(larger, viewport).zoom).toBeLessThan(fitPose(bounds, viewport).zoom);
  });

  it("stays finite for an empty city", () => {
    const pose = fitPose({ width: 0, depth: 0, maxHeight: 0, radius: 0 }, viewport);
    expect(Number.isFinite(pose.zoom)).toBe(true);
    expect(pose.zoom).toBeGreaterThan(0);
  });
});

describe("focusPose", () => {
  const start = fitPose(bounds, viewport);

  it("centres the building and keeps the viewing direction", () => {
    const pose = focusPose(building(), start, viewport);
    expect(pose.target).toEqual([10, 6.2, -5]);
    expect(pose.azimuth).toBe(start.azimuth);
    expect(pose.elevation).toBe(start.elevation);
  });

  it("zooms in from the overview", () => {
    expect(focusPose(building(), start, viewport).zoom).toBeGreaterThan(start.zoom);
  });

  it("doesn't pull back from a closer view", () => {
    const close = { ...start, zoom: start.zoom * 50 };
    expect(focusPose(building(), close, viewport).zoom).toBe(close.zoom);
  });

  it("frames a tall building with a wider view than a short one", () => {
    const tall = focusPose(building({ height: 26 }), start, viewport);
    const short = focusPose(building({ height: 2 }), start, viewport);
    expect(tall.zoom).toBeLessThanOrEqual(short.zoom);
  });
});

describe("interpolatePose", () => {
  const a = { target: [0, 0, 0] as [number, number, number], azimuth: 0, elevation: 0.5, zoom: 2 };
  const b = { target: [10, 0, 0] as [number, number, number], azimuth: 1, elevation: 0.7, zoom: 8 };

  it("returns the endpoints at 0 and 1", () => {
    expect(posesClose(interpolatePose(a, b, 0), a)).toBe(true);
    expect(posesClose(interpolatePose(a, b, 1), b)).toBe(true);
  });

  it("interpolates zoom geometrically", () => {
    expect(interpolatePose(a, b, 0.5).zoom).toBeCloseTo(4, 6);
  });

  it("turns the short way round across the ±π boundary", () => {
    const from = { ...a, azimuth: 3 };
    const to = { ...a, azimuth: -3 };
    const middle = interpolatePose(from, to, 0.5).azimuth;
    expect(Math.abs(middle)).toBeGreaterThan(3);
  });

  it("converges under repeated smoothing", () => {
    let pose = a;
    for (let i = 0; i < 300; i++) pose = interpolatePose(pose, b, smoothingAmount(1 / 60));
    expect(posesClose(pose, b)).toBe(true);
  });
});

describe("smoothingAmount", () => {
  it("is frame-rate independent", () => {
    const once = smoothingAmount(0.05);
    const twice = 1 - (1 - smoothingAmount(0.025)) ** 2;
    expect(once).toBeCloseTo(twice, 6);
  });

  it("caps long frames, so a stall doesn't cause a jump", () => {
    expect(smoothingAmount(5)).toBe(smoothingAmount(0.1));
  });
});

describe("cinematicPose", () => {
  const base = fitPose(bounds, viewport);

  it("starts from the base view", () => {
    expect(posesClose(cinematicPose(base, 0), base)).toBe(true);
  });

  it("is a pure function of time", () => {
    expect(cinematicPose(base, 12.5)).toEqual(cinematicPose(base, 12.5));
  });

  it("orbits while staying on the city and within a modest range", () => {
    for (const t of [5, 30, 90, 200]) {
      const pose = cinematicPose(base, t);
      expect(pose.target).toEqual(base.target);
      expect(pose.azimuth).toBeGreaterThan(base.azimuth);
      expect(pose.elevation).toBeGreaterThan(0.1);
      expect(pose.zoom / base.zoom).toBeGreaterThan(0.9);
      expect(pose.zoom / base.zoom).toBeLessThan(1.1);
    }
  });
});

describe("zoomLimits", () => {
  it("lets you back out a little and zoom in a lot", () => {
    const { min, max } = zoomLimits(4);
    expect(min).toBeLessThan(4);
    expect(max).toBeGreaterThan(40);
  });
});
