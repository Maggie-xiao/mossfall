# External Game Presentation Candidate Integration

Branch `codex/external-game-hongqi-integration-a001`. This documents the Kiwii External
Game candidate: one game document moves between the phone
scene and the noninteractive external display while the Host renders a
virtual gamepad on the phone.

## Scope and activation

- SDK: `@kiwii/game-sdk-external-game-candidate@0.2.0-private.1`, vendored
  as `private/sdk-candidates/kiwii-game-sdk-external-game-candidate-0.2.0-private.1.tgz`
  and referenced as a `file:` dependency. The existing formal
  `@kiwii/game-sdk@0.2.0-private.1` candidate remains the hardware capability
  boundary; it does not provide another display topology.
- Activation is transport-probing only: `src/main.js` checks
  `window.__kiwiiExternalGameTransport` before dynamically initializing
  `src/external-game.js`; only that module imports the private candidate.
  Without the injected global, the ordinary browser stays on the same
  one-instance local path and the candidate is not initialized. There is no
  query-selected role, projection document, state publisher, or alternate
  display runtime. External Game adds `src/external-game.js`, hardware/input
  hooks, the manifest, tests, and the development harness.
- Hardware admission remains independent. Ordinary Android may transfer the
  hardware descriptor and MessagePort after local boot; ordinary iOS may
  provide the preinstalled descriptor and port globals without any External
  Game transport. Either path upgrades the same `InputSystem` to the one
  `KiwiiHardwareClient` owner.
- The entry uses the SDK-required composition
  `getHostBootstrapTransport()` + `createExternalGameCandidateClient({...})`
  with `createDefaultSha256()` injected, then declares readiness with
  `ready(buttons, capabilities)` after all event handlers are registered.
  Readiness rejection is surfaced on the console, never swallowed.

## Manifest

`game-profile.json` (repo root, copied to `dist/game-profile.json` by the
build) satisfies the vendored `game-profile.schema.json` exactly:

| Field | Value |
| --- | --- |
| `profileVersion` | `kiwii.external-game.profile.v1` |
| `topology` | `EXTERNAL_GAME_PRESENTATION` |
| `buttons` | `UP DOWN LEFT RIGHT A B X Y` |
| `viewportPolicy` | `1920x1080`, `ADAPTIVE_SAFE_FRAME`, `ANY` orientation |
| `lifecycleCapabilities` | `viewportAck/pauseAck/checkpoint: true`, `checkpointMaxBytes: 4096` |

The same object is exported as `EXTERNAL_GAME_PROFILE` and mirrored on
`window.__MOSS_TILT_PLATFORM_API__.profile`; a unit test keeps
the JSON and the constant identical so they cannot drift.

**Open platform question:** the Host's discovery path for the manifest has
not been confirmed against the iOS candidate Host (see Validation). The
file is served at the package root `/game-profile.json`; if the Host
expects a different location, that is a platform-contract change to raise
with the control plane, not a game-side guess.

## Button mapping (game-side semantics)

Direction buttons feed `InputSystem.setGamepadTiltButton` and use the exact
keyboard fallback convention (screen-up is negative y, `vectorClamp` to
unit length, the same 2.8/3.6 per-second approach rates), so the Host D-pad
feels identical to the keyboard. The fallback chain is
`touch > kiwii-gamepad > keyboard`; the hardware Balance Board still wins
over all fallbacks exactly as before.

| Button | Screen | Action |
| --- | --- | --- |
| `UP/DOWN/LEFT/RIGHT` | GAMEPLAY (and any simulating state) | Table-tilt vector (held; smoothed) |
| `LEFT` / `RIGHT` | MODE_SELECT | Select beginner / advanced difficulty |
| `A` | MODE_SELECT | Start board setup |
| `UP/DOWN/LEFT/RIGHT` | PAUSE_MENU / CONFIRM_QUIT / RESULT_CALC (ready) | Move visible menu focus |
| `A` | HOW_TO_PLAY | Close how-to |
| `A` | PAUSE_MENU / CONFIRM_QUIT / RESULT_CALC (ready) | Confirm focused action |
| `B` | GAMEPLAY | Pause |
| `B` | PAUSE_MENU / HOW_TO_PLAY / CONFIRM_QUIT / RESULT_CALC | Return to title |
| `X` | PAUSE_MENU, RESULT_CALC (ready) | Restart run |
| `Y` | MODE_SELECT, PAUSE_MENU | Open how-to |
| `Y` | HOW_TO_PLAY | Close how-to |

