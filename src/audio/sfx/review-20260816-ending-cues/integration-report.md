# Mossfall Ending SFX Integration

## Selected cues

| Event | Review choice | Production file | Duration |
| --- | --- | --- | --- |
| Paper ball contacts the beetle | 03, Suno | `ending-paper-bonk.ogg` | 0.60 s |
| Paper texture after contact | 06, Pixabay | `ending-paper-crumple.ogg` | 1.90 s |
| First fortune word appears | 06, Pixabay | `ending-fortune-appear.ogg` | 0.94 s |
| Fortune paper starts dissolving | Reversed 06, Pixabay | `ending-fortune-vanish.ogg` | 0.94 s |

The selected originals are preserved under `src/audio/sfx/_source/`. Production
code references only the processed local OGG files.

## Processing

- Paper bonk: source segment 0.00-0.60 s, gain 0.78, 3 ms fade-in,
  35 ms fade-out.
- Paper texture: source segment 0.75-2.65 s, gain 1.80, 10 ms fade-in.
  The texture holds at full level for 0.20 s beyond the previous cut, then
  fades linearly over the final 200 ms. Playback still starts when the
  0.60 second bonk ends.
- Fortune appearance: source segment 0.04-0.98 s, gain 1.70, 10 ms fade-in,
  100 ms fade-out.
- Fortune disappearance: Magic Spell 02 source segment 0.04-0.98 s, reversed,
  gain 1.70, 10 ms fade-in, 280 ms fade-out.

## Integration

- `GameAudio.endingPaperBonk()` plays the dedicated impact immediately, then
  schedules Paper Crumple at 0.60 seconds, exactly after the impact clip.
- `GameAudio.endingFortuneAppear()` starts when the first word begins revealing.
- `GameAudio.endingFortuneVanish()` starts when `setDissolve()` begins.
- Entering `RESULT_CALC` immediately stops the normal run BGM.
- Each timeline callback is guarded and fires once per ending.
- Existing BGM files and references were preserved.

## Verification

- `npm run verify`: 153 tests passed and the distribution build succeeded.
- Dedicated ending timing tests: 2 passed.
- Production file hash and byte checks: 4 of 4 passed.
- Local server requests: 4 of 4 returned HTTP 200 with `audio/ogg`.
- Realtime browser ending:
  - `ending-paper-bonk`: sample, `ENDING`, fallback false, scheduled delay
    0 ms.
  - `ending-paper-crumple`: sample, `ENDING`, fallback false, scheduled delay
    600 ms.
  - `ending-fortune-appear`: sample, `ENDING`, fallback false.
  - `ending-fortune-vanish`: sample, `ENDING`, fallback false.
- Result settlement: `RESULT_CALC`, `bgmPlaying=false`.
- Browser console: no warnings or errors.

## Provenance

Full candidate identifiers, source URLs, source hashes, production hashes, and
license notes are recorded in `selected-candidates.json` and the production
`src/audio/sfx/audio-sources.json` manifest.
