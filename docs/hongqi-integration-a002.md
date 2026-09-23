# Hongqi External Game Integration A002

Date: 2026-08-26

## Coordinates

- Donor branch: `donor/mossfall-content`
- Donor revision: `9b41a133125cda5591d20038cb5711851f252ffe`
- Hongqi baseline branch:
  `origin/codex/external-game-hongqi-integration-a001`
- Hongqi baseline revision:
  `90ac8b845b4becd206a1d110fcc21687e4175aa6`
- Merge base: `9b41a133125cda5591d20038cb5711851f252ffe`
- Donor-only commits: `0`
- Baseline-only commits: `1`

The donor revision is the exact clean `main` content present when this task
started. It was published without force and verified to match
`origin/donor/mossfall-content`.

## Selective Migration Audit

The following donor-owned surfaces were compared against the Hongqi baseline:

- gameplay and scoring;
- authored levels and routes;
- UI and responsive presentation;
- Three.js scene, visual effects, and local assets;
- BGM, SFX, and audio provenance;
- build and offline release assets;
- gameplay, content, audio, rendering, and browser tests.

There are no donor-only commits or donor-only tree changes in any of those
categories. The Hongqi baseline already contains the complete donor content,
then adds the authoritative device-integration commit. No gameplay/content
hunks need migration in A002.

## Explicit Exclusions

The older
`origin/codex/external-game-pre-hongqi-donor-a001` revision
`2a0d1c8dc0122bc430ae50fc31273b73219d0a24` is not an A002 donor. It diverges
before the current lifecycle hardening and contains obsolete differences that
would remove private SDK candidates or roll back current Host behavior.

A002 deliberately excludes donor-side changes to:

- Android transferred-port and iOS preinstalled-port hardware bootstrap;
- canonical Balance CoP validation, normalization, orientation, freshness,
  identity, ordering, presence, connection gating, and recovery;
- External Game admission, single-instance ownership, topology revision
  handling, viewport ACK/NACK, authority epochs, gamepad release ordering,
  pause/checkpoint/restore, and teardown;
- browser audio activation, interrupted-state recovery, serialized BGM retry,
  and the one-owner audio lifecycle;
- private SDK tarballs, package coordinates, lockfile resolution, and
  `game-profile.json`;
- gameplay response and physics tuning values.

Those surfaces remain exactly authoritative from the Hongqi A001 baseline.

## Verification Repair

The self-driving browser harness restored authority epoch `2` and a new surface
instance, then emitted the following EXTERNAL topology with its old default
epoch `1` and original surface ID. The production runtime correctly rejected
those stale authority/identity values, which made the harness time out before
its final viewport ACK check.

A002 updates only the dev harness to emit epoch `2` and the restored surface ID
after restore, and adds source-level regression assertions. This does not
change the production game, Host protocol, hardware path, or release output.

## Release Gate

Automated and browser verification may qualify this local candidate for device
testing. A002 must not be pushed and no pull request may be opened until the
physical checklist passes on the required Android Host, iOS Host, Balance
Board, and real iOS External Game display/audio flow.
