# Moss Tilt 结尾音效集成报告（2026-08-06）

## Event mapping correction (2026-08-10)

- The non-final `level-clear` cue now reuses `people-shout-oo2.mp3`, the short
  vocal sample called by `sfxMult()` when the player steps on an x2 multiplier
  in the earlier Kiwii-AI `h5-police-jump` game.
- Production keeps the first 0.52 seconds, applies 1.35 gain during encoding,
  and fades the final 70 ms through Web Audio.
- The stronger `sfx_cheer_big.mp3` group celebration now belongs to final
  victory as `run-victory-cheer.ogg`. Its first 2.35 seconds play immediately
  on `RESULT_CALC`; the existing `run-victory-celebration.ogg` joins after
  250 ms.
- The previous `level-clear-v3-B` production cue is preserved as
  `audio/sfx/_source/retired-level-clear-crowd-v4-20260810.ogg`.
- The previous Suno final cheer is preserved as
  `audio/sfx/_source/retired-run-victory-cheer-pre-police-20260810.ogg`.

## Revision 1057 runtime override (2026-08-10)

This section supersedes the older runtime scheduling notes below while retaining
their asset provenance and audition history.

- Every successful pass-through plays `ball-capture` with a brighter
  `ui-confirm` layer so the reward reads immediately.
- Result entry owns one coherent win cue: `run-victory-cheer` starts at
  `RESULT_CALC`, and `run-victory-celebration` joins after 250 ms as the
  sustaining result-bed loop.
- `run-victory-applause` remains in the audited asset set for provenance but is
  intentionally not scheduled by the current runtime.
- Retry, Restart, Quit, and title return stop every active victory voice before
  the next state begins.
- Unit tests expose active victory voice count and keys; browser QA confirms
  both voices are active on result entry and zero remain after Retry or Quit.
- The current implementation is authoritative in `audio.js` and
  `controller.js`; older three-layer `LEVEL_CLEAR` timing in this report is
  retained only as historical production context.

## 摘要

- 目标入口：`src/index.html`
- 音频目录：`src/audio/sfx`
- 本次范围：将 1-7 关通关提示替换为用户选中的 `level-clear-v3-B` 多人欢呼，并加入尾部渐隐；第 8 关最终胜利保持现有鼓掌、欢呼、轻庆祝三条独立音轨
- 生产 SFX：14 个，共 198,366 bytes
- 审计 cue：16 个；`preserve` 2、`replace` 8、`add` 5、`layer` 1
- 普通通关：`level-clear.ogg` 为 1.22 秒，运行音量 `0.40`，最后 220 ms 由 Web Audio 线性渐隐
- 最终胜利：三层从 `0 / 0.18 / 0.65` 秒错峰启动，在约 2.45 秒结束
- 运行时等效混音预览：峰值 -8.727 dBFS、RMS -23.972 dBFS、0 削波
- 正常路径只播放本地采样；程序化声音仅在文件加载或解码失败时回退

## BGM 保留与风险

| Key | 引用 | 修改前 SHA-256 | 修改后 SHA-256 | 许可证状态 | 混音改动 |
| --- | --- | --- | --- | --- | --- |
| `bgm-balance-beam` | `./audio/bgm/balance-beam-loop.ogg` | `b163059c...f3707f9` | `b163059c...f3707f9` | 用户提供本地文件；发行权需项目方确认 | 无 |
| `bgm-precision-puzzle` | `./audio/bgm/precision-puzzle-loop.ogg` | `71ffc52d...d3d0cd16` | `71ffc52d...d3d0cd16` | 用户提供本地文件；发行权需项目方确认 | 无 |

两首 BGM 的引用、字节内容、音量 `0.14`、播放速率和淡入淡出逻辑均未变化。本次没有替换、重编码、重命名或移动 BGM。

## SFX 审计

评分为五项总分，满分 20。

