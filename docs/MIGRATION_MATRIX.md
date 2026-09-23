# Table Tilt -> Mossfall Migration Matrix

Baseline date: 2026-08-05

## Authority

1. Mossfall leaf rendering and visual behavior:
   `D:\KiwiiGit\Kiwii-AI\mossfall` current runtime and source.
2. Table Tilt gameplay behavior and data: this target's unchanged
   `src/levels.js`, `src/physics.js`, `src/core.js`, and `src/input.js`.
3. Source-equivalence snapshots:
   `tests/fixtures/mossfall-source`.
4. Local-only full visual archive:
   `visual-source/mossfall-20260805` (excluded from publication).

When the 2026-08-05 runtime source conflicts with the 2026-08-04 rebuild pack,
the runtime source wins by PM ruling. Each conflict is recorded below.

## Legacy Module Disposition

| Original mossfall area | Decision | Active replacement / retained use | Verification |
| --- | --- | --- | --- |
| `src/game/director.js` descent/finale state machine | REPLACE | `src/controller.js` table-tilt state machine | State snapshot and browser flow |
| `src/game/score.js` accuracy/smoothness/fall scoring | REPLACE | `src/core.js::scoreRun` and mode star thresholds in `src/ui.js` | Node score vectors |
| `src/sim/physics.js` custom leaf solver and speed-gated capture | REPLACE | cannon-es world in `src/scene.js`; capture helpers in `src/physics.js` | Physics/capture tests |
| `src/data/levels.js` leaf/descent level data | REPLACE | 16 deterministic boards in `src/levels.js` | Level count, containment, route tests |
| `src/input/pose.js` and webcam-first picker | REPLACE | `src/input.js` Balance Board CoP first, keyboard/touch fallback | Input tests and runtime snapshots |
| `src/core/audio.js` procedural-only soundscape | REPLACE | `src/audio.js` local dual BGM + 13 sampled SFX + procedural fallback | Audio tests and browser report |
| Old root `index.html` journey/descent screens | REPLACE | table-tilt screen contract in `src/index.html` / `dist/index.html` | DOM/state screenshots |
| `src/render/world.js` Lantern Tree environment | VISUAL ACTIVE | `src/mossfall/render/world.js`, driven by 30 m table-level depth positions and camera descent | Nonblank canvas, zone and handoff screenshots |
| `src/render/lighting.js` forest lighting/fog | VISUAL ACTIVE | `src/mossfall/render/lighting.js`, focused on the active depth with soft VSM shadows | Canvas pixels and level-zone captures |
| `src/fx/particles.js` pollen/firefly/event pools | VISUAL ACTIVE | `src/mossfall/fx/particles.js`, including board-local event transforms | Capture/fall/clear screenshots |
| `src/fx/postfx.js` bloom/grade/vignette | VISUAL ACTIVE | target-adapted implementation at `src/mossfall/fx/postfx.js` with direct-render fallback | PostFX contract test and browser captures |
| Mossfall beetle colour/material language | ADAPTED | smooth opaque spherical balls in `src/scene.js`, using the Mossfall palette and clearcoat shell response; LeafPlatform owns the single contact-shadow layer; no spherical glow or halo, eyes, brows, horns, legs, antennae, ghost meshes, or particle trails | Rolling/capture/fall browser checks plus locked spherical-ball metrics |
| `src/data/palette.js` forest/insect palette | VISUAL ONLY | copied to `src/mossfall/data/palette.js` | CSS/scene palette review |
| `src/render/leaf.js` leaf surface language | REUSED | runtime imports `src/mossfall/render/leaf.js::LeafPlatform`; the module calls the original `buildFieldMesh`, builds blade/underside/thin edge, burrow furniture/glow, dynamic contact shadows, sag, activity-gated breathing, tilt lag, win bend, and capture ripples | Adapter tests, source-equivalence test, runtime owner metrics, gameplay captures |
| `src/sim/field.js::buildFieldMesh` | REUSED | verbatim Mossfall module at `src/mossfall/sim/field.js`, fed by `BoardFieldAdapter` | Source-equivalence test and all-level mesh test |
| `src/render/props.js` organic burrows/props | REUSED / FILTERED | verbatim `BoardProps` owner is constructed by LeafPlatform; route-blocking authored props/movers are omitted because Table Tilt already owns collider visuals and has no matching Mossfall prop records | Source-equivalence and single-owner tests |
| Table Tilt arbitrary board geometry | ADAPTER | `src/mossfall/sim/board-field-adapter.js` exposes `sdf`, `visualSdf`, `height`, exact gradient/normal, veins, holes, samples, and edge projection for all 16 existing shapes without changing level or physics data | 16-level sign, hole, mesh, ring, overlap, and separated-platform tests |
| `src/game/camera.js` depth composition | ADAPTED | 52 degree camera, 480 m far plane, per-level depth, parallax world treadmill, and descending handoff in `src/scene.js` | Handoff runtime trace and screenshots |
| Old CSS design language | REPLACED | retained only in the local migration archive; wet forest glass title/HUD/panels are active in `src/styles.css` | Desktop/mobile layout captures |

