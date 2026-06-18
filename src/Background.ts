// Background — clean reconstruction of the bundle's `oB` class.
// A full-screen plane (the vertex shader outputs clip space directly) with a
// noise-driven two-colour gradient. renderOrder 0 (drawn first, behind everything).

import * as THREE from "three";
import { standaloneMaterial, setColors } from "./shaderAdapter";
import { loadNoise } from "./assets";
import { theme, type Theme } from "./theme";
import particlesVert from "@shaders/particles.vert.glsl";
import particlesFrag from "@shaders/particles.frag.glsl";
import type { ScenePart } from "./types";

export class Background implements ScenePart {
  renderer: THREE.WebGLRenderer;
  group: THREE.Group;
  material: THREE.ShaderMaterial | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = "background";
    this.material = null;
  }

  async load(): Promise<THREE.Group> {
    const tNoise = await loadNoise(this.renderer);
    this.material = standaloneMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uColor1: { value: new THREE.Color(theme.background.color1) },
        uColor2: { value: new THREE.Color(theme.background.color2) },
        tNoise: { value: tNoise },
      },
      vertexShader: particlesVert,
      fragmentShader: particlesFrag,
    });
    // PlaneGeometry(2, 2, 2, 2) — spans clip space -1..1.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 2, 2), this.material);
    mesh.name = "background";
    mesh.renderOrder = 0;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return this.group;
  }

  update(deltaMs: number): void {
    this.material!.uniforms.time.value += deltaMs * 0.001;
  }

  setSize(w: number, h: number): void {
    this.material?.uniforms.resolution.value.set(w, h);
  }

  applyTheme(t: Theme): void {
    setColors(this.material, {
      uColor1: t.background.color1,
      uColor2: t.background.color2,
    });
  }
}
