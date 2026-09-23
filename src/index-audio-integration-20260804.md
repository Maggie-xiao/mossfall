# 平衡桌球 BGM 接入报告

## 摘要

- 目标入口：`index.html`
- 用户提供源文件：`audio/bgm/_source/Balance Beam.wav`
- 生产文件：`audio/bgm/balance-beam-loop.ogg`
- 本次决策：按项目负责人明确要求替换运行时 BGM；全部 SFX 保持现状
- 运行方式：沿用 `GameAudio` 的解锁、淡入、暂停、恢复、页面隐藏和重置生命周期
- 离线构建：生产 OGG 会复制到 `dist/audio/bgm/`，并内联进 standalone HTML

## BGM 保留与替换

| 角色 | 文件 | SHA-256 | 状态 | 授权风险 |
| --- | --- | --- | --- | --- |
| 旧生产 BGM | `audio/bgm/table-tilt-loop.ogg` | `3556469b940281a89436edbe6ca88c3e5bddb1dfc498c61052fce3711939f2e8` | 文件未改动，保留用于回退 | Suno 账号方案与分发权需确认 |
| 新源文件 | `audio/bgm/_source/Balance Beam.wav` | `11dad8abb2c76acf31d24158988598e2ac8b2d974e1b7a64e8dd104fefe3bb1f` | 用户提供 | 未提供授权信息，发布前需由项目负责人确认 |
| 新生产 BGM | `audio/bgm/balance-beam-loop.ogg` | `b163059ca23e7fe47b9a2d0490dfadd81e259c154574fa529ab893ee6f3707f9` | 当前运行时文件 | 继承源文件授权风险 |

## 循环处理

原始 WAV 为 154.2 秒、48 kHz、双声道 PCM。处理脚本将结尾 5 秒与开头 5 秒做等功率交叉淡化，再接续中段，得到 149.2 秒的 OGG 循环。

| 长度 | 交叉淡化 | 边界跳变比 | 首尾 RMS 差 | 频谱差 | 循环预览 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 149.2 s | 5000 ms | 0.864399 | 0.848 dB | 0.214723 | 4 次 | 通过 |

四循环预览位于 `audio/bgm/_validation/bgm-balance-beam-loop-preview.ogg`，处理记录位于 `audio/bgm/loop-validation.json`。

## 音频架构

- 语义键仍为 `bgm-table-tilt`，资源引用改为 `./audio/bgm/balance-beam-loop.ogg`。
- 默认音量保持 `0.14`，播放速率保持 `1.0`。
- 活跃阶段：`LEVEL_INTRO`、`GAMEPLAY`、`LEVEL_CLEAR`、`BALL_FALL_RESET`、`RUN_COMPLETE`。
- 暂停覆盖层、页面隐藏和离开运行时会暂停或停止；恢复后继续播放。
- 旧曲没有删除或改写，回退只需恢复 `audio.js` 与 `build.mjs` 中的文件名。

## 修改位置

- 运行时映射与音量：`audio.js` 的 `BGM_TRACK`
- 离线构建资源：`scripts/build.mjs` 的 `BGM_FILE`
- 循环生成：`scripts/prepare-balance-beam-bgm.py`
- 来源与哈希：`audio/bgm/bgm-sources.json`
- BGM 审计：`audio/bgm/bgm-audit.json`
- 媒体分析：`audio/bgm/bgm-analysis.json`
- 浏览器证据：`audio/bgm/bgm-browser-runtime-report.json`

## 验证

- `npm run verify`：通过，29 项测试全部成功。
- 离线构建：通过，15 张截图、7 个字体、12 个音频资源验证成功。
- standalone 大小：6,355,940 字节。
- 浏览器请求：新 OGG 返回 HTTP 200/206，类型为 `audio/ogg`。
- 浏览器解码：成功，无 JavaScript 错误、无控制台错误。
- 循环：在 16 倍速 QA 下实际跨过 4 次播放边界。
- 暂停：播放时钟增量为 0。
- 恢复：播放时钟继续推进。
- 停止：离开运行后 `currentTime` 归零。

## 授权说明

`Balance Beam.wav` 是用户提供的本地文件，当前任务未附带来源页面或授权条款。本报告不扩大或推定其使用权；对外发布前应由项目负责人确认商业分发、改编和再发布权限。
