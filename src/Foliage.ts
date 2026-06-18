// Foliage — clean reconstruction of `sB` (Leaves), `rB` (Needles), `aB` (Stem).
// An InstancedMesh whose per-instance position is read from a texture (`tTexture1`)
// via a per-instance `texuv`.
//
// Two modes:
//   • static  — bake the initial scatter into the position texture (no motion).
//   • dynamic — pass a FluidSimulation: a GPGPU ping-pong (the bundle's compute
//     material, 2-output MRT) advects each particle by the fluid velocity sampled at
//     the particle's screen position, so the foliage flutters with the mouse.
//
// All params (counts, scatter ranges, colours, geometry, shaders) read from source.

import * as THREE from "three";
import { standaloneMaterial, adaptForStandalone, setColors } from "./shaderAdapter";
import { loadGeometry, loadTexture, loadNoise } from "./assets";
import { Blitter, makeMRT } from "./gpgpu";
import type { Theme } from "./theme";
import { theme } from "./theme";
import type { ScenePart } from "./types";
import type { FluidSimulation } from "./FluidSimulation";

import leafVert from "@shaders/leaf.vert.glsl";
import leafFrag from "@shaders/leaf.frag.glsl";
import needleVert from "@shaders/needle.vert.glsl";
import needleFrag from "@shaders/needle.frag.glsl";
import stemVert from "@shaders/stem.vert.glsl";
import stemFrag from "@shaders/stem.frag.glsl";
// GPGPU position-advection shaders (compute pass)
import leafComputeVert from "@shaders/material-4.vert.glsl";
import leafComputeFrag from "@shaders/material-3.glsl.glsl";
import needleComputeVert from "@shaders/material-5.vert.glsl";
import needleComputeFrag from "@shaders/material-4.glsl.glsl";
import stemComputeVert from "@shaders/material-6.vert.glsl";
import stemComputeFrag from "@shaders/material-5.glsl.glsl";

export interface FoliagePreset {
  name: string;
  geometryFile: string;
  textureFile: string;
  count: number;
  renderOrder: number;
  scatter: () => [number, number, number];
  themeKey: "leaf" | "needle" | "stem";
  colors: { uColor1: string; uColor2?: string; uOutlineColor: string };
  vert: string;
  frag: string;
  computeVert: string;
  computeFrag: string;
}

const rnd = Math.random;
const ceilPow2 = (x: number): number => {
  let n = 1;
  while (n < x) n *= 2;
  return n;
};

// The compute frag writes `pc_fragColor` (which three's GLSL3 ShaderMaterial does NOT
// declare) and a second MRT output. Declare the first output explicitly and turn the
// Global UBO into plain uniforms — same spirit as shaderAdapter, kept local.
function adaptCompute(glsl: string): string {
  return (
    glsl
      .replace(
        "#define outPos pc_fragColor",
        "layout(location = 0) out highp vec4 outPos;",
      )
      .replace(
        /uniform\s+Global\s*\{[^}]*\}\s*;/g,
        "uniform vec2 resolution;\nuniform float time;\nuniform float dtRatio;",
      )
      // The recovered compute decays only velocity.xyz, leaving the interaction
      // accumulator (.a → interactionRotation) growing unbounded — stirred leaves
      // then spin to edge-on and flicker out. Decay all four components so it settles,
      // and clamp the speed so a strong fluid splat can't fling a leaf across the
      // treadmill wrap every frame (which reads as strobing).
      .replace(
        "currentVel.xyz *= exp2(log2(0.9) * dtRatio);",
        "currentVel *= exp2(log2(0.9) * dtRatio); currentVel.xyz = clamp(currentVel.xyz, vec3(-0.12), vec3(0.12));",
      )
  );
}

export const LEAF: FoliagePreset = {
  name: "leaves",
  geometryFile: "leaf.drc",
  textureFile: "flower/leaf.ktx2",
  count: 140,
  renderOrder: 1,
  scatter: () => [rnd() * 32 - 16, rnd() * 12 - 6, -2 - rnd() * 6],
  themeKey: "leaf",
  colors: { uColor1: theme.leaf.color1, uOutlineColor: theme.leaf.outline },
  vert: leafVert,
  frag: leafFrag,
  computeVert: leafComputeVert,
  computeFrag: leafComputeFrag,
};

