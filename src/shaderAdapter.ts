// Shared helpers for running the recovered flower-scene shaders on a plain npm
// `three` ShaderMaterial, outside the original engine. Used by every Part in this
// folder. The recovered `.glsl` files stay verbatim — adaptation happens here.
//
// Two adaptations (see also Petal.js):
//   1. `Global { resolution; time; dtRatio }` UBO  ->  plain uniforms
//   2. `three`'s GLSL3 ShaderMaterial does NOT declare a fragment output, so we
//      declare our own `outColor` (location 0) and retarget `gl_FragColor`.
//
// The second MRT output `gInfo` (location 1 — packed depth/normal/edge info) is KEPT:
// the whole scene renders into a 2-attachment MRT so the Headline pass can draw the
// ink outlines from it. Parts are only ever rendered to that MRT, never to a
// single-attachment target, so the extra output is always consumed.

import * as THREE from "three";

export function adaptForStandalone(glsl: string, stage: "vertex" | "fragment"): string {
  let out = glsl.replace(
    /uniform\s+Global\s*\{[^}]*\}\s*;/g,
    "uniform vec2 resolution;\nuniform float time;\nuniform float dtRatio;",
  );
  if (stage === "fragment" && /\bgl_FragColor\b/.test(out)) {
    out =
      "layout(location = 0) out highp vec4 outColor;\n" +
      out.replace(/\bgl_FragColor\b/g, "outColor");
  }
  return out;
}

type StandaloneMaterialOptions = {
  uniforms?: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
} & THREE.ShaderMaterialParameters;

/**
 * Build a ShaderMaterial from a recovered vertex/fragment pair. The shared
 * `resolution` / `time` / `dtRatio` uniforms (the old UBO) are always present.
 */
export function standaloneMaterial({
  uniforms = {},
  vertexShader,
  fragmentShader,
  ...rest
}: StandaloneMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      resolution: { value: new THREE.Vector2(1, 1) },
      time: { value: 0 },
      dtRatio: { value: 1 },
      ...uniforms,
    },
    vertexShader: adaptForStandalone(vertexShader, "vertex"),
    fragmentShader: adaptForStandalone(fragmentShader, "fragment"),
    ...rest,
  });
}

/** Advance the shared `time` uniform on a material built by standaloneMaterial. */
export function tickMaterial(material: THREE.ShaderMaterial, elapsedSeconds: number): void {
  if (material?.uniforms?.time) material.uniforms.time.value = elapsedSeconds;
}

/**
 * Live-update colour uniforms on a material from a `{ uniformName: hex }` map.
 * Skips uniforms that don't exist or whose hex is undefined — used by applyTheme().
 */
export function setColors(
  material: THREE.ShaderMaterial | null,
  colors: Record<string, string | undefined>,
): void {
  if (!material) return;
  for (const [name, hex] of Object.entries(colors)) {
    const u = material.uniforms[name];
    if (u && hex !== undefined) (u.value as THREE.Color).set(hex);
  }
}
