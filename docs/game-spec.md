# Moss Tilt Game Specification

## Product

Moss Tilt is a Kiwii Balance Board game that wraps its established scoring and
product loop around Mossfall's native living-leaf simulation.
Players shift their center of pressure to tilt the leaf, roll shell-form
beetles through natural hazards, and capture them in reusable openings.

## Controls

- Endless testing: press N during level intro or gameplay to skip one leaf
  through the normal level-clear transition. This also works without `qa=1`.
  Held/repeated presses are ignored; pause and transition screens do not skip.
- Rogue reuses the procedural leaf stream without a countdown. Every three
  clears grants one stacking forest blessing, cycling through Dewlight
  (extra dew points), Treasure Luck (extra chest points), and Butterfly Bond
  (a guide after a fall). Stacked falling beetles award points in Rogue because
  time bonuses have no value there.
- With `?qa=1`, F3 opens the visual Test Lab. It can jump to any procedural
  level, locate an example of each mechanism, force capture/fall/clear, and
  show the butterfly guide. Ordinary movement keys remain available.

- Input has two explicit boundaries. Ordinary browsers use the injected
  simulator/InputAdapter plus keyboard or touch fallback. In Kiwii Mobile,
  the one game instance receives an explicit development Host port independently
  of External Game admission, loads the platform-owned SDK modules, and creates
  the real `KiwiiHardwareClient` with the SDK
  `validateCapabilityPayload()` function and the exact `balance.cop.read`
  subscribe body. Android accepts the descriptor plus transferred
  `event.ports[0]`, including a late transfer after ordinary phone boot. iOS
  checks the preinstalled descriptor and port globals before listening for
  `kiwii-game-sdk-hardware-ready-v1`. The game does not discover or call an
  ambient `KiwiiBridge`.
- Production requests only `balance.cop.read`. Its canonical closed payload is
  `FIRMWARE_RAW_PCT_KG`; `sourceSequence`, `copXPct`, `copYPct`, and `forceKg`
  are decimal strings, and JSON numbers are rejected before conversion.
- Canonical axes require the explicit approved installation orientation in
  `BALANCE_BOARD_CONFIG.canonicalOrientation`. Debug `copY > 0` remains the
  current debug-only player-forward convention and is not inherited by the
  canonical path.
- The Android development Host maps its runtime sample into the canonical
  closed capability payload before the SDK validates and delivers it. The
  source sequence, half-board CoP percentages, force kilograms, capture time, and
  freshness metadata remain explicit through that boundary.
- Canonical CoP already uses half-board percentages in `-100..100`, so the SDK
  maps it directly to the game's normalized `-1..1` axes. The browser simulator
  retains its separate 16 cm by 9 cm debug mapping. The game applies no
  horizontal inversion, a screen-space vertical inversion, `1.2x` horizontal
  gameplay gain, and `2.4x` vertical gameplay sensitivity.
- The adapter rejects unavailable, malformed, non-finite, duplicate,
  out-of-order, and effectively older-than-500-ms samples while preserving the
  latest diagnostic reason. Host-reported age and local elapsed age are both
  counted.
- Production ordering retains subscription identity and stream epoch, uses
  UInt64 `BigInt` comparisons for source sequence, consumes
  `DataDeliveryMetadata`, and resets accepted state after disconnect,
  replacement, failed subscription, resubscription, or epoch
  replacement. The candidate `KiwiiHardwareClient` validates hidden event
  envelope ordering internally; its current `onData` callback does not expose
  the event sequence to the game.
- Presentation migration, document visibility, and BFCache do not stop or
  replace the hardware source. The same client, subscription, calibration,
  freshness state, and stream epoch remain owned by the one game instance;
  stale delivery is still rejected by the normal freshness policy.
- External Game delivery is guarded before the candidate client sees it.
  Stale authority epochs, changed surface identities, older or conflicting
  topology revisions, duplicate or conflicting action IDs, non-monotonic
  gamepad source sequences, malformed canonical sequence strings, and actions
  for an inactive topology revision are ignored. Action-ID history is retained
  for the complete authority lifetime rather than evicted by a fixed-size
  cache; only a valid `EXTERNAL_GAME_RESTORE` with a newer authority epoch
  resets the topology, action-ID, and gamepad ordering windows for the new
  document instance.
- The response layer uses a 0.03 dead zone and 1.10 exponent. Presence checks
  require at least 5 kg. Fresh canonical CoP enters the gameplay response
  directly; no per-session origin subtraction or pre-game capture stage exists.
