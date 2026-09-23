# Deployment

## Requirements

- Node.js compatible with the checked-in `package-lock.json`.
- npm.
- A static host or Kiwii WebView capable of serving the `dist/` directory.

## Build And Verify

```powershell
npm ci
npm run verify
```

`npm run verify` runs the automated tests, rebuilds `dist/`, and checks the
portable source/build contract from a clean clone.

Local migration workspaces that retain the generated browser evidence can run:

```powershell
npm run verify:evidence
```

The evidence directories are intentionally excluded from the repository.

## Outputs

- `dist/index.html`: normal multi-file deployment entry.
- `dist/app.js`: bundled JavaScript runtime.
- `dist/styles.css`: application styles.
- `dist/audio/`: production BGM and SFX.
- `dist/fonts/`: embedded local font files for the multi-file build.
- `dist/table-tilt-standalone.html`: single-file offline build.

Deploy the contents of `dist/` so that `index.html` is at the host root. Do not
deploy source-only audio, tests, visual references, backups, or verification
artifacts.

## Local Review

```powershell
npm start
```

The local server prints the review URL and serves `dist/`.

## WebView Compatibility Contract

The committed platform contract baseline is
`kiwii-mobile@eafbb63aea10b202887d90250201c016796e2981`.

- Launch from HTTPS. Debug-only local review may use HTTP on a private IPv4
  address; public cleartext HTTP is rejected.
- Keep the top-level page on the launch URL's exact scheme, host, and effective
  port. The game does not open popups or navigate to another origin.
- All production CSS, JavaScript, fonts, images, and audio are relative local
  assets in `dist/`; the runtime does not require `file://` or `content://`
  access, a CDN, or mixed content.
- The game works with JavaScript and DOM storage enabled while file access,
  content access, geolocation, popup windows, and mixed content remain
  disabled.
- Input polling stops on `visibilitychange`/`pagehide`, restarts on visibility
  restore/`pageshow`, clears stuck keyboard or touch state, and removes
  subscriptions, ports, timers, and event listeners exactly once on teardown.
  Subscription/input shutdown is awaited before the Host event source or
  MessagePort closes.
- Ordinary browser review may use the simulator and keyboard/touch fallback.
  A hardware-required game instance never treats fallback as Balance Board
  evidence.

Automated compatibility coverage lives in `tests/webview-compat.test.mjs`.
Browser smoke testing must still be paired with the hardware checks below
before release.

## Hardware Release Checks

- Use a debuggable Kiwii Mobile build and confirm that ordinary Android and iOS
  game presentation can receive the explicit development Host port without
  External Game. Confirm that External Game presentation uses the same owner
  and reports
  `Kiwii Game SDK hardware client ready`. Confirm that the candidate page has
  no `KiwiiBridge` binding and that a release build does not expose the private
  development Host.
- Verify the first fresh sample with at least 5 kg presence enters the normal
  run without an empty-board, neutral, or center-capture interaction.
- Verify CoP direction, dead zone, sensitivity, force readings, sequence
  progression, the 500 ms freshness boundary, and loss/recovery behavior.
- Step off, disconnect, make the stream stale, and replace the device identity.
  Each case must freeze the current scene and show only connection-required
  feedback. A later fresh, presence-valid sample must resume that same scene.
- Verify P follows that same path, preserves the last CoP rather than
  publishing `(0,0)`, ignores editable controls and repeated keydown, and
  remains unavailable until a newer valid sample arrives after P is released.
- Confirm the one migrated game instance remains the only hardware, simulation,
  audio, and vibration owner before, during, and after external presentation.
- Verify audio after WebView hide/show and application resume.
- Complete the final level on iPhone External Game and confirm
  `finish-crowd` plus `well-done` play once, the BGM media position is not
  reset or replayed, and the same muted timeline only fades back in after both
  finish voices end.
- Complete representative Beginner and Expert runs.
- Confirm pause, quit, result persistence, and WebGL recovery.

Keyboard and touch fallback are development and accessibility paths; they do
not replace the final Balance Board check.

The `kiwii-mobile@eafbb63` baseline does not prove native `0x03` pre-IIR frame
isolation. A complete hardware release claim remains blocked until a later
immutable platform revision passes the native golden vectors.
