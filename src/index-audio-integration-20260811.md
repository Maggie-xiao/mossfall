# Moss Tilt Dune 通关音效替换报告

## 结论

- 目标：`src/index.html`
- 最终通关触发：第 8 关进入 `LEVEL_CLEAR`
- 结果：Moss Tilt 已改为播放当前 Dune Carve 的完整终点事件，而不是近似替代。
- 当前有效音频包：13 个 SFX、2 个原有 BGM，共 360089 bytes。

## Dune 同款实现

| Cue | 文件 | SHA-256 | Dune 参数 | Moss Tilt 参数 |
| --- | --- | --- | --- | --- |
| `finish-crowd` | `audio/sfx/finish-crowd.mp3` | `50fa4e071bab79b64aedb635166684dce94c393fa713f270b8efc63fcf11344b` | 基础音量 `0.72`，调用增益 `1.05`，零延迟 | 完全相同 |
| `well-done` | `audio/sfx/well_done.wav` | `df8b96bc9e50ee63383927e4a62372acb9e74deba4b2cbb4d6f8041a18d25160` | 调用增益 `0.98`，零延迟 | 完全相同 |

两个文件与 `h5-balance-dunesong-slalom/assets/audio/snowline/` 中的当前生产文件逐字节一致。两条音频在同一个 `LEVEL_CLEAR` 事件中同时启动、只播放一次、不循环、没有程序化 fallback。原 `run-victory-*` 三层通关声不再进入运行时资产表。

## 运行时改动

- `GameAudio.victory()` 同时触发 `finish-crowd` 与 `well-done`。
- 最终关进入 `LEVEL_CLEAR` 时立即停止 BGM，再播放 Dune 终点声。
- `RESULT_CALC` 不再重复触发胜利声。
- MP3/WAV 使用正确的构建内联 MIME 与本地服务器 MIME。
- Retry、Restart、Quit 和返回标题仍会停止尚未结束的通关 voice。

## BGM

两个原有 BGM 文件及引用均保持不变：

| Key | SHA-256 | 处理 |
| --- | --- | --- |
| `bgm-balance-beam` | `b163059ca23e7fe47b9a2d0490dfadd81e259c154574fa529ab893ee6f3707f9` | 保留；仅在最终完成时立即停止 |
| `bgm-precision-puzzle` | `71ffc52dd9af845eba25e334eb3f9d8e461fb815593a0122613e8dcdd3d0cd16` | 保留；仅在最终完成时立即停止 |

## 来源与许可

- `finish-crowd.mp3`：Dune Carve 当前生产文件；其清单记录的上游来源为 Pixabay 的 “Crowd Cheer and Applause”，Pixabay Content License。
- `well_done.wav`：Dune Carve 当前生产仓库中的生成式 Well Done cue；按用户要求在 Kiwii-AI 内部项目间原样复用，未记录独立第三方上游来源。
- 详细来源见 `audio/sfx/audio-sources.json`，完整决策见 `audio/sfx/audio-audit.json`。

## 验证

- `npm run verify`：134/134 单测通过，普通构建和 standalone 构建成功。
- 音频静态分析：20 条记录，0 失败。
- 浏览器音频巡检：15 个音频请求全部 HTTP 200 且 `decodeAudioData` 成功。
- `finish-crowd` 与 `well-done` 均在 `LEVEL_CLEAR` 记录为 `sample`、`fallback: false`、`scheduled_delay_ms: 0`。
- 浏览器 JavaScript errors：0。
- 音频包校验：15 个 audit cue、2 个保留 BGM、13 个 SFX，0 error、0 warning。

本地运行地址：`http://127.0.0.1:4317/`