- Gameplay communicates balance through the living leaf. No player-visible CoP
  panel is rendered; source CoP, sequence, capture time, freshness metadata, and
  `stage.dataset.cop` remain available for control logic and QA diagnostics.
- Losing the Balance Board stream identity, receiving stale hardware data, or
  stepping off for 0.25 seconds suspends time, physics, and tilt and enters
  `CONNECTION_REQUIRED`. Disconnect, stale input, step-off, forced disconnect,
  subscription replacement, stream replacement, device replacement, and
  authority replacement preserve the interrupted scene. Resume requires a
  newer fresh sample with valid presence, then restores that scene in place
  without restarting the run or returning to the title. Keyboard and touch
  cannot satisfy this hardware gate.
- A checkpoint restore loads the captured level into the new document and
  re-enters through the level countdown. When hardware is required, the
  restored run remains in `CONNECTION_REQUIRED` until a newer fresh,
  presence-valid sample arrives.
- F1/Z, F2/X, and P are always-on debug keys and suppress their browser
  defaults. Repeated keydown events are ignored. F1/Z clears temporary fall, level
  transition, and prior-state audio, loads level eight of the current
  difficulty with seven clears and 99 seconds, and permits fallback input.
  F2/X clears the current level through the normal level-clear flow only from
  level intro or gameplay. P toggles a local forced-disconnect sample during
  start-line, countdown, or gameplay states so the existing hardware-loss
  freeze, reconnect prompt, and recovery path can be tested without changing
  the real Balance Board or bridge state.
- External Game candidate Host (`@kiwii/game-sdk-external-game-candidate`
  0.2.0-private.1, ADR-0011 `EXTERNAL_GAME_PRESENTATION`) activates only when
  `window.__kiwiiExternalGameTransport` exists at boot; every other environment
  keeps the local one-instance behavior and does not initialize the private
  candidate module. The Host virtual
  gamepad maps `UP/DOWN/LEFT/RIGHT` to the table-tilt vector with the exact
  keyboard axis convention and smoothing, and `A/B/X/Y` to semantic actions
  per screen. `LEFT/RIGHT` on the title screen select difficulty; direction
  buttons on pause, quit-confirmation, and settled result screens move the
  visible menu focus; A confirms the selected action; B pauses during gameplay
  and returns to the title from menu/result overlays; X restarts; Y opens
  how-to. `PRESSED`, `RELEASED`,
  and `CANCELLED` are all consumed; only `PRESSED` fires menu actions so a
  host releaseAll never re-triggers them. When External Game or another
  hardware-required Host route is admitted, a Host probe timeout keeps the
  game behind the fresh, presence-valid Balance Board connection gate.
  Virtual direction buttons remain audio and UI input opportunities but never
  substitute for Balance hardware or satisfy that gate. Full mapping,
  checkpoint format, and validation live in
  `docs/external-game-integration.md`.

## Game Flow

1. Title and mode selection.
2. When hardware is required, wait for a fresh sample with valid player
   presence. The waiting surface reports connection status only.
3. A single teaching surface shows the approved instruction and all 239
   half-resolution frames of `motion_07` (four-direction weight shift) at
   30 fps multiplied by 1.25. It remains for at least four seconds and a full
   displayed cycle; loading, hidden-document time, and Host pauses do not
   consume the demonstration.
4. The completed demonstration goes directly to the existing countdown,
   with no centering or action-performance gate.
5. A clear `3 / 2 / 1 / GO` countdown enters a deterministic board.
6. Tilt the living leaf platform to capture all beetles.
7. Recover from falls and continue until the level is cleared.
8. Advance through the selected mode and calculate the result.

The game includes Beginner and Advanced content across 16 deterministic leaf
layouts. It supports pause, how-to, quit confirmation, uninterrupted board-loss
fallback, WebGL context loss, persistent best results, and debug/QA URL
parameters.

## Presentation

- The platform presentation profile uses a 1920x1080 design viewport, a 16:9
  safe frame, and `ADAPTIVE_SAFE_FRAME`. Gameplay, collision space, connection
  feedback, and game HUD stay inside the safe frame while backdrops and masks
  cover the full viewport.
- One game instance owns hardware input, simulation, randomness, scoring,
  persistence, audio, and the animation loop. The Host may move its existing
  rendering surface between phone and external display, but the game never
  creates a projection document, synchronization publisher, or second runtime.
  URL query, viewport, aspect ratio, and user agent never activate presentation.
