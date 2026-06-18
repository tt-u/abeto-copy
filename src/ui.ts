// The top-left control panel: a four-seasons toggle + static palette presets.
// Picking a preset stops the seasonal cycle; toggling Seasons resumes it.

import type { Theme } from "./theme";
import { presets } from "./presets";

interface PanelOptions {
  mount: HTMLElement;
  onPreset: (theme: Theme) => void;
  onSeasons: (on: boolean) => void;
  onPlay: (track: number) => void;
  onStop: () => void;
  trackNames: string[];
  seasonsOn: boolean;
}

export interface PanelHandle {
  // Called from the render loop while the cycle runs, to show the current season.
  setSeason(name: string | null): void;
}

export function createPanel({
  mount,
  onPreset,
  onSeasons,
  onPlay,
  onStop,
  trackNames,
  seasonsOn,
}: PanelOptions): PanelHandle {
  let active = seasonsOn;

  // --- seasons toggle -------------------------------------------------------
  const seasonsBtn = document.createElement("button");
  seasonsBtn.type = "button";
  seasonsBtn.className = "panel-seasons";
  seasonsBtn.textContent = "⟳ Seasons";

  const presetRow = document.createElement("div");
  presetRow.className = "panel-presets";
  const buttons: HTMLButtonElement[] = [];

  function syncSeasonsBtn(): void {
    seasonsBtn.classList.toggle("is-active", active);
    if (active) buttons.forEach((b) => b.classList.remove("is-active"));
  }

  seasonsBtn.addEventListener("click", () => {
    active = !active;
    if (!active) seasonsBtn.textContent = "⟳ Seasons";
    syncSeasonsBtn();
    onSeasons(active);
  });

  // --- static presets -------------------------------------------------------
  presets.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "panel-preset";
    btn.textContent = p.name;
    btn.style.setProperty("--dot", p.theme.flower.color1);
    btn.addEventListener("click", () => {
      active = false;
      seasonsBtn.textContent = "⟳ Seasons";
      seasonsBtn.classList.remove("is-active");
      buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
      onPreset(p.theme);
    });
    buttons.push(btn);
    presetRow.appendChild(btn);
  });

  // --- music: pick a track (click the playing one again to stop) ------------
  const musicRow = document.createElement("div");
  musicRow.className = "panel-music";
  const musicBtns: HTMLButtonElement[] = [];
  let playing: number | null = null; // index of the track currently playing, or null
  trackNames.forEach((name, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "panel-music-btn";
    btn.textContent = `♪ ${name}`;
    btn.addEventListener("click", () => {
      if (playing === i) {
        playing = null;
        onStop();
      } else {
        playing = i;
        onPlay(i);
      }
      musicBtns.forEach((b, k) => b.classList.toggle("is-active", playing === k));
    });
    musicBtns.push(btn);
    musicRow.appendChild(btn);
  });

  syncSeasonsBtn();
  mount.append(seasonsBtn, presetRow, musicRow);

  return {
    setSeason(name: string | null): void {
      if (active && name) seasonsBtn.textContent = `⟳ ${name}`;
    },
  };
}