`PRESSED` fires actions once; `RELEASED` and `CANCELLED` are consumed as
idempotent no-ops for action buttons, so a Host background `releaseAll`
never re-triggers a menu action. Direction buttons treat `CANCELLED` as a
release. The mapping is a pure function (`resolveGamepadAction`) covered by
a per-screen unit-test matrix; `controller.handleGamepadAction` only maps
the returned action names onto existing controller methods.

Before the candidate client receives Host events, Moss Tilt applies a bounded
ordering guard. Within one authority epoch it pins the surface identity,
requires nondecreasing topology revisions, rejects conflicting snapshots for
the same revision, tracks gamepad sequences with `BigInt`, and deduplicates up
to 1024 action IDs. A higher authority epoch is admitted only through
`EXTERNAL_GAME_RESTORE`, which clears the previous topology and action-ordering
state before the new document resumes. Rejected deliveries are diagnostic-only
and never mutate game state.

## Topology and viewport acknowledgement

Only a topology snapshot whose `phase` is `PREPARING` opens a viewport
acknowledgement transaction. `ACTIVE` snapshots still update the current
layout mode, but they are stable-state notifications and receive neither an
ACK nor a NACK. Replying to `ACTIVE` would create an unsolicited ACK after the
Host has already closed its pending transaction.

`onTopology` computes a layout mode from the snapshot:
`PHONE+FULL_GAME -> COMBINED`, `EXTERNAL -> EXTERNAL_GAME`, anything else
is unsupported. The mode string flows through the existing
`MossTiltLayoutController.updateMode`, which recomputes the 16:9 adaptive
safe frame and sets the `--safe-*` CSS variables. The game never renders
its own phone gamepad; on `EXTERNAL` the document simply renders the full
game and the Host owns the phone.

Acknowledgement order per revision (latest revision wins and cancels any older
unfinished wait):

1. apply the layout mode (any throw -> `nackViewport(revision,
   "VIEWPORT_UNSATISFIABLE")`);
2. explicitly resize layout, camera, Canvas backing, and postFX, then require
   the actual viewport/container/DPR/Canvas/postFX measurements to remain
   unchanged across two animation frames; the 1920x1080 total backing-pixel
   budget is checked as part of readiness. Stability does not mean every
   measurement must have the same numeric dimensions: on a phone WebKit's
   layout viewport may be scaled relative to the render container. The Canvas
   client must fill the actual render host, while both viewport and host values
   must independently settle;
3. wait for one rendered frame at those settled dimensions — normally through the
   `controller.onRenderedFrame` hook (invoked after `scene.render()` in the
   game loop); if the loop is paused or destroyed, one direct
   `scene.render()` proves layout readiness instead;
4. `ackViewport(revision)`. The closed `0.2.0-private.1` request contains only
   the topology revision; it does not add guessed render-surface fields.
   Timeout or an unsatisfiable measurement sends a NACK; a superseded revision
   sends neither a late ACK nor a late NACK.

This transaction resizes the existing renderer only. It does not replace the
controller, `InputSystem`, Game SDK hardware client, subscription, simulation,
timers, or audio graph.

## Output resolution ownership

- iOS owns `UIScreen.currentMode`, native settled-mode verification, fallback,
  and restoration. Moss Tilt contains no UIKit/iOS mode-selection logic.
- System-preferred 4K output is the compatibility baseline. The App may attempt
  an exact 1920x1080 external mode as a recoverable performance optimization;
  setter success alone is insufficient, and failure returns to the captured
  system mode.
- The game always fills the final CSS viewport. Its 1920x1080 design coordinate
  space and 1920x1080 maximum WebGL backing budget are independent of the
  physical output mode. `calculateRenderPixelRatio()` has no minimum-ratio
  floor: it takes the minimum of device DPR, the 1.5 game cap, and
  `sqrt((1920*1080)/(cssWidth*cssHeight))`, so 4096x2160 and wider viewports
  remain inside the same total backing-pixel budget.
- Measured on the current iPhone/WebKit path, a 3840x2160 CSS viewport with a
  1920x1080 backing sustained about 40 fps, while a settled 1920x1080 viewport
  with the same backing approached 60 fps. 4K output therefore remains
  compatible but does not carry a 60 fps commitment.

