# abeto — copy

> **Disclaimer.** This is a **non-commercial, AI-assisted study recreation** of the abeto
> studio website, [abeto.co](https://abeto.co/). The TypeScript engine was rebuilt by AI
>  to understand how the original realtime WebGL scene works; the
> **art and design assets** under `reference/` — shaders, textures and geometry — were
> **recovered from abeto's publicly-served build and reused for study**. This project is not
> affiliated with, endorsed by, or sponsored by abeto. All original design and assets remain
> the property of abeto and the respective upstream authors. See
> [`ATTRIBUTION.md`](ATTRIBUTION.md). Only the `src/` engine code is MIT-licensed
> ([`LICENSE`](LICENSE)).

An interactive WebGL flower scene: a fluid-driven bed of falling foliage around an
animated bloom, with hand-drawn ink outlines, a pointer trail, a dissolve-in intro, and a
small palette switcher. Built with **Vite + TypeScript + three.js**.

## Run

```sh
npm install
npm run dev        # http://127.0.0.1:4173
npm run build      # type-check + production build → dist/
npm run preview
npm run typecheck  # tsc --noEmit
```

## Attribution

- **`src/` — the engine.** Original code written for this recreation (scene setup, the GPU
  fluid solver, the GPGPU foliage, the MRT/outline compositing). MIT-licensed.
- **`reference/` — the design.** Shaders, textures and `.drc` geometry recovered from the
  deployed abeto site; the Draco / Basis decoders under `reference/assets/libs/` belong to
  their upstream authors. **Not** MIT, **not** for redistribution or commercial use — all
  rights remain with abeto and the respective authors. See [`ATTRIBUTION.md`](ATTRIBUTION.md).

If you are the rights holder and want this taken down, please open an issue.

## Layout

```
index.html              entry + the top-left palette panel (loads /src/main.ts)
src/                    the engine — TypeScript
  main.ts               bootstraps the scene + render loop + live re-theming
  theme.ts              Theme type + the default palette
  presets.ts            named palettes (Rose / Autumn / Ember)
  ui.ts                 the palette-switcher panel
  types.ts              the ScenePart interface
  core: assets.ts, shaderAdapter.ts, gpgpu.ts   (loaders, GLSL adapters, GPGPU helpers)
  parts: Background.ts, Border.ts, Petal.ts, Foliage.ts, Line.ts, Headline.ts
  sim: FluidSimulation.ts                        (GPU fluid solver)
reference/             the recovered design elements (study material — see Attribution)
  shaders/             the GLSL used by the scene
  assets/              geometry (.drc), textures (.ktx2/.jpg), libs (draco + basis decoders)
```

`reference/assets` is Vite's `publicDir` (served at the web root: `/geometries`, `/images`,
`/libs`). Shaders are imported through the `@shaders` alias, e.g.
`import petalFrag from "@shaders/petal.frag.glsl"`.

## How it renders (per frame)

1. **Fluid sim** steps a velocity + dye field (mouse splats stir it).
2. **Parts update** — the foliage runs a GPGPU advection (a 2-attachment MRT ping-pong)
   pushed by the fluid velocity; the petal and line animate.
3. The whole scene renders into a **2-attachment MRT** (colour + packed depth/normal/edge).
4. The **Headline pass** reads that MRT, draws the ink outlines, runs the intro reveal,
   and composites to the screen.

## Tweaking

- **Palettes:** pick one in the top-left panel (live), or edit `src/presets.ts` to add/change
  one. The default palette and the `Theme` shape live in `src/theme.ts`.
- **Panel look:** the `.panel { --panel-* }` variables in `index.html`.
- **Outline weight:** `theme.ink.thickness` (global — affects every silhouette).
- **Pointer force / feel:** `splatForce` in `src/main.ts`; the foliage velocity clamp in
  `src/Foliage.ts`.
- **Intro animation:** `DURATION` / `DELAYS` in `src/Headline.ts` (`headline.replayIntro()`
  replays it).
