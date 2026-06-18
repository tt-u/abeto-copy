# Attribution

This project is a **non-commercial study recreation** of the abeto studio website,
**https://abeto.co/**, rebuilt to understand how its realtime WebGL flower scene works.
It is not affiliated with, endorsed by, or sponsored by abeto.

## Original work

The original website — its visual design, the flower illustration, the overall
look-and-feel and brand — is the work of **abeto** (https://abeto.co/) and remains their
property. All rights to the original design and brand belong to abeto.

## What is original vs. borrowed in this repository

- **`src/` — the TypeScript engine.** Written from scratch for this recreation (scene
  setup, the GPU fluid solver, the GPGPU foliage, the compositing pipeline, etc.).
  Licensed under MIT — see [`LICENSE`](LICENSE).

- **`reference/` — shaders, textures, geometry and decoders.** These are design elements
  recovered from the publicly-served abeto build and reused here for study. They are
  **not** original to this project and are **not** offered under the MIT license:
  - the shaders (`reference/shaders/`), images/textures and `.drc` geometry
    (`reference/assets/`) derive from abeto's work — all rights remain with abeto;
  - the Draco and Basis/KTX2 decoders (`reference/assets/libs/`) belong to their
    respective upstream authors (Google Draco; Binomial / KTX-Software), under their own
    licenses.

  Do not redistribute or use the contents of `reference/` commercially.

## Takedown

If you are the rights holder and would like this recreation removed, please open an issue
and it will be taken down.
