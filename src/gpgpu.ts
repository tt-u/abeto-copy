// Tiny GPGPU helpers shared by the fluid sim and the foliage position compute:
// a full-screen blitter and a 2-attachment (MRT) float render target.

import * as THREE from "three";

export class Blitter {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  blit(
    renderer: THREE.WebGLRenderer,
    material: THREE.Material,
    target: THREE.WebGLRenderTarget | null,
  ): void {
    this.quad.material = material;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }
}

// A single-texture float ping-pong (read/write/swap) — for the line trail.
export class DoubleFBO {
  private _a: THREE.WebGLRenderTarget;
  private _b: THREE.WebGLRenderTarget;

  constructor(w: number, h: number) {
    const opts = {
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this._a = new THREE.WebGLRenderTarget(w, h, opts);
    this._b = new THREE.WebGLRenderTarget(w, h, opts);
  }
  get read(): THREE.WebGLRenderTarget {
    return this._a;
  }
  get write(): THREE.WebGLRenderTarget {
    return this._b;
  }
  swap(): void {
    const t = this._a;
    this._a = this._b;
    this._b = t;
  }
}

// A 2-attachment float MRT target (texture[0] = position, texture[1] = velocity).
// three r161 uses WebGLMultipleRenderTargets (the `count` option on WebGLRenderTarget
// only landed in r162); its attachments live in the `.texture` ARRAY.
export function makeMRT(res: number): THREE.WebGLMultipleRenderTargets {
  return new THREE.WebGLMultipleRenderTargets(res, res, 2, {
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
}
