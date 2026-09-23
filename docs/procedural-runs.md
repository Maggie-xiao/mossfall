# Procedural runs

Every run of Moss Tilt used to be the same eight boards, descending through the
same eight zones, in the same order. This document describes what replaced that
and — more importantly — what was deliberately *not* touched.

## What a run is

A run is a pure function of `(theme, seed, mode)`, assembled by
[`src/run-plan.js`](../src/run-plan.js). `controller.js` asks it for eight level
records and knows nothing else about how they were chosen.

```js
planRun({ theme: "dew-hollow", seed: "2026-08-31", mode: "beginner" })
```

Same inputs, same eight boards, forever. That is what lets two players compare a
score, lets a bug report be reproduced from a seed alone, and lets the hardware
gate replay fixed geometry.

## The four sources of variety

| Layer | What varies | Art risk |
|---|---|---|
| Descent route | Which authored zones the run falls through, and how long it dwells in each | None — every zone is a shipped palette |
| Variant transform | Authored boards reflected into one of four isometries | None — the geometry is the authored geometry |
| Procedural boards | New leaves drawn from the authored composition grammar | Managed — see below |
| Colour reroll | Which insect species sits on which spawn | None — colour is cosmetic today |

## What was NOT done, and why

**The palette was not generated.** `src/mossfall/data/palette.js` states two
rules its art depends on: beetles are the only fully saturated things on screen,
and the palette *is* the sense of depth. A hue-shifting biome layer breaks both.
It also flattens deliberate beats — zone 6 turns its glow bioluminescent green
before zone 7 returns to gold, which measures as a 128/255 red-channel deviation
from any smooth interpolation. A generated ramp would silently delete that.

So a theme is not a new palette. A theme is a **depth band of the existing
world**: which authored zones this run descends through.

| Theme | Zones | Difficulty window |
|---|---|---|
| Full Descent | 0–7 | 0.00 – 1.00 |
| Sunlit Crown | 0–3 | 0.00 – 0.55 |
| Dew Hollow | 3–6 | 0.35 – 0.85 |
| Lantern Deep | 5–7 | 0.60 – 1.00 |

**`src/mossfall/**` was not modified.** It is hash-locked by
`upstream-sha256.json` and enforced by `tests/leaf-platform-adapter.test.mjs`.
Nothing here touches it.

**The sixteen authored boards were not replaced.** They are the difficulty
curve's calibration and the best boards in the game, so they remain the spine of
every run: slot 0 is always authored, and roughly half of a beginner run is.
`canonRun()` still returns them in their authored order for the evidence gate.

## How generated boards stay in the authored style

[`src/level-gen.js`](../src/level-gen.js) does not invent kinds of leaf. Each of
its nine archetypes is an authored board re-parameterised — the four-lobed cross
is B03's, the subtractive ring is A03's, the island field is A08's. Randomness
moves radii, angles and counts inside ranges the authored set already occupies.

Two things came out of rendering candidates side by side with canon in
`tools/level-shot.entry.js` and looking at them, rather than out of reasoning:

- **Veins must follow the board's structural skeleton.** A vein at a random
  angle reads as a smudge, and a scalloped rosette with no radiating veins reads
  as a puddle. Every archetype now declares its own `axes`.
- **Actors must be composed, not scattered.** Greedy random placement satisfies
  the spacing contract but clumps everything into one half of the board. Spawns,
  burrows and obstacles are now laid out in mirror pairs, like A06's column of
  five and A05's paired snail gate. Spacing is also set by the *visual* radius
  (`INSECT_VISUAL_SCALE` is 1.4), not the collider — at collider spacing the
  insects render almost touching.

## Solvability

`tests/mossfall-levels.test.mjs` always asserted a safety contract and a
tilt-only reachability flood fill against the authored boards. That contract now
lives in [`src/level-validate.js`](../src/level-validate.js) so the generator can
run it *before* a player ever sees a board, and the tests call the same
function — one definition, so a rule cannot drift between the gate and the
generator.

Generation is therefore propose-and-check: draw a board, validate it, redraw if
it fails. Measured at ~31 ms per board, ~240 ms per run, which is paid once at
`startRun` and covered by the level-intro transition.

If the generator exhausts its retry budget, the slot falls back to an authored
board. A run of eight authored boards is worse than intended; a run of seven
boards is a broken game.

### One caveat worth knowing

Variant transforms are exact isometries — proved numerically against the Field
to 1e-15, including the opposite `rot` sign conventions of `ellipse` and `lobe`.
Routes therefore cannot break under a reflection.

But the `ripple` feature is world-space value noise that deliberately does not
move with the board, so a reflected leaf slides under the grain. Ripple is capped
below the resting slope and cannot break a route, but it can tip a spawn that was
resting near the limit — measured at ~2% of reflected boards. Reflections
therefore still get the cheap half of `validateLevel` (`checkRoutes: false`), and
fall back to identity.

## Reviewing the art

```bash
node scripts/build.mjs && node tools/build-level-shot.mjs
# then, in the browser pane at /level-shot.html:
#   window.__renderCanon("B01", { zone: 0 })
#   window.__renderGenerated(4219, 0.85, { zone: 4 })
```

The rig runs the real `LeafPlatform`, `Lighting`, `World`, `PostFX` and
`InsectView`, with the same three-line colour pipeline as `src/scene.js`. Canon
and generated boards are shot from an identical camera at a matched zone, so a
comparison is about composition rather than about lighting.

`npm run build` does `rm -rf dist/`, so re-run `build-level-shot.mjs` after it.

## Unused lever

`colorMatch` is fully implemented — the physics rejects a wrong-coloured capture
(`physics.js:731`, `:1178`) and the renderer tints burrow glow to match
(`leaf.js:475`) — but no authored level enables it, so colour is cosmetic today.
Turning it on is a ready-made difficulty axis, and would make `recolorLevel`'s
colour-pairing invariant load-bearing rather than merely future-proof. It changes
the rules of the game, so it is left off pending a design call.