- The External Game candidate profile (`game-profile.json`, mirrored as
  `window.__MOSS_TILT_PLATFORM_API__.profile`) declares the full
  eight-button set, a 1920x1080 design viewport with
  `ADAPTIVE_SAFE_FRAME` and `ANY` orientation, and
  `viewportAck/pauseAck/checkpoint: true` with a 4096-byte checkpoint
  budget. Topology snapshots switch the existing document between
  `COMBINED` (phone full game) and `EXTERNAL_GAME` (external display, Host
  virtual gamepad) layouts; the game never renders its own phone gamepad.
  Each `PREPARING` topology revision uses a latest-wins viewport transaction;
  stable `ACTIVE` snapshots update layout but receive no ACK or NACK. The game
  waits until viewport, container, DPR, Canvas backing, and postFX target sizes
  remain unchanged across two animation frames, applies resize, then
  acknowledges only after one frame renders at that settled size. The candidate
  ACK carries only the closed-protocol topology revision; render-surface
  dimensions are not added to the wire message. The WebKit
  layout viewport may be scaled relative to the phone render container; the
  Canvas client must match its actual host, while both measurements settle
  independently. A newer revision cancels the old wait; timeout or an
  unsatisfiable layout sends `nackViewport`.
  Render pixel ratio is the minimum of the device DPR, the game's 1.5 DPR cap,
  and the ratio required to keep total Canvas backing at or below 1920x1080;
  there is no minimum-ratio floor for 4096x2160 or wider viewports.
  Display-mode changes never recreate the hardware client, subscription,
  simulation, timers, or audio graph.
  Teardown first stops and awaits the active input subscription, then closes
  the Host event source or MessagePort, and only then releases presentation,
  layout, scene, audio, listeners, timers, and loops. Repeated teardown calls
  share the same completion promise.
  Host pause, document visibility, and BFCache are independent freeze owners.
  The normal RAF is cancelled while any owner remains active and exactly one
  RAF chain resumes after the final owner releases; Host resume is never gated
  by board activity, player presence, or instantaneous CoP. Lifecycle `pause`
  freezes simulation, timing, physics, and audio and,
  when requested, commits a closed-schema JSON checkpoint; `resume`
  continues the same run. An `EXTERNAL_GAME_RESTORE` checkpoint is applied
  to the new document as a new instance that re-enters through the captured
  level's countdown — and, when hardware is required, through the fresh
  presence-valid connection gate. It never claims the original instance survived, and
  no surface migration rebuilds the simulation, timers, or audio graph.
- Three.js r169 renders the Mossfall world and LeafPlatform.
- The title presents a custom moss-and-leaf `MOSS TILT` wordmark without a
  secondary Kiwii Balance label. Its Three.js cover remains alive at a reduced
  visual rate while gameplay physics and input stay disabled.
- UI override (August 10, 2026, Feishu revision 1057): player-visible screens
  follow the repository's `mossfall-ui-v2.html` catalog plus the newer revision
  feedback. This supersedes older UI descriptions without changing gameplay,
  physics, scoring, or Balance Board tuning.
- Normal first-run play follows `TEACH_IN -> LEVEL_INTRO` after any required
  hardware connection wait. The instruction remains
  "Lean <b>any direction</b> to roll the leaf." The existing teaching art box
  now hosts `motion_07`; it has no pages, dots, or added skip button. The old
  countdown image remains separate and hidden by the existing countdown UI.
- The in-game HUD is limited to the Level pill, Timer pill with clock icon,
  connection feedback, countdown, and event toasts.
  How to Play is available from the title and pause menu, not during active
  gameplay.
- Opening, setup, teaching, pause, and recovery masks use a fixed full-viewport
  backdrop. Their controls remain authored on the centered 1280x720 UI stage,
  so non-16:9 WebView sizes cannot expose undimmed side gutters. At portrait
  aspect ratios, How to Play and Result switch to viewport-native responsive
  layouts so essential copy remains at least 12 CSS px without changing the
  gameplay HUD or 3D stage.
- One Mossfall `Field` instance owns each level's visible mesh, height,
  normals, edge behavior, physics surface, and camera framing.
- `TableTiltLeafSim` retains the 120 Hz Mossfall solver while adapting the
  legacy 0.075 second reusable-hole capture and whole-board fall recovery. Its
  Table Tilt profile uses 9.81 m/s2 gravity, 0.027 Beginner or 0.022 Advanced
  linear damping, 0.10 rolling friction, and a 0.045 m/s rest threshold.