## Lifecycle and checkpoint

- `pause` first releases every held Host gamepad direction, then calls
  `controller.setVisibilityPaused(true, "external-game:<reason>")`,
  which stops simulation, timing, physics, and audio in the existing loop.
  When `requestCheckpoint` is true the runtime commits
  `JSON.stringify(captureExternalGameCheckpoint(controller.snapshot()))`
  through `client.commitCheckpoint` (SDK adds base64 + `sha256:` digest).
- `resume` clears the pause flag and resumes audio; the same run continues
  — nothing is rebuilt on surface migration.
- Checkpoint payload (closed shape, ~200 bytes, budget 4096):
  `{ schemaVersion: "kiwii.moss-tilt.external-game-checkpoint.v1", screen,
  mode, level, timeRemainingMs, levelsCleared, drops }`. Menu/setup/result
  screens collapse to `{ schemaVersion, screen: "MODE_SELECT", mode }`.
  Instance-identity data (performance counters, stream metadata) is
  deliberately absent.
- `onRestore` validates the decoded checkpoint against the closed shape and
  applies it via `controller.restoreExternalGameCheckpoint`: a run
  checkpoint reloads the captured level and re-enters through `LEVEL_INTRO`
  (fresh countdown/handoff). A hardware-required restore first waits in
  `CONNECTION_REQUIRED` for a newer fresh, presence-valid board sample. A menu
  checkpoint restarts at mode selection, and a corrupted checkpoint starts
  a fresh instance. This document is a NEW instance; it never claims or
  behaves as if the original instance survived.
- Runtime teardown awaits `balance.cop.read` subscription closure before
  closing the Host event source or MessagePort, then releases the candidate
  client and the remaining single-instance resources. Close is idempotent and
  releases held direction input once.

## Files

| Path | Role |
| --- | --- |
| `src/external-game.js` | profile, button/checkpoint pure logic, transport probe, runtime wiring |
| `src/input.js` | `setGamepadTiltButton` / `updateGamepadTilt` / fallback chain (additive) |
| `src/controller.js` | `onRenderedFrame` hook, `handleGamepadAction`, `restoreExternalGameCheckpoint` (additive) |
| `src/main.js` | transport-probed boot branch, ready handshake, destroy wiring (additive) |
| `game-profile.json` | external-game manifest (copied to `dist/`) |
| `tests/external-game.test.mjs` | manifest/profile, mapping matrix, checkpoint budget, fake-host end-to-end |
| `tools/serve-external-game-harness.mjs` | dev-only fake Host + self-driving scenario server (not shipped) |

## Validation performed (2026-08-23)

> Historical evidence note (August 24, 2026): the device observations below
> came from Zhifei's single-instance architecture work with a different private
> candidate package. They support the ADR-0011 architecture choice, but they do
> not constitute physical acceptance for the exact committed
> `0.2.0-private.1` artifacts. This merged branch must be revalidated on the
> development iPhone, physical Balance Board, and external display before
> promotion.

- `npm ci`-equivalent install with both vendored tarballs;
  `npm run verify` passes the automated suite and runnable build. The
  backing-pixel test covers 4096x2160, 3840x2160, 2560x1080, 1920x1080, and a
  phone viewport, checking the total pixel budget and both DPR caps.
- Normal-browser regression on `node tools/serve.mjs 4318`: page boots to
  the title screen with one local `GAME_INSTANCE`,
  `window.__TABLE_TILT__.externalGame` stays absent, no errors.
- Browser external-game simulation via
  `node tools/serve-external-game-harness.mjs 4319` (fake Host implementing
  the closed message schema and a current-shape `balance.cop.read` fixture):
  `ready` handshake carries the 8 buttons and three capabilities; topology
  rev1 `PHONE/FULL_GAME` switches the layout to `COMBINED` and ACKs only after
  a rendered frame; virtual direction input does not substitute for the
  Balance stream, while a canonical CoP fixture tilts the board;
  `pause`+checkpoint freezes the run and commits a correct closed payload with
  a valid `sha256:` digest; `resume` continues `GAMEPLAY`;
  `EXTERNAL_GAME_RESTORE` loads the checkpoint level (HUD `4 / 8`); topology
  rev2 `EXTERNAL/VIRTUAL_GAMEPAD` switches to `EXTERNAL_GAME` and ACKs.
