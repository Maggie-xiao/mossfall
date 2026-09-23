# Moss Tilt Design Critique

## Basis

This critique evaluates Feishu revision 1057 against the approved
`mossfall-ui-v2.html` catalog, the live game flow, and the preserved gameplay
and Kiwii hardware contracts. It also records the independent rejection of Git
commit `e32b6c4bd5db9deb55e514c689b6307465df236c`.

The rejected candidate had 0 P0, 0 P1, 3 P2, and 0 P3 findings. Its independent
report is at
`E:/Codex/run-project/runs/705625441ae24fec98951b8dffc651ae/verifier-g0/reports/moss-tilt-independent-verification.md`.
The exact replacement revision and this critique's SHA-256 are recorded under
stable artifact IDs `moss-tilt-final` and `moss-tilt-critique` in
`E:/Codex/run-project/runs/705625441ae24fec98951b8dffc651ae/producer-g2/producer-result.json`.

## What Works

Moss Tilt has a coherent identity from title through results. The glass, moss,
leaf, and lime-accent vocabulary supports the balance theme without competing
with the playfield. The live leaf serves simultaneously as world object,
control feedback, and capture surface.

The title hierarchy remains stable when difficulty changes. Calibration uses
one consistent panel frame, the combined model-and-copy teaching phase is
exactly 6000 ms, and the explicit 3, 2, 1, GO cadence creates a clean transition
into control.

Gameplay benefits from the reduced HUD. The leaf and balls retain visual
authority without the redundant board gauge or an in-game Help entry. Timer,
level, and event feedback retain the approved catalog hierarchy.

The result screen concludes the same product language, and result-owned cheer
and celebration audio starts and stops with the result lifecycle.

## Independent P2 Findings And Resolution

### MTV-P2-001: final capture toast suppression

At rejected commit `e32b6c4`, `ballCaptured` scheduled the 900 ms
`In the hole!` toast, but the synchronous `allCaptured` transition immediately
hid it on `LEVEL_CLEAR`. The replacement keeps the active success toast under
its existing timer when level clear was caused by the final capture. Debug or
other non-capture clear paths still clear stale toast state.

Producer disposition: resolved, pending fresh independent verification.
Threshold: visible while `state=LEVEL_CLEAR` through at least 650 ms after the
final capture, then hidden after the configured 900 ms dwell and by 1100 ms.
Evidence:
`E:/Codex/run-project/runs/705625441ae24fec98951b8dffc651ae/producer-g1/browser/final-toast-dwell.json`
and `browser/1280-final-toast-650ms.png`.

### MTV-P2-002: portrait essential text unreadable

At rejected commit `e32b6c4`, the 390x844 viewport scaled the complete
1280x720 screen wrapper to about 0.305, producing essential How to Play and
Result text around 3-5 effective CSS px. The replacement leaves the 3D stage
and ordinary fixed-stage screens unchanged, but switches How to Play and
Result to viewport-native responsive layouts at portrait aspect ratios.

Producer disposition: resolved, pending fresh independent verification.
Threshold: every essential How to Play and Result label is at least 12 CSS px;
command targets are at least 44 CSS px high; all measured content is inside the
390x844 viewport within 0.5 px; document scroll dimensions equal the viewport;
the result board and actions do not overlap. Evidence:
`E:/Codex/run-project/runs/705625441ae24fec98951b8dffc651ae/producer-g1/browser/portrait-readability.json`,
`browser/390-how-to.png`, and `browser/390-result.png`.

### MTV-P2-003: inaccurate critique signoff

The rejected critique incorrectly declared no P0/P1/P2 issue and listed device
topics without commands, routes, thresholds, or evidence destinations. This
revision records all three rejected P2s, their producer dispositions, the
independent-verification caveat, and the executable residual checks below.

Producer disposition: resolved as a document repair, pending fresh independent
review of the exact replacement commit.

### MTV-P2-004: touch fallback omitted from the shipping build

Independent review of commit `1379935412d55168238bc86c58d2d08b6cbfe58b`
found that the release source omitted `#touch-stick` and `#touch-knob`.
`InputSystem` therefore could not install its existing pointer/touch bindings,
and a coarse-pointer drag left touch fallback inactive. The replacement restores
the control only for coarse-pointer or explicit QA touch sessions, keeps it
hidden for keyboard and Balance Board presentation, and restores live knob
feedback without reinstating the removed always-on board gauge.

Producer disposition: resolved, pending fresh independent verification.
Threshold at 390x844 with `?qa=1&realtime=1&touch=1&screen=GAMEPLAY`: both
control nodes are visible and contained; pointer capture succeeds; deliberate
horizontal and vertical drags report the matching normalized axes and
`fallback.touchActive=true`; release returns both axes and the knob to neutral;
the control does not overlap the HUD or viewport edges.

## Remaining Product Validation

