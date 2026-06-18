// Named colour presets for the control panel. Each is a full Theme; pick one and the
// scene re-themes live. Add your own by copying an entry and changing the hexes.

import type { Theme } from "./theme";
import { theme as rose } from "./theme";

export interface Preset {
  name: string;
  theme: Theme;
}

const autumn: Theme = {
  flower: { color1: "#d88b3e", color2: "#ddb94c", outline: "#b84a08" },
  leaf: { color1: "#886a3d", outline: "#904619" },
  needle: { color1: "#cda05e", color2: "#ab8349", outline: "#904619" },
  stem: { color1: "#886a3d", outline: "#904619" },
  background: { color1: "#ffec95", color2: "#ecc168" },
  border: { color1: "#ecc168", color2: "#ffec95" },
  line: { color: "#ac5c36" },
  ink: { color: "#9f4a16", thickness: 1 },
  bgColor: "#ffec95",
};

const ember: Theme = {
  flower: { color1: "#c23a3a", color2: "#e08858", outline: "#7a1a1a" },
  leaf: { color1: "#3a5a3a", outline: "#22421a" },
  needle: { color1: "#5a6a3a", color2: "#3a4a1a", outline: "#22421a" },
  stem: { color1: "#2a4a2a", outline: "#163216" },
  background: { color1: "#fcefd8", color2: "#f0d0a8" },
  border: { color1: "#e8c498", color2: "#fcefd8" },
  line: { color: "#c23a3a" },
  ink: { color: "#5a1010", thickness: 1 },
  bgColor: "#fcefd8",
};

export const presets: Preset[] = [
  { name: "Rose", theme: rose },
  { name: "Autumn", theme: autumn },
  { name: "Ember", theme: ember },
];
