// Standalone demo — the full migrated flower scene on npm `three`.
//
// Pipeline (mirrors the bundle):
//   1. fluid sim step  → velocity + dye fields
//   2. parts update    → foliage GPGPU advection, petal/line animation
//   3. render the scene into a 2-attachment MRT (colour + gInfo) — NOT to the screen
//   4. Headline pass reads the MRT, draws the ink outlines + logo, composites to screen
//
// Dev only: http://127.0.0.1:4173/src/three-migration/demo.html
// Errors (shader-compile, asset-load, anything thrown) are shown ON THE PAGE.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Background } from "./Background";
import { Border } from "./Border";
import { Petal } from "./Petal";
import { Foliage, LEAF, NEEDLE, STEM } from "./Foliage";
import { FluidSimulation } from "./FluidSimulation";
import { Line } from "./Line";
import { Headline } from "./Headline";
import { theme, type Theme } from "./theme";
import { createPanel, type PanelHandle } from "./ui";
import { seasonTheme, seasonName, seasonForm } from "./seasons";
import { Ambient } from "./audio";

const ambient = new Ambient();

// Seconds for one full year (spring → summer → autumn → winter → spring).
const SEASON_CYCLE = 64;
import type { ScenePart } from "./types";

function showError(title: string, detail: string): void {
  console.error(`[flower-demo] ${title}\n`, detail);
  let el = document.getElementById("err");
  if (!el) {
    el = document.createElement("pre");
    el.id = "err";
    el.style.cssText =
      "position:fixed;inset:0;margin:0;padding:16px;color:#7a1f00;background:#fff7e0;" +
      "font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow:auto;z-index:9";
    document.body.appendChild(el);
  }
  el.textContent += `\n● ${title}\n${detail}\n`;
}
addEventListener("error", (e: ErrorEvent) => showError("window error", e.message));
addEventListener("unhandledrejection", (e: PromiseRejectionEvent) =>
  showError("unhandled promise rejection", e.reason?.stack || String(e.reason)),
);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(theme.bgColor);
document.body.appendChild(renderer.domElement);

// Avoid a one-frame flash of the page background before the scene loads: paint the
// page + canvas with the theme colour up front (and keep the page in sync with theme).
document.documentElement.style.backgroundColor = theme.bgColor;
renderer.clear();

renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = (s: WebGLShader): string => gl.getShaderInfoLog(s) || "";
  showError("shader compile error", `VERTEX:\n${log(vs)}\nFRAGMENT:\n${log(fs)}`);
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, 4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// 2-attachment scene target: texture[0] = colour (.a = per-object faceId),
// texture[1] = gInfo (depth/normal/edge). NearestFilter so the outline reads exact
// per-object values. r161 uses WebGLMultipleRenderTargets.
const dbs = new THREE.Vector2();
renderer.getDrawingBufferSize(dbs);
const sceneMRT = new THREE.WebGLMultipleRenderTargets(dbs.x, dbs.y, 2, {
  type: THREE.HalfFloatType,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  format: THREE.RGBAFormat,
  depthBuffer: true,
});

// splatForce lowered from the bundle's 35 — gentler push so the foliage drifts with
// the cursor instead of getting flung across the wrap boundary (which strobed).
const fluid = new FluidSimulation(renderer, { splatForce: 18 });
const petal: Petal = new Petal(renderer);
const line: Line = new Line(renderer);
const headline = new Headline(renderer);
const parts: ScenePart[] = [
  new Background(renderer), // renderOrder 0
  new Foliage(renderer, LEAF, fluid), // 1 — fluid-advected
  new Foliage(renderer, NEEDLE, fluid), // 1 — fluid-advected
  new Border(renderer), // 2
  petal, // 3 — depth-tested (self-occludes)
  new Foliage(renderer, STEM, fluid), // 4 — fluid-advected
  line, // 5 — pointer trail
];

function sizeAll(): void {
  renderer.getDrawingBufferSize(dbs);
  sceneMRT.setSize(dbs.x, dbs.y);
  for (const p of parts) p.setSize?.(dbs.x, dbs.y);
  headline.setSize(dbs.x, dbs.y);
}

(async function start(): Promise<void> {
  try {
    for (const p of parts) scene.add(await p.load());
    await headline.load();
  } catch (err) {
    showError("load failed (asset/decoder issue)", (err as Error)?.stack || String(err));
    return;
  }
  sizeAll();
  console.log("[flower-demo] loaded", parts.length, "parts + headline");

  // Live re-theming: applied to every part + the headline + the page background.
  function setTheme(next: Theme): void {
    for (const p of parts) p.applyTheme?.(next);
    headline.applyTheme(next);
    renderer.setClearColor(next.bgColor);
    document.documentElement.style.backgroundColor = next.bgColor;
  }
  // Seasons cycle on by default; picking a static preset stops it.
  let seasonsOn = true;
  let seasonElapsed = 0;
  let seasonTick = 0;
  let panel: PanelHandle | null = null;
  const controlsEl = document.getElementById("controls");
  if (controlsEl) {
    panel = createPanel({
      mount: controlsEl,
      seasonsOn,
      onPreset: (t) => {
        seasonsOn = false;
        setTheme(t);
        petal.setForm(1); // static palette → full bloom
      },
      onSeasons: (on) => {
        seasonsOn = on;
      },
      trackNames: ["Track 1", "Track 2"],
      onPlay: (i) => ambient.play(i),
      onStop: () => ambient.stop(),
    });
  }
  setTheme(seasonTheme(0, SEASON_CYCLE)); // start on spring
  petal.setForm(seasonForm(0, SEASON_CYCLE));

  addEventListener("wheel", (e: WheelEvent) => petal.onWheel(e.deltaX, e.deltaY), {
    passive: true,
  });

  const trailRay = new THREE.Raycaster();
  const trailPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2();
  const worldHit = new THREE.Vector3();
  addEventListener("pointermove", (e: PointerEvent) => {
    fluid.setPointer(e.clientX / innerWidth, 1 - e.clientY / innerHeight);
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    trailRay.setFromCamera(ndc, camera);
    if (trailRay.ray.intersectPlane(trailPlane, worldHit)) line.setPointerWorld(worldHit);
  });
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    sizeAll();
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();

    // beat-sync: let the flower breathe gently in time with the music (no jerks)
    petal.setPulse(ambient.running ? ambient.pulse() : 0);

    // advance the seasons (re-theme a few times a second while the cycle runs)
    if (seasonsOn) {
      seasonElapsed += dt;
      seasonTick += dt;
      if (seasonTick >= 0.1) {
        seasonTick = 0;
        const bloom = seasonForm(seasonElapsed, SEASON_CYCLE);
        setTheme(seasonTheme(seasonElapsed, SEASON_CYCLE));
        petal.setForm(bloom);
        ambient.setMood(bloom); // brighter sound in summer, cold in winter
        panel?.setSeason(seasonName(seasonElapsed, SEASON_CYCLE));
      }
    }

    fluid.setAspect(renderer.domElement.width / renderer.domElement.height);
    fluid.step(dt);
    controls.update();
    camera.updateMatrixWorld();
    for (const p of parts) p.update?.(dt * 1000, camera);
    headline.update(dt * 1000);

    // 1) render the scene into the MRT (colour + gInfo)
    renderer.autoClear = true;
    renderer.setRenderTarget(sceneMRT);
    renderer.render(scene, camera);

    // 2) composite outlines + logo to the screen
    headline.render(sceneMRT, camera);
  });
})();
