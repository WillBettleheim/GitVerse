import * as THREE from "three";

/**
 * Instanced building material. Facades are drawn procedurally in world units, so they stay the
 * same size whatever the building's scale, and each file category gets its own pattern. Which
 * windows are lit comes from a hash of the file ID, so the city looks the same on every load.
 *
 * aStyle: x = category index (see FILE_CATEGORIES), y = seed, z = 1 for landmarks.
 */

const vertexShader = /* glsl */ `
  attribute vec3 aStyle;
  varying vec3 vLocal;
  varying vec3 vNormalLocal;
  varying vec3 vSize;
  varying vec3 vTint;
  varying vec3 vStyle;
  varying float vRadial;
  uniform float uRadius;

  void main() {
    vLocal = position;
    vNormalLocal = normal;
    vSize = vec3(
      length(instanceMatrix[0].xyz),
      length(instanceMatrix[1].xyz),
      length(instanceMatrix[2].xyz)
    );
    vTint = instanceColor;
    vStyle = aStyle;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vRadial = length(world.xz) / uRadius;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalLocal;
  varying vec3 vSize;
  varying vec3 vTint;
  varying vec3 vStyle;
  varying float vRadial;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float windows(vec2 surface, float cellX, float cellY, float seed, float litShare) {
    vec2 cell = vec2(surface.x / cellX, surface.y / cellY);
    vec2 id = floor(cell);
    vec2 f = fract(cell);
    float pane = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.75);
    float lit = step(1.0 - litShare, hash(id + seed * 91.0));
    return pane * lit * (0.55 + hash(id + 3.0) * 0.45);
  }

  void main() {
    float category = floor(vStyle.x + 0.5);
    float seed = vStyle.y;
    float landmark = vStyle.z;
    vec3 color;

    if (vNormalLocal.y > 0.5) {
      // Roof: dark, with a glowing rim. Landmarks get an inner ring.
      vec2 toEdge = (0.5 - abs(vLocal.xz)) * vSize.xz;
      float edge = min(toEdge.x, toEdge.y);
      float rim = 1.0 - smoothstep(0.0, 0.12, edge);
      float ring = landmark * (1.0 - smoothstep(0.0, 0.08, abs(edge - 0.45)));
      color = vTint * (0.1 + rim * (1.2 + landmark) + ring * 1.2);
    } else if (vNormalLocal.y < -0.5) {
      color = vTint * 0.02;
    } else {
      bool facesX = abs(vNormalLocal.x) > 0.5;
      float across = (facesX ? vLocal.z * vSize.z : vLocal.x * vSize.x) + 100.0;
      float up = vLocal.y * vSize.y;
      vec2 surface = vec2(across, up);
      float faceSeed = seed + (facesX ? 0.37 : 0.0);
      float pattern = 0.0;

      if (category < 0.5) {
        // Source: an office grid.
        pattern = windows(surface, 0.62, 0.8, faceSeed, 0.38);
      } else if (category < 1.5) {
        // Tests: continuous scan bands.
        pattern = step(0.72, fract(up / 0.7)) * 0.75;
      } else if (category < 2.5) {
        // Config: a blank monolith with widely spaced seams.
        pattern = step(0.93, fract(up / 1.6)) * 0.8;
      } else if (category < 3.5) {
        // Docs: tall vertical ribbons.
        pattern = step(0.62, fract(across / 0.95)) * 0.5;
      } else if (category < 4.5) {
        // Styles: a diagonal lattice.
        pattern = step(0.8, fract((across + up) / 0.9)) * 0.7;
      } else {
        // Data: dense server-rack lights.
        pattern = windows(surface, 0.3, 0.32, faceSeed, 0.55);
      }

      float gradient = clamp(vLocal.y, 0.0, 1.0);
      float corner = 0.5 - abs(facesX ? vLocal.z : vLocal.x);
      float edge = 1.0 - smoothstep(0.0, 0.05 / max(facesX ? vSize.z : vSize.x, 0.1), corner);
      float cap = smoothstep(vSize.y - 0.1, vSize.y, up);
      // In a fixed isometric view, one wall in shade makes the volume readable.
      float shade = facesX ? 0.72 : 1.0;

      color = vTint * (0.045 + gradient * 0.09);
      color += vTint * pattern;
      color += vTint * (edge * 0.35 + cap * (1.0 + landmark * 0.6));
      color *= shade;
    }

    // The far edges of the city fall away into the dark.
    color *= 1.0 - smoothstep(0.75, 1.5, vRadial) * 0.55;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createBuildingMaterial(radius: number) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    toneMapped: false,
    uniforms: { uRadius: { value: Math.max(radius, 1) } },
  });
}
