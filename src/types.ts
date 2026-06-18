import type { Camera, Group } from "three";
import type { Theme } from "./theme";

// Every flower part follows this shape. `update`, `setSize` and `applyTheme` are optional.
export interface ScenePart {
  load(): Promise<Group>;
  update?(deltaMs: number, camera: Camera): void;
  setSize?(width: number, height: number): void;
  // Re-colour live from a Theme (used by the control panel).
  applyTheme?(theme: Theme): void;
}
