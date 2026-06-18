// The colour theme for the whole flower scene. `theme` is the default (loaded at
// startup); the control panel can swap in any `Theme` at runtime (see presets.ts).
// Every part reads its colours from a Theme — both when it builds (load) and when the
// panel re-themes it live (applyTheme).

export interface Theme {
  flower: { color1: string; color2: string; outline: string };
  leaf: { color1: string; outline: string };
  needle: { color1: string; color2: string; outline: string };
  stem: { color1: string; outline: string };
  background: { color1: string; color2: string };
  border: { color1: string; color2: string };
  line: { color: string };
  // global ink OUTLINE (Headline pass). `thickness` affects every silhouette.
  ink: { color: string; thickness: number };
  // page / headline background colour
  bgColor: string;
}

// Default palette: "Pink Rose".
export const theme: Theme = {
  flower: { color1: "#e87aa0", color2: "#f4b8cd", outline: "#b83a6a" },
  leaf: { color1: "#5a7a4a", outline: "#3a5230" },
  needle: { color1: "#6a8a5a", color2: "#4a6a42", outline: "#3a5230" },
  stem: { color1: "#4a6a3a", outline: "#2a4222" },
  background: { color1: "#fce8f0", color2: "#f0c8da" },
  border: { color1: "#e8a8c2", color2: "#fce8f0" },
  line: { color: "#d05a85" },
  ink: { color: "#8a2a4a", thickness: 1 },
  bgColor: "#fce8f0",
};
