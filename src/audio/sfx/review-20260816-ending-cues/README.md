# Mossfall Ending SFX Candidate Review

This folder collects candidate sounds for three ending-cinematic beats:

1. crumpled paper bonk
2. fortune text appearance
3. fortune paper disappearance

Each cue contains five Suno Sounds candidates and five Pixabay candidates.
Open `index.html` through the local review server to listen and choose. The
review HTML is the selection gate; no candidate is integrated into the
production audio manager until the user chooses it.

All Suno originals are preserved under `_source/suno/`. Pixabay originals are
preserved under `_source/pixabay/` with per-file provenance in
`pixabay-sources.json`.

Suno generation evidence and the three excluded sixth candidates remain in
`suno-generation-plan.json` and `_source/suno/`. They are intentionally kept
out of the review page because each cue is limited to five Suno options.

The user's confirmed choices are recorded in `selected-candidates.json`:

1. paper bonk: review option 03, immediate on contact
2. paper texture: review option 06, sequenced after the 0.60 second bonk
3. fortune appearance: review option 06
4. fortune disappearance: reversed review option 06 with a fade-out

These selections are integrated into the production audio manager and aligned
to the paper impact, first-word reveal, and dissolve onset frames.
