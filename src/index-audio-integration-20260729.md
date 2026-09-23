# Table Tilt 音频整合报告

生成日期：2026-07-29

## 摘要

- 目标 HTML：`game/src/index.html`
- 音效目录：`game/src/audio/sfx/`
- 新音效来源：Kenney Interface Sounds、Kenney Impact Sounds
- 生产音效：11 个 OGG，共 90,726 bytes（约 0.09 MB）
- 决策统计：`replace` 8、`add` 2、`layer` 1、`keep` 0、`preserve` 0
- 原有 BGM：无
- 实现方式：语义化 WebAudio Buffer 管理器、预加载与解码记录、重叠声部限制、逐提示音音量、失败回退、可见性与重开清理、有限长度调试历史
- 构建方式：普通版本复制本地 OGG；单文件版本将 11 个 OGG 内联为 `data:audio/ogg;base64`

机器可读文件：

- [音效审计](audio/sfx/audio-audit.json)
- [来源清单](audio/sfx/audio-sources.json)
- [音频分析](audio/sfx/audio-analysis.json)
- [处理结果](audio/sfx/loop-validation.json)
- [浏览器运行报告](audio/sfx/browser-runtime-report.json)

## BGM 保留与许可风险

项目在整合前后均没有 BGM 文件、BGM URL 或 BGM 播放逻辑，因此没有受保护 BGM 需要替换、改名、重新下载或调整混音。

| Key | Reference | Before hash | After hash | License status | Mix-only changes |
| --- | --- | --- | --- | --- | --- |
| 不适用 | 无 BGM | 不适用 | 不适用 | 不适用 | 无 |

## SFX 审计与决策

评分顺序为：语义适配、时序、耐重复、混音清晰度、风格一致性；每项 0-4 分。

| Key | 事件 | 原始来源 | 原评分 | 决策 | 候选评分 | 原因 |
| --- | --- | --- | --- | --- | --- | --- |
| `ui-move` | 模式与菜单导航 | 程序音 `GameAudio.move()` | 14/20 | replace | 20/20 | 实体选择音更清晰；原音仅作加载失败回退 |
| `ui-confirm` | 开始、恢复、重试、退出确认 | 程序音 `GameAudio.confirm()` | 14/20 | replace | 20/20 | 独立确认音比通用升调更明确 |
| `setup-ready` | 平衡板准备完成 | 程序音 `GameAudio.ready()` | 16/20 | replace | 20/20 | 与普通 UI 确认形成区别 |
| `countdown-beat` | 3、2、1 出现 | 缺失 | 不适用 | add | 20/20 | 使用独立时钟式短 tick，不再复用菜单移动音 |
| `countdown-go` | GO 出现 | 缺失 | 不适用 | add | 20/20 | 提供明确开跑信号 |
| `ball-impact` | 球与板、墙、障碍或球碰撞 | 程序音 `GameAudio.hit()` | 11/20 | replace | 20/20 | 轻质硬表面瞬态更符合弹珠物理 |
| `ball-capture` | 球进入洞口 | 程序音 `GameAudio.capture()` | 16/20 | layer | 20/20 | 落洞样本提供材质感，短升调继续提供精确奖励反馈 |
| `ball-fall` | 球掉出台面 | 程序音 `GameAudio.fall()` | 15/20 | replace | 20/20 | 友好错误音立即表达失败且不过度刺耳 |
| `level-clear` | 关卡清除与加时 | 程序音 `GameAudio.clear()` | 16/20 | replace | 20/20 | 完整确认样本比三颗裸振荡音更统一 |
| `result-count` | 结算数字计数 | 程序音 `GameAudio.resultTick()` | 15/20 | replace | 20/20 | 极短样本适合快速重复，降低振荡器疲劳 |
| `result-rank` | 星级或纪录揭晓 | 程序音 `GameAudio.rank()` | 16/20 | replace | 20/20 | 明亮扩张音与普通确认音区分明显 |

`replace` 项的原程序音仍保留为加载或解码失败时的回退，不会在样本正常播放时叠加。`ball-capture` 是唯一有意的正常分层提示音。

## 已整合资源

| 生产文件 | 原始成员 | 事件与触发 | 默认音量 | 处理 | 来源与许可 |
| --- | --- | --- | --- | --- | --- |
| `ui-move.ogg` | `Audio/select_006.ogg` | 导航状态变化 | 0.20 | trim | Kenney Interface Sounds / CC0 1.0 |
| `ui-confirm.ogg` | `Audio/confirmation_002.ogg` | 接受 UI 命令 | 0.30 | none | Kenney Interface Sounds / CC0 1.0 |
| `setup-ready.ogg` | `Audio/confirmation_001.ogg` | `SETUP_READY` 进入 | 0.32 | none | Kenney Interface Sounds / CC0 1.0 |
| `countdown-beat.ogg` | `Audio/tick_001.ogg` | 3、2、1 视觉拍点 | 0.30 | none | Kenney Interface Sounds / CC0 1.0 |
| `countdown-go.ogg` | `Audio/confirmation_003.ogg` | GO 视觉拍点 | 0.34 | none | Kenney Interface Sounds / CC0 1.0 |
| `ball-impact.ogg` | `Audio/impactPlate_light_000.ogg` | Scene `collision` | 0.18 × 强度 | none | Kenney Impact Sounds / CC0 1.0 |
| `ball-capture.ogg` | `Audio/bong_001.ogg` | Scene `ballCaptured` | 0.26 | none | Kenney Interface Sounds / CC0 1.0 |
| `ball-fall.ogg` | `Audio/error_004.ogg` | Scene `ballFell` | 0.32 | none | Kenney Interface Sounds / CC0 1.0 |
| `level-clear.ogg` | `Audio/confirmation_004.ogg` | `LEVEL_CLEAR` 进入 | 0.30 | none | Kenney Interface Sounds / CC0 1.0 |
| `result-count.ogg` | `Audio/tick_002.ogg` | Result count callback | 0.14 | none | Kenney Interface Sounds / CC0 1.0 |
| `result-rank.ogg` | `Audio/maximize_008.ogg` | Result star/record callback | 0.24 | none | Kenney Interface Sounds / CC0 1.0 |

