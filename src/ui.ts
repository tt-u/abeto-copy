// The top-left control panel: preset palette buttons. Picking one re-themes the
// whole scene live via `onChange(theme)` (see main.ts).

import type { Theme } from "./theme";
import { presets } from "./presets";

interface PanelOptions {
  mount: HTMLElement;
  initial: Theme;
  onChange: (theme: Theme) => void;
}

export function createPanel({ mount, initial, onChange }: PanelOptions): void {
  const presetRow = document.createElement("div");
  presetRow.className = "panel-presets";
  const buttons: HTMLButtonElement[] = [];

  presets.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "panel-preset";
    btn.textContent = p.name;
    btn.style.setProperty("--dot", p.theme.flower.color1);
    if (p.theme === initial) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
      onChange(p.theme);
    });
    buttons.push(btn);
    presetRow.appendChild(btn);
  });

  mount.appendChild(presetRow);
}
