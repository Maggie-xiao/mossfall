# Teach-in frame assets

Source: D:/KiwiiGit/Teachin, approved half sequences, 2026-09-14.
Runtime files are self-contained; source PNGs are not a runtime dependency.
Lossless WebP atlases preserve all source RGBA pixels and all frames.
Playback speed: 1.25; motion_01 base rate: 24 fps; others follow source video timing.
Per-action source-manifest.json records exact source hashes and generated atlas hashes.
Generation and pixel verification: build_assets.py in the delivery run kit.
Known accepted source defect: motion_09 frames 35-64 clip the head at the source right edge.
