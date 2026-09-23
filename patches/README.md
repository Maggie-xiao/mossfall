# Patches for the read-only upstream (`src/mossfall/**`)

`src/mossfall/**` is vendored from `Kiwii-AI/mossfall` (manifest records the
source as `D:/KiwiiGit/Kiwii-AI/mossfall/src`, `sourcePolicy: "read-only"`), and
`tests/leaf-platform-adapter.test.mjs` enforces it with a SHA-256 manifest. So
fixes that belong to those modules are kept here as patches rather than applied
in place — applying one turns that test red until
`src/mossfall/upstream-sha256.json` is re-stamped.

The upstream repo is **not reachable from `git.kiwiiai.cn`** — `Kiwii-AI/mossfall`
and the obvious variants all return `Cannot find repository`. Whoever holds the
`D:/KiwiiGit` working copy needs to land these there and re-vendor.

## `mossfall-upstream-render-fixes.patch`

Two rendering bugs, both verified by applying the patch locally, rebuilding, and
comparing frames — then reverted so the manifest test stays green.

### 1 · Trunk dressing floats off the trunk

Three independent causes, all of which put a prop in the air beside the bark.
The bracket fungus in the bug report is cause (a).

**(a) Props are placed outside the trunk's arc.** The trunk is not a cylinder —
`_buildTrunk` builds `LatheGeometry(prof, radial, -1.95, 3.9)`, so surface only
exists for `|θ| ≤ 1.95`. But the trunk-bound dressing families reach further:

| family | old azimuth | max |
|---|---|---|
| shelf fungi | `±(1.25 + u·0.9)` | 2.15 |
| knots | `±(1.25 + u·1.1)` | 2.35 |
| moss tufts | `±(1.25 + u·1.3)` | 2.55 |
| flowers/tufts | `±(1.25 + u·1.2)` | 2.45 |

Anything past 1.95 is anchored to geometry that was never built, so it hangs in
the void just outside the silhouette.

**(b) The anchor radius ignores the profile.** The lathe's radius varies with
height (`TRUNK_R + sin(ph)·0.42 + sin(2ph+1.1)·0.21`, i.e. 6.37 – 7.63) while
props sit at a constant `TRUNK_R - 0.3` (6.7). A prop cannot sample the profile
at bake time — `_dressBand` re-dresses each band to a new `yOff` on every wrap,
so its final height is unknown. Anchoring **below the profile minimum**
(`TRUNK_R - 0.8`) makes it only ever buried, never airborne.

**(c) Props land over carved hollows.** `_buildTrunk` carves four hollows per
tile, each pushing the surface in by 0.7 – 1.4 over a radius of 1.6 – 3.5.
Height cannot be tested for the same reason as (b) — but **azimuth can**: a prop's
angle is fixed for its whole life, so an angle that clears every hollow in θ
clears it at every height. The patch hoists hollow generation into a shared
deterministic `trunkHollows()`, narrows their spread from `±1.7` to `±0.7` (two
wide hollows at ±1.7 could otherwise swallow the entire band of angles dressing
is allowed to use), and routes every trunk-bound placement through
`trunkAzimuth(sign, u, margin)`, which walks the range until it finds an angle
clear of all of them.

Verified by exhaustive sweep — 202 sign/u combinations, 0 unresolved, every
result inside `[1.25, 1.73]`, i.e. within the lathe arc less the prop's own
half-width. With the narrowed spread the hollows top out at `|θ| ≤ 1.07`, so
they no longer reach the dressing band at all; the search is the safety net if
those hash constants ever move.

### 2 · A long arc cuts across the deep canopy

The parallax canopy shells are open-ended cylinders that ride the camera, so the
near shell's bottom rim sat a fixed 39 m below it at radius 34 — about 49° down.
Pitch the camera into a descent and that rim circle sweeps across frame as a long
arc, canopy on one side and bare fog on the other. `H` goes from
`[78, 104, 142, 186]` to `[170, 220, 300, 380]`, putting every rim past 70° down.

Cost is overdraw on four `alphaTest` basic materials; no extra draw calls, no new
geometry.

## Not in this patch — god rays

The third bug (a ring of pale yellow light snapping across frame every 60 m of
descent, from `godrays.position.y = Math.round(y / 60) * 60` on an additive
sheet) is **already fixed app-side**, in `TableTiltScene.removeGodrays()`
(`src/scene.js`). That one needed no upstream change: `world.js` guards its
per-frame god-ray block behind `if (this.godrays)`, so dropping the mesh and
clearing the handle after construction is enough.

If god rays are ever wanted back, the treadmill is the thing to fix — snapping a
bright additive slab 60 m at a time is what makes it read as a flash.
