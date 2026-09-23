import './teachin/player.js';
import './teachin/manifest.js';

/* =====================================================================
   TABLE TILT · UI 渲染层
   实现 docs/ui-catalog/table-tilt-ui-v3.html。每个方法标注对应的 K/C 编号。
   目录稿是唯一事实来源——改样式先改目录稿。
   ===================================================================== */

const TOTAL_LEVELS = 8;
const RESULT_SCORE_COUNT_MS = 900;
const RESULT_RECORD_DELAY_MS = 300;
const RESULT_RECORD_REVEAL_MS = 350;
const RESULT_NEXT_SIGNAL_DELAY_MS = 150;
export const RESULT_TO_RANK_DWELL_MS = 3000;

export function resultToRankTimeline(afterRowsMs) {
  const recordRevealAtMs =
    afterRowsMs + RESULT_SCORE_COUNT_MS + RESULT_RECORD_DELAY_MS;
  const contentCompleteAtMs = recordRevealAtMs + RESULT_RECORD_REVEAL_MS;
  return {
    recordRevealAtMs,
    contentCompleteAtMs,
    readyAtMs: contentCompleteAtMs + RESULT_NEXT_SIGNAL_DELAY_MS,
    advanceAtMs: contentCompleteAtMs + RESULT_TO_RANK_DWELL_MS
  };
}
/* 连接提示消失前的停留。半拍够看见「好了」，短到不会挡住重新开始的操作。 */
const CONNECTION_NOTE_DWELL_MS = 450;
/* K4 定稿：金星（starC 实心 / starD 空心），4 星制 */
function starMarkup(count = 0, total = 4) {
  return Array.from({ length: total }, (_, index) => {
    const id = index < count ? "starC" : "starD";
    return `<span class="st"><svg viewBox="0 0 24 24"><use href="#${id}"/></svg></span>`;
  }).join("");
}

/* mossfall-ui-v2 C13 · 四档：4★ 全清零掉落 / 3★ 全清 / 2★ 过半 / 1★ 起步 */
export function scoreStars(score, drops = 0, totalLevels = TOTAL_LEVELS) {
  const cleared = score?.cleared ?? 0;
  if ((score?.totalPoints ?? 0) <= 0) return 1;
  /* ENDLESS 没有「全清」这回事 —— totalLevels 是 Infinity，上面那条永远不成立。
     所以改成按清关数给档：能一直打下去本身就是本事，而掉落零次仍然是最高档。 */
  if (!Number.isFinite(totalLevels)) {
    if (cleared >= 16) return drops === 0 ? 4 : 3;
    if (cleared >= 8) return 2;
    return 1;
  }
  if (cleared >= totalLevels) return drops === 0 ? 4 : 3;
  if (cleared >= 4) return 2;
  return 1;
}

/* C13 · 段位称号，与星数一一对应；最低档叫 Sprout（刚发芽），不骂人 */
const RANK_TITLES = ["SPROUT", "SPROUT", "MOSS WALKER", "GROVE GUIDE", "CANOPY KEEPER"];

/* V3 · 结算标题改成按星级四选一。
   原来是按结局二选一（通关 "You did it!" / 超时 "Time's up!"），一句话要覆盖
   1★ 到 4★ 四种手感，讲不出差别；段位名说「打得多好」，标题说「这一局发生了
   什么」，两行分工才成立。索引与 RANK_TITLES 对齐（0 位不用）。 */
const RESULT_HEADLINES = [
  "TIME RAN OUT",
  "TIME RAN OUT",
  "YOU GOT THROUGH",
  "YOU DID IT",
  "YOU DID IT CLEAN"
];

/* V3 · 模式在界面上一律大写（榜标签、结算相关文案都按这张表取字）。
   内部键保持小写 beginner / advanced / endless 不动 —— 它们是 Personal Best 的
   存储命名空间，改一个字母就等于把玩家的历史最佳全丢了。展示名和存储键分开，
   是这里唯一安全的做法。V3 的 gallery 只列了 NORMAL / ENDLESS 两档，游戏实际有
   三档（Beginner / Advanced 打手工那 16 关，Endless 走程序化），按「保留游戏更
   丰富的行为」保三档，只统一大小写。 */
const MODE_LABELS = {
  beginner: "BEGINNER",
  advanced: "ADVANCED",
  endless: "ENDLESS",
  rogue: "ROGUE"
};

function modeLabel(mode) {
  return MODE_LABELS[mode] || String(mode || "").toUpperCase() || "BEGINNER";
}

/* C4 · 双脚印 —— 尺寸与 transform 照 SNOWLINE SPRINT 的 #board-visual .feet 平移。
   三态由 CSS 的 .feet use{fill} 切换（.stepped / .ready），不在这里写死颜色。 */
/**
 * The two footprints on the board.
 *
 * Placement stays on the `<use>` and the step animation goes on the wrapping
 * `<g>`, and they have to stay on separate elements: a CSS transform *replaces*
 * the SVG transform attribute, so animating the same node drops the foot to the
 * viewBox origin at scale 1 and both feet pile into the top-left corner the
 * moment they move.
 *
 * `foot-l` / `foot-r` are what the per-phase keyframes hang off; they are
 * staggered in CSS, because nobody steps onto a board with both feet at once.
 */
export class GameUI {
  constructor() {
    this.screenLayer = document.querySelector("#screen-stage");
    this.screenBackdrop = document.querySelector("#screen-backdrop");
    this.hud = document.querySelector("#game-hud");
    this.level = document.querySelector("#hud-level");
    this.levelValue = this.level.querySelector(".nv");
    this.timerShell = document.querySelector("#timer-shell");
    this.timer = document.querySelector("#hud-timer");
    this.timeBonus = document.querySelector("#hud-time-bonus");
    this.rogueBlessings = document.querySelector("#rogue-blessings");
    this.connectionNote = document.querySelector("#connection-note");
    this.connectionRequired = document.querySelector("#connection-required");
    this.connectionRequiredTitle = document.querySelector(
      "#connection-required-title"
    );
    this.connectionRequiredCopy = document.querySelector(
      "#connection-required-copy"
    );
    this.levelFlash = document.querySelector("#level-flash");
    this.countdownDemo = document.querySelector("#countdown-demo");
    this.eventFlash = document.querySelector("#event-flash");
    this.touchSurface = document.querySelector("#touch-surface");
    this.touchStick = document.querySelector("#touch-stick");
    this.touchKnob = document.querySelector("#touch-knob");
    this.boot = document.querySelector("#boot-fallback");
    this.stage = document.querySelector("#stage");

    this.timers = new Set();
    this.animationFrames = new Set();
    this.bindings = [];
    this.destroyed = false;
    this.lastTimerText = "";
    this.lastLevelText = "";
    this.countdownAnimation = null;
    /* 连接提示的收尾停留自带一个计时器，不进 this.timers：那一批每次换屏都会被
       clearTimers() 清掉，而这条停留要跨过局内的状态切换活下来 */
    this.connectionNoteText = "";
    this.connectionNoteTimer = 0;
  }

  /* 计时器统一在【排下一批之前】清空，否则会把刚排的节拍杀掉 */
  clearTimers() {
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers.clear();
    this.animationFrames.forEach((id) => window.cancelAnimationFrame(id));
    this.animationFrames.clear();
  }

  after(ms, fn) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  nextFrame(fn) {
    const id = window.requestAnimationFrame((now) => {
      this.animationFrames.delete(id);
      if (!this.destroyed) fn(now);
    });
    this.animationFrames.add(id);
    return id;
  }

  clearBindings() {
    for (const { element, handler, type } of this.bindings) {
      element.removeEventListener(type, handler);
    }
    this.bindings.length = 0;
  }

  on(id, handler) {
    this.bind(document.getElementById(id), handler);
  }

  focusMenuControl(id) {
    const control = document.getElementById(id);
    if (!control || typeof control.focus !== "function") return false;
    document
      .querySelectorAll('[data-gamepad-focused="true"]')
      .forEach((element) => element.removeAttribute("data-gamepad-focused"));
    control.dataset.gamepadFocused = "true";
    control.focus({ preventScroll: true });
    return true;
  }

  /* 按元素绑，而不是按 id —— 三档强度按钮没有各自的 id，而开关要听的是
     change 不是 click。 */
  bind(element, handler, type = "click") {
    if (!element) return;
    element.addEventListener(type, handler);
    this.bindings.push({ element, handler, type });
  }

  showScreen(html) {
    this.teachinPlayer?.dispose();
    this.teachinPlayer = null;
    this.clearBindings();
    this.screenLayer.innerHTML = html;
    const screen = this.screenLayer.querySelector(".screen");
    const screenName = screen?.dataset.screen;
    if (screenName) {
      this.screenBackdrop.dataset.screen = screenName;
      this.screenLayer.dataset.screen = screenName;
    } else {
      this.screenBackdrop.removeAttribute("data-screen");
      this.screenLayer.removeAttribute("data-screen");
    }
  }

  clearScreen() {
    this.teachinPlayer?.dispose();
    this.teachinPlayer = null;
    this.clearBindings();
    this.screenLayer.replaceChildren();
    this.screenBackdrop.removeAttribute("data-screen");
    this.screenLayer.removeAttribute("data-screen");
  }

  hideHud() {
    this.hud.classList.add("hidden");
    this.touchStick?.classList.add("hidden");
    this.touchStick?.classList.remove("interactive");
    this.touchStick?.setAttribute("aria-hidden", "true");
    this.touchSurface?.classList.remove("interactive");
    if (this.touchKnob) this.touchKnob.style.transform = "";
    this.timeBonus.classList.add("hidden");
    /* HUD 一收，那条提示连同它的停留一起作废——别让它在下一屏上补一帧 */
    if (this.connectionNoteTimer) {
      window.clearTimeout(this.connectionNoteTimer);
      this.connectionNoteTimer = 0;
    }
    this.connectionNoteText = "";
    this.connectionNote.textContent = "";
  }

  setReady() {
    this.boot.classList.add("ready");
    this.after(260, () => this.boot.classList.add("hidden"));
  }