MTV-P2-001, MTV-P2-002, and MTV-P2-003 were independently closed against
commit `1379935412d55168238bc86c58d2d08b6cbfe58b`. The touch repair is
producer-verified, not independently signed off. The coordinator must run a
fresh read-only verifier against the revision named by `moss-tilt-final`. The
following external-device checks remain open and must not be represented as
completed browser validation.

### Automated and browser release gate

Commands:

```powershell
npm ci
npm run verify
npm run verify:evidence
node tools/serve.mjs 4389 127.0.0.1
```

Routes:

```text
http://127.0.0.1:4389/?qa=1&realtime=1&screen=HOW_TO_PLAY&from=MODE_SELECT
http://127.0.0.1:4389/?qa=1&screen=RESULT_CALC&mode=advanced&cleared=8&time=22.4&settled=1
http://127.0.0.1:4389/?qa=1&realtime=1&screen=GAMEPLAY&mode=beginner&level=5&time=60
http://127.0.0.1:4389/?qa=1&realtime=1&touch=1&screen=GAMEPLAY&mode=beginner&level=1&time=60
```

Procedure: run the commands, test 390x844, 1280x720, 1920x1080, and
2560x1080, open the first two routes, and use QA capture `C` twice on B03 for
the final-toast dwell. Threshold: all commands pass; portrait thresholds match
MTV-P2-002; the toast thresholds match MTV-P2-001; backdrop edges are within
0.5 px of the viewport; the touch route meets the MTV-P2-004 activation,
direction, release, and containment thresholds; no unintended scroll; zero
attributable console warnings or errors. Evidence destination:
`E:/Codex/run-project/runs/705625441ae24fec98951b8dffc651ae/producer-g2/browser`.

### Balance Board standing comfort and signal integrity

Commands:

```powershell
adb devices -l
adb reverse tcp:4389 tcp:4389
adb logcat -c
adb logcat -v threadtime > E:\Codex\run-project\runs\705625441ae24fec98951b8dffc651ae\producer-g2\device\balance-board-logcat.txt
```

Route: open `http://127.0.0.1:4389/?realtime=1` in the debuggable Kiwii host
after starting `node tools/serve.mjs 4389 0.0.0.0`.
Procedure: complete empty-board and standing calibration, hold center for
2.0 continuous seconds, then play a representative Beginner run while shifting
left, right, forward, and backward. Threshold: motion direction matches the
player, resting input stays inside the 0.04 dead zone, connected samples advance
sequence IDs, and no accepted sample exceeds the 500 ms freshness limit.
Evidence destination:
`E:/Codex/run-project/runs/705625441ae24fec98951b8dffc651ae/producer-g2/device/balance-board-session.json`
plus the logcat file above.

### Disconnect and recovery timing

Use the same device command and route. During gameplay, disconnect the board,
record the first visible recovery state, reconnect, and press Retry.
Threshold: no recovery transition before 500 ms of loss; recovery appears on
the first frame after the 500 ms gate; Retry requires empty-board, standing,
and centered-hold calibration; the preserved level, cleared count, and timer
resume without a new countdown. Evidence destination:
`E:/Codex/run-project/runs/705625441ae24fec98951b8dffc651ae/producer-g2/device/disconnect-recovery.json`.

### Speaker balance and WebView audio latency

Use the gameplay route above and the result route from the browser gate.
Record target-device audio and screen at 60 fps for one capture, one fall, and
result entry. Threshold: capture confirmation begins within 150 ms of visible
capture, result cheer begins within 250 ms of `RESULT_CALC`, speech-range SFX
remain intelligible over BGM, no audible clipping occurs, and Retry/Quit leaves
zero victory voices. Evidence destination:
`E:/Codex/run-project/runs/705625441ae24fec98951b8dffc651ae/producer-g2/device/audio-latency.json`
with the synchronized recording.

### Android WebView lifecycle

Commands:

```powershell
adb shell input keyevent KEYCODE_HOME
adb logcat -d -v threadtime > E:\Codex\run-project\runs\705625441ae24fec98951b8dffc651ae\producer-g2\device\webview-lifecycle-logcat.txt
```

Procedure: while gameplay audio is active, send Home, wait 2 seconds, reopen
the debuggable Kiwii host from the launcher, and resume the same page.
Threshold: audio pauses within 250 ms of hide, resumes with one BGM voice,
input polling restarts with fresh sequence progress, the WebGL canvas is
nonblank, and no attributable console error occurs. Evidence destination:
`E:/Codex/run-project/runs/705625441ae24fec98951b8dffc651ae/producer-g2/device/webview-lifecycle.json`
plus the logcat file above.

## Signoff Status

Rejected commit `e32b6c4` remains failed with three P2 findings. Commit
`1379935412d55168238bc86c58d2d08b6cbfe58b` closed those three findings
independently but remains rejected for MTV-P2-004. The new replacement candidate
has producer evidence for the touch repair, but release signoff remains pending
until an independent verifier re-tests the exact commit named by
`moss-tilt-final`.
