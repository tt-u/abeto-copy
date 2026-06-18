// FluidSimulation — clean npm-`three` reconstruction of the bundle's fluid solver
// (the `UL` class). It's a standard Stam/PavelDoGreat GPU fluid: ping-pong render
// targets stepped through curl → vorticity → divergence → pressure → gradient-subtract
// → advect(velocity) → advect(dye), with mouse splats injecting velocity + dye.
//
// The pass shaders are the recovered `postfx-*` GLSL — GLSL1 `RawShaderMaterial`
// shaders. The only adaptation is resolving their precision/conditional templates
// (`${e.highPrecision}` etc.); `.glsl` files stay verbatim.
//
// Outputs `velocityTexture` (drives the foliage advection) and `dyeTexture` (feeds
// the headline). Config mirrors the flower scene: simRes 128, dyeRes 256,
// curlStrength 0, splatForce 35, splatRadius 0.2, pressureIterations 2,
// dissipation density 0.88 / velocity 0.98 / pressure 0.86.

import * as THREE from "three";

import clearVert from "@shaders/postfx.vert.glsl";
import clearFrag from "@shaders/postfx.frag.glsl";
import splatVert from "@shaders/postfx-2.vert.glsl";
import splatFrag from "@shaders/postfx-2.frag.glsl";
import curlVert from "@shaders/postfx-3.vert.glsl"; // computes the curl field
import curlFrag from "@shaders/postfx-3.frag.glsl";
import vorticityVert from "@shaders/postfx-4.vert.glsl"; // applies the curl force
import vorticityFrag from "@shaders/postfx-4.frag.glsl";
import divergenceVert from "@shaders/postfx-5.vert.glsl";
import divergenceFrag from "@shaders/postfx-5.frag.glsl";
import pressureVert from "@shaders/postfx-6.vert.glsl";
import pressureFrag from "@shaders/postfx-6.frag.glsl";
import gradientVert from "@shaders/postfx-7.vert.glsl";
import gradientFrag from "@shaders/postfx-7.frag.glsl";
import advectionVert from "@shaders/postfx-8.vert.glsl";
import advectionFrag from "@shaders/postfx-8.frag.glsl";

export interface FluidConfig {
  simRes: number;
  dyeRes: number;
  pressureIterations: number;
  densityDissipation: number;
  velocityDissipation: number;
  pressureDissipation: number;
  curlStrength: number;
  splatRadius: number;
  splatForce: number;
}

// A read/write/swap pair of render targets.
interface DoubleFBOHandle {
  get read(): THREE.WebGLRenderTarget;
  get write(): THREE.WebGLRenderTarget;
  swap(): void;
}

// Resolve the material-class templates the engine used to inject. Our config:
// highp/mediump precision, line splats (no SPLAT_DOT), no borders, linear filtering.
function adaptFluid(glsl: string): string {
  return glsl
    .replace(/\$\{e\.highPrecision\}/g, "highp")
    .replace(/\$\{e\.mediumPrecision\}/g, "mediump")
    .replace(/\$\{[^}]*\}/g, ""); // remaining conditional #defines collapse to empty
}