  /* =================================================================
     K1 · TITLE / COVER
     目录稿只有：封面 + logo + 难度胶囊分段 + START。原版的 Back 按钮已删。

     2026-08-03：封面与 logo 都换成实图（game/src/images/），标题页因此是
     全作唯一分三拍进场的屏——封面淡入、logo 弹入、按钮落下，三拍不重叠：
     先认地方，再认名字，最后才给选择。时序全写在 styles.css 的 K1 段。
     DOM 顺序上 .logo 放在最后，是为了让它盖在 .ui 之上而不必再加 z-index。
     ================================================================= */
  renderTitle(mode, callbacks) {
    this.clearTimers();
    this.hideHud();
    this.showScreen(`
      <section class="screen title-screen" data-screen="MODE_SELECT">
        <div class="title-topbar">
          <button id="title-howto" class="title-howto" type="button">How to play</button>
          <span class="bpill"><span class="ic ic--link"></span>Kiwii Move</span>
        </div>
        <div class="ui">
          <!-- 一个开关 + 三档强度，同一个胶囊，摆在难度选择器上方。
               底部读下来是 设置 → 选择 → 动作，一层比一层窄、一层比一层重。

               强度按钮是 label 的兄弟，不是子元素：<label> 会把内部任何点击
               转交给它的控件，嵌套会导致每次按强度都顺手翻转开关。

               Moss Tilt 不是震动游戏——震动只是接住/掉落的点缀，玩家不需要
               从里面读信息——所以默认 Light 而不是 Medium。 -->
          <div class="vibration-setting-row">
            <label class="vibration-setting">
              <span>Vibration</span>
              <input id="vibration-toggle" type="checkbox" role="switch" checked>
              <span class="vibration-track" aria-hidden="true"><i></i></span>
            </label>
            <!-- 关闭态用 aria-disabled 而不是 disabled 属性：disabled 的按钮
                 会掉出 tab 顺序，把震动关掉的键盘玩家就再也 tab 不回这一组。 -->
            <div class="miniseg">
              <div id="vibration-levels" class="vibration-levels" role="group" aria-label="Vibration strength">
                <button class="vibration-level is-selected" data-vibration-level="light" type="button" aria-pressed="true">Light</button>
                <button class="vibration-level" data-vibration-level="medium" type="button" aria-pressed="false">Medium</button>
                <button class="vibration-level" data-vibration-level="heavy" type="button" aria-pressed="false">Heavy</button>
              </div>
            </div>
          </div>
          <div class="diffseg" role="group" aria-label="Difficulty">
            <button id="difficulty-beginner" type="button" data-testid="difficulty-beginner"
              class="${mode === "beginner" ? "on" : ""}"
              aria-pressed="${mode === "beginner"}">Beginner</button>
            <button id="difficulty-advanced" type="button" data-testid="difficulty-advanced"
              class="${mode === "advanced" ? "on" : ""}"
              aria-pressed="${mode === "advanced"}">Advanced</button>
            <!-- 第三档。Beginner / Advanced 打的是手工那 16 关，程序化内容只从
                 这扇门进来 —— 见 docs/procedural-runs.md。 -->
            <button id="difficulty-endless" type="button" data-testid="difficulty-endless"
              class="${mode === "endless" ? "on" : ""}"
              aria-pressed="${mode === "endless"}">Endless</button>
            <button id="difficulty-rogue" type="button" data-testid="difficulty-rogue"
              class="${mode === "rogue" ? "on" : ""}"
              aria-pressed="${mode === "rogue"}">Rogue</button>
          </div>
          <button id="start-button" class="btn big" type="button" data-testid="start">START</button>
        </div>
        <div class="logo" aria-label="Moss Tilt">
          <h1 class="logo-wordmark" aria-label="Moss Tilt">
            <svg class="logo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5605 1351" role="img" aria-label="Moss Tilt" focusable="false"> <defs> <!-- 笔画光变：光从树冠上方来，顶端近白，底端沉进苔绿。平涂奶白放大后是一块塑料板。 --> <linearGradient id="mtInk" gradientUnits="userSpaceOnUse" x1="0" y1="150.0" x2="0" y2="711.0"> <stop offset="0" stop-color="#fdfff4"/><stop offset=".46" stop-color="#edf9cd"/><stop offset="1" stop-color="#a9cd72"/> </linearGradient> <linearGradient id="mtVine" gradientUnits="userSpaceOnUse" x1="150.0" y1="0" x2="5455.0" y2="0"> <stop offset="0" stop-color="#cfe89a" stop-opacity="0"/><stop offset=".18" stop-color="#cfe89a" stop-opacity=".95"/> <stop offset=".82" stop-color="#cfe89a" stop-opacity=".95"/><stop offset="1" stop-color="#cfe89a" stop-opacity="0"/> </linearGradient> <!-- 投影写在用户坐标里，跟笔画同比例缩放；写成 CSS 固定 px 会在小尺寸糊成一圈描边。 第一层是无偏移暗色外晕：标题两端压在浅色叶丛上，没有它就糊了。 --> <filter id="mtSh" x="-16%" y="-15%" width="132%" height="136%" color-interpolation-filters="sRGB"> <feDropShadow dx="0" dy="0"  stdDeviation="16" flood-color="#062010" flood-opacity=".78"/> <feDropShadow dx="0" dy="11" stdDeviation="8"  flood-color="#0a2a15" flood-opacity=".55"/> <feDropShadow dx="0" dy="30" stdDeviation="28" flood-color="#04180b" flood-opacity=".42"/> </filter> </defs> <g filter="url(#mtSh)"> <g fill="url(#mtInk)"> <path transform="translate(150.0 711.0) scale(1 -1)" d="M739.0 584.0Q773.0 584.0 784.0 565.0Q795.0 546.0 795.0 525.0Q795.0 522.0 790.5 516.0Q786.0 510.0 779.5 504.0Q773.0 498.0 766.5 493.5Q760.0 489.0 756.0 489.0H739.0Q732.0 489.0 727.0 488.0Q714.0 486.0 709.0 481.0Q694.0 481.0 686.5 474.5Q679.0 468.0 675.0 458.0Q671.0 448.0 670.5 436.0Q670.0 424.0 670.0 414.0V347.0V275.0Q670.0 264.0 673.0 258.0Q676.0 252.0 678.0 247.0Q683.0 241.0 683.5 235.0Q684.0 229.0 684.0 222.0L681.0 189.0Q681.0 175.0 685.0 161.5Q689.0 148.0 689.0 142.0L701.0 114.0V86.0Q701.0 68.0 718.5 61.0Q736.0 54.0 756.5 49.5Q777.0 45.0 794.5 39.5Q812.0 34.0 812.0 19.0Q812.0 -11.0 784.0 -11.0H748.0Q741.0 -11.0 733.0 -11.5Q725.0 -12.0 717.0 -17.0L634.0 -11.0H606.0H587.0Q584.0 -11.0 573.0 -12.0Q562.0 -13.0 549.5 -14.0Q537.0 -15.0 526.0 -16.0Q515.0 -17.0 512.0 -17.0Q497.0 -17.0 490.5 -15.0Q484.0 -13.0 484.0 0.0Q484.0 14.0 491.5 30.5Q499.0 47.0 520.0 47.0H539.0H578.0Q585.0 47.0 589.5 51.5Q594.0 56.0 595.5 62.5Q597.0 69.0 597.5 75.5Q598.0 82.0 598.0 86.0Q598.0 99.0 592.5 117.0Q587.0 135.0 587.0 142.0V178.0V208.0V236.0Q587.0 240.0 585.5 249.5Q584.0 259.0 581.0 268.5Q578.0 278.0 574.5 285.0Q571.0 292.0 567.0 292.0Q565.0 292.0 558.5 283.5Q552.0 275.0 543.5 261.5Q535.0 248.0 524.5 231.5Q514.0 215.0 504.5 199.0Q495.0 183.0 487.0 170.0Q479.0 157.0 475.0 150.0Q467.0 144.0 461.5 134.0Q456.0 124.0 452.0 113.5Q448.0 103.0 445.0 92.5Q442.0 82.0 439.0 75.0Q431.0 61.0 423.5 50.5Q416.0 40.0 411.0 33.0Q403.0 16.0 400.0 13.5Q397.0 11.0 389.0 11.0Q377.0 11.0 373.5 19.0Q370.0 27.0 361.0 42.0L353.0 103.0Q346.0 121.0 337.0 140.0Q328.0 159.0 320.5 178.5Q313.0 198.0 308.0 217.0Q303.0 236.0 303.0 253.0V264.0Q303.0 268.0 300.0 277.5Q297.0 287.0 293.0 296.5Q289.0 306.0 284.0 313.0Q279.0 320.0 275.0 320.0Q272.0 320.0 267.0 311.0Q262.0 302.0 257.5 290.0Q253.0 278.0 250.0 265.5Q247.0 253.0 247.0 247.0V197.0V178.0Q243.0 152.0 239.0 131.0Q236.0 113.0 233.5 96.0Q231.0 79.0 231.0 75.0Q231.0 47.0 241.0 37.0Q251.0 27.0 263.0 24.0Q275.0 21.0 285.0 18.0Q295.0 15.0 295.0 0.0Q295.0 -11.0 290.5 -16.5Q286.0 -22.0 280.0 -24.5Q274.0 -27.0 268.0 -27.5Q262.0 -28.0 259.0 -28.0H220.0L125.0 -11.0H106.0H89.0Q86.0 -13.0 82.0 -14.0Q76.0 -17.0 69.0 -17.0H50.0Q47.0 -17.0 41.0 -16.0Q35.0 -15.0 29.0 -12.5Q23.0 -10.0 18.5 -7.0Q14.0 -4.0 14.0 0.0Q14.0 10.0 21.5 17.5Q29.0 25.0 38.5 30.0Q48.0 35.0 57.0 37.0Q66.0 39.0 69.0 39.0H89.0Q92.0 39.0 101.0 40.0Q110.0 41.0 120.0 43.0Q131.0 45.0 145.0 47.0Q152.0 54.0 159.0 71.5Q166.0 89.0 171.0 107.5Q176.0 126.0 179.5 141.5Q183.0 157.0 183.0 161.0V197.0V208.0Q186.0 211.0 188.0 217.5Q190.0 224.0 191.0 231.0Q192.0 239.0 192.0 247.0V292.0Q192.0 296.0 193.5 304.0Q195.0 312.0 197.0 320.0Q200.0 329.0 203.0 339.0V367.0Q205.0 373.0 207.0 379.0Q209.0 384.0 210.0 390.0Q211.0 396.0 211.0 403.0V425.0Q211.0 428.0 208.0 438.5Q205.0 449.0 201.0 460.0Q197.0 473.0 192.0 489.0Q187.0 496.0 178.0 502.0Q169.0 508.0 161.0 514.0Q155.0 519.0 146.5 523.5Q138.0 528.0 133.0 537.0V548.0Q133.0 554.0 138.0 557.0Q143.0 560.0 150.0 562.0Q157.0 564.0 167.0 564.0H192.0Q202.0 564.0 206.5 565.5Q211.0 567.0 213.0 569.5Q215.0 572.0 216.0 573.5Q217.0 575.0 220.0 575.0H267.0H286.0L314.0 564.0Q324.0 538.0 335.5 500.5Q347.0 463.0 359.0 421.0Q371.0 379.0 382.5 337.5Q394.0 296.0 404.5 263.0Q415.0 230.0 423.0 209.5Q431.0 189.0 436.0 189.0Q438.0 194.0 441.0 198.0Q443.0 202.0 446.5 206.5Q450.0 211.0 453.0 214.0Q468.0 265.0 493.5 320.0Q519.0 375.0 539.0 425.0Q539.0 446.0 551.5 461.5Q564.0 477.0 578.0 498.0Q581.0 505.0 582.0 516.5Q583.0 528.0 585.5 539.5Q588.0 551.0 594.0 561.0Q600.0 571.0 614.0 575.0H653.0L667.0 567.0Q681.0 567.0 693.0 569.5Q705.0 572.0 716.0 575.0Q727.0 579.0 739.0 584.0Z"/> <path transform="translate(1031.0 711.0) scale(1 -1)" d="M314.0 562.0 350.0 553.0H370.0Q383.0 549.0 394.0 545.0Q404.0 541.0 413.0 537.5Q422.0 534.0 425.0 531.0Q440.0 523.0 459.5 517.5Q479.0 512.0 492.0 498.0Q500.0 491.0 508.5 474.0Q517.0 457.0 525.0 450.0Q559.0 421.0 568.5 394.5Q578.0 368.0 578.0 347.0L575.0 281.0V253.0Q575.0 242.0 566.5 220.0Q558.0 198.0 546.5 174.0Q535.0 150.0 525.0 129.5Q515.0 109.0 512.0 103.0Q505.0 82.0 487.5 68.5Q470.0 55.0 453.0 47.0Q426.0 26.0 402.5 9.0Q379.0 -8.0 350.0 -8.0Q338.0 -8.0 326.5 -5.5Q315.0 -3.0 295.0 -3.0Q291.0 -3.0 285.0 -3.5Q279.0 -4.0 272.0 -5.0Q264.0 -6.0 256.0 -6.0H239.0Q231.0 -6.0 218.5 -3.0Q206.0 0.0 195.0 5.0Q182.0 10.0 167.0 17.0Q140.0 29.0 112.0 43.5Q84.0 58.0 67.0 92.0Q46.0 142.0 28.5 196.0Q11.0 250.0 11.0 300.0Q11.0 310.0 13.0 318.0Q15.0 326.0 18.0 334.5Q21.0 343.0 25.0 352.0Q29.0 361.0 33.0 375.0Q33.0 390.0 37.5 403.0Q42.0 416.0 50.0 431.0Q50.0 434.0 59.0 450.0Q68.0 466.0 81.0 484.0Q94.0 502.0 108.5 516.5Q123.0 531.0 133.0 531.0L161.0 542.0Q174.0 542.0 184.5 543.0Q195.0 544.0 206.0 550.0Q217.0 555.0 227.0 558.5Q237.0 562.0 247.0 562.0H295.0ZM228.0 484.0Q211.0 484.0 194.0 461.0Q177.0 438.0 163.5 408.5Q150.0 379.0 141.5 352.0Q133.0 325.0 133.0 317.0V300.0V239.0Q133.0 225.0 150.5 196.5Q168.0 168.0 194.0 139.5Q220.0 111.0 249.5 89.0Q279.0 67.0 303.0 67.0H322.0Q343.0 67.0 367.5 78.0Q392.0 89.0 412.5 108.0Q433.0 127.0 447.0 152.5Q461.0 178.0 461.0 206.0V234.0V300.0Q461.0 321.0 455.5 333.5Q450.0 346.0 441.0 357.5Q432.0 369.0 420.0 383.5Q408.0 398.0 395.0 423.0Q387.0 429.0 377.5 438.0Q368.0 447.0 357.5 455.0Q347.0 463.0 335.5 469.0Q324.0 475.0 314.0 475.0H295.0Q287.0 475.0 276.0 476.0Q265.0 477.0 254.0 479.0Q242.0 481.0 228.0 484.0Z"/> <path transform="translate(1689.0 711.0) scale(1 -1)" d="M100.0 475.0Q100.0 491.0 105.5 502.5Q111.0 514.0 120.5 523.0Q130.0 532.0 142.0 540.0Q154.0 548.0 167.0 556.0Q194.0 573.0 216.5 584.0Q239.0 595.0 272.0 595.0Q293.0 595.0 309.0 594.5Q325.0 594.0 342.0 581.0Q356.0 570.0 361.5 557.0Q367.0 544.0 367.0 525.0Q367.0 515.0 363.5 504.0Q360.0 493.0 353.5 484.0Q347.0 475.0 337.5 469.5Q328.0 464.0 317.0 464.0Q306.0 464.0 299.5 469.5Q293.0 475.0 287.5 481.0Q282.0 487.0 275.5 492.5Q269.0 498.0 259.0 498.0Q246.0 498.0 232.5 495.5Q219.0 493.0 208.0 487.0Q197.0 481.0 190.0 472.0Q183.0 463.0 183.0 450.0Q183.0 438.0 191.0 433.0Q199.0 428.0 210.5 426.0Q222.0 424.0 235.0 422.0Q248.0 420.0 259.0 414.0Q286.0 400.0 305.5 389.0Q325.0 378.0 350.0 361.0Q359.0 356.0 366.0 352.5Q373.0 349.0 379.5 346.0Q386.0 343.0 393.0 339.0Q400.0 335.0 409.0 328.0Q438.0 305.0 455.5 281.5Q473.0 258.0 473.0 220.0V197.0Q473.0 185.0 477.0 175.5Q481.0 166.0 481.0 153.0Q481.0 132.0 472.5 119.0Q464.0 106.0 456.0 89.0Q454.0 81.0 456.0 75.5Q458.0 70.0 453.0 64.0Q449.0 51.0 440.0 47.0Q431.0 43.0 423.0 33.0Q414.0 25.0 406.0 19.0Q398.0 13.0 390.0 7.5Q382.0 2.0 373.5 -3.0Q365.0 -8.0 353.0 -14.0Q334.0 -25.0 319.0 -29.5Q304.0 -34.0 284.0 -39.0Q277.0 -41.0 272.0 -45.5Q267.0 -50.0 259.0 -50.0Q250.0 -50.0 245.0 -48.5Q240.0 -47.0 234.0 -47.0Q219.0 -47.0 210.5 -50.0Q202.0 -53.0 189.0 -53.0Q181.0 -53.0 176.5 -49.5Q172.0 -46.0 164.0 -44.0Q153.0 -40.0 144.5 -40.5Q136.0 -41.0 125.0 -39.0Q114.0 -39.0 107.0 -32.5Q100.0 -26.0 89.0 -19.0Q78.0 -13.0 68.0 -10.5Q58.0 -8.0 47.0 3.0Q36.0 9.0 35.0 18.5Q34.0 28.0 28.0 39.0Q20.0 56.0 14.0 65.5Q8.0 75.0 8.0 95.0Q8.0 124.0 30.0 145.5Q52.0 167.0 83.0 167.0Q102.0 167.0 119.0 158.5Q136.0 150.0 136.0 133.0Q136.0 127.0 134.5 124.0Q133.0 121.0 133.0 117.0Q133.0 110.0 136.0 106.0Q139.0 102.0 139.0 97.0Q139.0 95.0 137.5 91.5Q136.0 88.0 136.0 86.0Q136.0 71.0 144.0 60.5Q152.0 50.0 164.5 42.5Q177.0 35.0 193.0 31.5Q209.0 28.0 225.0 28.0Q257.0 28.0 283.5 43.0Q310.0 58.0 331.0 83.0Q343.0 96.0 351.0 110.0Q359.0 124.0 359.0 145.0Q359.0 157.0 353.0 167.5Q347.0 178.0 347.0 189.0Q347.0 194.0 348.5 194.5Q350.0 195.0 350.0 197.0Q350.0 213.0 341.5 223.5Q333.0 234.0 320.0 242.0Q307.0 250.0 291.5 257.0Q276.0 264.0 261.0 272.0Q257.0 274.0 254.5 279.0Q252.0 284.0 247.0 286.0Q237.0 291.0 227.0 291.5Q217.0 292.0 208.0 300.0Q200.0 305.0 197.0 310.5Q194.0 316.0 186.0 322.0Q175.0 327.0 166.5 327.5Q158.0 328.0 147.0 336.0Q141.0 343.0 136.5 348.0Q132.0 353.0 128.0 361.0Q120.0 371.0 108.5 377.0Q97.0 383.0 97.0 398.0V423.0Q97.0 429.0 96.0 435.0Q95.0 441.0 95.0 448.0Q95.0 452.0 96.0 454.5Q97.0 457.0 97.0 461.0Q97.0 466.0 98.5 469.5Q100.0 473.0 100.0 475.0Z"/> <path transform="translate(2236.0 711.0) scale(1 -1)" d="M100.0 475.0Q100.0 491.0 105.5 502.5Q111.0 514.0 120.5 523.0Q130.0 532.0 142.0 540.0Q154.0 548.0 167.0 556.0Q194.0 573.0 216.5 584.0Q239.0 595.0 272.0 595.0Q293.0 595.0 309.0 594.5Q325.0 594.0 342.0 581.0Q356.0 570.0 361.5 557.0Q367.0 544.0 367.0 525.0Q367.0 515.0 363.5 504.0Q360.0 493.0 353.5 484.0Q347.0 475.0 337.5 469.5Q328.0 464.0 317.0 464.0Q306.0 464.0 299.5 469.5Q293.0 475.0 287.5 481.0Q282.0 487.0 275.5 492.5Q269.0 498.0 259.0 498.0Q246.0 498.0 232.5 495.5Q219.0 493.0 208.0 487.0Q197.0 481.0 190.0 472.0Q183.0 463.0 183.0 450.0Q183.0 438.0 191.0 433.0Q199.0 428.0 210.5 426.0Q222.0 424.0 235.0 422.0Q248.0 420.0 259.0 414.0Q286.0 400.0 305.5 389.0Q325.0 378.0 350.0 361.0Q359.0 356.0 366.0 352.5Q373.0 349.0 379.5 346.0Q386.0 343.0 393.0 339.0Q400.0 335.0 409.0 328.0Q438.0 305.0 455.5 281.5Q473.0 258.0 473.0 220.0V197.0Q473.0 185.0 477.0 175.5Q481.0 166.0 481.0 153.0Q481.0 132.0 472.5 119.0Q464.0 106.0 456.0 89.0Q454.0 81.0 456.0 75.5Q458.0 70.0 453.0 64.0Q449.0 51.0 440.0 47.0Q431.0 43.0 423.0 33.0Q414.0 25.0 406.0 19.0Q398.0 13.0 390.0 7.5Q382.0 2.0 373.5 -3.0Q365.0 -8.0 353.0 -14.0Q334.0 -25.0 319.0 -29.5Q304.0 -34.0 284.0 -39.0Q277.0 -41.0 272.0 -45.5Q267.0 -50.0 259.0 -50.0Q250.0 -50.0 245.0 -48.5Q240.0 -47.0 234.0 -47.0Q219.0 -47.0 210.5 -50.0Q202.0 -53.0 189.0 -53.0Q181.0 -53.0 176.5 -49.5Q172.0 -46.0 164.0 -44.0Q153.0 -40.0 144.5 -40.5Q136.0 -41.0 125.0 -39.0Q114.0 -39.0 107.0 -32.5Q100.0 -26.0 89.0 -19.0Q78.0 -13.0 68.0 -10.5Q58.0 -8.0 47.0 3.0Q36.0 9.0 35.0 18.5Q34.0 28.0 28.0 39.0Q20.0 56.0 14.0 65.5Q8.0 75.0 8.0 95.0Q8.0 124.0 30.0 145.5Q52.0 167.0 83.0 167.0Q102.0 167.0 119.0 158.5Q136.0 150.0 136.0 133.0Q136.0 127.0 134.5 124.0Q133.0 121.0 133.0 117.0Q133.0 110.0 136.0 106.0Q139.0 102.0 139.0 97.0Q139.0 95.0 137.5 91.5Q136.0 88.0 136.0 86.0Q136.0 71.0 144.0 60.5Q152.0 50.0 164.5 42.5Q177.0 35.0 193.0 31.5Q209.0 28.0 225.0 28.0Q257.0 28.0 283.5 43.0Q310.0 58.0 331.0 83.0Q343.0 96.0 351.0 110.0Q359.0 124.0 359.0 145.0Q359.0 157.0 353.0 167.5Q347.0 178.0 347.0 189.0Q347.0 194.0 348.5 194.5Q350.0 195.0 350.0 197.0Q350.0 213.0 341.5 223.5Q333.0 234.0 320.0 242.0Q307.0 250.0 291.5 257.0Q276.0 264.0 261.0 272.0Q257.0 274.0 254.5 279.0Q252.0 284.0 247.0 286.0Q237.0 291.0 227.0 291.5Q217.0 292.0 208.0 300.0Q200.0 305.0 197.0 310.5Q194.0 316.0 186.0 322.0Q175.0 327.0 166.5 327.5Q158.0 328.0 147.0 336.0Q141.0 343.0 136.5 348.0Q132.0 353.0 128.0 361.0Q120.0 371.0 108.5 377.0Q97.0 383.0 97.0 398.0V423.0Q97.0 429.0 96.0 435.0Q95.0 441.0 95.0 448.0Q95.0 452.0 96.0 454.5Q97.0 457.0 97.0 461.0Q97.0 466.0 98.5 469.5Q100.0 473.0 100.0 475.0Z"/> <path transform="translate(3168.0 711.0) scale(1 -1)" d="M631.0 584.0Q634.0 584.0 637.5 576.5Q641.0 569.0 644.0 559.0Q647.0 549.0 649.0 539.0Q651.0 529.0 651.0 525.0V453.0Q651.0 449.0 650.5 438.0Q650.0 427.0 647.5 415.5Q645.0 404.0 639.0 395.0Q633.0 386.0 623.0 386.0Q606.0 386.0 598.5 393.5Q591.0 401.0 587.5 412.5Q584.0 424.0 582.0 437.5Q580.0 451.0 575.0 462.5Q570.0 474.0 559.5 481.5Q549.0 489.0 528.0 489.0H473.0Q468.0 489.0 462.0 488.0Q456.0 487.0 451.0 485.0Q445.0 483.0 439.0 481.0Q418.0 481.0 406.5 467.5Q395.0 454.0 395.0 434.0V386.0Q395.0 378.0 394.5 371.5Q394.0 365.0 400.0 359.0L395.0 320.0V158.0Q395.0 138.0 398.0 125.5Q401.0 113.0 406.0 105.0Q411.0 97.0 417.0 91.5Q423.0 86.0 428.0 81.0Q443.0 76.0 455.0 71.5Q467.0 67.0 484.0 67.0Q514.0 62.0 529.0 48.5Q544.0 35.0 545.0 20.5Q546.0 6.0 534.0 -6.5Q522.0 -19.0 498.0 -22.0Q489.0 -22.0 480.5 -19.0Q472.0 -16.0 464.0 -14.0Q455.0 -13.0 444.0 -13.0Q433.0 -13.0 421.5 -12.5Q410.0 -12.0 399.5 -10.0Q389.0 -8.0 381.0 -3.0H375.0H286.0Q280.0 -3.0 261.5 -8.5Q243.0 -14.0 220.0 -14.0Q204.0 -14.0 191.0 -13.0Q180.0 -12.0 168.5 -11.5Q157.0 -11.0 153.0 -11.0Q148.0 -11.0 145.0 -15.0Q142.0 -19.0 125.0 -19.0Q123.0 -18.0 121.0 -15.0Q119.0 -13.0 118.0 -10.5Q117.0 -8.0 117.0 -3.0Q121.0 8.0 127.0 19.0Q132.0 28.0 138.5 38.0Q145.0 48.0 153.0 56.0Q167.0 61.0 179.0 65.0Q189.0 69.0 198.5 72.0Q208.0 75.0 211.0 75.0L259.0 86.0Q266.0 86.0 270.0 95.5Q274.0 105.0 276.0 116.0Q278.0 129.0 278.0 147.0V253.0Q278.0 257.0 282.0 267.0L286.0 275.0V403.0Q286.0 411.0 287.5 419.0Q289.0 427.0 289.0 434.0Q289.0 437.0 286.0 443.0Q283.0 449.0 278.0 455.0Q273.0 461.0 266.5 465.5Q260.0 470.0 253.0 470.0H142.0Q121.0 470.0 109.5 462.5Q98.0 455.0 92.0 443.5Q86.0 432.0 83.0 418.5Q80.0 405.0 75.5 393.5Q71.0 382.0 63.0 374.5Q55.0 367.0 39.0 367.0Q24.0 367.0 17.5 378.5Q11.0 390.0 11.0 403.0Q11.0 407.0 12.0 415.5Q13.0 424.0 14.5 433.0Q16.0 442.0 17.5 450.0Q19.0 458.0 19.0 461.0L31.0 509.0Q31.0 512.0 32.5 522.5Q34.0 533.0 37.5 545.0Q41.0 557.0 46.0 566.0Q51.0 575.0 58.0 575.0Q71.0 575.0 78.5 570.0Q86.0 565.0 95.0 559.0Q101.0 554.0 107.5 551.0Q114.0 548.0 125.0 548.0Q131.0 548.0 143.0 550.5Q155.0 553.0 161.0 553.0H181.0Q184.0 551.0 188.0 550.5Q192.0 550.0 197.0 549.0Q202.0 548.0 208.0 548.0H359.0L386.0 553.0L414.0 548.0Q435.0 548.0 457.5 550.5Q480.0 553.0 500.0 553.0H548.0Q566.0 553.0 580.0 558.0Q594.0 563.0 604.5 568.5Q615.0 574.0 621.5 579.0Q628.0 584.0 631.0 584.0Z"/> <path transform="translate(3885.0 711.0) scale(1 -1)" d="M195.0 564.0Q198.0 564.0 205.0 562.5Q212.0 561.0 220.0 559.5Q228.0 558.0 235.5 557.0Q243.0 556.0 247.0 556.0Q249.0 556.0 254.0 552.0Q259.0 548.0 263.5 542.0Q268.0 536.0 271.5 528.5Q275.0 521.0 275.0 514.0Q275.0 510.0 263.0 507.0Q251.0 504.0 236.0 501.0Q221.0 498.0 209.0 494.0Q197.0 490.0 197.0 484.0V414.0Q199.0 406.0 202.0 399.0Q204.0 393.0 206.0 387.0Q208.0 381.0 208.0 378.0L197.0 331.0Q197.0 328.0 198.5 320.0Q200.0 312.0 202.5 303.0Q205.0 294.0 206.5 286.0Q208.0 278.0 208.0 275.0L217.0 225.0Q217.0 204.0 212.5 186.0Q208.0 168.0 208.0 161.0V133.0Q208.0 127.0 202.5 122.5Q197.0 118.0 197.0 97.0Q197.0 93.0 200.0 87.5Q203.0 82.0 207.5 77.5Q212.0 73.0 217.0 70.0Q222.0 67.0 225.0 67.0L247.0 61.0Q275.0 48.0 275.0 19.0Q275.0 7.0 258.5 -0.5Q242.0 -8.0 225.0 -8.0H208.0H189.0H170.0L133.0 3.0Q127.0 3.0 116.0 0.0Q105.0 -3.0 93.0 -7.0Q81.0 -11.0 71.0 -14.0Q61.0 -17.0 58.0 -17.0Q52.0 -17.0 41.5 -10.5Q31.0 -4.0 31.0 3.0Q31.0 14.0 42.5 22.5Q54.0 31.0 67.5 39.5Q81.0 48.0 90.5 58.0Q100.0 68.0 97.0 83.0Q89.0 98.0 93.0 105.5Q97.0 113.0 97.0 120.0V147.0V214.0V359.0L86.0 386.0Q88.0 397.0 91.0 407.0Q93.0 415.0 95.0 422.5Q97.0 430.0 97.0 434.0Q97.0 454.0 94.0 465.5Q91.0 477.0 86.0 484.0Q81.0 489.0 75.0 490.5Q69.0 492.0 62.5 492.5Q56.0 493.0 49.0 494.0Q42.0 495.0 36.0 498.0Q30.0 502.0 26.0 511.0Q22.0 520.0 22.0 539.0Q22.0 543.0 23.0 547.0Q24.0 550.0 25.5 553.0Q27.0 556.0 31.0 556.0H50.0H86.0Q90.0 556.0 95.5 555.0Q101.0 554.0 106.0 552.0Q111.0 550.0 117.0 548.0Q123.0 548.0 132.0 549.0Q141.0 550.0 149.0 552.0Q159.0 554.0 170.0 556.0H181.0Q185.0 556.0 191.0 560.0Z"/> <path transform="translate(4232.0 711.0) scale(1 -1)" d="M306.0 548.0Q320.0 548.0 332.5 540.0Q345.0 532.0 345.0 517.0V498.0Q334.0 490.0 324.0 484.0Q316.0 479.0 308.0 474.5Q300.0 470.0 297.0 470.0H267.0Q246.0 470.0 234.0 458.0Q222.0 446.0 222.0 425.0V395.0Q222.0 368.0 215.5 336.0Q209.0 304.0 203.0 275.0V220.0V164.0V136.0V125.0Q203.0 122.0 204.5 114.5Q206.0 107.0 209.5 99.5Q213.0 92.0 218.0 86.5Q223.0 81.0 231.0 81.0H259.0H289.0H317.0Q320.0 81.0 333.5 87.0Q347.0 93.0 363.0 101.0Q379.0 109.0 394.5 118.0Q410.0 127.0 417.0 133.0Q425.0 140.0 433.0 146.5Q441.0 153.0 448.0 153.0Q454.0 167.0 456.5 169.5Q459.0 172.0 467.0 172.0Q473.0 172.0 484.0 165.5Q495.0 159.0 495.0 153.0Q495.0 150.0 486.5 129.5Q478.0 109.0 466.0 83.5Q454.0 58.0 440.0 34.5Q426.0 11.0 414.0 3.0Q411.0 -1.0 396.5 -2.5Q382.0 -4.0 366.0 -5.0Q348.0 -6.0 325.0 -6.0H297.0H278.0Q257.0 -6.0 236.0 -2.0Q215.0 2.0 208.0 -3.0L195.0 -6.0L147.0 -17.0Q144.0 -17.0 134.5 -15.5Q125.0 -14.0 114.0 -11.5Q103.0 -9.0 93.5 -7.5Q84.0 -6.0 81.0 -6.0Q73.0 -6.0 66.0 -8.0Q59.0 -10.0 54.0 -12.0Q48.0 -15.0 42.0 -17.0Q31.0 -17.0 25.5 -12.0Q20.0 -7.0 17.5 0.0Q15.0 7.0 14.5 14.0Q14.0 21.0 14.0 25.0Q14.0 46.0 27.5 51.0Q41.0 56.0 57.0 59.5Q73.0 63.0 86.5 71.5Q100.0 80.0 100.0 108.0V192.0L108.0 267.0V303.0Q108.0 307.0 109.0 318.5Q110.0 330.0 112.0 343.0Q114.0 358.0 117.0 375.0Q117.0 383.0 112.5 390.0Q108.0 397.0 108.0 403.0V414.0Q108.0 442.0 99.5 452.5Q91.0 463.0 80.5 468.5Q70.0 474.0 61.5 481.0Q53.0 488.0 53.0 509.0Q53.0 519.0 57.5 526.5Q62.0 534.0 68.0 539.0Q74.0 544.0 80.0 546.0Q86.0 548.0 89.0 548.0Z"/> <path transform="translate(4793.0 711.0) scale(1 -1)" d="M631.0 584.0Q634.0 584.0 637.5 576.5Q641.0 569.0 644.0 559.0Q647.0 549.0 649.0 539.0Q651.0 529.0 651.0 525.0V453.0Q651.0 449.0 650.5 438.0Q650.0 427.0 647.5 415.5Q645.0 404.0 639.0 395.0Q633.0 386.0 623.0 386.0Q606.0 386.0 598.5 393.5Q591.0 401.0 587.5 412.5Q584.0 424.0 582.0 437.5Q580.0 451.0 575.0 462.5Q570.0 474.0 559.5 481.5Q549.0 489.0 528.0 489.0H473.0Q468.0 489.0 462.0 488.0Q456.0 487.0 451.0 485.0Q445.0 483.0 439.0 481.0Q418.0 481.0 406.5 467.5Q395.0 454.0 395.0 434.0V386.0Q395.0 378.0 394.5 371.5Q394.0 365.0 400.0 359.0L395.0 320.0V158.0Q395.0 138.0 398.0 125.5Q401.0 113.0 406.0 105.0Q411.0 97.0 417.0 91.5Q423.0 86.0 428.0 81.0Q443.0 76.0 455.0 71.5Q467.0 67.0 484.0 67.0Q514.0 62.0 529.0 48.5Q544.0 35.0 545.0 20.5Q546.0 6.0 534.0 -6.5Q522.0 -19.0 498.0 -22.0Q489.0 -22.0 480.5 -19.0Q472.0 -16.0 464.0 -14.0Q455.0 -13.0 444.0 -13.0Q433.0 -13.0 421.5 -12.5Q410.0 -12.0 399.5 -10.0Q389.0 -8.0 381.0 -3.0H375.0H286.0Q280.0 -3.0 261.5 -8.5Q243.0 -14.0 220.0 -14.0Q204.0 -14.0 191.0 -13.0Q180.0 -12.0 168.5 -11.5Q157.0 -11.0 153.0 -11.0Q148.0 -11.0 145.0 -15.0Q142.0 -19.0 125.0 -19.0Q123.0 -18.0 121.0 -15.0Q119.0 -13.0 118.0 -10.5Q117.0 -8.0 117.0 -3.0Q121.0 8.0 127.0 19.0Q132.0 28.0 138.5 38.0Q145.0 48.0 153.0 56.0Q167.0 61.0 179.0 65.0Q189.0 69.0 198.5 72.0Q208.0 75.0 211.0 75.0L259.0 86.0Q266.0 86.0 270.0 95.5Q274.0 105.0 276.0 116.0Q278.0 129.0 278.0 147.0V253.0Q278.0 257.0 282.0 267.0L286.0 275.0V403.0Q286.0 411.0 287.5 419.0Q289.0 427.0 289.0 434.0Q289.0 437.0 286.0 443.0Q283.0 449.0 278.0 455.0Q273.0 461.0 266.5 465.5Q260.0 470.0 253.0 470.0H142.0Q121.0 470.0 109.5 462.5Q98.0 455.0 92.0 443.5Q86.0 432.0 83.0 418.5Q80.0 405.0 75.5 393.5Q71.0 382.0 63.0 374.5Q55.0 367.0 39.0 367.0Q24.0 367.0 17.5 378.5Q11.0 390.0 11.0 403.0Q11.0 407.0 12.0 415.5Q13.0 424.0 14.5 433.0Q16.0 442.0 17.5 450.0Q19.0 458.0 19.0 461.0L31.0 509.0Q31.0 512.0 32.5 522.5Q34.0 533.0 37.5 545.0Q41.0 557.0 46.0 566.0Q51.0 575.0 58.0 575.0Q71.0 575.0 78.5 570.0Q86.0 565.0 95.0 559.0Q101.0 554.0 107.5 551.0Q114.0 548.0 125.0 548.0Q131.0 548.0 143.0 550.5Q155.0 553.0 161.0 553.0H181.0Q184.0 551.0 188.0 550.5Q192.0 550.0 197.0 549.0Q202.0 548.0 208.0 548.0H359.0L386.0 553.0L414.0 548.0Q435.0 548.0 457.5 550.5Q480.0 553.0 500.0 553.0H548.0Q566.0 553.0 580.0 558.0Q594.0 563.0 604.5 568.5Q615.0 574.0 621.5 579.0Q628.0 584.0 631.0 584.0Z"/> </g> <path d="M150.0 1011.0 C1317.1 989.0, 1953.7 1033.0, 2802.5 1011.0 C3651.3 989.0, 4287.9 1033.0, 5455.0 1011.0" fill="none" stroke="url(#mtVine)" stroke-width="16.0" stroke-linecap="round"/> <g transform="rotate(-22 2033.3 1005.0)"><path d="M1883.3 1005.0 Q2033.3 915.0 2183.3 1005.0 Q2033.3 1095.0 1883.3 1005.0 Z" fill="url(#mtInk)" opacity=".95"/><path d="M1919.3 1005.0 L2153.3 1005.0" stroke="#5d8a3d" stroke-width="6" stroke-linecap="round" opacity=".55"/></g> <g transform="rotate(20 3571.7 1017.0)"><path d="M3421.7 1017.0 Q3571.7 927.0 3721.7 1017.0 Q3571.7 1107.0 3421.7 1017.0 Z" fill="url(#mtInk)" opacity=".95"/><path d="M3457.7 1017.0 L3691.7 1017.0" stroke="#5d8a3d" stroke-width="6" stroke-linecap="round" opacity=".55"/></g> </g> </svg>
          </h1>
        </div>
      </section>
    `);
    this.on("difficulty-beginner", () => callbacks.onMode("beginner"));
    this.on("difficulty-advanced", () => callbacks.onMode("advanced"));
    this.on("difficulty-endless", () => callbacks.onMode("endless"));
    this.on("difficulty-rogue", () => callbacks.onMode("rogue"));
    this.on("title-howto", callbacks.onHowTo);
    this.on("start-button", callbacks.onStart);
    const toggle = document.getElementById("vibration-toggle");
    this.bind(
      toggle,
      () => callbacks.onVibrationToggle?.(Boolean(toggle.checked)),
      "change"
    );
    for (const button of document.querySelectorAll(".vibration-level")) {
      this.bind(button, () => callbacks.onVibrationLevel?.(button));
    }
  }

