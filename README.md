# Moss Tilt

A Kiwii Balance Board game built on the native Mossfall leaf runtime. Moss
Tilt preserves the established scoring, input, capture hold, and recoverable
fall rules, while each of the 16 levels is authored directly as a Mossfall
`Field`.

## 中文说明

Moss Tilt 是一款在健身平衡垫上完成的体感游戏。玩家移动身体重心，控制叶片倾斜，
让瓢虫避开机关并进入对应颜色的洞口。普通浏览器也支持键盘和触控测试。

### 游戏模式

- Beginner / Advanced：各 8 个固定关卡。完成第 8 关后结束。
- Endless：持续生成叶片，直到倒计时归零。若持有药水，会自动消耗药水并恢复
  12 秒；没有药水时本局结束。
- Rogue：使用相同的生态地图和叠加玩法，但没有时间限制，也没有扣时压力。以清空
  叶片数量、收集奖励和逐步提高的地图难度为长期目标。每完成 3 关会循环叠加
  “露光、寻宝运、蝶之羁绊”三种森林祝福，分别提高露水得分、宝箱得分和失误后的
  蝴蝶引导；叠层瓢虫入洞在此模式奖励分数，而不是奖励时间。
- 每一关只有在全部必需瓢虫真正进入正确洞口后才会通关。颜色匹配关中，错误颜色
  会被洞口弹开，并显示所需颜色。

### 美术方向

- 整体采用童话森林绘本风格。中央树干保持为连续的闯关主轴，树干后的完整世界背景
  每两层切换一次，依次为金色水岸、绿色森林、蓝紫浮岛与夜间发光蘑菇区。
- 游戏叶片保持干净，不额外摆放装饰植物。高饱和颜色优先留给瓢虫、洞口光圈和关键
  奖励，保证第一次玩的用户仍能快速看懂目标。

### 无限模式机制

- 障碍碰撞和瓢虫跌落不再扣时间；仍保留碰撞反馈、短暂控制影响与跌落复位。
- 露水每颗增加 5 分；累计 5 份露水自动兑换 1 瓶复活药水。
- 空降瓢虫每关最多 3 只；接住后叠加，随承载瓢虫归巢时每只奖励 3 秒。
- 蘑菇、枝条、蜗牛、墨水、伸缩尖刺、蜘蛛网、冰雹、地鼠和云雾会逐步出现。
- 连续顺利通关会提高后续难度；连续受挫会降低后续难度。同一关失败 3 次后，
  蝴蝶会显示推荐路线。
- 每 8 关切换天气章节，并同步改变场景、HUD、计时器和提示条配色。

### 键盘与测试快捷键

| 按键 | 功能 | 使用条件 |
| --- | --- | --- |
| 方向键 / WASD | 模拟身体重心、倾斜叶片 | 普通浏览器 |
| Esc | 暂停 / 返回游戏 | 游戏中 |
| N | 跳过当前叶片并进入下一关 | Endless；开场或游戏中 |
| F2 / X | 调试跳过当前关 | 开场或游戏中 |
| F1 | 跳到固定模式第 8 关 | 调试 |
| Z | 直接完成当前局 | 调试 |
| G | 模拟瓢虫掉落 | `?qa=1` |
| C | 模拟瓢虫入洞 | `?qa=1` |
| P | 模拟平衡垫断开 / 恢复 | 调试 |
| A | 播放音效测试流程 | `?qa=1` |
| V | 模拟页面冻结 / 恢复 | `?qa=1` |
| F3 | 打开 / 关闭可视化 Debug 面板 | `?qa=1` |

`N` 每次只跳一关，长按不会连续触发；暂停和换关动画中不会跳关。
Debug 面板还可以直接输入关卡号，或选择某种机制并自动找到包含它的地图。

### 本地启动

本公开仓库不包含 Kiwii 私有 SDK。运行前需通过有权限的渠道单独取得以下安装包，
放入本地 `private/sdk-candidates/`（该目录已被 Git 忽略，禁止公开上传）：

