// Shared, lazily-created asset loaders. Singletons so the Draco / Basis workers are
// spun up once and reused across every part.
// Assets resolve at the web root (`/geometries/...`, `/images/...`, `/libs/...`),
// served by Vite from `reference/assets` (the project's `publicDir`).

import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

const ASSET_BASE = "";

let _draco: DRACOLoader | null = null;
let _ktx2: KTX2Loader | null = null;

export function dracoLoader(): DRACOLoader {
  if (!_draco) _draco = new DRACOLoader().setDecoderPath(`${ASSET_BASE}/libs/draco/`);
  return _draco;
}

export function ktx2Loader(renderer: THREE.WebGLRenderer): KTX2Loader {
  if (!_ktx2) {
    _ktx2 = new KTX2Loader()
      .setTranscoderPath(`${ASSET_BASE}/libs/basis/`)
      .detectSupport(renderer);
  }
  return _ktx2;
}

export function loadGeometry(name: string): Promise<THREE.BufferGeometry> {
  return dracoLoader().loadAsync(`${ASSET_BASE}/geometries/${name}`);
}

export async function loadTexture(
  renderer: THREE.WebGLRenderer,
  name: string,
  { srgb = false, repeat = false }: { srgb?: boolean; repeat?: boolean } = {},
): Promise<THREE.Texture> {
  const tex = await ktx2Loader(renderer).loadAsync(`${ASSET_BASE}/images/${name}`);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Regular (non-KTX2) image loader — e.g. the transition JPG.
export function loadImage(
  name: string,
  { repeat = false }: { repeat?: boolean } = {},
): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(`${ASSET_BASE}/images/${name}`).then((t) => {
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

// The shared noise texture every flower shader samples (`tNoise`).
// The engine loads it "srgb-repeat"; we use repeat here to match the verified petal.
export function loadNoise(renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
  return loadTexture(renderer, "flower/noise-simplex-layered.ktx2", { repeat: true });
}
