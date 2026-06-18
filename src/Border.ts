// Border — clean reconstruction of the bundle's `lB` class.
// A clip-space frame (Draco `border.drc`, positions snapped to integers) pushed to
// the screen edges by pixel amounts scaled with `uRes`; cuts a notch for the email
// icon. renderOrder 2. Needs `uRes` = canvas size (set in setSize / on resize).

import * as THREE from "three";
import { standaloneMaterial, setColors } from "./shaderAdapter";
import { loadGeometry, loadNoise } from "./assets";
import { theme, type Theme } from "./theme";
import particles2Vert from "@shaders/particles-2.vert.glsl";
import particles2Frag from "@shaders/particles-2.frag.glsl";
import type { ScenePart } from "./types";

export class Border implements ScenePart {
  renderer: THREE.WebGLRenderer;
  group: THREE.Group;
  material: THREE.ShaderMaterial | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = "border";
    this.material = null;
  }

  async load(): Promise<THREE.Group> {
    const [geometry, tNoise] = await Promise.all([
      loadGeometry("border.drc"),
      loadNoise(this.renderer),
    ]);
    // positions are pre-quantised in the asset; snap to integers like the original
    const pos = geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i++) pos[i] = Math.round(pos[i]);
    geometry.attributes.position.needsUpdate = true;

    this.material = standaloneMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uBorderSizePixels: { value: 64 },
        uNotchSizePixels: { value: new THREE.Vector2(384, 103) },
        uColor1: { value: new THREE.Color(theme.border.color1) },
        uColor2: { value: new THREE.Color(theme.border.color2) },
        tNoise: { value: tNoise },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: particles2Vert,
      fragmentShader: particles2Frag,
    });

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = "border";
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return this.group;
  }

  update(deltaMs: number): void {
    this.material!.uniforms.time.value += deltaMs * 0.001;
  }

  setSize(w: number, h: number): void {
    if (!this.material) return;
    this.material.uniforms.resolution.value.set(w, h);
    this.material.uniforms.uRes.value.set(w, h);
  }

  applyTheme(t: Theme): void {
    setColors(this.material, {
      uColor1: t.border.color1,
      uColor2: t.border.color2,
    });
  }
}