- The same harness with `?hardwareScenario=missing` omits the Balance fixture
  and shortens the Host probe timeout. Starting a run must enter
  `CONNECTION_REQUIRED`; keyboard, touch, and Host virtual directions cannot
  satisfy the gate.

Physical iPhone + real external-display validation was also executed:

- Final 1080p candidate: exact 1920x1080 native/WebKit viewport, DPR 1,
  1920x1080 Canvas backing, warmed gameplay at about 60 fps, fresh Balance
  Board input, continuous BGM, 4/4 gamepad phases, checkpoint, pause/resume,
  revision-3 return ACK, no rollback, and restoration to the captured 4K mode.
- A preceding 90-second soak kept the native board phase connected, samples
  fresh, and BGM advancing for the full interval. It exposed a return-to-phone
  WebKit layout-viewport/container mismatch; the final code accepts those
  independently stable dimensions and covers the condition with a unit test.
- Final system-preferred 3840x2160 compatibility run used a 1920x1080 backing,
  completed the same hardware/audio/lifecycle round trip without rollback, and
  settled around 41-48 fps near the end. This is compatibility evidence, not a
  4K 60 fps commitment.
- Three consecutive cold process launches passed on the final patch on
  2026-08-23. Every cycle discovered and bound the real Balance Board, kept a
  fresh monotonic source sequence, settled the external mode at 1920x1080,
  ACKed revisions 2 and 3, accepted all 4/4 exercised gamepad phases, committed
  a checkpoint, completed pause/resume and return-to-phone with no rollback,
  then restored the external display to the captured 3840x2160 mode.
- A follow-up direction-probe session verified the empty-board condition and
  remained in `SETUP_STEP_ON`, with `force=0`, `copX=0`, and `copY=0` while the
  source sequence continued to advance. No person stepped onto the board, so
  standing/center/four-corner direction and deliberate physical BLE
  interruption/reconnect remain unexecuted and are not claimed here.

## Device validation findings (2026-08-21, iPhone + external display)

Executed against the served build on `192.168.70.18:4318` with a temporary
dist-only probe beacon (removed afterwards by rebuilding):

- Game side fully healthy on device: the Host injected
  `window.__kiwiiExternalGameTransport`, the ready handshake was accepted
  (`[EXTERNAL_GAME] ready handshake accepted`), topology rev 1 (phone) was
  received, and the game played normally on the phone.
- After the external display scene was adopted, `外屏游戏` became enabled;
  tapping it migrated the same run to the external display (host-pause /
  host-resume lifecycle around the migration were handled by the game),
  and the phone became the Host virtual gamepad.
- Gamepad semantics validated on the external display: A start, D-pad
  tilt, B pause/resume, X restart, level-1 clear through the normal flow.
- The Host never fetched `/game-profile.json`; this Host build gates
  external gameplay purely on the ready handshake, so the manifest
  discovery path question is moot for this build (keep serving it for
  future Host revisions).

Platform-repo gaps found during device validation (all fixed on platform
branch `codex/virtual-gamepad-zero2-restyle-a001`, commits `363e6a1` +
`cc89ad7`; the game must not work around them):

1. `apps/ios/App/ExternalDisplaySupport.swift` — the scene delegate routed
   a connecting external scene to `ExternalGameMigrationPocController.shared`
   before the game coordinator (DEBUG); fixed by routing the coordinator
   first.
2. Same file — `ExternalDisplaySceneCoordinator.connect(_:)` guarded on
   `policy == .dedicatedSurface`, so at cold launch (default
   `.productSurface`) it destroyed the just-connected declared external
   scene and stranded the app in system mirroring; fixed by releasing the
   scene only under `.systemMirror`.
3. `activateDedicatedScene()` short-circuited on an existing scene session
   without notifying the external-game coordinator, and `willConnect` is
   one-shot, so exiting and re-entering the game always re-triggered
   `外屏游戏（不可用）`; fixed by `ExternalGameGameCoordinator` adopting an
   already-connected external scene at creation (the PoC's pattern).
4. `activateDedicatedScene()` has no retry when activation fails with no
   display attached. Not fixed: the external scene is declared in
   Info.plist, so the system recreates it when a display attaches, which
   covers the attach-later flow.

Before the fixes, power-cycling the external display while the game was
open reliably recovered the offer. After the fixes, cold launch with the
display attached and game re-entry both enable the offer directly
(device-verified together with the gamepad restyle build).
