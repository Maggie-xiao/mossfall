# Balance Board and WebView Verification

Date: August 6, 2026

## Baseline

- Game repository branch: `codex/cop-input-webview-20260806`
- Android host contract: `kiwii-mobile` commit `3ee4900`
- Current hardware surface: debug-only `KiwiiBridge.isBound()` and
  `getBalanceBoardCoPLatest()`
- Release status: no Balance Board browser API until the canonical
  `@kiwii/game-sdk` Host and capability contract are published

## Automated Results

- `npm run verify`: PASS
  - 98 tests passed
  - multi-file and standalone builds completed
- `npm run runtime:evidence`: PASS
  - deterministic B01 capture completed
  - B03, A03, and A08 each remained finite for 12/12 stress cycles
- `git diff --check`: PASS

The input tests cover full raw cm/kg metadata, unavailable reasons, malformed
payloads, project freshness, duplicate and out-of-order sequences, fallback
activation, low-sequence recovery after explicit disconnect, and timer/event
cleanup.

## Browser and WebView-Contract Smoke

The built game was served from private debug HTTP at
`http://127.0.0.1:4318/`.

- Desktop 1280x720 gameplay:
  - one canvas, fully inside the stage
  - nonblank opaque render
  - luminance range `242.887`
  - variance `3521.366`
  - no console errors or warnings
- Mobile 390x844 gameplay:
  - no document scroll overflow
  - canvas and touch control fully inside the stage
  - nonblank opaque render
  - luminance range `247.245`
  - variance `4396.839`
  - no console errors or warnings
- Runtime asset inventory:
  - 19 observed assets
  - no external-origin assets

Runtime interaction checks passed for:

- boot and gameplay with no bridge using keyboard fallback;
- visible touch fallback, pointer cancellation, and neutral reset;
- an injected read-only CoP payload preserving flags, sequence, cm/kg values,
  capture time, and age;
- CoP-driven horizontal and vertical gameplay tilt;
- duplicate samples aging into `PROJECT_STALE`;
- recovery on a later sequence;
- explicit `DISCONNECTED` fallback followed by recovery from a reset sequence;
- `pagehide` stopping polling and clearing fallback state;
- `pageshow` restarting polling with fresh sequence progress.

## Remaining Device Gate

The Android SDK `adb` executable is installed, but no Android device or
emulator was connected. The pinned host has focused unit tests for
`DevelopmentBalanceCopPrototype` and `TrustedH5OriginPolicy`, but Gradle could
not run because this machine has no Java runtime configured.

Before release, verify on a debuggable Kiwii Android build:

- physical CoP direction and feel;
- real force readings and calibration;
- disconnect/reconnect timing;
- application pause/resume and renderer recovery;
- debug bridge presence and release bridge absence;
- exact-origin launch and blocked cross-origin navigation.