| Key | 事件 | 原来源 | 原评分 | 决策 | 候选评分 | 原因 |
| --- | --- | --- | ---: | --- | ---: | --- |
| `ui-move` | 菜单移动 | 程序音 | 14 | replace | 20 | 使用现有专用移动采样 |
| `ui-confirm` | 确认命令 | 程序音 | 14 | replace | 20 | 使用现有专用确认采样 |
| `setup-ready` | 上板准备完成 | 程序音 | 16 | replace | 20 | 使用独立准备完成采样 |
| `countdown-beat` | 3、2、1 | 缺失 | - | add | 20 | 使用短节拍采样 |
| `countdown-go` | GO | 缺失 | - | add | 20 | 使用独立开始采样 |
| `ball-impact` | 碰撞 | 程序音 | 11 | replace | 20 | 使用材质碰撞采样 |
| `ball-capture` | 捕获 | 程序音 | 16 | layer | 20 | 保留物理落点，并叠加短奖励采样 |
| `ball-fall` | 掉出台面 | 程序音 | 15 | replace | 20 | 使用友好、不过度惩罚的失败采样 |
| `level-clear` | 1-7 关叶片下压、虫体发光、加时 | 旧叶片确认音 | 11 | replace | 20 | 改为短促、清晰、明确由多人同时发出的振奋欢呼 |
| `run-victory-applause` | 最终归巢第一拍 | 缺失 | - | add | 20 | 轻量叶片与花瓣鼓掌 |
| `run-victory-cheer` | 最终归巢第二拍 | 缺失 | - | add | 20 | 小规模、无台词、非体育场式欢呼 |
| `run-victory-celebration` | 最终归巢收束 | 缺失 | - | add | 20 | 露珠、叶片与萤火微光的轻庆祝 |
| `result-count` | 结算计数 | 程序音 | 15 | replace | 20 | 使用耐重复的短计数采样 |
| `result-rank` | 星级与纪录揭晓 | 程序音 | 16 | replace | 20 | 使用独立奖励采样 |

## Suno 生成记录

生成时可见状态：

- 模型：`v5.5`
- 类型：`One-Shot`
- 账户页面显示付费生成能力和 Pro WAV 下载控件
- Sounds UI 未显示单次积分价格；台账如实记录为“未展示”
- 完整提示词、候选 URL、提交时间和拒绝原因见 `audio/sfx/suno-generation-plan.json`

约 0.98 秒的第一版通关声因偏敲击而被拒绝；0.786 秒的叶片 v2 和 0.323 秒的露珠 v3 也先后退役。用户最终选择 revision 3 的多人欢呼候选 B。最新两条最终胜利候选均被拒绝，且未接入游戏；现有最终胜利资源与叠加逻辑保持不变。

| 单元 | 选中 Candidate | 原始时长 | 选段 | 生产时长 | 选择原因 |
| --- | --- | ---: | --- | ---: | --- |
| 小关多人欢呼 | `47754a28-3d12-472d-a4ef-6e81f2f0ac0e` | 2.160000 s | 0.000-1.220 s | 1.220000 s | 用户明确选择 `level-clear-v3-B`；多人同步欢呼保持短促有力，最后 220 ms 在运行时渐隐 |
| 轻鼓掌 | `01f07779-9e7c-49d5-94b1-b91d0910f0b6` | 5.720167 s | 0.000-1.650 s | 1.650000 s | 立即进入轻量节奏；另一候选有效内容约晚 0.4 秒 |
| 小欢呼 | `c69e46af-cc98-4fb4-991b-256ad487025d` | 8.360167 s | 0.372479-2.272479 s | 1.900000 s | 友好、持续且均匀；移除前导后便于精确错峰 |
| 轻庆祝 | `1edcc11f-a167-4386-a158-66d51dcb9654` | 6.280167 s | 0.000-1.800 s | 1.800000 s | 更轻、更偏闪烁与叶片质感，没有沉重终止击 |

## 集成资产

| 生产文件 | 原始文件 | 触发与时序 | 运行音量 / 处理 | 来源与权利 |
| --- | --- | --- | --- | --- |
| `audio/sfx/level-clear.ogg` | `_source/mossfall-level-clear-crowd-v4-source.wav` | 非最终 `LEVEL_CLEAR`，0.0 s | `0.40`；最后 220 ms 运行时线性渐隐 | Suno v5.5 Sounds；用户手动下载 Pro WAV |
| `audio/sfx/run-victory-applause.ogg` | `_source/mossfall-run-victory-applause-source.wav` | 最终 `LEVEL_CLEAR`，0.0 s | `0.18`；trim；24 ms padding；12 ms edge fade | Suno v5.5 Sounds；可见付费方案状态 |
| `audio/sfx/run-victory-cheer.ogg` | `_source/mossfall-run-victory-cheer-source.wav` | 最终 `LEVEL_CLEAR`，0.18 s | `0.40`；trim；28 ms padding；14 ms edge fade | Suno v5.5 Sounds；可见付费方案状态 |
| `audio/sfx/run-victory-celebration.ogg` | `_source/mossfall-run-victory-celebration-source.wav` | 最终 `LEVEL_CLEAR`，0.65 s | `0.34`；trim；24 ms padding；12 ms edge fade | Suno v5.5 Sounds；可见付费方案状态 |

