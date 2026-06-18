// =============================================================================
// Petal — clean npm-`three` reconstruction of the bundle's `nB` class.
// =============================================================================
//
// Migration TEMPLATE, separate from the running app (see README.md). It shows how
// one flower part looks rewritten against npm `three`, reusing the recovered GLSL.
//
// Faithful to the original `nB` (verified against the minified source):
//   - geometry:    Draco `petal.drc`, + a per-instance `random` attribute
//   - instancing:  THREE.InstancedMesh, 38 instances; the layout is computed in
//                  the vertex shader from gl_InstanceID / uCount (no instanceMatrix)
//   - uniforms:    uCount=38, uColor1/2, uOutlineColor, tPetal, tNoise, uFlowerTime
//   - animation:   uFlowerTime = baseTime + wheel/touch "additionalTime" + hold
//   - colours:     uColor1 #d88b3e, uColor2 #ddb94c, uOutlineColor #b84a08
//
// Two deliberate adaptations so the recovered shaders run on a plain ShaderMaterial,
// outside the original engine (both done at load time; the .glsl files stay verbatim):
//   1. the shared `Global { resolution; time; dtRatio }` UBO  ->  plain uniforms
//      (the engine binds a real UBO; standalone we don't need one)
//   2. the second MRT output `gInfo` (the outline pass's id/depth/normal buffer)
//      is dropped — the standalone demo renders only colour (location 0)
// =============================================================================

import * as THREE from "three";

import { standaloneMaterial, setColors } from "./shaderAdapter";
import { loadGeometry, loadTexture, loadNoise } from "./assets";
import { theme, type Theme } from "./theme";
import petalVert from "@shaders/petal.vert.glsl";
import petalFrag from "@shaders/petal.frag.glsl";
import type { ScenePart } from "./types";

interface PetalOptions {
  petalCount?: number;
}

// The engine augments the camera with a spherical parallax offset; not part of the
// stock THREE.Camera, so we describe just the shape Petal reads from it.
interface SphericalOffsetCamera extends THREE.Camera {
  _additionalSphericalPosition?: { theta: number; phi: number };
}

export class Petal implements ScenePart {
  renderer: THREE.WebGLRenderer;
  options: Required<PetalOptions>;

  // animation state (mirrors the original nB fields)
  elapsed = 0;
  baseTime = 0;
  additionalTime = 0;
  additionalTimeTarget = 0;
  additionalHold = 0;
  additionalHoldTarget = 0;
  touching = false;

  group: THREE.Group;
  material: THREE.ShaderMaterial | null = null;
  mesh: THREE.InstancedMesh | null = null;

  /**
   * @param renderer  required for KTX2Loader.detectSupport
   */
  constructor(renderer: THREE.WebGLRenderer, options: PetalOptions = {}) {
    this.renderer = renderer;
    this.options = { petalCount: 38, ...options };

    // animation state (mirrors the original nB fields)
    this.elapsed = 0;
    this.baseTime = 0;
    this.additionalTime = 0;
    this.additionalTimeTarget = 0;
    this.additionalHold = 0;
    this.additionalHoldTarget = 0;
    this.touching = false;

    this.group = new THREE.Group();
    this.group.name = "flower";
    this.material = null;
    this.mesh = null;
  }

  async load(): Promise<THREE.Group> {
    const count = this.options.petalCount;

    // --- geometry: Draco petal + per-instance random attribute ----------------
    const geometry = await loadGeometry("petal.drc");
    const random = new Float32Array(count);
    for (let i = 0; i < count; i++) random[i] = Math.random();
    geometry.setAttribute("random", new THREE.InstancedBufferAttribute(random, 1));

    // --- textures: KTX2 (basis) -----------------------------------------------
    const tPetal = await loadTexture(this.renderer, "flower/petal.ktx2", { srgb: true });
    const tNoise = await loadNoise(this.renderer);

    // --- material: ShaderMaterial @ GLSL3 (recovered shaders, adapted) --------
    this.material = standaloneMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uCount: { value: count },
        uColor1: { value: new THREE.Color(theme.flower.color1) },
        uColor2: { value: new THREE.Color(theme.flower.color2) },
        uOutlineColor: { value: new THREE.Color(theme.flower.outline) },
        tPetal: { value: tPetal },
        tNoise: { value: tNoise },
        uFlowerTime: { value: 0 },
        uBloom: { value: 1 }, // 0 = tight bud, 1 = full bloom (seasonal)
      },
      vertexShader: petalVert,
      fragmentShader: petalFrag,
    });

    // --- instanced mesh (38 instances, procedurally laid out in the shader) ---
    this.mesh = new THREE.InstancedMesh(geometry, this.material, count);
    this.mesh.rotation.x = Math.PI * 0.5 - 0.5;
    this.mesh.rotation.z = Math.PI * 0.05;
    this.mesh.position.y += 0.03;
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    return this.group;
  }

  setSize(width: number, height: number): void {
    if (this.material) this.material.uniforms.resolution.value.set(width, height);
  }

  applyTheme(t: Theme): void {
    setColors(this.material, {
      uColor1: t.flower.color1,
      uColor2: t.flower.color2,
      uOutlineColor: t.flower.outline,
    });
  }

  /** Seasonal openness: 0 = tight bud, 1 = full bloom. */
  setForm(bloom: number): void {
    if (this.material) this.material.uniforms.uBloom.value = bloom;
  }

  private _beat = 0;
  /** Music beat 0..1: speeds up the flower's own animation on the beat so its motion
   *  matches the music's rhythm. This modulates animation SPEED (not size or position),
   *  so the motion stays continuous and never jerks — it just surges and eases. */
  setBeat(p: number): void {
    this._beat = p;
  }

  /**
   * Per-frame update. Call from your render loop.
   * @param deltaMs   frame delta in milliseconds
   * @param camera  optional; if it exposes a spherical offset the
   *                flower gets the original parallax rotation.
   */
  update(deltaMs: number, camera?: THREE.Camera): void {
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

    this.elapsed += deltaMs * 0.001;
    this.additionalTime = lerp(this.additionalTime, this.additionalTimeTarget, 0.035);
    // beat-sync: the flower's own animation runs faster on the beat (1× at rest), so its
    // motion keeps time with the music. Speed modulation → motion stays smooth, no jerk.
    this.baseTime += deltaMs * 0.001 * (1 + this._beat * 2.2);
    this.additionalHoldTarget += this.touching ? deltaMs * 0.0025 : 0;
    this.additionalHold = lerp(this.additionalHold, this.additionalHoldTarget, 0.035);

    const u = this.material!.uniforms;
    u.time.value = this.elapsed;
    u.uFlowerTime.value = this.baseTime + this.additionalTime + this.additionalHold;

    const s = camera && (camera as SphericalOffsetCamera)._additionalSphericalPosition;
    if (s) {
      this.group.rotation.y = -s.theta * 7;
      this.group.rotation.x = s.phi * 7;
    }
  }

  // Input hooks — wire these to wheel / pointer events (see demo.js).
  onWheel(deltaX: number, deltaY: number): void {
    const d = Math.abs(deltaY) > Math.abs(deltaX) ? deltaY : deltaX;
    this.additionalTimeTarget += d * 65e-5 * (d < 0 ? 2 : 1);
  }
  onTouchStart(): void {
    this.touching = true;
  }
  onTouchEnd(): void {
    this.touching = false;
  }
}
