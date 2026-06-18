// Four-seasons cycle: spring bloom → summer → autumn → winter "snow" → spring, looping.
// Each season is a full Theme; the scene smoothly interpolates between them over time.
// (Winter recolours the already-falling foliage to white, so it reads as falling snow.)

import * as THREE from "three";
import type { Theme } from "./theme";

const spring: Theme = {
  flower: { color1: "#e87aa0", color2: "#f6bcd2", outline: "#c0466e" },
  leaf: { color1: "#6aa048", outline: "#3c6a2a" },
  needle: { color1: "#7aae5a", color2: "#5a8a3a", outline: "#3c6a2a" },
  stem: { color1: "#5a8a3a", outline: "#2e521f" },
  background: { color1: "#fce8f0", color2: "#f2cee0" },
  border: { color1: "#ecb6cc", color2: "#fce8f0" },
  line: { color: "#d05a85" },
  ink: { color: "#b03a64", thickness: 1 },
  bgColor: "#fce8f0",
};

const summer: Theme = {
  flower: { color1: "#e24a72", color2: "#f088a4", outline: "#962a4c" },
  leaf: { color1: "#3c8030", outline: "#265018" },
  needle: { color1: "#4c9038", color2: "#2e6020", outline: "#265018" },
  stem: { color1: "#2e6824", outline: "#1a3e12" },
  background: { color1: "#eef6dc", color2: "#d8e8b8" },
  border: { color1: "#cfe0a8", color2: "#eef6dc" },
  line: { color: "#c84068" },
  ink: { color: "#7a2440", thickness: 1 },
  bgColor: "#eef6dc",
};

const autumn: Theme = {
  flower: { color1: "#d88b3e", color2: "#e2bd54", outline: "#9a4410" },
  leaf: { color1: "#a86c2e", outline: "#6e4418" },
  needle: { color1: "#c2964e", color2: "#92662e", outline: "#6e4418" },
  stem: { color1: "#8a5824", outline: "#543214" },
  background: { color1: "#f6e8c2", color2: "#ecd49a" },
  border: { color1: "#e2c486", color2: "#f6e8c2" },
  line: { color: "#b85c2c" },
  ink: { color: "#7e3a12", thickness: 1 },
  bgColor: "#f6e8c2",
};

const winter: Theme = {
  flower: { color1: "#d9c6cf", color2: "#ece0e6", outline: "#9a8a94" },
  leaf: { color1: "#eef3f8", outline: "#c2cedc" },
  needle: { color1: "#e4ecf5", color2: "#cdd8e6", outline: "#c2cedc" },
  stem: { color1: "#d8e2ee", outline: "#b0bccc" },
  background: { color1: "#eaf1f8", color2: "#d4e0ee" },
  border: { color1: "#cdd8e6", color2: "#eaf1f8" },
  line: { color: "#9aabc0" },
  ink: { color: "#7e8ea2", thickness: 1 },
  bgColor: "#eaf1f8",
};

// `bloom`: how open the flower is in that season (0 = tight bud, 1 = full bloom).
export const SEASONS: { name: string; theme: Theme; bloom: number }[] = [
  { name: "Spring", theme: spring, bloom: 0.4 },
  { name: "Summer", theme: summer, bloom: 1.0 },
  { name: "Autumn", theme: autumn, bloom: 0.75 },
  { name: "Winter", theme: winter, bloom: 0.28 },
];

// --- interpolation --------------------------------------------------------
const _a = new THREE.Color();
const _b = new THREE.Color();

function lerpVal(a: any, b: any, t: number): any {
  if (typeof a === "number") return a + (b - a) * t;
  if (typeof a === "string") return "#" + _a.set(a).lerp(_b.set(b), t).getHexString();
  const out: any = {};
  for (const k of Object.keys(a)) out[k] = lerpVal(a[k], b[k], t);
  return out;
}

export function lerpTheme(a: Theme, b: Theme, t: number): Theme {
  return lerpVal(a, b, t) as Theme;
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

// `elapsedSec` of wall-clock time mapped onto a `cycleSec`-long year. Each season holds
// for a beat, then smoothly morphs into the next.
export function seasonTheme(elapsedSec: number, cycleSec: number): Theme {
  const n = SEASONS.length;
  const phase = ((elapsedSec % cycleSec) / cycleSec) * n; // 0..n
  const i = Math.floor(phase) % n;
  const j = (i + 1) % n;
  const local = phase - Math.floor(phase); // 0..1 within the season
  const HOLD = 0.5; // dwell at the season for the first half of its slot
  const t = local < HOLD ? 0 : smoothstep((local - HOLD) / (1 - HOLD));
  return lerpTheme(SEASONS[i].theme, SEASONS[j].theme, t);
}

export function seasonName(elapsedSec: number, cycleSec: number): string {
  const n = SEASONS.length;
  const phase = ((elapsedSec % cycleSec) / cycleSec) * n;
  return SEASONS[Math.floor(phase) % n].name;
}

// Interpolated flower openness for the current point in the cycle (same easing as the
// colour transition), 0 = bud, 1 = full bloom.
export function seasonForm(elapsedSec: number, cycleSec: number): number {
  const n = SEASONS.length;
  const phase = ((elapsedSec % cycleSec) / cycleSec) * n;
  const i = Math.floor(phase) % n;
  const j = (i + 1) % n;
  const local = phase - Math.floor(phase);
  const HOLD = 0.5;
  const t = local < HOLD ? 0 : smoothstep((local - HOLD) / (1 - HOLD));
  return SEASONS[i].bloom + (SEASONS[j].bloom - SEASONS[i].bloom) * t;
}
