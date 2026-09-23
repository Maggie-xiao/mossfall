# Kiwii Hardware Skill Validation

> Historical validation record. The PRIMARY/DISPLAY Dual Surface details below
> describe the retired pre-ADR-0011 implementation and are retained only as
> provenance. The current runtime uses one External Game document and one
> hardware, simulation, audio, input, and vibration owner.

## Implementation Baseline

- Repository: `h5-balance-mossfall`
- Package: `kiwii-mossfall-table-tilt`
- Implementation branch: `feat/kiwii-balance-hardware-skill-validation`
- Pre-change HEAD: `050312b86174547bca7a293b6886ddd40031a279`
- Pre-change worktree: clean
- Pre-change gate: `npm run verify`, 178/178 tests passed and build passed
- Platform baseline: `kiwii-mobile@b3213ea43eb680fd00d273362bd2d83b13df30a7`
- Candidate package: `@kiwii/game-sdk@0.1.0-private.2`
- Semantic contract: `kiwii.game-sdk@1.0.0`
- Post-change gates: `npm test` 201/201, `npm run build`,
  `npm run verify`, `npm run runtime:evidence`, and
  `npm run verify:evidence` all passed

## Boundary

Moss Tilt now owns three distinct input routes:

1. Browser simulator/InputAdapter with keyboard and touch fallback.
2. Android debug compatibility through exactly `isBound()` and
   `getBalanceBoardCoPLatest()`.
3. Production Host injection through `KiwiiHardwareClient`,
   `validateCapabilityPayload()`, an exact Host-provided `SubscribeBody`, and
   the validated Game SDK event source for lifecycle events.

The game does not install a sibling-repository dependency and does not treat
the debug bridge as the production Host/Runtime.

## Traceability

| Skill or reference | Rule used | Implementation | Automated evidence |
| --- | --- | --- | --- |
| `kiwii-bridge-skill` / `current-debug-h5.md` | Debug surface has six methods globally, but Balance Board code may call only the two current CoP methods | `src/input.js` debug reader; production path is separate | `tests/input.test.mjs` pinned-surface test |
| `kiwii-bridge-skill` / `canonical-game-sdk.md` | Production hardware is capability-based and PRIMARY-only | `src/kiwii-cop-sdk.js`, `src/main.js` | DISPLAY zero-call denial and PRIMARY subscription tests |
| `kiwii-web-game-skill` / `bridge-api.md` | Keep local assets, WebView cleanup, fallback, and no historical APIs | Existing lifecycle retained; source close and rAF cancellation added | `tests/webview-compat.test.mjs`, `tests/input.test.mjs` |
| `kiwii-cop-balance` | Closed canonical CoP schema, decimal strings, UInt64 order, explicit orientation, freshness, recovery | `CanonicalCopStream`, `KiwiiCopSdkSource`, `canonicalOrientation` | `tests/kiwii-cop-sdk.test.mjs` |
| `kiwii-balance-skill` / `current-cop-contract.md` | Debug `copY > 0` is forward only for current debug data; canonical orientation needs project authority | Debug mapping preserved; canonical mapping has separate `rightSign` and `forwardSign` | canonical mapping and missing-orientation tests |
| `fix-viewport-overlay-leaks` | 1920x1080 adaptive 16:9 safe frame; backdrop may cover viewport | `src/presentation.js`, safe-frame CSS variables | six-viewport layout tests and browser evidence |
| `kiwii-performance-skill` | One authoritative loop/subscription, cleanup on detach, bounded rendering | role-owned boot, publisher cleanup, rAF cancellation, 4K pixel budget | ownership, cleanup, and render-budget tests |

## Browser Evidence

The production build was exercised in the Codex in-app browser against
`http://127.0.0.1:4327/`.

- The local browser resolved to `PRIMARY + COMBINED` with
  `LOCAL_SIMULATOR` authority. It completed mode selection, empty-board
  setup, standing setup, teaching, countdown, a 60-second gameplay run, and
  result presentation without a console error.
- Keyboard direction fallback was exercised during gameplay.
- The required viewport matrix passed at `1920x1080`, `2532x1170`,
  `1920x1000`, `2560x1080`, `3840x2160`, and `390x844`. Every measured stage
  was centered at exactly 16:9, backdrop layers covered the full viewport,
  no body or document scrolling appeared, and canvas backing pixels remained
  within the 3840x2160 budget.
- An authenticated Host harness verified system mirror as one
  `PRIMARY + COMBINED` execution. Dedicated-display attach changed only the
  existing PRIMARY mode to `CONTROLLER`; detach returned it to `COMBINED`.
  Controller identity and input-source identity did not change.
- An authenticated DISPLAY harness verified snapshot-first reload,
  rejection of a pre-snapshot delta, duplicate sequence rejection, authority
  epoch replacement, rejection of the old epoch, acceptance of a replacement
  snapshot, zero hardware calls, zero state publications, and removal of all
  state/topology listeners on close.

The first system-mirror browser run exposed two injected-source starts during
initial `pageshow`. A failing test was added before the fix. `InputSystem` now
serializes source transitions and makes repeated start/stop requests
idempotent, preventing avoidable subscription replacement and calibration
loss.

## Candidate SDK Evidence

The actual neighboring candidate package validators accept the Moss Tilt Dual
Surface profile and canonical `balance.cop.read` frame. The public npm registry
does not publish `@kiwii/game-sdk@0.1.0-private.2`; production packaging still
requires the platform-owned private artifact.

