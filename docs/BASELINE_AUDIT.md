# Migration Baseline Audit

Audit date: 2026-08-05

## Source Baselines

- Table-tilt current source: 43/43 Node tests passed before migration.
- Mossfall copied baseline: 30/30 modules parsed and the field test passed.
- Target had no `.git` directory, so the copied app was preserved under
  the local-only `visual-source/mossfall-20260805/` archive before replacing
  active files. The three source-equivalence fixtures needed by tests are
  tracked under `tests/fixtures/mossfall-source/`.
- `.pre-fix-backup`, `.pre-verify-backup`, and `.tmp-physics*` were not read as
  requirements and remain outside the active build.

## First-Stage Result

- Active `src/`, `tests/`, `scripts/`, package files, and build entry now come
  from the current table-tilt runtime.
- Old descent, finale, journey scoring, webcam/pose selection, custom leaf
  solver, and procedural-only audio are no longer in the active import graph.
- The copied target independently passes all 43 source behavior tests and
  builds `dist/index.html` plus the standalone package.
- Mossfall visual modules were copied into `src/mossfall/` for controlled
  integration. Their old director, physics, score, input, and audio owners were
  not copied into the active source tree.

## Final Visual Migration Result

- `TableTiltScene` now drives the Lantern Tree world at authored 30 metre depth
  intervals with the 52 degree Mossfall camera composition and a descending
  between-level handoff.
- Arbitrary Table Tilt silhouettes remain intact through
  `src/mossfall/sim/board-field-adapter.js`. The active visual owner is the
  original Mossfall `LeafPlatform` at `src/mossfall/render/leaf.js`, consuming
  the original `buildFieldMesh` implementation.
- LeafPlatform owns the blade, underside and thin edge, cell/vein material,
  burrow furniture/glow, contact shadows, resting-ball sag, activity-gated
  breathing, tilt lag, win bend, and capture ripples. `scene.js` owns only the
  Cannon capture logic, logical hole records, and a non-duplicated capture burst.
- Ball proxies retain their gameplay identity as smooth Mossfall-coloured
  spheres. Their visual and Cannon radii are identical, and the current linear
  size is 20% smaller than the preceding playtest. Eyes, brows, horns, legs,
  antennae, ghost meshes, and particle trails are removed. The earlier
  independent ball shadow is also removed so the LeafPlatform contact-shadow
  layer is the sole owner.
- Balance Board calibration uses only the 2D board/CoP UI. No 3D player guide is
  constructed, attached, or hidden off-scene.
- The active render path includes bloom extraction, separable blur, zone colour
  grading, vignette, and a direct-render fallback in
  `src/mossfall/fx/postfx.js`.
- The title, HUD, setup, modal, result, touch fallback, and responsive layouts
  use the wet forest glass language without changing their state or input
  contracts.
- `verification/current` documents the superseded adaptive implementation.
  New evidence is isolated under
  `verification/leafplatform-adapter-20260805`.

## Device-Side Residual

- Real Balance Board and target Android/Kiwii WebView acceptance remain
  external-device checks, including physical CoP feel, actual hide/show
  lifecycle events, speaker mix, and handle haptics.
> Historical record, superseded on August 6, 2026. The active implementation
> authority is `docs/game-spec.md`; Cannon, fixed-camera, spherical-only, and
> legacy-silhouette conclusions below no longer describe the product.