  setVibrationEnabled(enabled) {
    const on = Boolean(enabled);
    const toggle = document.getElementById("vibration-toggle");
    if (toggle) {
      toggle.checked = on;
      toggle.setAttribute("aria-checked", String(on));
    }
    /* 三档强度只在震动开着时才有意义，所以变暗由开关说了算。
       aria-disabled 而不是 disabled，见 renderTitle 里那段注释。 */
    for (const button of document.querySelectorAll(".vibration-level")) {
      button.setAttribute("aria-disabled", String(!on));
    }
  }

  setVibrationIntensity(intensity) {
    for (const button of document.querySelectorAll(".vibration-level")) {
      const selected = button.dataset.vibrationLevel === intensity;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
  }

  updateTitleMode(mode) {
    for (const difficulty of ["beginner", "advanced", "endless", "rogue"]) {
      const button = document.getElementById(`difficulty-${difficulty}`);
      const active = difficulty === mode;
      button?.classList.toggle("on", active);
      button?.setAttribute("aria-pressed", String(active));
    }
  }

  /* =================================================================
     K2 · HUD · in-play — 三件套，局内永不移动
     ================================================================= */
  beginGameplay({ level, timer, touch, totalLevels }) {
    /* 必须在 setLevel 之前落定。setLevel 对相同文本会提前 return，所以先用
       旧分母渲一次、再补设 totalLevels 是改不回来的 —— HUD 会一直挂着「/ 8」。 */
    if (totalLevels != null) this.totalLevels = totalLevels;
    this.clearScreen();
    this.hud.classList.remove("hidden");
    this.touchStick?.classList.add("hidden");
    this.touchStick?.classList.remove("interactive");
    this.touchStick?.setAttribute("aria-hidden", "true");
    this.touchSurface?.classList.toggle("interactive", Boolean(touch));
    this.setLevel(level);
    this.setTimer(timer);
    this.connectionNote.textContent = "";
    this.levelFlash.classList.add("hidden");
    this.eventFlash.classList.add("hidden");
  }

  setRogueBlessings(blessings = null) {
    if (!this.rogueBlessings) return;
    const ranks = blessings || {};
    const total = Object.values(ranks).reduce(
      (sum, value) => sum + Math.max(0, Number(value) || 0),
      0
    );
    this.rogueBlessings.classList.toggle("hidden", total === 0);
    this.rogueBlessings.textContent = total > 0 ? `FOREST BLESSINGS · ${total}` : "";
    this.rogueBlessings.title = total > 0
      ? `Dewlight ${ranks.dewlight || 0} · Treasure luck ${ranks.treasureLuck || 0} · Butterfly bond ${ranks.butterflyBond || 0}`
      : "";
  }

  updateTouchDisplay(sample) {
    if (this.touchSurface) {
      this.touchSurface.dataset.source = sample?.source || "";
    }
  }

  showConnectionRequired(reason = "DISCONNECTED") {
    if (!this.connectionRequired) return;
    const awaitingSample = [
      "WAITING_FOR_FIRST_SAMPLE",
      "WAITING_FOR_FRESH_SAMPLE",
      "STALE",
      "PROJECT_STALE"
    ].includes(reason);
    const title =
      reason === "STEP_OFF"
        ? "Step onto the Balance Board"
        : awaitingSample
          ? "Waiting for Balance Board input"
          : "Balance Board connection required";
    const copy =
      reason === "STEP_OFF"
        ? "Step back onto the Balance Board to continue."
        : awaitingSample
          ? "Stand on the Balance Board and hold still for a moment."
          : "Reconnect the Balance Board to continue.";
    if (this.connectionRequiredTitle?.textContent !== title) {
      this.connectionRequiredTitle.textContent = title;
    }
    if (this.connectionRequiredCopy?.textContent !== copy) {
      this.connectionRequiredCopy.textContent = copy;
    }
    this.connectionRequired.dataset.reason = reason;
    this.connectionRequired.classList.remove("hidden");
  }

  hideConnectionRequired() {
    this.connectionRequired?.classList.add("hidden");
    this.connectionRequired?.removeAttribute("data-reason");
  }

  setLevel(level) {
    const text = `${level}`;
    if (text === this.lastLevelText) return;
    const isAdvance = this.lastLevelText !== "";
    this.lastLevelText = text;
    /* ENDLESS 没有分母。写「3 / ∞」只是把一个空洞的符号塞进一个很小的字号里，
       不如不写 —— 玩家看到的是自己走了多深，那才是这个模式的分数。 */
    this.levelValue.innerHTML = Number.isFinite(this.totalLevels ?? TOTAL_LEVELS)
      ? `${level}<small> / ${this.totalLevels ?? TOTAL_LEVELS}</small>`
      : `${level}`;
    this.retrigger(this.levelValue, "tickd");
    /* C9 · 清关进位：底边转苔绿弹一下（lvpill.up），其余时间安静 */
    if (isAdvance) {
      this.level.classList.add("up");
      this.after(900, () => this.level.classList.remove("up"));
    }
  }

  setTimer(seconds) {
    const unlimited = !Number.isFinite(seconds);
    const text = unlimited ? "∞" : String(Math.max(0, Math.ceil(seconds)));
    this.timerShell.classList.toggle("unlimited", unlimited);
    this.timerShell.classList.toggle("low", !unlimited && seconds <= 10);
    if (text === this.lastTimerText) return;
    this.lastTimerText = text;
    this.timer.textContent = text;
    this.retrigger(this.timer, "tickd");
  }

  updateGameplay({ level, timer, totalLevels }) {
    if (totalLevels != null) this.totalLevels = totalLevels;
    this.setLevel(level);
    this.setTimer(timer);
  }

  /* 一次性动画要用这个惯用法重放，否则只播一次就再也不动 */
  retrigger(element, className) {
    if (!element) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  /* C7-A · 关卡开始倒计时（裸字 + halo）。beat 时长与它实际停留的时间一致 */
  showCountdown(text, holdMs) {
    const numeral = this.levelFlash.querySelector(".n");
    numeral.textContent = text;
    numeral.classList.toggle("go", text === "GO");
    this.levelFlash.classList.toggle("is-go", text === "GO");
    this.levelFlash.classList.remove("hidden");
    this.countdownDemo?.classList.add("hidden");
    this.levelFlash.style.setProperty("--beat", `${holdMs}ms`);
    this.retrigger(this.levelFlash, "beat");
    this.countdownAnimation?.cancel();
    if (typeof this.levelFlash.animate === "function") {
      const go = text === "GO";
      const at = (scale) => `translate(-50%, -50%) scale(${scale})`;
      this.countdownAnimation = this.levelFlash.animate(
        [
          {
            opacity: 0,
            transform: at(1.9),
            filter: "blur(10px)",
            easing: "cubic-bezier(.22,1,.36,1)"
          },
          {
            opacity: 1,
            transform: at(1),
            filter: "blur(0px)",
            offset: 0.22,
            easing: "linear"
          },
          {
            opacity: 1,
            transform: at(go ? 1.14 : 1.02),
            filter: "blur(0px)",
            offset: 0.78,
            easing: "ease-in"
          },
          {
            opacity: 0,
            transform: at(go ? 1.5 : 1.22),
            filter: "blur(4px)"
          }
        ],
        { duration: holdMs }
      );
    }
  }

  hideCountdown() {
    this.countdownAnimation?.cancel();
    this.countdownAnimation = null;
    this.levelFlash.classList.add("hidden");
    this.levelFlash.classList.remove("beat", "hold", "is-go");
    this.countdownDemo?.classList.add("hidden");
  }

  /* 只给截图 / 验收用：把某一拍定住，不让它淡出 */
  holdCountdown(text) {
    const numeral = this.levelFlash.querySelector(".n");
    numeral.textContent = text;
    numeral.classList.toggle("go", text === "GO");
    this.levelFlash.classList.toggle("is-go", text === "GO");
    this.levelFlash.classList.remove("hidden", "beat");
    this.levelFlash.classList.add("hold");
    this.countdownDemo?.classList.add("hidden");
  }

  /* C6 · 加时（定稿 = 同体胶囊）：+20s 从钟胶囊里弹出 → 停 1s → 滑出消失。
     整只钟同帧一起反应——它们现在是同一个物件。 */
  pulseTimer(amount) {
    this.timeBonus.textContent = `+${amount}s`;
    this.timeBonus.classList.remove("hidden");
    this.timerShell.classList.add("fuse");
    /* 一次性动画重放惯用法：清掉 → 强制回流 → 加回 */
    this.timeBonus.style.animation = "none";
    void this.timeBonus.offsetWidth;
    this.timeBonus.style.animation = "";
    this.retrigger(this.timerShell, "time-added");
    /* 秒数本身闪绿：说明涨的是这个数，不只是旁边多了个泡 */
    this.retrigger(this.timer, "gained");
    this.after(2050, () => {
      this.timeBonus.classList.add("hidden");
      this.timerShell.classList.remove("fuse", "time-added");
      this.timer.classList.remove("gained");
    });
  }

  /* C10/C12 · Toast（mossfall-ui-v2 toastA）：纯色胶囊，无图标无白边 */
  showToast(text, tone = "success") {
    this.eventFlash.textContent = text;
    this.eventFlash.dataset.tone = tone;
    /* display:none → 可见 会自然重放 CSS 动画，不需要额外的重放惯用法 */
    this.eventFlash.classList.remove("hidden");
  }

  hideToast() {
    this.eventFlash.classList.add("hidden");
  }

  /* 掉球是多通道的：颜色 + 抖动 + 计时器一起反应 */
  penaltyShake() {
    this.retrigger(this.stage, "shake");
  }

  /* 局内连接提示。每帧都会被调用，所以同文案直接早退。
     收起时不立刻清：留半拍，让玩家看见问题是被自己修好的，而不是看着那行字
     在板子刚接上的同一帧凭空消失（照 DUNE CARVE hud.warn 的收尾）。 */
  showConnectionNote(text) {
    const next = text || "";
    if (next === this.connectionNoteText) return;
    this.connectionNoteText = next;

    if (this.connectionNoteTimer) {
      window.clearTimeout(this.connectionNoteTimer);
      this.connectionNoteTimer = 0;
    }
    if (next) {
      this.connectionNote.textContent = next;
      return;
    }
    this.connectionNoteTimer = window.setTimeout(() => {
      this.connectionNoteTimer = 0;
      this.connectionNote.textContent = "";
    }, CONNECTION_NOTE_DWELL_MS);
  }

  /* =================================================================
     C14 · PAUSE — 湿叶玻璃卡：三个动词，没有第四个
     ================================================================= */
  renderPause(callbacks) {
    this.clearTimers();
    this.showScreen(`
      <section class="screen pause-screen" data-screen="PAUSE_MENU">
        <div class="pmA">
          <button id="pause-howto-button" class="pause-help" type="button"
            aria-label="How to Play" title="How to Play">?</button>
          <div class="hd">PAUSED</div>
          <button id="resume-button" class="mi primary" type="button" data-testid="resume">Resume</button>
          <button id="restart-button" class="mi" type="button" data-testid="restart">Restart</button>
          <button id="pause-quit-button" class="mi" type="button" data-testid="pause-quit">Quit</button>
        </div>
      </section>
    `);
    this.on("resume-button", callbacks.onResume);
    this.on("restart-button", callbacks.onRestart);
    this.on("pause-quit-button", callbacks.onQuit);
    this.on("pause-howto-button", callbacks.onHowTo);
  }

  /* =================================================================
     C15 · HOW TO PLAY — 2×2 图示卡：Shift / Roll home / Beat the clock /
     Earn time，一格一句话，收尾只有 Got it（mossfall-ui-v2）。
     ================================================================= */
  renderHowTo({ onConfirm }) {
    this.clearTimers();
    this.hideHud();
    this.showScreen(`
      <section class="screen modal-screen" data-screen="HOW_TO_PLAY">
        <div class="howto">
          <h3>How to Play</h3>
          <div class="grid">
            <div class="cell">
              <div class="dgm" aria-hidden="true">
                <div class="calboard" style="width:126px;height:80px">
                  <div class="cross-v"></div><div class="cross-h"></div>
                  <div class="cop" style="left:36%;top:62%"></div>
                </div>
              </div>
              <div class="cl">Shift</div>
              <div class="cx">Lean <b>left / right / forward / back</b> to tilt the table.</div>
            </div>
            <div class="cell">
              <div class="dgm" aria-hidden="true">
                <div style="position:relative;width:120px;height:80px">
                  <span class="hole" style="left:64%;top:44%;transform:translate(-50%,-50%);width:38px;height:38px"></span>
                  <span class="tball" style="left:16%;top:38%;width:28px;height:28px"></span>
                </div>
              </div>
              <div class="cl">Roll home</div>
              <div class="cx">Guide every beetle into a <b>hole</b>.</div>
            </div>
            <div class="cell">
              <div class="dgm" aria-hidden="true">
                <span class="tclock-mini"><span class="cg"></span><span class="cn">29</span></span>
              </div>
              <div class="cl">Beat the clock</div>
              <div class="cx">Clear the level before <b>time runs out</b>.</div>
            </div>
            <div class="cell">
              <div class="dgm" aria-hidden="true">
                <span class="tclock-mini fuse"><span class="cg"></span><span class="cn">49</span><span class="plus">+20s</span></span>
              </div>
              <div class="cl">Earn time</div>
              <div class="cx">Each level cleared adds <b>+20s</b> (Advanced +30s).</div>
            </div>
          </div>
          <div class="foot">
            <button id="howto-close" class="btn" type="button" style="font-size:20px;padding:15px 52px"
              data-testid="howto-close">Got it</button>
          </div>
        </div>
      </section>
    `);
    this.on("howto-close", onConfirm);
  }

  /* =================================================================
     K3 · TEACH-IN · pre-run — 不是全屏：左侧模型框 + 底部一句字幕。
     一张卡，完整动作播放后直接进倒计时。没有分页、没有练习期、不挡门：
     玩家做什么都不会让它快，不做也不会让它停。
     ================================================================= */
  renderTeachIn() {
    this.clearTimers();
    this.hideHud();
    /* 教的是直接控制——你倾斜，叶子跟着动。「把甲虫送进洞」是目标，
       游戏开局三十秒自己会教，不占这张卡。

       句式照产品线铁律：sentence case（不是全大写）、一句祈使、一个 <b>
       包住身体必须做对的那部分、句号收尾。加粗落在「任意方向」而不是动词
       上——大多数人默认只试左右，前后那个自由度不点破就白给。
       动词用 lean 而不是 tilt：跟 How-to-Play 面板和 core-luge 同一套
       身体动词，不另造词。 */
    const teachingCopy = "Lean <b>any direction</b> to roll the leaf.";
    this.showScreen(`
      <section class="screen teach-screen" data-screen="TEACH_IN">
        <div class="tpanel">
          <div id="teach-motion" class="teachin-motion"></div>
        </div>
        <div class="teach-caption">
          <div id="teach-cap" class="capC">${teachingCopy}</div>
        </div>
      </section>
    `);
    this.teachinPlayer = globalThis.KiwiiTeachin.mount(
      document.getElementById("teach-motion"), "motion_07",
      { mode: "loop", speed: 1.25, minDuration: 4, label: "Shift weight left, right, forward and back" }
    );
  }

  canAdvanceTeachIn() {
    return this.teachinPlayer?.canAdvance === true;
  }

  setTeachInPaused(paused) {
    this.teachinPlayer?.setPaused(Boolean(paused));
  }

  /* =================================================================
     K4 / C13 · RESULT — 湿叶玻璃深板一屏出完（mossfall-ui-v2）
     分阶揭晓：标题 → 称号 → 星逐颗 → 统计行 → 分数数上去 → 个人最佳 → 自动翻页。
     这一屏没有按钮：读完就走，行动都在下一屏（K6 全球榜）上。
     没掉过就不出 DROPS 行；时间到（0s）不出 TIME LEFT 行，板子自然变短。
     ================================================================= */
  renderResult({
    score,
    mode,
    drops = 0,
    /* ENDLESS 传 Infinity。分母、星级门槛都跟着它走。 */
    totalLevels = TOTAL_LEVELS,
    best,
    isRecord,
    personalBests,
    onTick,
    onReady,
    onAdvance
  }) {
    this.clearTimers();
    this.hideHud();
    void mode;
    const starCount = scoreStars(score, drops, totalLevels);
    const rankTitle = RANK_TITLES[starCount] || RANK_TITLES[1];
    /* 标题跟星级走，不再由调用方传进来：星级是这一屏唯一的评价口径，
       标题和段位名都从它派生，才不会出现「四星配超时文案」这种错位。 */
    const headline = RESULT_HEADLINES[starCount] || RESULT_HEADLINES[1];
    const delta = score.totalPoints - best;
    /* 没有历史最佳时，"+143" 是拿 0 当基准，没有意义——直接说这是第一条记录 */
    const deltaTop = best <= 0 ? "NEW" : delta >= 0 ? `+${delta}` : `${delta}`;
    const deltaLabel = best <= 0 ? "RECORD" : isRecord ? "BEST" : "TODAY";

    const rows = [
      `<div class="row reveal" id="rv-row1">
        <span class="lb">LEVELS CLEARED</span><span class="dt"></span>
        <span class="vl num" id="result-cleared">${
          Number.isFinite(totalLevels) ? `${score.cleared} / ${totalLevels}` : score.cleared
        }</span>
      </div>`,
      `<div class="row reveal" id="rv-row2">
        <span class="lb">LEVEL POINTS</span><span class="dt"></span>
        <!-- V3 §1.2：算式和结果同在一个右对齐单元格里，但不是同一个重量。
             算式部分（.wk）15px 压暗，乘号连同乘数（.op）用 --accent-lt 加粗，
             结果留在 22px 亮色。整块一个单元格，点线才能一路顶到板边，短结果
             也不会被固定列宽推得离自己的算式老远。乘号用小写字母 x，不用 ×。 -->
        <span class="vl num" id="result-level-points"><span class="wk">${
          score.cleared
        } <span class="op">x 10</span> = </span>${score.levelPoints}</span>
      </div>`
    ];
    const rowIds = ["rv-row1", "rv-row2"];
    if (score.timePoints > 0) {
      rows.push(`<div class="row reveal" id="rv-row3">
        <span class="lb">TIME LEFT</span><span class="dt"></span>
        <span class="vl num bonus" id="result-time-points">+${score.timePoints}</span>
      </div>`);
      rowIds.push("rv-row3");
    }
    if (score.bonusPoints > 0) {
      rows.push(`<div class="row reveal" id="rv-row-dew">
        <span class="lb">DEW BONUS</span><span class="dt"></span>
        <span class="vl num bonus" id="result-dew-points">+${score.bonusPoints}</span>
      </div>`);
      rowIds.push("rv-row-dew");
    }
    if (drops > 0) {
      rows.push(`<div class="row reveal" id="rv-row4">
        <span class="lb">DROPS</span><span class="dt"></span>
        <span class="vl num drop" id="result-drops">${drops}</span>
      </div>`);
      rowIds.push("rv-row4");
    }

    this.showScreen(`
      <section class="screen result-screen" data-screen="RESULT_CALC"
        data-pb-mode="${mode}"
        data-session-best="${personalBests?.session ?? Math.max(best, score.totalPoints)}"
        data-device-best="${personalBests?.device ?? Math.max(best, score.totalPoints)}"
        data-session-record="${Boolean(personalBests?.isSessionRecord)}"
        data-device-record="${Boolean(personalBests?.isDeviceRecord ?? isRecord)}">
        <div class="veil"></div>
        <span class="rope" style="left:470px"></span>
        <span class="rope" style="left:810px"></span>
        <div class="rboard" id="result-board">
          <div class="screw" style="left:15px;top:15px"></div>
          <div class="screw" style="right:15px;top:15px"></div>
          <div class="screw" style="left:15px;bottom:15px"></div>
          <div class="screw" style="right:15px;bottom:15px"></div>
          <h2 class="reveal" id="rv-title">${headline}</h2>
          <div class="ttl reveal" id="rv-rank">${rankTitle}</div>
          <div class="stars lg" id="result-stars">${starMarkup(starCount)}</div>
          <div class="rows">${rows.join("")}</div>
          <div class="flab reveal" id="rv-flab">FINAL SCORE</div>
          <div class="final num reveal" id="result-total">0</div>
          <div class="rec reveal" id="rv-rec">
            <div class="med">
              <svg width="21" height="21" viewBox="0 0 24 24"><path d="M12 1.6l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 17.27l-6.18 3.2L7 13.73l-5-4.87 6.91-1z" fill="#fff" opacity=".95"/></svg>
            </div>
            <div class="stack">
              <div class="lb">PERSONAL BEST</div>
              <div class="tm num" id="result-best">${Math.max(best, score.totalPoints)}</div>
            </div>
            <div class="delta">
              <span class="d1">${deltaTop}</span>
              <span class="d2">${deltaLabel}</span>
            </div>
          </div>
        </div>
        <div class="result-next hidden" id="result-next" aria-hidden="true">
          <i></i><i></i><i></i>
        </div>
      </section>
    `);

    const action = document.getElementById("result-next");
    const totalEl = document.getElementById("result-total");
    const stars = [...document.querySelectorAll("#result-stars .st")];
    const show = (id) => document.getElementById(id)?.classList.add("shown");

    /* K4 · 分阶段揭示：板即刻进场，内容按阅读顺序落 */
    show("rv-title");
    this.after(180, () => show("rv-rank"));
    stars.forEach((star, index) =>
      this.after(360 + index * 260, () => {
        star.classList.add("pop");
        onTick?.("star");
      })
    );
    const afterStars = 360 + stars.length * 260 + 200;
    rowIds.forEach((id, index) =>
      this.after(afterStars + index * 260, () => {
        show(id);
        onTick?.("row");
      })
    );
    const afterRows = afterStars + rowIds.length * 260 + 200;
    const timeline = resultToRankTimeline(afterRows);
    this.after(afterRows, () => {
      show("rv-flab");
      totalEl.classList.add("shown");
      this.countUp(totalEl, score.totalPoints, RESULT_SCORE_COUNT_MS, onTick);
    });
    this.after(timeline.recordRevealAtMs, () => {
      show("rv-rec");
      onTick?.("record");
    });
    /* 读完之后：先亮出三点的「还有下一页」提示，再停一拍自动翻。
       提示先于翻页出现，是为了让翻页看起来是被预告过的，而不是突然发生。 */
    this.after(timeline.readyAtMs, () => {
      action.classList.remove("hidden");
      onReady?.();
    });
    this.after(timeline.advanceAtMs, () => onAdvance?.());
  }

  /* =================================================================
     K6 · GLOBAL STANDING — 结算板之后的一屏。
     样式定稿走 rank-neighbours-styles.html 的 D「票根」：米黄纸票 + 点线
     引导，点线是结算板 LEVELS CLEARED 那几行已经在用的语言。
     这一屏的情绪全在位移上：先摆出你跑这局之前的排序，再让你升一格。
     ================================================================= */
  renderGlobalRank({
    roster,
    headline,
    /* 榜是按模式隔离的（各档各存各的最佳），所以标签第一段印模式，让玩家知道
       自己在哪张榜上；结算板反过来不印模式（那一屏只讲这一局）。传进来的是内部
       小写键，印出去之前过 modeLabel() 转大写。 */
    mode = "beginner",
    /* 名单是真榜还是占位 demo，对玩家没意义、对 QA 有意义：落在 data 属性上，
       不占标签那一行。 */
    sourceLabel = "SCORE NEIGHBORS",
    /* 榜按「你的最佳」排，不按这一局——最佳不会因为你多打一局变低，
       所以打得差永远不会掉名次。这一局单独在页脚交代。 */
    best,
    runScore,
    previousBest,
    isRecord,
    onRetry,
    onQuit,
    onTick,
    onReady
  }) {
    this.clearTimers();
    this.hideHud();

    const meIndex = roster.findIndex((person) => person.isMe);
    const tickets = roster
      .map(
        (person, index) => `
        <div class="gr-row${person.isMe ? " me" : ""}" id="gr-row-${index}">
          <span class="av" style="background:linear-gradient(180deg,${person.color},${person.color}bb)"
            >${[...person.name][0]}</span>
          <span class="nm">${person.name}</span>
          <span class="dt"></span>
          <span class="sc num" id="gr-score-${index}">${person.score}</span>
        </div>`
      )
      .join("");

    this.showScreen(`
      <section class="screen grank-screen" data-screen="GLOBAL_RANK"
        data-roster-source="${sourceLabel}">
        <div class="veil"></div>
        <div class="gboard" id="grank-board">
          <div class="screw" style="left:15px;top:15px"></div>
          <div class="screw" style="right:15px;top:15px"></div>
          <div class="screw" style="left:15px;bottom:15px"></div>
          <div class="screw" style="right:15px;bottom:15px"></div>
          <h2 class="gr-title reveal" id="gr-title">
            ${headline.gap ? `<em>${headline.gap}</em> ` : ""}${headline.text}
          </h2>
          <div class="gr-lab reveal" id="gr-lab">${modeLabel(mode)} · PERSONAL BEST</div>
          <div class="gr-strip" id="gr-strip">${tickets}
            <div class="gr-gap" id="gr-gap">+${headline.gap} TO PASS</div>
          </div>
          <div class="gr-run reveal${isRecord ? " rec" : ""}" id="gr-run">${
            isRecord
              ? /* 第一次玩没有「上一个最佳」，+N 就没有意义——不印那个差 */
                previousBest > 0
                ? `NEW BEST <b class="num">+${best - previousBest}</b>`
                : "YOUR FIRST RUN ON THE BOARD"
              : /* 打平最佳时 best - runScore === 0，原来的 Math.max(1, …) 会印成
                   「还差 1 分追平自己」——人已经追平了，这句话是错的。差为 0 就
                   直接说打平，只有真落后才报还差多少。 */
                best - runScore > 0
                ? `THIS RUN <b class="num">${runScore}</b> · <b class="num">${
                    best - runScore
                  }</b> TO MATCH YOUR BEST`
                : `THIS RUN <b class="num">${runScore}</b> · MATCHED YOUR BEST`
          }</div>
        </div>
        <div class="result-action hidden" id="grank-action">
          <!-- 宽度只写在 CSS 里：以前这个按钮带一条行内 min-width，行内样式压过窄屏
               兜底的 min()，390px 手机上它还是死宽、左右各切掉 11px。别再加回来。 -->
          <button id="retry-button" class="btn big" type="button"
            data-testid="retry">PLAY AGAIN</button>
          <button id="quit-button" class="btn cream big" type="button" data-testid="quit">QUIT</button>
        </div>
      </section>
    `);

    /* 行高与间距只写在 CSS 里（横屏 66/10、竖屏 58/8），这里只喂序号。
       之前把 68/10 硬编码在 JS 上，竖屏一换行高最后一行就掉出板外。 */
    const strip = document.getElementById("gr-strip");
    const rows = roster.map((_, index) => document.getElementById(`gr-row-${index}`));
    const gap = document.getElementById("gr-gap");
    const myScore = document.getElementById(`gr-score-${meIndex}`);

    /* 破了纪录才有位移：起手摆成旧最佳的排序（你还在下面那位后面），
       然后升一格。没破纪录时最佳没变，排名本来就不该动——假装有位移
       一眼就能看穿，所以这里直接落在终态，情绪交给页脚那行自我对比。 */
    const pre = roster.map((_, index) => index);
    if (isRecord && meIndex + 1 < rows.length) {
      pre[meIndex] = meIndex + 1;
      pre[meIndex + 1] = meIndex;
    }
    strip.style.setProperty("--gr-n", String(rows.length));
    strip.style.setProperty("--gr-me", String(meIndex));
    rows.forEach((row, index) => {
      row.style.setProperty("--i", String(index));
      row.style.setProperty("--p", String(pre[index]));
      row.style.zIndex = index === meIndex ? "3" : "1";
    });
    myScore.textContent = String(isRecord ? previousBest : best);

    onTick?.("board");
    document.getElementById("gr-title")?.classList.add("shown");
    this.after(180, () => document.getElementById("gr-lab")?.classList.add("shown"));

    this.after(620, () => {
      rows.forEach((row) => {
        row.classList.add("moving");
        row.classList.add("settled");
      });
      if (isRecord) {
        onTick?.("swap");
        this.countUp(myScore, best, 620, onTick, previousBest);
      }
    });
    if (isRecord) this.after(880, () => rows[meIndex]?.classList.add("flash"));
    this.after(1440, () => {
      if (headline.gap > 0) gap.classList.add("shown");
      onTick?.("gap");
    });
    this.after(1660, () => {
      document.getElementById("gr-run")?.classList.add("shown");
      if (isRecord) onTick?.("best");
    });
    this.after(1900, () => {
      document.getElementById("grank-action")?.classList.remove("hidden");
      document.getElementById("retry-button")?.classList.add("idle-pulse");
      onReady?.();
    });

    this.on("retry-button", onRetry);
    this.on("quit-button", onQuit);
  }

  /* from 默认 0（结算板从零滚到总分）；全球榜那一屏要从「上一局」滚起。 */
  countUp(element, target, durationMs, onTick, from = 0) {
    const start = performance.now();
    let lastBucket = -1;
    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(from + (target - from) * eased);
      element.textContent = String(value);
      const bucket = Math.floor(t * 12);
      if (bucket !== lastBucket && t < 1) {
        lastBucket = bucket;
        onTick?.("count");
      }
      if (t < 1) this.nextFrame(step);
    };
    this.nextFrame(step);
  }

  /* =================================================================
     K5 · ENDING — 谢幕的 DOM 侧：只剩结算板淡出这一件事。

     第二幕整幕都在场景里演：签语写在那片被虫子顶开的叶子上
     （ending-leaf.js），不是 DOM 元素。DOM 这边一个遮罩都不铺 ——
     铺了就会把甲虫一起压暗，而这一幕的主角正是它。
     endEndingCinematic 幂等，任何离场路径都可调。
     ================================================================= */

  /** 结算板原地淡出（不切黑场），淡完后回调清屏。 */
  fadeOutScreenForEnding(onGone) {
    this.clearTimers();
    const screen = this.screenLayer.querySelector(".screen");
    if (!screen) {
      onGone?.();
      return;
    }
    screen.classList.add("ending-exit");
    this.after(500, () => onGone?.());
  }

  /* 签语曾经是一块 DOM 卡片，现在写在场景里那片叶子上。这里只留一个幂等
     的清理：老的节点早已不生成，但任何离场路径都还会调这一下。 */
  endEndingCinematic() {
    document.getElementById("ending-tip")?.remove();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.teachinPlayer?.dispose();
    this.teachinPlayer = null;
    this.clearTimers();
    if (this.connectionNoteTimer) {
      window.clearTimeout(this.connectionNoteTimer);
      this.connectionNoteTimer = 0;
    }
    this.clearBindings();
  }

  /* =================================================================
     C14 · SYSTEM — 确认退出 / WebGL 恢复

     局内板子掉线不在这里：它不铺屏、不暂停、不要求重新校准，只在 HUD 上挂一条
     常驻提示，键盘/触摸接着玩（见 controller 的 BOARD_FALLBACK_NOTE）。
     ================================================================= */
  renderConfirmQuit(callbacks) {
    this.clearTimers();
    this.showScreen(`
      <section class="screen modal-screen" data-screen="CONFIRM_QUIT">
        <div class="sysover" style="width:360px">
          <div class="st1">Quit this run?</div>
          <div class="st2">Your score won't be saved.</div>
          <div class="row">
            <button id="quit-cancel" class="btn cream" type="button" style="font-size:16px;padding:12px 28px"
              data-testid="quit-cancel">Keep playing</button>
            <button id="quit-confirm" class="btn danger" type="button" data-testid="quit-confirm">Quit</button>
          </div>
        </div>
      </section>
    `);
    this.on("quit-cancel", callbacks.onCancel);
    this.on("quit-confirm", callbacks.onConfirm);
  }

  renderContextLost(callback) {
    this.clearTimers();
    this.hideHud();
    this.showScreen(`
      <section class="screen modal-screen" data-screen="CONTEXT_LOST">
        <div class="sysover">
          <div class="st1">Display paused</div>
          <div class="st2">The 3D view is recovering.</div>
          <div class="row">
            <button id="reload-button" class="btn" type="button" data-testid="reload">Reload</button>
          </div>
        </div>
      </section>
    `);
    this.on("reload-button", callback);
  }
}