function rawMaterial(
  vert: string,
  frag: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    vertexShader: adaptFluid(vert),
    fragmentShader: adaptFluid(frag),
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

function doubleFBO(
  w: number,
  h: number,
  type: THREE.TextureDataType,
  filter: THREE.MagnificationTextureFilter & THREE.MinificationTextureFilter,
): DoubleFBOHandle {
  const opts: THREE.RenderTargetOptions = {
    type,
    minFilter: filter,
    magFilter: filter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  };
  let read = new THREE.WebGLRenderTarget(w, h, opts);
  let write = new THREE.WebGLRenderTarget(w, h, opts);
  return {
    get read() {
      return read;
    },
    get write() {
      return write;
    },
    swap() {
      const t = read;
      read = write;
      write = t;
    },
  };
}

const DEFAULTS: FluidConfig = {
  simRes: 128,
  dyeRes: 256,
  pressureIterations: 2,
  densityDissipation: 0.88,
  velocityDissipation: 0.98,
  pressureDissipation: 0.86,
  curlStrength: 0,
  splatRadius: 0.2,
  splatForce: 35,
};

export class FluidSimulation {
  renderer: THREE.WebGLRenderer;
  cfg: FluidConfig;
  aspect: number;

  simTexel: number;
  dyeTexel: number;

  point: THREE.Vector2;
  prevPoint: THREE.Vector2;
  pointerVelocity: number;
  pointerMoved: boolean;
  private _time: number;
  private _lastSplatT: number;

  private _velocity: DoubleFBOHandle;
  private _density: DoubleFBOHandle;
  private _pressure: DoubleFBOHandle;
  private _divergence: THREE.WebGLRenderTarget;
  private _curl: THREE.WebGLRenderTarget;

  private _mClear!: THREE.RawShaderMaterial;
  private _mSplat!: THREE.RawShaderMaterial;
  private _mCurl!: THREE.RawShaderMaterial;
  private _mVorticity!: THREE.RawShaderMaterial;
  private _mDivergence!: THREE.RawShaderMaterial;
  private _mPressure!: THREE.RawShaderMaterial;
  private _mGradient!: THREE.RawShaderMaterial;
  private _mAdvection!: THREE.RawShaderMaterial;

  private _scene: THREE.Scene;
  private _camera: THREE.OrthographicCamera;
  private _quad: THREE.Mesh;

  dyeUniform: { value: THREE.Texture | null };
  velUniform: { value: THREE.Texture | null };

  constructor(renderer: THREE.WebGLRenderer, config: Partial<FluidConfig> = {}) {
    this.renderer = renderer;
    this.cfg = { ...DEFAULTS, ...config };
    this.aspect = 1;

    this.simTexel = 1 / this.cfg.simRes;
    this.dyeTexel = 1 / this.cfg.dyeRes;

    // pointer state for splatting (matches the bundle's `points[0]`)
    this.point = new THREE.Vector2(0.5, 0.5);
    this.prevPoint = new THREE.Vector2(0.5, 0.5);
    this.pointerVelocity = 0;
    this.pointerMoved = false;
    this._time = 0;
    this._lastSplatT = -1e9;

    const HALF = THREE.HalfFloatType;
    const { simRes, dyeRes } = this.cfg;
    this._velocity = doubleFBO(simRes, simRes, HALF, THREE.LinearFilter);
    this._density = doubleFBO(dyeRes, dyeRes, HALF, THREE.LinearFilter);
    this._pressure = doubleFBO(simRes, simRes, HALF, THREE.NearestFilter);
    const single = (res: number): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(res, res, {
        type: HALF,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
      });
    this._divergence = single(simRes);
    this._curl = single(simRes);

    this._buildMaterials();

    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._mClear);
    this._quad.frustumCulled = false;
    this._scene.add(this._quad);

    // Fresh render targets are UNINITIALISED (may hold NaN/Inf). Zero them, else the
    // foliage compute samples garbage velocity → NaN positions → leaves vanish.
    this._zeroTargets();

    this.dyeUniform = { value: this._density.read.texture };
    this.velUniform = { value: this._velocity.read.texture };
  }

  private _zeroTargets(): void {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevColor = new THREE.Color();
    r.getClearColor(prevColor);
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const fbo of [this._velocity, this._density, this._pressure]) {
      for (const t of [fbo.read, fbo.write]) {
        r.setRenderTarget(t);
        r.clear(true, false, false);
      }
    }
    for (const t of [this._divergence, this._curl]) {
      r.setRenderTarget(t);
      r.clear(true, false, false);
    }
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
  }

  private _buildMaterials(): void {
    const v2 = (x = 0, y = 0): { value: THREE.Vector2 } => ({ value: new THREE.Vector2(x, y) });
    this._mClear = rawMaterial(clearVert, clearFrag, {
      uTexture: { value: null },
      value: { value: 1 },
    });
    this._mSplat = rawMaterial(splatVert, splatFrag, {
      uTarget: { value: null },
      aspectRatio: { value: 1 },
      color: { value: new THREE.Vector3() },
      point: v2(0.5, 0.5),
      prevPoint: v2(0.5, 0.5),
      radius: { value: 0.2 },
      isDye: { value: false },
    });
    this._mCurl = rawMaterial(curlVert, curlFrag, {
      texelSize: v2(),
      uVelocity: { value: null },
    });
    this._mVorticity = rawMaterial(vorticityVert, vorticityFrag, {
      texelSize: v2(),
      uVelocity: { value: null },
      uCurl: { value: null },
      curl: { value: this.cfg.curlStrength },
      dt: { value: 0 },
    });
    this._mDivergence = rawMaterial(divergenceVert, divergenceFrag, {
      texelSize: v2(),
      uVelocity: { value: null },
    });
    this._mPressure = rawMaterial(pressureVert, pressureFrag, {
      texelSize: v2(),
      uPressure: { value: null },
      uDivergence: { value: null },
    });
    this._mGradient = rawMaterial(gradientVert, gradientFrag, {
      texelSize: v2(),
      uPressure: { value: null },
      uVelocity: { value: null },
    });
    this._mAdvection = rawMaterial(advectionVert, advectionFrag, {
      texelSize: v2(),
      dyeTexelSize: v2(),
      uVelocity: { value: null },
      uSource: { value: null },
      dt: { value: 0 },
      dissipation: { value: 1 },
    });
  }

  private _blit(material: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this._quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this._scene, this._camera);
  }

  /** Record the current pointer position in 0..1 space (y up). */
  setPointer(x01: number, y01: number): void {
    this.point.set(x01, y01);
    this.pointerMoved = true;
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
  }

  private _splat(): void {
    // Resume damping (bundle's `l`): the first splat after a >0.15s pause injects NO
    // velocity (just dye), so jumping the cursor / starting to move doesn't fling the
    // foliage. Without this the first frame of motion is a huge velocity spike.
    const resume = this._time - this._lastSplatT > 0.15;
    this._lastSplatT = this._time;
    if (resume) this.prevPoint.copy(this.point);

    const d = new THREE.Vector2().subVectors(this.point, this.prevPoint);
    const len = d.length();
    this.pointerVelocity += len * 2;
    if (len > 0) {
      // velocity splat
      this._mSplat.uniforms.isDye.value = false;
      this._mSplat.uniforms.uTarget.value = this._velocity.read.texture;
      this._mSplat.uniforms.aspectRatio.value = this.aspect;
      this._mSplat.uniforms.point.value.copy(this.point);
      this._mSplat.uniforms.prevPoint.value.copy(this.prevPoint);
      this._mSplat.uniforms.color.value
        .set(d.x, d.y, 0)
        .multiplyScalar(resume ? 0 : this.cfg.splatForce);
      this._mSplat.uniforms.radius.value = this.cfg.splatRadius;
      this._blit(this._mSplat, this._velocity.write);
      this._velocity.swap();
      // dye splat
      this._mSplat.uniforms.isDye.value = true;
      this._mSplat.uniforms.uTarget.value = this._density.read.texture;
      this._mSplat.uniforms.color.value.setScalar(1);
      this._blit(this._mSplat, this._density.write);
      this._density.swap();
    }
    this.prevPoint.copy(this.point);
    this.pointerVelocity = Math.min(1, this.pointerVelocity * 0.9);
  }

  /** Advance one step. dt in seconds. */
  step(dt: number): void {
    this._time += dt;
    const prevAutoClear = this.renderer.autoClear;
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.autoClear = false;

    if (this.pointerMoved) {
      this._splat();
      this.pointerMoved = false;
    }

    const dtRatio = Math.min(2, dt * 60); // frame-rate normalised step
    const frict = (v: number): number => Math.pow(v, dtRatio);
    const sTexel = this.simTexel;

    // curl
    this._mCurl.uniforms.texelSize.value.setScalar(sTexel);
    this._mCurl.uniforms.uVelocity.value = this._velocity.read.texture;
    this._blit(this._mCurl, this._curl);

    // vorticity (applies curl force; curlStrength 0 ⇒ no-op, kept for fidelity)
    this._mVorticity.uniforms.texelSize.value.setScalar(sTexel);
    this._mVorticity.uniforms.uVelocity.value = this._velocity.read.texture;
    this._mVorticity.uniforms.uCurl.value = this._curl.texture;
    this._mVorticity.uniforms.curl.value = this.cfg.curlStrength;
    this._mVorticity.uniforms.dt.value = dtRatio;
    this._blit(this._mVorticity, this._velocity.write);
    this._velocity.swap();

    // divergence
    this._mDivergence.uniforms.texelSize.value.setScalar(sTexel);
    this._mDivergence.uniforms.uVelocity.value = this._velocity.read.texture;
    this._blit(this._mDivergence, this._divergence);

    // clear pressure (decay)
    this._mClear.uniforms.uTexture.value = this._pressure.read.texture;
    this._mClear.uniforms.value.value = frict(this.cfg.pressureDissipation);
    this._blit(this._mClear, this._pressure.write);
    this._pressure.swap();

    // pressure solve (Jacobi iterations)
    this._mPressure.uniforms.texelSize.value.setScalar(sTexel);
    this._mPressure.uniforms.uDivergence.value = this._divergence.texture;
    for (let i = 0; i < this.cfg.pressureIterations; i++) {
      this._mPressure.uniforms.uPressure.value = this._pressure.read.texture;
      this._blit(this._mPressure, this._pressure.write);
      this._pressure.swap();
    }

    // gradient subtract
    this._mGradient.uniforms.texelSize.value.setScalar(sTexel);
    this._mGradient.uniforms.uPressure.value = this._pressure.read.texture;
    this._mGradient.uniforms.uVelocity.value = this._velocity.read.texture;
    this._blit(this._mGradient, this._velocity.write);
    this._velocity.swap();

    // advect velocity
    this._mAdvection.uniforms.texelSize.value.setScalar(sTexel);
    this._mAdvection.uniforms.dyeTexelSize.value.setScalar(sTexel);
    this._mAdvection.uniforms.uVelocity.value = this._velocity.read.texture;
    this._mAdvection.uniforms.uSource.value = this._velocity.read.texture;
    this._mAdvection.uniforms.dt.value = dtRatio;
    this._mAdvection.uniforms.dissipation.value = frict(this.cfg.velocityDissipation);
    this._blit(this._mAdvection, this._velocity.write);
    this._velocity.swap();

    // advect dye
    this._mAdvection.uniforms.dyeTexelSize.value.setScalar(this.dyeTexel);
    this._mAdvection.uniforms.uVelocity.value = this._velocity.read.texture;
    this._mAdvection.uniforms.uSource.value = this._density.read.texture;
    this._mAdvection.uniforms.dissipation.value = frict(this.cfg.densityDissipation);
    this._blit(this._mAdvection, this._density.write);
    this._density.swap();

    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;

    this.velUniform.value = this._velocity.read.texture;
    this.dyeUniform.value = this._density.read.texture;
  }

  get velocityTexture(): THREE.Texture {
    return this._velocity.read.texture;
  }
  get dyeTexture(): THREE.Texture {
    return this._density.read.texture;
  }
}
