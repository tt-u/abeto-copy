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

// Touch devices (phones/tablets) are usually fill-rate bound on the fluid sim + MRT,
// so cap the pixel ratio a little lower there than on desktop.
const isTouch = matchMedia("(pointer: coarse)").matches || innerWidth < 640;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.25 : 1.5));
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
// Pan would slide the flower off-centre (and move the orbit target off the origin the
// pointer-trail plane is anchored to), so keep it to rotate + zoom only.
controls.enablePan = false;

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

// First-load overlay: a themed cover that hides the empty canvas while the Draco/KTX2
// assets decode, then fades out on the first rendered frame so the scene reveals through
// the intro ramp instead of popping in. Removed from the DOM after the fade.
const loadingEl = document.getElementById("loading");
function dismissLoading(): void {
  if (!loadingEl || loadingEl.classList.contains("is-hidden")) return;
  loadingEl.classList.add("is-hidden");
  loadingEl.addEventListener("transitionend", () => loadingEl.remove(), { once: true });
}

(async function start(): Promise<void> {
  try {
    for (const p of parts) scene.add(await p.load());
    await headline.load();
  } catch (err) {
    showError("load failed (asset/decoder issue)", (err as Error)?.stack || String(err));
    dismissLoading(); // uncover the page so the error overlay is visible
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

  // Pointer trail. We keep only the latest screen-space NDC here and re-project it onto
  // the trail plane every frame (below), so the trail stays glued to the cursor even
  // while the camera is moving under its own inertia. The plane is rebuilt each frame to
  // face the camera through the origin — a fixed world plane goes edge-on as you orbit,
  // which is what made the cursor swing wildly during fast rotation.
  const trailRay = new THREE.Raycaster();
  const trailPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const camForward = new THREE.Vector3();
  const ndc = new THREE.Vector2();
  const worldHit = new THREE.Vector3();
  let hasPointer = false;

  // While the user is orbiting, the same drag would otherwise paint a trail across the
  // rotating view; freeze it during the drag and re-snap to the cursor on release.
  let orbiting = false;
  controls.addEventListener("start", () => {
    orbiting = true;
  });
  controls.addEventListener("end", () => {
    orbiting = false;
    line.snap();
  });

  addEventListener("pointermove", (e: PointerEvent) => {
    fluid.setPointer(e.clientX / innerWidth, 1 - e.clientY / innerHeight);
    if (orbiting) return; // dragging to rotate — don't drive the trail
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    hasPointer = true;
  });
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    sizeAll();
  });

  const clock = new THREE.Clock();
  let firstFrame = true;
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();

    // beat-sync: drive the flower's own animation speed with the music's beat (no scaling)
    petal.setBeat(ambient.running ? ambient.pulse() : 0);

    // advance the seasons (re-theme a few times a second while the cycle runs)
    if (seasonsOn) {
      seasonElapsed += dt;
      const bloom = seasonForm(seasonElapsed, SEASON_CYCLE);
      // Bloom drives the petal geometry, so update it EVERY frame — stepping it at 10fps
      // made the flower judder on the big spring→summer opening. It's just a uniform write,
      // so it's cheap; only the colour re-theme below is throttled.
      petal.setForm(bloom);
      seasonTick += dt;
      if (seasonTick >= 0.1) {
        seasonTick = 0;
        setTheme(seasonTheme(seasonElapsed, SEASON_CYCLE));
        ambient.setMood(bloom); // brighter sound in summer, cold in winter
        panel?.setSeason(seasonName(seasonElapsed, SEASON_CYCLE));
      }
    }

    fluid.setAspect(renderer.domElement.width / renderer.domElement.height);
    fluid.step(dt);
    controls.update();
    camera.updateMatrixWorld();

    // Re-project the cursor onto a camera-facing plane through the origin every frame,
    // using the up-to-date camera. This keeps the trail under the cursor while the
    // camera is still settling, and never goes ill-conditioned at grazing angles.
    if (hasPointer && !orbiting) {
      camera.getWorldDirection(camForward).negate();
      trailPlane.setFromNormalAndCoplanarPoint(camForward, scene.position);
      trailRay.setFromCamera(ndc, camera);
      if (trailRay.ray.intersectPlane(trailPlane, worldHit)) line.setPointerWorld(worldHit);
    }

    for (const p of parts) p.update?.(dt * 1000, camera);
    headline.update(dt * 1000);

    // 1) render the scene into the MRT (colour + gInfo)
    renderer.autoClear = true;
    renderer.setRenderTarget(sceneMRT);
    renderer.render(scene, camera);

    // 2) composite outlines + logo to the screen
    headline.render(sceneMRT, camera);

    // first real frame is on screen — fade the loading cover away
    if (firstFrame) {
      firstFrame = false;
      dismissLoading();
    }
  });
})();