export const NEEDLE: FoliagePreset = {
  name: "needles",
  geometryFile: "needle.drc",
  textureFile: "flower/petal.ktx2",
  count: 20,
  renderOrder: 1,
  scatter: () => [rnd() * 32 - 16, rnd() * 12 - 6, -4 - rnd() * 4],
  themeKey: "needle",
  colors: {
    uColor1: theme.needle.color1,
    uColor2: theme.needle.color2,
    uOutlineColor: theme.needle.outline,
  },
  vert: needleVert,
  frag: needleFrag,
  computeVert: needleComputeVert,
  computeFrag: needleComputeFrag,
};

export const STEM: FoliagePreset = {
  name: "foreground-leaves",
  geometryFile: "leaf.drc",
  textureFile: "flower/leaf.ktx2",
  count: 60,
  renderOrder: 4,
  scatter: () => [rnd() * 10 - 5, rnd() * 12 - 6, 0.75 + rnd()],
  themeKey: "stem",
  colors: { uColor1: theme.stem.color1, uOutlineColor: theme.stem.outline },
  vert: stemVert,
  frag: stemFrag,
  computeVert: stemComputeVert,
  computeFrag: stemComputeFrag,
};

export class Foliage implements ScenePart {
  renderer: THREE.WebGLRenderer;
  preset: FoliagePreset;
  fluid: FluidSimulation | null;
  group: THREE.Group;
  material: THREE.ShaderMaterial | null = null;
  mesh!: THREE.InstancedMesh;
  private _first = true;
  private _view: THREE.Matrix4;
  private _n!: number;
  private _tPositionInit!: THREE.DataTexture;
  private _tVelocityInit!: THREE.DataTexture;
  private _blitter!: Blitter;
  private _mrtA!: THREE.WebGLMultipleRenderTargets;
  private _mrtB!: THREE.WebGLMultipleRenderTargets;
  private _read!: THREE.WebGLMultipleRenderTargets;
  private _write!: THREE.WebGLMultipleRenderTargets;
  private _compute: THREE.ShaderMaterial | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    preset: FoliagePreset,
    fluid: FluidSimulation | null = null,
  ) {
    this.renderer = renderer;
    this.preset = preset;
    this.fluid = fluid;
    this.group = new THREE.Group();
    this.group.name = preset.name;
    this.material = null;
    this._first = true;
    this._view = new THREE.Matrix4();
  }

  async load(): Promise<THREE.Group> {
    const p = this.preset;
    const [geometry, tPetal, tNoise] = await Promise.all([
      loadGeometry(p.geometryFile),
      loadTexture(this.renderer, p.textureFile, { srgb: true }),
      loadNoise(this.renderer),
    ]);

    const count = p.count;
    const n = Math.max(2, ceilPow2(Math.sqrt(count)));
    this._n = n;

    const positions = new Float32Array(n * n * 4);
    const texuv = new Float32Array(count * 2);
    const rand = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const [x, y, z] = p.scatter();
      positions[i * 4 + 0] = x;
      positions[i * 4 + 1] = y;
      positions[i * 4 + 2] = z;
      positions[i * 4 + 3] = rnd();
      const col = i % n;
      const row = Math.floor(i / n);
      texuv[i * 2 + 0] = (col + 0.5) / n;
      texuv[i * 2 + 1] = (row + 0.5) / n;
      rand[i * 4 + 0] = rnd();
      rand[i * 4 + 1] = rnd();
      rand[i * 4 + 2] = rnd();
      rand[i * 4 + 3] = rnd();
    }

    const dataTex = (arr: Float32Array): THREE.DataTexture => {
      const t = new THREE.DataTexture(
        arr as Float32Array<ArrayBuffer>,
        n,
        n,
        THREE.RGBAFormat,
        THREE.FloatType,
      );
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    this._tPositionInit = dataTex(positions);
    this._tVelocityInit = dataTex(new Float32Array(n * n * 4));

    geometry.setAttribute("texuv", new THREE.InstancedBufferAttribute(texuv, 2));
    geometry.setAttribute("rand", new THREE.InstancedBufferAttribute(rand, 4));

    const uniforms: Record<string, THREE.IUniform> = {
      uCount: { value: count },
      uColor1: { value: new THREE.Color(p.colors.uColor1) },
      uOutlineColor: { value: new THREE.Color(p.colors.uOutlineColor) },
      tPetal: { value: tPetal },
      tNoise: { value: tNoise },
      tTexture1: { value: this._tPositionInit },
      tTexture2: { value: this._tVelocityInit },
    };
    if (p.colors.uColor2) uniforms.uColor2 = { value: new THREE.Color(p.colors.uColor2) };

    this.material = standaloneMaterial({
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide, // leaves spin; FrontSide culls back-faces → flicker
      uniforms,
      vertexShader: p.vert,
      fragmentShader: p.frag,
    });

    const mesh = new THREE.InstancedMesh(geometry, this.material, count);
    mesh.renderOrder = p.renderOrder;
    mesh.frustumCulled = false;
    mesh.updateMatrixWorld();
    this.mesh = mesh;
    this.group.add(mesh);

    if (this.fluid) this._setupCompute();
    return this.group;
  }

  // GPGPU advection: a 2-output MRT (position + velocity) ping-pong driven by the
  // fluid velocity field, replicating the bundle's compute material.
  private _setupCompute(): void {
    const n = this._n;
    this._blitter = new Blitter();
    this._mrtA = makeMRT(n);
    this._mrtB = makeMRT(n);
    this._read = this._mrtA;
    this._write = this._mrtB;

    this._compute = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        resolution: { value: new THREE.Vector2(n, n) },
        time: { value: 0 },
        dtRatio: { value: 1 },
        tTexture1: { value: null },
        tTexture2: { value: null },
        tVel: this.fluid!.velUniform,
        uViewMatrix: { value: new THREE.Matrix4() },
        uModelMatrix: { value: new THREE.Matrix4() },
        uProjMatrix: { value: new THREE.Matrix4() },
      },
      vertexShader: adaptCompute(this.preset.computeVert),
      fragmentShader: adaptCompute(this.preset.computeFrag),
    });
  }

  update(deltaMs: number, camera: THREE.Camera): void {
    const tSec = (this.material!.uniforms.time.value += deltaMs * 0.001);

    if (!this.fluid || !this._compute) return;

    const u = this._compute.uniforms;
    u.time.value = tSec;
    u.dtRatio.value = Math.min(2, deltaMs * 0.06); // ~1 at 60fps
    u.tTexture1.value = this._first ? this._tPositionInit : this._read.texture[0];
    u.tTexture2.value = this._first ? this._tVelocityInit : this._read.texture[1];
    u.tVel.value = this.fluid.velocityTexture;
    u.uModelMatrix.value.copy(this.mesh.matrixWorld);
    u.uViewMatrix.value.copy(this._view.copy(camera.matrixWorld).invert());
    u.uProjMatrix.value.copy(camera.projectionMatrix);

    this._blitter.blit(
      this.renderer,
      this._compute,
      this._write as unknown as THREE.WebGLRenderTarget,
    );
    const t = this._read;
    this._read = this._write;
    this._write = t;
    this._first = false;

    // feed the freshly-advected positions/velocities to the render material
    this.material!.uniforms.tTexture1.value = this._read.texture[0];
    this.material!.uniforms.tTexture2.value = this._read.texture[1];
  }

  setSize(w: number, h: number): void {
    this.material?.uniforms.resolution.value.set(w, h);
  }

  applyTheme(t: Theme): void {
    const c = t[this.preset.themeKey];
    setColors(this.material, {
      uColor1: c.color1,
      uColor2: "color2" in c ? c.color2 : undefined,
      uOutlineColor: c.outline,
    });
  }
}
