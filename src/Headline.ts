// Headline — clean reconstruction of the bundle's outline-pass material (`eB`).
// This is the compositing finale: a full-screen pass that reads the scene's 2-attachment
// MRT (colour + gInfo) and
//   1. draws the signature ink OUTLINES (the `outline()` function detects edges from
//      per-object faceId / depth / normal variation in the MRT),
//   2. (a logo overlay used to go here — disabled; fed a black texture), and
//   3. runs the intro transition (uProgress1..4) and adds film grain.
//
// Outline params are the recovered `ug.flower` preset. The recovered shader is reused
// verbatim; only the Global UBO and the GLSL3 fragment output are adapted.

import * as THREE from "three";
import { loadImage, loadNoise } from "./assets";
import { setColors } from "./shaderAdapter";
import { theme, type Theme } from "./theme";
import headlineVert from "@shaders/headline-2.vert.glsl";
import headlineFrag from "@shaders/headline-2.frag.glsl";

function adapt(glsl: string, stage: "vertex" | "fragment"): string {
  let out = glsl.replace(
    /uniform\s+Global\s*\{[^}]*\}\s*;/g,
    "uniform vec2 resolution;\nuniform float time;\nuniform float dtRatio;",
  );
  if (stage === "fragment" && /\bgl_FragColor\b/.test(out)) {
    out =
      "layout(location = 0) out highp vec4 outColor;\n" +
      out.replace(/\bgl_FragColor\b/g, "outColor");
    // The whole scene is composited in linear space in this final pass; three does
    // not encode custom-ShaderMaterial output, so encode linear→sRGB here (else the
    // image renders too dark). Applied once, at the very end.
    out = out.replace(
      "outColor = vec4(sceneColor, 1.0);",
      "outColor = vec4(pow(max(sceneColor, vec3(0.0)), vec3(0.45454545)), 1.0);",
    );
  }
  return out;
}

export class Headline {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: THREE.OrthographicCamera;
  material: THREE.ShaderMaterial | null = null;
  introElapsed: number;
  quad!: THREE.Mesh;
  private _p: [number, number, number, number];

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = null;
    // Intro reveal: the four progress values ramp 0→1 with staggered delays
    // (the bundle's playInAnimation). Set introElapsed huge to skip it.
    this.introElapsed = 0;
    this._p = [0, 0, 0, 0];
  }

  /** Restart the opening animation. */
  replayIntro(): void {
    this.introElapsed = 0;
  }

  async load(): Promise<void> {
    const [tNoise, tTransition] = await Promise.all([
      loadNoise(this.renderer),
      loadImage("flower/transition-nomipmaps.jpg"),
    ]);
    // Headline logo overlay is disabled — feed a 1×1 black texture so it never draws.
    const tLogo = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    tLogo.needsUpdate = true;

    const v3 = (x: number, y: number, z: number): THREE.IUniform => ({
      value: new THREE.Vector3(x, y, z),
    });
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        resolution: { value: new THREE.Vector2(1, 1) },
        time: { value: 0 },
        dtRatio: { value: 1 },
        tDiffuse: { value: null }, // scene colour (set per frame)
        tInfo: { value: null }, // scene gInfo (set per frame)
        tLogo: { value: tLogo },
        tNoise: { value: tNoise },
        tTransition: { value: tTransition },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 100 },
        uBgColor: { value: new THREE.Color(theme.bgColor) },
        // ug.flower outline preset (thickness from the theme — raise for chunkier ink)
        uOutlineFade: { value: new THREE.Vector2(10, 80) },
        uOutlineThickness: { value: theme.ink.thickness },
        uOutlineColor: { value: new THREE.Color(theme.ink.color) },
        uOutlineScale: { value: 1 },
        uInfoRange: v3(1e-4, 2e-4, 0.1),
        uInfoMinScale: { value: 0.6 },
        uDepthRange: v3(1e-4, 0.001, 0.5),
        uNormalRange: v3(0.4, 0.5, 0.3),
        uSmoothMargin: { value: 0.2 },
        uProgress1: { value: 1 },
        uProgress2: { value: 1 },
        uProgress3: { value: 1 },
        uProgress4: { value: 1 },
      },
      vertexShader: adapt(headlineVert, "vertex"),
      fragmentShader: adapt(headlineFrag, "fragment"),
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(w: number, h: number): void {
    this.material?.uniforms.resolution.value.set(w, h);
  }

  applyTheme(t: Theme): void {
    if (!this.material) return;
    setColors(this.material, { uBgColor: t.bgColor, uOutlineColor: t.ink.color });
    this.material.uniforms.uOutlineThickness.value = t.ink.thickness;
  }

  update(deltaMs: number): void {
    if (!this.material) return;
    this.material.uniforms.time.value += deltaMs * 0.001;

    // staggered power2.out reveal (delays/duration from the bundle's playInAnimation)
    this.introElapsed += deltaMs * 0.001;
    const DURATION = 5;
    const DELAYS = [0.25, 0.45, 0.85, 1.15];
    for (let i = 0; i < 4; i++) {
      const t = Math.min(1, Math.max(0, (this.introElapsed - DELAYS[i]) / DURATION));
      this._p[i] = 1 - (1 - t) * (1 - t); // ease power2.out
    }
  }

  /** Composite the scene MRT to the screen. */
  render(sceneMRT: THREE.WebGLMultipleRenderTargets, camera: THREE.Camera): void {
    const u = this.material!.uniforms;
    u.tDiffuse.value = sceneMRT.texture[0];
    u.tInfo.value = sceneMRT.texture[1];
    u.uCameraNear.value = (camera as THREE.PerspectiveCamera).near;
    u.uCameraFar.value = (camera as THREE.PerspectiveCamera).far;
    u.uProgress1.value = this._p[0];
    u.uProgress2.value = this._p[1];
    u.uProgress3.value = this._p[2];
    u.uProgress4.value = this._p[3];
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
