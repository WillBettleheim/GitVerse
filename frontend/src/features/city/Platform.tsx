"use client";

import { memo, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { CityLayout } from "@/lib/city/layout";

const PLATFORM_THICKNESS = 2.4;
const VOID_DEPTH = 14;

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalLocal;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vNormalLocal = normal;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const platformFragment = /* glsl */ `
  uniform vec2 uHalf;
  varying vec3 vWorld;
  varying vec3 vNormalLocal;
  varying vec3 vLocal;

  float gridLine(vec2 p, float spacing, float width) {
    vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
    vec2 aa = fwidth(p);
    vec2 lines = 1.0 - smoothstep(vec2(width), vec2(width) + aa * 1.2, g);
    return max(lines.x, lines.y);
  }

  void main() {
    vec3 base = vec3(0.008, 0.013, 0.03);
    vec3 accent = vec3(0.05, 0.3, 0.75);
    vec3 color;

    if (vNormalLocal.y > 0.5) {
      vec2 p = vWorld.xz;
      vec2 toEdge = uHalf - abs(p);
      float edge = min(toEdge.x, toEdge.y);
      float falloff = 1.0 - smoothstep(0.0, 1.0, length(p / uHalf) * 0.72);
      color = base + vec3(0.006, 0.012, 0.03) * falloff;
      color += accent * gridLine(p, 4.0, 0.012) * (0.035 + falloff * 0.05);
      color += accent * gridLine(p, 20.0, 0.03) * (0.08 + falloff * 0.1);
      // A bright rim, with a faint second line just inside it.
      color += accent * (1.0 - smoothstep(0.0, 0.2, edge)) * 1.3;
      color += accent * (1.0 - smoothstep(0.0, 0.08, abs(edge - 1.3))) * 0.35;
      // Corner brackets mark it as a designed object.
      vec2 corner = step(uHalf - vec2(9.0), abs(p));
      float bracket = corner.x * corner.y * (1.0 - smoothstep(0.0, 0.1, abs(edge - 0.7)));
      color += vec3(0.1, 0.65, 0.9) * bracket;
    } else {
      // The sides fade down from a lit top edge.
      float t = clamp(vLocal.y / ${PLATFORM_THICKNESS.toFixed(1)} + 0.5, 0.0, 1.0);
      color = base * 0.7 + accent * pow(t, 7.0) * 0.5;
    }

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const voidFragment = /* glsl */ `
  uniform float uRadius;
  varying vec3 vWorld;

  void main() {
    vec2 p = vWorld.xz;
    vec2 g = abs(fract(p / 12.0 - 0.5) - 0.5) * 12.0;
    vec2 aa = fwidth(p);
    vec2 lines = 1.0 - smoothstep(vec2(0.02), vec2(0.02) + aa * 1.2, g);
    float grid = max(lines.x, lines.y);
    float fade = 1.0 - smoothstep(uRadius * 0.7, uRadius * 2.4, length(p));
    vec3 background = vec3(0.0019, 0.0030, 0.0080);
    vec3 color = background + vec3(0.02, 0.09, 0.22) * grid * fade * 0.5;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** The slab the city stands on, floating over a faint grid that fades into the dark. */
export const Platform = memo(function Platform({ bounds }: { bounds: CityLayout["bounds"] }) {
  const margin = Math.max(bounds.radius * 0.12, 6);
  const width = Math.max(bounds.width, 10) + margin * 2;
  const depth = Math.max(bounds.depth, 10) + margin * 2;
  const radius = Math.max(bounds.radius, 20);

  const slab = useMemo(() => new THREE.BoxGeometry(width, PLATFORM_THICKNESS, depth), [width, depth]);
  useEffect(() => () => slab.dispose(), [slab]);

  const [platformUniforms] = useState(() => ({
    uHalf: { value: new THREE.Vector2(width / 2, depth / 2) },
  }));
  const [voidUniforms] = useState(() => ({ uRadius: { value: radius } }));

  return (
    <group>
      <mesh geometry={slab} position={[0, -PLATFORM_THICKNESS / 2, 0]} raycast={() => null}>
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={platformFragment}
          uniforms={platformUniforms}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, -VOID_DEPTH, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
        <planeGeometry args={[radius * 10, radius * 10]} />
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={voidFragment}
          uniforms={voidUniforms}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
});