- `kiwii-game-sdk-0.2.0-private.1.tgz`
- `kiwii-game-sdk-external-game-candidate-0.2.0-private.1.tgz`

图片、音频等素材使用 Git LFS；克隆后先执行 `git lfs install` 和 `git lfs pull`。
准备好素材和上述私有依赖后，再执行：

```bash
npm ci
npm start
```

浏览器打开 `http://127.0.0.1:4317/`。调试模式使用
`http://127.0.0.1:4317/?qa=1`，玩法展示页为
`http://127.0.0.1:4317/mechanics-showcase.html`。不要直接用 `file://` 打开
`src/index.html`，否则模块、音频和内嵌游戏可能无法正常加载。

### 计分与结束条件

无限模式总分由已清空叶片、剩余时间和收集奖励组成。游戏只会在倒计时归零且没有
可用药水时结束。固定模式在完成全部 8 关后结束。

## Run

```powershell
npm ci
npm test
npm run build
npm run verify
npm start
```

The local server prints the review URL and serves `dist/`.

## Verification

- `npm run verify` is the portable gate for a clean clone. It runs all tests
  and rebuilds `dist/`.
- Input tests cover the pinned debug CoP payload, sequence/freshness rejection,
  fallback recovery, display direction, and listener/timer cleanup. Controller
  tests cover connection-required freezing, fresh-sample recovery, the P
  disconnect toggle, and the always-on F1/Z and F2/X debug flows. WebView
  compatibility tests cover local assets, navigation assumptions, lifecycle
  events, and Canvas feature usage.
- `tests/cop-semantics.probe.mjs` calls the production canonical CoP mapper and
  is validated with the shared Balance CoP Semantic v1 probe.
- The private hardware and presentation candidates are excluded from this public repository. Obtain them separately through an authorized channel and place them at
  `private/sdk-candidates/kiwii-game-sdk-0.2.0-private.1.tgz` and
  `private/sdk-candidates/kiwii-game-sdk-external-game-candidate-0.2.0-private.1.tgz`
  before running `npm ci`. Never commit or publicly upload these archives.
- `npm run runtime:evidence` runs the deterministic B01 capture trace plus
  repeated B03, A03, and A08 stress passes.
- `npm run verify:evidence` runs both gates.
- Existing folders under `verification/` are historical migration evidence.
  Current verification commands do not treat them as proof for this runtime.

## Source Layout

- `src/controller.js`, `src/core.js`, `src/input.js`: product flow, timing,
  scoring, and controls.
- `src/levels.js`: 16 native Mossfall level records and both descent routes.
- `src/run-plan.js`: assembles one run from a theme, a seed and a mode. The
  only level source `controller.js` talks to.
- `src/level-gen.js`, `src/level-validate.js`, `src/level-variants.js`,
  `src/biomes.js`, `src/rng.js`: procedural boards, the solvability contract,
  the isometric variant transforms, the theme depth-bands, and the seeded
  stream. See `docs/procedural-runs.md`.
- `src/adapters/`: the Table Tilt capture, failure, color, and insect-state
  adaptations around the read-only Mossfall core.
- `src/scene.js`: single-Field runtime ownership and world orchestration.
- `src/mossfall/`: hash-locked Mossfall Field, LeafSim, LeafPlatform,
  InsectView, GameCamera, World, Lighting, Effects, and PostFX sources.
- `src/audio.js`, `src/audio/`: dual mode BGM and semantic SFX runtime.
- `tests/fixtures/mossfall-source/`: tracked source-equivalence snapshots.
- `docs/procedural-runs.md`: how a run is assembled, what the generator may and
  may not draw, and why the palette is not generated.
- `docs/MIGRATION_MATRIX.md` and `docs/BASELINE_AUDIT.md`: historical records
  from the superseded adapter-based migration.