| Key | 生产 SHA-256 | 时长 | 峰值 | RMS | 质量 |
| --- | --- | ---: | ---: | ---: | --- |
| `level-clear` | `27b50cd5...2dea8c` | 1.220000 s | -3.950 dBFS | -15.617 dBFS | 通过，0 削波 |
| `run-victory-applause` | `ac1e32d8...40f32ed` | 1.650000 s | -3.565 dBFS | -12.225 dBFS | 通过，0 削波 |
| `run-victory-cheer` | `b1b8a26c...47c49b2` | 1.900000 s | -2.578 dBFS | -17.310 dBFS | 通过，0 削波 |
| `run-victory-celebration` | `6e637f6a...a90e667` | 1.800000 s | -4.055 dBFS | -21.515 dBFS | 通过，0 削波 |

运行时等效试听文件：`audio/sfx/_validation/run-victory-layered-preview.ogg`。该预览使用与 `GameAudio.victory()` 相同的音量和延迟，时长 2.45 秒。

全部生成候选和分析副本保存在 `audio/sfx/_source/suno/`；生产代码不引用 `_source/`、`_validation/` 或远程 URL。

## 音频架构

- 保留现有 `GameAudio` 语义管理器，没有新增散落的 `new Audio()`。
- `playSample()` 使用 Web Audio 时间线调度延迟音轨，并将计划延迟写入播放历史。
- `level-clear` 在自身 1.22 秒播放时间的最后 220 ms 自动线性渐隐；该设置不作用于最终胜利音轨。
- 全局同时发声上限为 24；四个新 cue 的每 cue 上限分别为 2、1、1、1。
- `level-clear` 只在 1-7 关播放；三个 `run-victory-*` cue 只在第 8 关最终 `LEVEL_CLEAR` 各播放一次。
- 文件加载或解码成功时只播放采样；程序化叶片、鼓掌、欢呼和庆祝音仅作为失败回退。
- 页面隐藏、暂停、重开和销毁继续由既有生命周期逻辑清理声音。
- 本次没有新增 BGM ducking，也没有新增或修改连续 SFX 循环。

## 流程覆盖

- 菜单、上板准备、教学、开始线：已覆盖
- 倒计时：3、2、1、GO 已覆盖
- 碰撞、捕获、掉落：已覆盖
- 普通通关：`level-clear` 在非最终 `LEVEL_CLEAR` 播放一次
- 最终通关：鼓掌、欢呼、轻庆祝在最终 `LEVEL_CLEAR` 按 `0 / 180 / 650 ms` 调度
- 暂停与恢复：已覆盖
- 结算计数与评级：已覆盖
- 战斗、Boss、QTE、武器、角色对白：游戏不存在，标记为不适用
- Balance Board 实机听感和目标 WebView 扬声器表现：仍需目标设备试听

## 修改指南

- 审计决策：`audio/sfx/audio-audit.json`
- 来源清单与生产哈希：`audio/sfx/audio-sources.json`
- 旧下载清单：`audio/sfx/audio-download-manifest.json` 已标记 deprecated，仅为 2026 年 7 月历史报告保留
- Suno 生成台账：`audio/sfx/suno-generation-plan.json`
- 媒体分析：`audio/sfx/audio-analysis.json`
- 裁切记录：`audio/sfx/loop-validation.json`
- 浏览器证据：`audio/sfx/browser-runtime-report.json`
- 运行时试听：`audio/sfx/_validation/run-victory-layered-preview.ogg`
- 默认音量与错峰：`audio.js` 的 `SFX_DEFINITIONS` 与 `GameAudio.victory()`
- 业务分流：`controller.js` 的 `LEVEL_CLEAR` 状态入口和 `levelClear.isFinal`

## 验证

- `npm run verify`：98/98 测试通过，生产构建成功
- 新增回归测试确认 `0.18` 秒延迟被调度到 `AudioContext.currentTime + 0.18`
- 音频分析：22 条记录，0 失败
- 音频包校验：16 个审计 cue、14 个生产 SFX、2 个受保护 BGM、0 错误、0 警告
- 浏览器 QA：14 个 SFX 与 2 个 BGM 全部 HTTP 200 并解码成功
- 浏览器流程证据：14 条；播放历史 18 条
- 三层胜利播放历史均为 `phase=LEVEL_CLEAR`、`implementation=sample`、`fallback=false`
- 三层调度证据：`scheduled_delay_ms = 0 / 180 / 650`
- JavaScript 控制台错误与警告：0
- 两首 BGM 修改前后哈希一致
- 验证包：`verification/audio-sfx-20260806`

## 许可证与残余风险

- Kenney 旧 SFX：CC0 1.0 Universal。
- 四个新生产音效生成时页面显示付费生成能力和 Pro WAV 控件；发行仍受生成账户在 2026-08-06 的实际订阅状态及 Suno 当时条款约束。
- 本报告不扩大页面明确展示的权利。发行前仍应由项目方完成账户和条款复核。
- 主观氛围已结合提示词、候选试听记录、声学指标和游戏时序筛选；最终体感仍建议在目标 WebView 与实际音箱上试听。
