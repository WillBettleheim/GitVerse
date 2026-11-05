import * as THREE from "three";

/**
 * Instanced building material. Windows are drawn procedurally in world units, so they stay
 * the same size whatever the building's scale. Which windows are lit comes from a hash of
 * their position: there is no randomness, so the city looks the same on every load.
 */

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalLocal;
  varying vec3 vSize;
  varying vec3 vTint;
  varying vec2 vSeed;
  varying float vDistance;

  void main() {
    vLocal = position;
    vNormalLocal = normal;
    vSize = vec3(
      length(instanceMatrix[0].xyz),
      length(instanceMatrix[1].xyz),
      length(instanceMatrix[2].xyz)
    );
    vTint = instanceColor;
    vSeed = instanceMatrix[3].xz;
    vec4 view = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
    vDistance = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;

  varying vec3 vLocal;
  varying vec3 vNormalLocal;
  varying vec3 vSize;
  varying vec3 vTint;
  varying vec2 vSeed;
  varying float vDistance;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec3 color;
    if (vNormalLocal.y > 0.5) {
      // Roof: dark, with a glowing rim.
      vec2 toEdge = (0.5 - abs(vLocal.xz)) * vSize.xz;
      float rim = 1.0 - smoothstep(0.0, 0.14, min(toEdge.x, toEdge.y));
      color = vTint * (0.12 + rim * 1.5);
    } else {
      // Walls: lit windows on a dark body, brighter towards the top.
      bool facesX = abs(vNormalLocal.x) > 0.5;
      float across = (facesX ? vLocal.z * vSize.z : vLocal.x * vSize.x) + 100.0;
      float up = vLocal.y * vSize.y;
      vec2 cell = vec2(across / 0.62, up / 0.8);
      vec2 id = floor(cell);
      vec2 f = fract(cell);
      float pane = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.75);
      float lit = step(0.62, hash(id + vSeed + (facesX ? 17.0 : 0.0)));
      float gradient = clamp(vLocal.y, 0.0, 1.0);

      float corner = 0.5 - abs(facesX ? vLocal.z : vLocal.x);
      float edge = 1.0 - smoothstep(0.0, 0.05 / max(facesX ? vSize.z : vSize.x, 0.1), corner);
      float cap = smoothstep(vSize.y - 0.1, vSize.y, up);

      color = vTint * (0.05 + gradient * 0.1);
      color += vTint * pane * lit * (0.55 + hash(id) * 0.45);
      color += vTint * (edge * 0.45 + cap * 1.2);
    }
    float fog = smoothstep(uFogNear, uFogFar, vDistance);
    gl_FragColor = vec4(mix(color, uFog, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

export function createBuildingMaterial(fogColor: string, fogNear: number, fogFar: number) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    toneMapped: false,
    uniforms: {
      uFog: { value: new THREE.Color(fogColor) },
      uFogNear: { value: fogNear },
      uFogFar: { value: fogFar },
    },
  });
}