## 持续循环与处理质量

游戏没有持续移动、环境或机械循环音，因此无需创建无缝循环，也没有四周期循环验证项。

`ui-move` 原文件存在约 1,697.9 ms 尾部静音，已执行受限 trim：

| Key | 原长度 | 输出长度 | 起始静音 | 尾部静音 | Padding | Edge fade | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ui-move` | 1.943923 s | 0.239615 s | 6.145 ms | 7.279 ms | 8 ms | 4 ms | PASS |

原始文件保留在 `audio/sfx/_source/ui-move-source.ogg`，生产代码不引用 `_source/` 或 `_validation/`。

## 音频架构

- `GameAudio` 保留为唯一音频入口，没有散落的 `new Audio()`。
- `SFX_DEFINITIONS` 维护语义 key、相对文件 URL、默认音量、决策和单 cue 声部上限。
- 使用 `fetch` + `decodeAudioData` 预加载 11 个 AudioBuffer，并记录 HTTP 状态、Content-Type 和解码结果。
- 全局最大 24 个声部；高频碰撞单独限制为 8 个，UI 与结果音限制更低。
- 碰撞音根据强度调整增益，并使用小范围播放速率变化减少重复感。
- 页面隐藏时停止活跃声部并挂起 AudioContext；恢复时按已解锁状态恢复。
- 重新开始设置时停止非确认声部并允许当前确认音自然结束；销毁控制器时关闭 AudioContext。
- 播放历史最多 240 条，请求历史最多 32 条。
- 项目没有 BGM，因此 BGM ducking 不适用。

## 流程覆盖

浏览器 QA 在同一音频会话中覆盖：

| Flow | 证据状态 |
| --- | --- |
| `mode-select` | `MODE_SELECT` 模式切换 |
| `setup-ready` | `SETUP_READY` |
| `teach-in` | `TEACH_IN page 2` |
| `countdown` | `LEVEL_INTRO 3-2-1-GO` |
| `gameplay-collision` | `GAMEPLAY` collision |
| `ball-capture` | `GAMEPLAY` ballCaptured |
| `ball-fall` | `BALL_FALL_RESET` |
| `level-clear` | `LEVEL_CLEAR` |
| `pause-resume` | `PAUSE_MENU -> GAMEPLAY` |
| `result` | `RESULT_CALC` count 与 rank reveal |

武器、敌人、Boss、招募和 QTE 不存在于本游戏，标记为不适用。

## 修改指南

- 审计决策：`game/src/audio/sfx/audio-audit.json`
- 下载输入：`game/src/audio/sfx/audio-download-manifest.json`
- 机器来源清单：`game/src/audio/sfx/audio-sources.json`
- 默认音量与文件映射：`game/src/audio.js` 的 `SFX_DEFINITIONS`
- 样本播放、声部、失败回退与历史：`GameAudio.playCue()`、`playSample()`、`recordPlay()`
- 业务触发：`game/src/controller.js`
- 倒计时触发：`tickCountdown()` 中的 `countdownBeat()` / `countdownGo()`
- 浏览器 QA：`debugAudioTour()`，仅在 `?qa` 下由 `A` 键触发
- 普通版复制与单文件内联：`game/scripts/build.mjs`
- 构建音频完整性检查：`game/scripts/verify-artifacts.mjs`

## 验证

- `npm run verify`：PASS
- Node 测试：29/29 PASS
- QA 截图检查：15/15 PASS
- 单文件字体内联：7/7 PASS
- 单文件音效内联：11/11 PASS
- 审计 cue：11，未覆盖 0
- 生产音效：11，缺失 0，未引用 0
- 音频分析：12 条记录（11 个生产文件 + 1 个 trim 原始文件），失败 0
- 媒体校验：PASS；无削波失败
- BGM 引用与 hash：不适用，项目无 BGM
- 最终 `dist` 构建浏览器音频请求（`http://127.0.0.1:4173/`）：11/11 HTTP 200、`audio/ogg`、解码成功
- 浏览器样本播放：11/11 cue 已观察；所有 `replace` cue 均为 sample 且 `fallback=false`
- `ball-capture` 分层：sample + procedural，均为预期
- 浏览器流程：10/10
- 浏览器 JavaScript 错误：0
- 最终 `dist` 浏览器记录重新执行 `validate_audio_pack.py`：0 errors，0 warnings

## 许可与来源

新音效均来自 Kenney，并由对应资产页标注为 Creative Commons CC0：

- [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds)
- [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds)
- [Creative Commons CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)

CC0 新音效与原有项目代码/素材许可应分别管理。本报告只记录本次下载音效的来源与许可，不扩大其他项目资产的授权范围。

## 剩余风险

- 浏览器验证运行于桌面 Chromium 环境；Kiwii 目标 Android WebView 的扬声器响度与音色仍需设备试听。
- 左右手柄静态效果调用保持不变，但本次没有真实硬件验证。
- 项目没有 BGM，因此尚未验证音乐存在时的混音或 ducking 行为。