- Advanced A05's large `BLOCK_01` and `BLOCK_02` snails use 0.55
  restitution and clamp meaningful impacts to 0.30-0.72 m/s outward normal
  speed. Small `BLOCK_03` and `BLOCK_04` use 0.22 restitution and
  0.10-0.26 m/s. The adapter preserves tangential velocity, applies no extra
  kick to resting or sub-threshold contact, and reuses the native hit event,
  squash, camera impulse, and impact audio.
- The A05 snails are built app-side by `BoardSnails`, which claims the seats
  Mossfall's `BoardProps` already placed rather than editing the read-only
  upstream. Each is one mesh: a flat terracotta spiral shell carried on edge, a
  smooth green body reaching past it into a rounded head, and two tall stalks
  capped with plain cream eyeballs. Shell saturation and lightness are stepped
  down one notch so the beetles stay the brightest reading on the board. The
  flat shell cannot fill the circular collider, so the silhouette meets it fore
  and aft while a beetle arriving broadside stops about 0.13 m short; nothing
  ever overhangs, and `tests/board-snails.test.mjs` measures that gap against a
  real beetle profile rather than asserting it away. A hit squashes and leans
  the struck snail along the impact direction and retracts its eyestalks. The
  impulse is scaled against the 0.28-2.74 m/s impacts the board actually
  produces, so a median 1.17 m/s shove squashes the snail to about 86% height
  and tips it 6 degrees while the hardest run saturates near 75% and 11
  degrees. The damped spring is under a tenth of its peak half a second later.
  The ball's own rebound is unchanged.
- Beetles climb the native curled rim and enter falling only after their centre
  crosses the unmodified `Field.sdf >= 0` outline. There are no containment
  walls, forced teleports, or position clamps at the leaf edge.
- Capture holes are real mesh openings with a thin lip and no throat, floor,
  funnel, or light cone.
- Each character has one `InsectView`: it closes into its spherical shell in
  about 0.10 seconds while moving and expands after 0.35 seconds of rest over
  about 0.28 seconds.
- GameCamera drives a 60 degree dynamic frame and the authored eight-zone
  descents. Beginner plays B01, B02, B04, B05, B03, B06, B07, B08 while
  mapping each board's content onto the corresponding original downward
  journey slot. Advanced uses A08 in slot 7 and A07 in slot 8 while retaining
  the mirrored journey.
- BGM has separate balance and precision run modes. It enters with the teaching
  screen and continues through start-line preparation, countdown, gameplay,
  falls, and non-final level transitions. Final level completion immediately
  mutes the existing media element without pausing or resetting it, keeping the
  iOS media session warm while the finish cue plays. The same timeline fades
  back in for `ENDING`; `RESULT_CALC` remains silent.
- Every External Game `PRESSED` prepares the existing audio graph, including
  direction presses that have no screen-level menu action. Suspended or
  interrupted AudioContexts are resumed, while a transient HTMLAudio
  `play()` rejection remains retryable at the preserved media position instead
  of being treated as a permanent asset failure. SFX decoding continues in the
  background and does not block the first virtual-gamepad input.
  QA audio telemetry reports one owner while the manager is alive and zero
  after teardown; presentation migration never constructs a second owner.
- Semantic SFX cover setup, countdown, impacts, captures, falls, clears,
  result counting, rank reveal, and UI navigation. Every capture layers a
  bright positive confirmation over the capture sound.
- Final level completion uses the byte-identical current Dune Carve finish cue:
  `finish-crowd.mp3` at 1.05 gain together with `well_done.wav` at 0.98 gain,
  both starting immediately and playing once. It does not layer the normal
  level-clear shout or the retired Mossfall victory loop. Retry, Restart, Quit,
  and title return synchronously stop any remaining finish voices and invalidate
  their pending decode/unlock callbacks. If WebKit temporarily
  reports the AudioContext as `interrupted`, these two cues keep their
  phase-bounded playback intent until audio recovers or the ending exits.
- Switching difficulty on the title replaces the preview leaf and beetles while
  preserving the exact camera pose.
- Captured beetles fade fully into their burrows even when the final capture
  immediately pauses gameplay physics for the level-clear sequence.
- During whole-board fall recovery, only beetles that naturally cross the
  Field edge enter falling. Beetles that fall later continue their ballistic
  descent and fade completely before the reset spin begins; the sequence still
  counts as one drop and preserves already captured beetles.
- During level handoff every cleared leaf remains in its original world
  position for the rest of the run. Cleared leaves are released only when the
  run is restarted, abandoned, or the scene is destroyed.

