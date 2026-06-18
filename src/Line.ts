// Line — clean reconstruction of the bundle's `hB` class (the glowing pointer trail,
// the engine's `ZL` line renderer). A GPGPU trail: a points×1 texture holds the trail
// positions; each frame texel 0 = pointer, the rest chase the one before (snake). A
// ribbon mesh reads those positions (3 per vertex: current/prev/next index) and extrudes
// `lineWidth` along the screen-space normal.
//
// Standalone adaptations: the recovered shaders' Global UBO → plain uniforms, the trail
// compute's `pc_fragColor` → an explicit output, and the render frag's MRT `gInfo` is
// dropped (outline-pass only). `.glsl` files stay verbatim.

import * as THREE from "three";
import type { ScenePart } from "./types";
import { loadNoise } from "./assets";
import { Blitter, DoubleFBO } from "./gpgpu";
import { setColors } from "./shaderAdapter";
import { theme, type Theme } from "./theme";

import glowVert from "@shaders/glow.vert.glsl";
import glowFrag from "@shaders/glow.frag.glsl";
import computeVert from "@shaders/glow-2.vert.glsl";
import computeFrag from "@shaders/glow.glsl.glsl";

const POINTS = 16;

function adaptRender(glsl: string, stage: "vertex" | "fragment"): string {
  // Keep the gInfo MRT output (the scene renders into a 2-attachment target).
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
function adaptCompute(glsl: string): string {
  return glsl
    .replace("#define outPos pc_fragColor", "layout(location = 0) out highp vec4 outPos;")
    .replace(
      /uniform\s+Global\s*\{[^}]*\}\s*;/g,
      "uniform vec2 resolution;\nuniform float time;\nuniform float dtRatio;",
    );
}

// Build the ribbon geometry: 2 vertices per trail point; `position` carries
// (currentIndex, prevIndex, nextIndex) texel coords; uv = (alongLine, side).
function buildRibbon(points: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const uvy: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < points; i++) {
    const prev = Math.max(i - 1, 0);
    const next = Math.min(i + 1, points - 1);
    const t = i / (points - 1);
    for (let side = 0; side < 2; side++) {
      pos.push(i, prev, next);
      uv.push(t, side);
      uvy.push(0);
    }
  }
  for (let i = 0; i < points - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("uvy", new THREE.Float32BufferAttribute(uvy, 1));
  g.setIndex(index);
  return g;
}

export class Line implements ScenePart {
  renderer: THREE.WebGLRenderer;
  group: THREE.Group;
  material: THREE.ShaderMaterial | null;
  pointerWorld: THREE.Vector3;
  private _snap: boolean; // snap the whole trail to the pointer on the first frame
  private _speed: number;
  private _prev: THREE.Vector3;
  mesh!: THREE.Mesh;
  private _blitter!: Blitter;
  private _trail!: DoubleFBO;
  private _compute!: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = "line";
    this.material = null;
    this.pointerWorld = new THREE.Vector3();
    this._snap = true; // snap the whole trail to the pointer on the first frame
    this._speed = 0;
    this._prev = new THREE.Vector3();
  }

  async load(): Promise<THREE.Group> {
    const tNoise = await loadNoise(this.renderer);

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      defines: { SHAPE: 0 },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      uniforms: {
        resolution: { value: new THREE.Vector2(1, 1) },
        time: { value: 0 },
        dtRatio: { value: 1 },
        lineWidth: { value: 0.01 },
        uColor: { value: new THREE.Color(theme.line.color) },
        tTexture1: { value: null },
        tNoise: { value: tNoise },
      },
      vertexShader: adaptRender(glowVert, "vertex"),
      fragmentShader: adaptRender(glowFrag, "fragment"),
    });

    this.mesh = new THREE.Mesh(buildRibbon(POINTS), this.material);
    this.mesh.name = "line";
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // GPGPU trail (points×1)
    this._blitter = new Blitter();
    this._trail = new DoubleFBO(POINTS, 1);
    this._compute = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        resolution: { value: new THREE.Vector2(POINTS, 1) },
        time: { value: 0 },
        dtRatio: { value: 1 },
        tTexture1: { value: null },
        uMousePos: { value: new THREE.Vector3() },
        uSnap: { value: 1 },
      },
      vertexShader: adaptCompute(computeVert),
      fragmentShader: adaptCompute(computeFrag),
    });

    return this.group;
  }

  /** World-space pointer position (already unprojected onto the flower plane). */
  setPointerWorld(v3: THREE.Vector3): void {
    this.pointerWorld.copy(v3);
  }

  update(deltaMs: number, camera: THREE.Camera): void {
    if (!this._compute || !this.material) return;
    const dtRatio = Math.min(1, deltaMs * 0.06);
    const tSec = (this.material.uniforms.time.value += deltaMs * 0.001);

    // pointer speed → line width (thinner when moving fast), like the original
    this._speed += this._prev.distanceTo(this.pointerWorld);
    this._speed = Math.min(1, this._speed * 0.8);
    this._prev.copy(this.pointerWorld);

    const c = this._compute.uniforms;
    c.tTexture1.value = this._trail.read.texture;
    c.uMousePos.value.copy(this.pointerWorld);
    c.uSnap.value = this._snap ? 1 : 0;
    c.dtRatio.value = dtRatio;
    c.time.value = tSec;
    this._blitter.blit(this.renderer, this._compute, this._trail.write);
    this._trail.swap();
    this._snap = false;

    this.material.uniforms.tTexture1.value = this._trail.read.texture;
    // Bundle formula: thin stroke, width ∝ 9/screenHeight, scaled by pointer speed
    // (fades out when still). This is ~10× thinner than a naive constant width.
    const screenH = this.material.uniforms.resolution.value.y || 1080;
    const fit = (x: number, a1: number, a2: number, b1: number, b2: number): number => {
      const t = b1 + ((x - a1) * (b2 - b1)) / (a2 - a1);
      return Math.max(Math.min(b1, b2), Math.min(Math.max(b1, b2), t));
    };
    this.material.uniforms.lineWidth.value = (9 / screenH) * fit(this._speed, 0.01, 0.001, 1, 0);
  }

  setSize(w: number, h: number): void {
    this.material?.uniforms.resolution.value.set(w, h);
  }

  applyTheme(t: Theme): void {
    setColors(this.material, { uColor: t.line.color });
  }
}
