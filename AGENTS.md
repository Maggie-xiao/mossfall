# Mossfall Table Tilt Agent Instructions

This repository contains one independently released Kiwii H5 game. This
`AGENTS.md` is authoritative for work inside this repository.

## Project

- Game ID: `mossfall`
- Stack: JavaScript, Three.js r169, native Mossfall Field/LeafSim, esbuild
- Source entry point: `src/main.js`
- Built entry point: `dist/index.html`
- Shared control plane: https://git.kiwiiai.cn/Kiwii-AI/h5-minigame-dev

## Workflow

1. Read `.h5dev/project.yaml`, `docs/game-spec.md`, and Git status.
2. Preserve unrelated user work and use a short-lived branch after the initial
   baseline.
3. Edit only the reviewed source and project-documentation paths:
   `src/`, `tests/`, `scripts/`, `tools/`, `docs/`, `index.html`,
   `package.json`, `package-lock.json`, `README.md`, and repository metadata.
4. Do not hand-edit generated output:
   `dist/`, `verification/`, `.pre-*/`, `.tmp-*/`, or `scripts/__pycache__/`.
5. Exercise the representative flow:
   fresh Balance Board connection, Beginner and Advanced play, beetle capture
   and fall recovery, level clear and results, pause and connection-required
   recovery, keyboard/touch fallback, audio, and WebGL context recovery.
6. Request confirmation before push, merge, release, repository
   administration, or publishing unless the current user request explicitly
   authorizes that exact action.

## Validation

```powershell
npm ci
npm run verify
```

Physical Balance Board feel, force readings, and Kiwii WebView lifecycle
behavior still require hardware validation.

## Shared Guidance

Use `h5-minigame-dev` as a read-only reference for shared Agent instructions,
skills, SDK contracts, and reusable workflow knowledge. Game development in
this repository must not modify the control-plane repository.

- Do not copy the control plane into this repository.
- Do not add it as a Git submodule.
- Do not assume it is already cloned locally.
- Keep game-specific requirements, decisions, assets, tests, and history here.
- Make shared-tooling changes only in a separate control-plane task and branch.

References:

- [Control-plane AGENTS.md](https://git.kiwiiai.cn/Kiwii-AI/h5-minigame-dev/src/branch/main/AGENTS.md)
- [Agent workflow](https://git.kiwiiai.cn/Kiwii-AI/h5-minigame-dev/src/branch/main/docs/agent-workflow.md)
- [Repository contract](https://git.kiwiiai.cn/Kiwii-AI/h5-minigame-dev/src/branch/main/docs/repository-contract.md)
- [Create UI skill](https://git.kiwiiai.cn/Kiwii-AI/h5-minigame-dev/src/branch/main/skills/create-ui/SKILL.md)
- [Recreate UI skill](https://git.kiwiiai.cn/Kiwii-AI/h5-minigame-dev/src/branch/main/skills/recreate-ui/SKILL.md)
- [Game testing skill](https://git.kiwiiai.cn/Kiwii-AI/h5-minigame-dev/src/branch/main/skills/test-game/SKILL.md)

## Boundaries

- Do not commit credentials, generated output, dependencies, caches, or player
  data.
- Use Git LFS for binary source assets.
- Do not silently change SDK, Kiwii Bridge, hardware, or platform contracts.
- Keep the gameplay specification, asset manifest, and acceptance evidence
  accurate when behavior changes.