The actual `KiwiiHardwareClient` validates the SDK event envelope before
delivering CoP, but its `onData` shape exposes only `{ capabilityId, value,
metadata }`. Event `sequence` and `streamEpoch` remain inside the client. Moss
Tilt therefore:

- relies on the client for hidden envelope validation,
- records the returned subscription identity and stream epoch,
- applies its own UInt64 source-sequence ordering,
- consumes and rechecks `DataDeliveryMetadata`,
- consumes validated lifecycle events from the injected underlying Game SDK
  event source,
- never fabricates an event sequence.

## Known Platform And Skill Issues

1. `KiwiiHardwareClient.onData` does not expose event sequence or stream epoch,
   so a Skill instruction that asks game code to inspect both is not directly
   executable through that client alone.
2. The private SDK package is unavailable from the public npm registry. A
   production Host artifact or private registry resolution remains required.
3. A system-preferred 4K external output is the compatibility baseline, not a
   60 fps promise. The Host may select a verified 1080p performance mode and
   must restore the captured mode when the session returns to the phone.

## Skill Results

| Skill | Result | Evidence and limitation |
| --- | --- | --- |
| `kiwii-bridge-skill` | PASS | The six-method debug boundary and the two-method Balance Board subset were precise and executable. It correctly prevented presenting debug compatibility as the production Host. |
| `kiwii-web-game-skill` | PASS | Its offline/WebView, fallback, cleanup, and lifecycle rules matched the repository and produced executable tests. |
| `kiwii-cop-balance` | PARTIAL | Closed-schema, decimal-string, freshness, ordering, and axis-authority rules were strong. It does not explain that `KiwiiHardwareClient.onData` hides event sequence and stream epoch, or how to consume the validated underlying event source without inventing fields. |
| `kiwii-balance-skill` | PARTIAL | The debug-axis warning and canonical/debug separation were correct. It needs a concrete orientation-authority artifact and the same client-visibility caveat. |
| `fix-viewport-overlay-leaks` | PASS | The three display paths and adaptive safe-frame rules were complete enough to implement and verify across all required viewports. |
| `kiwii-performance-skill` | PASS | It directly led to single-owner execution, bounded publication cadence, listener/rAF cleanup, idempotent subscriptions, and a 4K backing-pixel budget. |

Recommended Skill wording:

1. "`KiwiiHardwareClient.onData` validates but does not expose the event
   envelope's `sequence` or `streamEpoch`. Game code MUST NOT fabricate those
   fields. Use the returned subscription identity/epoch, canonical
   `sourceSequence`, `DataDeliveryMetadata`, and an injected validated
   low-level event source when lifecycle-event inspection is required."
2. "Canonical orientation MUST reference a named, approved installation
   authority containing explicit `rightSign` and `forwardSign`; debug
   `copY > 0 = player-forward` MUST NOT be inherited automatically."
3. "External Game topology moves the existing document between phone and
   external display. A game MUST retain one simulation, audio graph, input
   owner, hardware client, and `balance.cop.read` subscription."

## Hardware Status

### August 24, 2026 Contract Re-audit

Current game baseline: the local audit branch based on
`5206915d8caafd5d267c6fa69d5d1392a0f33c9c`, preserving
`41e3ff9` and `5206915`.

- 233/233 project tests pass, including ordinary Android transferred-port
  admission, ordinary iOS preinstalled-port admission, malformed descriptor
  and non-MessagePort rejection, late simulator-to-hardware ownership
  replacement, 420/501 ms freshness boundaries, and subscription-before-
  transport teardown.
- Shared CoP Semantic, direct-axis, optional-neutral, and exact External Game
  profile validators pass.
- Ordinary browser smoke starts one Canvas with no External Game runtime or
  overflow. The fake-Host harness completes ready, PHONE and EXTERNAL viewport
  ACK, direction tilt, pause/checkpoint, resume, restore, and migration with
  one game document.
- Browser automation leaves AudioContext suspended without a real user
  activation. It validates retryable state and telemetry, not iPhone audio.
- No new physical Balance Board, iPhone, or real external-display run was
  performed. Native `0x03` isolation also remains outside game-side proof at
  `kiwii-mobile@eafbb63`.

On August 23, 2026, Moss Tilt commit `35a3306` was exercised through Kiwii
Mobile commit `5bfe862` on a signed Debug build running on an iPhone 16 Pro with
a live 3840x2160 external display. The Host delivered the hardware descriptor
and port, Moss Tilt established one `balance.cop.read` subscription, and a real
KiwiiPowerBalance connection produced fresh, increasing source sequences
throughout the run.

The same game document migrated from the phone to a settled 1920x1080 external
viewport. Its Canvas client and backing were both 1920x1080. After warm-up,
page rAF and native display-link diagnostics repeatedly measured approximately
60 fps / 60 Hz with no sustained hitches. The audio context was running, BGM
time advanced throughout the 30-second soak, and the hardware client remained
bound with fresh samples.

All four automated gamepad phases were accepted. Pause, checkpoint digest,
resume, return to phone, and topology revision 3 acknowledgement passed. The
Host restored the external display to its captured 3840x2160 mode after the
game returned to the phone. Physical 180-degree phone rotation was not remotely
executable because CoreDevice reported that orientation control is unsupported
for this device; the native controller lock is covered by the iOS test suite,
but the physical rotation remains a manual acceptance item.

This proves the current private SDK Host path, real Balance Board binding, and
single-instance External Game migration for these exact commits. It is not a
production SDK release claim. Immutable SDK publication, signed game-candidate
provenance, release-build diagnostic removal, and the remaining physical
rotation check are still required before promotion.