The complete pre-migration app remains preserved read-only in the local-only
`visual-source/mossfall-20260805/` archive. Runtime modules are maintained as
active copies under `src/mossfall/`; the archived tree itself is not imported
or published. The three source-equivalence references required by automated
tests are tracked under `tests/fixtures/mossfall-source/`.

## Behavior Mapping

| Source behavior | Mossfall landing point | Status | Verification |
| --- | --- | --- | --- |
| `BOOT -> MODE_SELECT` | `src/controller.js`, `src/main.js` | MIGRATED | Boot snapshot |
| Beginner/Advanced selection | controller mode + `src/levels.js` | MIGRATED | Mode switch test/browser |
| Fresh, presence-valid board connection | controller + `src/input.js` + `src/ui.js` | MIGRATED | Connection-required tests/screens |
| How to Play opens from title and pause, never active gameplay | controller modal return state + pause help control | MIGRATED | Browser manual-open flow |
| No hardware pre-game capture flow | direct canonical CoP input with 5 kg presence gate | MIGRATED | Controller and CoP Semantic tests |
| Center hold before start | `START_LINE`, silent for 3 s before guidance, then 0.6 s | MIGRATED | State timing snapshot |
| First-level countdown only | `LEVEL_INTRO` | MIGRATED | Browser level 1 vs level 2 |
| Later-level nonblocking handoff | controller + scene handoff | MIGRATED | Level 2 state trace |
| Shared 60 s timer | controller | MIGRATED | Browser snapshots |
| Beginner +20 / Advanced +30; cap 99 | `src/levels.js`, controller | MIGRATED | Node tests |
| Score `10*cleared + floor(time)` | `src/core.js` | MIGRATED | 143/102/50 vectors |
| Mode star thresholds | `src/ui.js::scoreStars` | MIGRATED | Node tests |
| Eight authored boards per mode | `src/levels.js`; Beginner B01/B02/B04/B05/B03/B06/B07/B08 mapped onto original descent slots | MIGRATED | Counts/containment/routes |
| 120 Hz, max four catch-up steps | controller + scene | MIGRATED | Determinism tests |
| CoP `/16`, `/9*2`, deadzone/exponent + display-only 10/s UI smoothing | `src/input.js`, `src/core.js`, `src/ui.js` | MIGRATED | Input/core/UI tests |
| Hardware-first input priority | `src/input.js` | MIGRATED | Unit and browser stubs |
| 0.5 s input disable / 2.5 s board-lost | controller | MIGRATED | Browser hardware stub |
| Shape containment, gaps, ring void | `src/core.js`, `src/scene.js` | MIGRATED | Containment tests |
| Reusable holes and 9-step hold | `src/physics.js`, scene capture | MIGRATED | Capture tests |
| Captured progress survives a fall | scene reset path | MIGRATED | Scene/browser fall test |
| Pause/how-to/quit/board-lost/context-lost | controller + UI | MIGRATED | Browser flow matrix |
| Result Retry and pause Restart preserve effective mode; unavailable hardware enters connection-required and resumes in place | controller | MIGRATED | Unit and browser retry traces |
| Semantic SFX, layered capture reward, and result-owned cheer/celebration | `src/audio.js` | MIGRATED | Audio tests/runtime history |
| Beginner/Advanced BGM selection | `src/audio.js::setMode` | MIGRATED | Audio mode test/runtime request |

## 2026-08-05 Runtime Overrides

These are intentional `SPEC CONFLICT / superseded by 2026-08-05 runtime source`
items. They must not be silently changed back to the 2026-08-04 pack.

| Area | 2026-08-04 pack | 2026-08-05 runtime source used here |
| --- | --- | --- |
| BGM | one active `balance-beam-loop.ogg`; 12 total inlined audio assets | Beginner `balance-beam-loop.ogg`, Advanced `precision-puzzle-loop.ogg`; 13 total inlined audio assets |
| Fall presentation | one 1.05 s reset state with short damped twist | `BALL_FALL_DROP` followed by full board-spin reset presentation; authored source delay retained |
| Ball size | base normalized radius 0.058 | preceding playtest radius reduced linearly by 20%; visual and Cannon radii now match |
| Countdown/clear timing | 1000/1000/1000/800 ms; 1.40 s clear | current source `UI_TIMING` values retained |

## Stage Gates

- Gate 1: old descent/pose/scoring/audio modules cannot be imported by active code.
- Gate 2: inherited Table Tilt behavior tests and the added Field adapter,
  LeafPlatform dynamic, ownership, visual, audio, and integration tests pass.
- Gate 3: mossfall visual adapters do not modify level data, controller rules,
  cannon bodies, capture thresholds, input mapping, or audio events.
- Gate 4: desktop and mobile browser flows reach result, retry, pause, fall,
  board-lost, and mode-specific BGM with no console errors or asset 404s.
- Gate 5: final screenshots and runtime reports come from this target build, not
  from archived mossfall shots or table-tilt historical screenshots.

`verification/current` is historical evidence for the superseded adaptive-leaf
implementation and is not accepted for this migration. The LeafPlatform adapter
evidence is written separately under
`verification/leafplatform-adapter-20260805`.
> Historical record, superseded on August 6, 2026. The active implementation
> authority is `docs/game-spec.md`; the adapter/Cannon decisions below describe
> the previous migration and must not be used for current runtime work.