## Acceptance

- All automated tests pass.
- The production build contains no external runtime dependencies.
- `dist/index.html` loads with no missing assets or console errors.
- Generated and root release entries content-version `app.js` and `styles.css`.
- Every SFX and BGM request carries its content-derived revision and avoids
  `force-cache`.
- `dist/table-tilt-standalone.html` contains fonts and audio inline.
- All 16 native Fields build valid meshes and preserve their authored topology,
  holes, routes, object counts, and deliberate disconnected regions.
- A flat beetle starting at 3 m/s retains at least 2.4 m/s after three seconds.
- B01 is deterministic at 120 Hz; every Field has a repeatable full-tilt path
  across its native edge; B03, A03, and A08 remain finite under stress.
- Runtime source contains no active Cannon, BoardFieldAdapter, legacy outline
  containment, duplicate ball owner, ghost, trail, or halo.
- Both eight-level routes complete without truncating authored descents.
- Consecutive multi-beetle falls never leave a later beetle suspended in the
  air, never force a beetle that remains on the Field to fall, and still
  produce one board-failure penalty and reset.
- Balance Board loss during gameplay suspends the run with the exact reconnect
  prompt and resumes from preserved run state on the first fresh board frame.
- Result Retry and pause Restart preserve effective mode and wait in
  `CONNECTION_REQUIRED` whenever a hardware-required source is unavailable.
- Session and device personal bests use final score, remain isolated between
  Beginner and Advanced, and degrade to in-memory state if persistence fails.
- F1/Z, F2/X, and P work without `qa=1`; F2/X retains normal final-level result
  settlement, and P restores the input mode that was active before simulation.
- Physical CoP feel and Kiwii WebView lifecycle behavior are checked on target
  hardware before release.
- The game exposes no vibration settings UI. First-run vibration defaults to
  enabled `light`, while valid persisted enabled/intensity choices take
  precedence. Only the authoritative single game instance calls vibration;
  unsupported APIs fail silently.
- The current External Game commit must be revalidated on a development iPhone
  and physical Balance Board. Earlier device evidence from retired candidate
  protocol names is historical context only and does not prove this contract,
  orientation lock, hardware binding, or output-mode restore.
- This worktree uses its ignored/private development SDK candidates for local
  build and unified device-test preparation. This development gate consists of
  the runnable build, automated behavior checks, and HTTP startup-resource smoke.
  Browser/contract success is not a substitute for binding, standing, tilt,
  disconnect/reconnect, or external presentation switching on physical hardware.
- The August 24, 2026 automated audit covers 233 tests, the shared CoP Semantic
  and axis validators, the exact External Game profile validator, ordinary
  browser admission, and the fake-Host External Game lifecycle. It is
  simulation/contract evidence only, not a physical-board, iPhone audio, or
  real external-display result.
- The August 25, 2026 release verification covers 237 tests, including
  External Game stale/replayed delivery rejection and idempotent page, UI,
  WebGL, input, and audio teardown. It remains simulation/contract evidence;
  physical Balance Board feel and the current iPhone external-display path
  still require target-device confirmation.

## Portrait Result and Ranking alignment — 2026-09-08

The user explicitly requires all twelve games to use the same vertical alignment in portrait. This supersedes the previous V3 stage-floor action placement for portrait only.

- Center Result as one composition: score board plus its reserved loader area.
- Center Ranking as one composition: standing board, 16 authored px gap, and the action row. Reserve the action row before its gated reveal so the board does not jump.
- Use a 10 authored px action gap, flexible PLAY AGAIN, and 112 authored px QUIT. Scale these distances with the actual presentation frame.
- The composition center must match the active viewport/safe-frame center within 1 CSS px; keep the entire composition visible without horizontal overflow.
- Preserve the game palette, scoring, record data, reveal order and natural automatic handoff. Landscape retains its existing layout.

Acceptance: browser measurements and paired Result/Ranking captures at 720×1280, 390×844, 1080×1920, 360×640 and 800×1000; include all attainable 1–4 star layouts at 720×1280. Evidence and fixed-orientation review videos are stored outside the repository under E:/Codex/output/result-rank-portrait-center-20260908.

## Teaching Frame Assets (2026-09-14)

`src/teachin/manifest.js` and its verified atlas assets are the local source
for the action player. `npm run build` copies these assets into the served
`dist` tree and embeds them into `table-tilt-standalone.html`. No remote asset
URL is required. Browser verification covers the three modes and existing
layout sizes; it is not physical Balance Board or App acceptance.
