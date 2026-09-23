# Mossfall Table Tilt · UI port notes

2026-08-06 · UI 全量替换为 [`mossfall-ui-v2.html`](./mossfall-ui-v2.html)（目录稿 = 唯一事实来源），
方法照 `recreate-ui` skill。

---

## ⚠️ 哪些改动会被下次构建冲掉

这个目录里是**部署产物**，没有 `src/`、没有 `package.json`、没有 `.git`。

| 文件 | 性质 | 下次 build 会怎样 |
|---|---|---|
| `styles.css` | **手写源文件**（带注释、缩进、组件编号） | 一般安全，除非部署流程整目录覆盖 |
| `index.html` | **手写源文件** | 同上 |
| `app.js` | **构建产物** —— `(()=>{…})()` IIFE + 混淆标识符（`$o` `Rd` `mi` `Pw` `Gw`），无 sourcemap | **必被覆盖**。本次改动全部丢失 |

也就是说：**风险只集中在 `app.js` 的 11 处改动**。它们是直接改 minified bundle 的，
原始 TS/JS 源码在上游仓库（`h5-minigame-dev`），本机沙箱连不上那台 git。

### 怎么根治

把下表逐条在**上游源码**里重做一遍，然后正常 build。改完这一轮，本文件可以删。
备份在 `app.pre-catalog.js.bak` / `styles.pre-catalog.css.bak`，可 diff 对照。

---

## `app.js` 的 11 处改动（按语义，不按行号）

| # | 位置（源码里找这个概念） | 改了什么 | 依据 |
|---|---|---|---|
| 1 | 暂停菜单模板 `renderPause` | 删掉 `#howto-button`「How to play」那一项，只留 Resume / Restart / Quit | C14 只有三个动词 |
| 2 | 断连面板 `renderBoardLost` | `st1`: `Board disconnected` → `Board signal lost`；`st2`: 原长句 → `Step off the board, then step back on.` | C16 |
| 3 | 倒计时标签数组 | `["3","2","1","GO!"]` → `["3","2","1","GO"]`（4 处同一 token，含 `showCountdown` / `holdCountdown` 里的 `t==="GO!"` 比较） | C6，GO 无叹号 |
| 4 | `renderHowTo` 模板 | 四个空 `.dgm.teaching-slot` 占位 → C15 四格实体内容（Shift / Roll home / Beat the clock / Earn time），后两格复用局中 `.timer-shell`/`.timer-clock`/`.hud-time-bonus` | C15 |
| 5 | UI 节点缓存 + `LEVEL_INTRO` + `hideCountdown` | 新增 `this.teachCaption = querySelector("#teach-caption")`，和 `#countdown-demo` **同生同灭**（进 state 一起 show，收倒计时一起 hide）。字幕条本身在 `index.html`。**注意它属于场景层，不是弹窗里的一行** | K3 `.capC`，位置照 Wii 实拍 |
| 6 | toast 图标表（`Pw`） | 三个 SVG 里的 `#fff` → `currentColor` | success/goal 改成浅底深字后，白图标会糊掉 |
| 7 | 时序 config（`mi`） | 新增 `countdownLeadInMs: 1400` | teach-in 要有阅读窗口 |
| 8 | `tickCountdown` | 节拍 `[0,t,2t,3t]` → `[l,l+t,l+2t,l+3t]`；退出条件 `>= t*3+e` → `>= l+t*3+e` | 同上 |
| 9 | 总时长常量（`Gw`） | `beat*3+go` → `lead + beat*3 + go`（**必须从 config 推导**，否则少算一个 lead-in） | 同上 |
| 10 | `enterState` 的 `LEVEL_INTRO` 分支 | 进 state 就 `countdownDemo.classList.remove("hidden")`，且**仅 `currentLevelIndex===0`**（否则每关都多一段死等） | 同上；原来面板要等第一拍才 show，lead-in 会是空屏 |
| 11 | `setMode` + UI 新方法 | `setMode` 不再调 `renderTitle()`（整屏重渲染 → K1 入场动画全部重放 → 跳屏），改调新增的 `setDifficultySelection(mode)`，只 toggle 两个按钮的 `.on` | 见 skill「Entrance animations turn full re-renders into visible jumps」 |

| 12 | 星档 `Cw(r=0,t=3)` | 默认星数 `3` → `4` | C13 是四星 |
| 13 | 评级 `Rw(score,mode)` | 各加一档四星阈值：advanced `>=140`，beginner `>=170` | 同上 |
| 14 | 新增 `Nw(stars)` + 结算模板 | 档位名表 `["SPROUT","MOSS WALKER","GROVE GUIDE","CANOPY KEEPER"]`，在 `<h2>` 和 stars 之间插 `<div class="ttl reveal" id="rv-tier">` | C13 四档对四星 |

附带的纯文案改动（同样在 `app.js`）：

- 标题页硬件 pill：`Balance Board` → `Kiwii Balance Board`（C4）
- 结算主行动按钮：`Retry` → `PLAY AGAIN`（K4；断连面板的 Retry 不动）
- 结算板 DOM 顺序：`FINAL SCORE` + 总分从 rows **之前**移到 rows **之后**
  （K4 阅读顺序：标题 → 星 → 明细 → 总分 → 纪录条）

### 验证方式

`window.__TABLE_TILT__.debugGoto(state, opts)` 可跳所有状态，`scoreRun({cleared,time,settled})`
可直接出结算板。用它做断言，别靠肉眼截图。特别是 #11 要断言**节点身份**：

```js
const before = document.querySelector(".title-screen");
document.getElementById("difficulty-advanced").click();
before === document.querySelector(".title-screen");   // 必须 true
```

---

## 仍未做的（需要 Dantong 定）

1. **K3 三页轮换**：目录稿是「左侧模型框 + 字幕 + page dots + Next」三页轮换，
   现在落地的是「模型占位 + 字幕」同屏一页，没有翻页。补齐要在源码里加翻页状态机。
2. **断连面板的 Retry 按钮**：目录稿那格只有 recon pill。删的是硬件恢复入口，属功能不属装饰，留着等确认。
3. **K1 封面**：目录稿假设一张完整封面图，实机是 3D 菜单场景（偏暗）。属场景/美术，不在 UI 层。

### 四星阈值（2026-08-06 定，可调）

| 档位 | 星 | beginner 总分 | advanced 总分 |
|---|---|---|---|
| CANOPY KEEPER | 4 | ≥170 | ≥140 |
| GROVE GUIDE | 3 | ≥130 | ≥100 |
| MOSS WALKER | 2 | ≥80 | ≥60 |
| SPROUT | 1 | 其余 | 其余 |

四星线是在原有三档之上按同样间距加的（满分约 179 = 8×10 + 剩余时间上限 99）。
实际手感要调就只动 `Rw` 里这两组阈值，档位名和星数不用动。

## 教学占位

`#countdown-demo`（K3 展示位）是 **PLACEHOLDER**，`index.html` 里有替换步骤注释。
换真资产时只替换 `.countdown-demo-slot`，保持外层 id 不变（`app.js` 只 toggle 它的 `.hidden`）。
