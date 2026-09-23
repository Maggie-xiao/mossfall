import {
  animateBonusTimer,
  scoreRun,
  shouldStartFailureSpin
} from "./core.js";
import { pickEndingLine } from "./ending-lines.js";
import { buildRoster, standingHeadline } from "./global-rank.js";
import { levelSet, sharedRules } from "./levels.js";
import { planRun, createEndlessRun } from "./run-plan.js";
import { DEFAULT_THEME_ID, themeById } from "./biomes.js";
import { applySkin, restoreCanon } from "./art-skins.js";
import { resolveGamepadAction } from "./external-game-contract.js";
import { DEFAULT_VIBRATION_INTENSITY } from "./vibration.js";

const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 4;
const TOTAL_LEVELS = 8;

/** 只有这个模式吃程序化内容。 */
export const ENDLESS_MODE = "endless";
export const ROGUE_MODE = "rogue";
const isEndless = (mode) => mode === ENDLESS_MODE;
const isProcedural = (mode) => mode === ENDLESS_MODE || mode === ROGUE_MODE;
const isRogue = (mode) => mode === ROGUE_MODE;
export const ENDLESS_OBSTACLE_PENALTY_SEC = 0;
export const ENDLESS_FALL_PENALTY_SEC = 0;
export const COLLISION_PENALTY_COOLDOWN_MS = 900;
export const DEW_PER_POTION = 5;
export const POTION_REVIVE_SEC = 12;
export const STACK_CAPTURE_BONUS_SEC = 3;
export const ROGUE_BLESSING_INTERVAL = 3;
export const ROGUE_BLESSINGS = Object.freeze([
  Object.freeze({ id: "dewlight", name: "Dewlight", description: "dew is worth +2 points" }),
  Object.freeze({ id: "treasureLuck", name: "Treasure luck", description: "chests are worth +5 points" }),
  Object.freeze({ id: "butterflyBond", name: "Butterfly bond", description: "a butterfly guides you after a fall" })
]);
const INPUT_REQUIRED_STATES = new Set([
  "TEACH_IN",
  "LEVEL_INTRO",
  "GAMEPLAY",
  "BALL_FALL_DROP",
  "BALL_FALL_RESET",
  "LEVEL_CLEAR",
  "RUN_COMPLETE",
  "PAUSE_MENU"
]);

/* =====================================================================
   UI 时序 · 单一来源
   所有依赖节拍的偏移（含 debug 跳转）都从这里推导，绝不硬编码——
   否则改一次时长，测试就落到错误的阶段里，failure 的原因跟它声称检查的东西无关。
   ===================================================================== */
export const UI_TIMING = {
  /* 一张卡四秒——产品线通行的节拍（core-luge 的 CEREMONY 注释量过：1.8s
     是可测的「扫一眼」，撑不住卡上那张动图跑完一轮）。卡不挡门：玩家做
     什么都不会让它快，不做也不会让它停。 */
  teachingMs: 4000,
  /* 无 lead-in：3 → 2 → 1 各 1.0s，GO 1.2s，总 4.2s（core-luge 正典）。
     这里原本挂着 1400ms 前摇，把总长顶到 5.6s。 */
  countdownLeadInMs: 0,
  countdownBeatMs: 1000,
  countdownGoMs: 1200,
  ballDropMinMs: 650,
  ballDropMaxMs: 1050,
  levelHandoffMs: 450, // 第 2 关起不数倒计时，只留一个换关的呼吸
  levelClearMs: 2400,
  levelBoardExitMs: 600,
  levelBoardEnterAtMs: 1600,
  /* 第二幕：纸团砸下来 → 虫子拱开 → 字一个个洇出来 → 停住让人读完，
     随后才轮到结算板。
     大头是「读完」那 4.2s（对齐 dunesong oracle 的停顿，见 ending.js 的
     READ_HOLD）：末词落在 ~4.36s，停顿走完 ~8.56s，纸散成光再用 1s。
     改这个数要跟 ending.js 顶上的第二幕时刻表一起改。 */
  endingTipMs: 9600
};

/* 倒计时总时长 = 3 拍 + GO */
export const COUNTDOWN_MS =
  UI_TIMING.countdownLeadInMs +
  UI_TIMING.countdownBeatMs * 3 +
  UI_TIMING.countdownGoMs;

/**
 * 按下一档震动强度。
 *
 * 从绑定代码里拆出来，是为了能脱离 document 测：关闭态的守卫正是这几个按钮
 * 用 aria-disabled 而不是 disabled 的全部理由，而 aria-disabled 的按钮照样
 * 会派发 click。
 */
export function pressVibrationLevel(vibration, button) {
  if (!button || button.getAttribute?.("aria-disabled") === "true") return null;
  const level = vibration?.setIntensity?.(button.dataset?.vibrationLevel);
  if (level === undefined) return null;
  /* 试一下刚选的那一档 —— 强度是唯一一个光看看不出来的设置。 */
  vibration?.play?.("catch");
  return level;
}

export function countdownHoldMs(step) {
  return step === 3
    ? UI_TIMING.countdownGoMs
    : UI_TIMING.countdownBeatMs;
}

export function parseRuntimeFlags(search = "") {
  const params =
    search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const qaMode = params.get("qa") === "1";
  const realtime = params.get("realtime") === "1";
  return {
    qaMode,
    autoClear: qaMode && params.get("autoclear") === "1",
    forceTouch: qaMode && params.get("touch") === "1",
    timingScale: qaMode && !realtime ? 0.18 : 1
  };
}

export function isEditableKeyTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tagName = String(target.tagName || "").toLowerCase();
  return (
    target.isContentEditable === true ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

/**
 * The HUD level is a landing announcement, not a clear receipt: it flips the
 * moment the descent sets the player down on the new leaf. Bumping it at clear
 * time meant the number changed while the camera was still falling past the old
 * one, so the player read "3" over a leaf that was still level 2.
 *
 * `currentLevelIndex` has already advanced by the time `nextLoaded` is true, so
 * holding the old number through the fall means subtracting that step back out.
 */
export function levelClearHudLevel(
  currentLevelIndex,
  nextLoaded,
  descending = false,
  totalLevels = TOTAL_LEVELS
) {
  const offset = nextLoaded && descending ? 0 : 1;
  return Math.min(totalLevels, currentLevelIndex + offset);
}

export function levelClearDurationSec(nextLevel, timingScale = 1) {
  const scale = Math.max(0.05, Number(timingScale) || 1);
  const base = UI_TIMING.levelClearMs / 1000;
  if (!nextLevel) return base * scale;
  const enterAt = UI_TIMING.levelBoardEnterAtMs / 1000;
  const descent = Math.max(0, Number(nextLevel.descent?.duration || 0));
  return Math.max(base, enterAt + descent) * scale;
}

export function frameDurations(lastNow, now, maxSimulationDt = 0.05) {
  const elapsedSec = Math.max(0, (now - lastNow) / 1000);
  return {
    elapsedSec,
    simulationDt: Math.min(Math.max(0, maxSimulationDt), elapsedSec)
  };
}

export class TableTiltController {
  constructor({ scene, input, audio, ui, vibration = null, deferRAF = false }) {
    this.scene = scene;
    this.input = input;
    this.audio = audio;
    this.ui = ui;
    this.vibration = vibration;
    this.mode = "beginner";
    if (globalThis.document?.documentElement) {
      document.documentElement.dataset.mode = this.mode;
    }
    this.state = "BOOT";
    this.previousState = null;
    this.stateElapsed = 0;
    this.lastNow = performance.now();
    this.accumulator = 0;
    this.currentLevelIndex = 0;
    /* 随机只属于 ENDLESS 模式。beginner 和 advanced 打的永远是手工那 16 关、
       按手工的顺序 —— 那两条曲线是调过的，也是硬件验证和成绩基线的依据，随机
       内容不该从它们的门进去。见 docs/procedural-runs.md。

       一局 = (主题, seed, 模式) 的纯函数，见 run-plan.js。`runSeed` 为 null 时
       每局现摇一个新 seed；给了具体 seed 就永远复现同一局。 */
    this.theme = DEFAULT_THEME_ID;
    this.runSeed = null;
    this.pendingSeed = null;
    this.run = null;
    this.timeRemaining = 60;
    this.levelsCleared = 0;
    this.score = scoreRun(0, 60);
    this.connectionResumeContext = null;
    this.connectionReason = null;
    this.connectionSampleFloor = 0;
    this.currentInputSample = null;
    this.sessionBests = { beginner: 0, advanced: 0 };
    this.deviceBestCache = {};
    this.lastPersonalBests = {
      mode: this.mode,
      session: 0,
      device: 0,
      isSessionRecord: false,
      isDeviceRecord: false
    };
    this.resultCanContinue = false;
    this.gamepadMenuIndex = 0;
    this.offBoardElapsed = 0;
    this.debugBoardDisconnected = false;
    this.externalPaused = false;
    this.pageHidden = Boolean(document.hidden);
    this.bfcachePaused = false;
    this.visibilityPaused = this.pageHidden;
    this.destroyed = false;
    this.perfWindowSec = 0;
    this.perfFrames = 0;
    this.fps = 0;
    this.maxFrameMs = 0;
    this.countdownStep = -1;
    this.resumeStateAfterModal = null;
    const runtimeFlags = parseRuntimeFlags(location.search);
    this.qaMode = runtimeFlags.qaMode;
    this.autoClear = runtimeFlags.autoClear;
    this.forceTouch = runtimeFlags.forceTouch;
    this.timingScale = runtimeFlags.timingScale;
    this.scene.setTimingScale?.(this.timingScale);
    this.audioQaRunning = false;
    this.audioQaComplete = false;
    this.audioQaError = "";
    this.audioQaFlowEvidence = {};
    this.levelClear = null;
    this.fallenBallId = null;
    this.drops = 0;
    this.bonusPoints = 0;
    this.dewBank = 0;
    this.potions = 0;
    this.collisionPenaltyUntil = new Map();
    this.levelFalls = 0;
    this.cleanWinStreak = 0;
    this.struggleStreak = 0;
    this.adaptiveDifficulty = 0;
    this.hintShownThisLevel = false;
    this.butterflyHintPending = false;
    this.rogueBlessings = { dewlight: 0, treasureLuck: 0, butterflyBond: 0 };
    this.bindDebugPanel();

    /* 局内 Menu 按钮已删（Dantong 2026-07-27），暂停只走 Esc */
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onVisibility = () => this.setPageHidden(document.hidden);
    this.onPageHide = (event) => {
      if (event.persisted) this.setBfcachePaused(true);
    };
    this.onPageShow = () => this.setBfcachePaused(false);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("pageshow", this.onPageShow);
    document.addEventListener("visibilitychange", this.onVisibility);

    this.scene.onEvent = (event) => this.handleSceneEvent(event);
    this.scene.loadLevel(levelSet("beginner")[0], "beginner");
    this.enterState("MODE_SELECT");
    this.ui.setReady();
    this.frame = (now) => this.loop(now);
    // QA hook invoked once per frame after the simulation update. Never a timer.
    this.onSimulatedFrame = null;
    // External Game hook: invoked once per frame after scene.render() so a
    // topology ACK can prove one frame was produced in the new viewport.
    this.onRenderedFrame = null;
    this.rafStartAllowed = !deferRAF;
    this.frameRequestId = deferRAF ? null : requestAnimationFrame(this.frame);
  }

  startRAF() {
    this.rafStartAllowed = true;
    if (
      this.frameRequestId === null &&
      !this.destroyed &&
      !this.visibilityPaused
    ) {
      this.lastNow = performance.now();
      this.frameRequestId = requestAnimationFrame(this.frame);
    }
  }

  duration(seconds) {
    return seconds * this.timingScale;
  }

  ms(milliseconds) {
    return this.duration(milliseconds / 1000);
  }

  animationDuration(seconds) {
    return seconds;
  }

  animationMs(milliseconds) {
    return milliseconds / 1000;
  }

  bestKey(mode = this.mode) {
    return `kiwii.tableTilt.best.${mode}`;
  }

  ensurePersonalBestState() {
    this.sessionBests ||= { beginner: 0, advanced: 0 };
    this.deviceBestCache ||= {};
  }

  sessionBest(mode = this.mode) {
    this.ensurePersonalBestState();
    return Math.max(0, Number(this.sessionBests[mode]) || 0);
  }

  personalBest(mode = this.mode) {
    this.ensurePersonalBestState();
    if (Object.prototype.hasOwnProperty.call(this.deviceBestCache, mode)) {
      return this.deviceBestCache[mode];
    }
    try {
      const raw = globalThis.localStorage?.getItem(this.bestKey(mode));
      const score =
        typeof raw === "string" && /^(?:0|[1-9]\d*)$/.test(raw)
          ? Number(raw)
          : 0;
      this.deviceBestCache[mode] =
        Number.isSafeInteger(score) && score > 0 ? score : 0;
    } catch {
      this.deviceBestCache[mode] = 0;
    }
    return this.deviceBestCache[mode];
  }

  savePersonalBest(total, mode = this.mode) {
    this.ensurePersonalBestState();
    const score = Math.max(0, Math.floor(Number(total) || 0));
    const next = Math.max(this.personalBest(mode), score);
    this.deviceBestCache[mode] = next;
    try {
      globalThis.localStorage?.setItem(this.bestKey(mode), String(next));
    } catch {
      // Keep the in-memory best available when persistence is unavailable.
    }
    return next;
  }

  recordPersonalBests(total, mode = this.mode) {
    this.ensurePersonalBestState();
    const score = Math.max(0, Math.floor(Number(total) || 0));
    const previousSession = this.sessionBest(mode);
    const previousDevice = this.personalBest(mode);
    const session = Math.max(previousSession, score);
    this.sessionBests[mode] = session;
    const device = this.savePersonalBest(score, mode);
    this.lastPersonalBests = {
      mode,
      session,
      device,
      previousSession,
      previousDevice,
      isSessionRecord: score > previousSession,
      isDeviceRecord: score > previousDevice
    };
    return this.lastPersonalBests;
  }

  enterState(nextState, payload = {}) {
    const previous = this.state;
    this.previousState = previous;
    this.state = nextState;
    this.stateElapsed = 0;
    this.audio.setPhase(nextState);
    this.ui.setTeachInPaused?.(nextState !== "TEACH_IN" || this.visibilityPaused);
    console.log(`[STATE] ${previous} -> ${nextState}`);

    /* Ending 期间任何去处（正常收场、context lost、debug 跳转）都先把
       舞台和滤镜拆干净，两个清理都幂等。 */
    if (previous === "ENDING" && nextState !== "ENDING") {
      this.ui.endEndingCinematic?.();
      this.scene.endEnding?.();
    }

    switch (nextState) {
      /* K1 · Title */
      case "MODE_SELECT":
        restoreCanon();
        this.clearDebugBoardDisconnect();
        this.connectionResumeContext = null;
        this.connectionReason = null;
        this.ui.hideConnectionRequired?.();
        this.audio.stopVictory?.();
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        this.scene.loadLevel(this.runLevels()[0], this.mode);
        this.scene.setPresentation("menu");
        this.renderTitle();
        break;

      case "CONNECTION_REQUIRED":
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        this.ui.showConnectionRequired?.(
          payload.reason || this.connectionReason || "DISCONNECTED"
        );
        break;

      /* K3 · First-run teaching — 左侧模型框 + 底部字幕三页轮换（mossfall-ui-v2） */
      case "TEACH_IN":
        this.startRun();
        this.scene.setPresentation("gameplay");
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        this.ui.renderTeachIn();
        this.ui.setTeachInPaused?.(this.visibilityPaused);
        break;

      /* C7-A · 每关开始的 3 · 2 · 1 · GO */
      case "LEVEL_INTRO":
        this.scene.setPresentation("levelIntro");
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        this.ui.beginGameplay({
          level: this.currentLevelIndex + 1,
          timer: this.timeRemaining,
          touch: this.shouldShowTouch(),
          totalLevels: this.levelCount()
        });
        this.countdownStep = -1;
        break;

      /* K2 · HUD in-play */
      case "GAMEPLAY":
        this.scene.setPresentation("gameplay");
        this.scene.setSimulationEnabled(true);
        this.scene.setInputEnabled(true);
        this.ui.hideCountdown();
        this.ui.beginGameplay({
          level: this.currentLevelIndex + 1,
          timer: this.timeRemaining,
          touch: this.shouldShowTouch(),
          totalLevels: this.levelCount()
        });
        this.ui.setRogueBlessings?.(isRogue(this.mode) ? this.rogueBlessings : null);
        if (isProcedural(this.mode)) {
          const level = this.levelAt(this.currentLevelIndex);
          const objective = level?.colorMatch
            ? "Guide every beetle into the ring with the same colour"
            : "Guide every beetle into a glowing hole";
          this.showTimedToast(
            `${level?.weatherName || "Deep Canopy"} · ${objective}`,
            "success",
            this.currentLevelIndex === 0 ? 3200 : 2200
          );
        }
        break;

      case "BALL_FALL_DROP":
        this.scene.setSimulationEnabled(true);
        this.scene.setInputEnabled(false);
        this.scene.startFailureDrop(payload.ballId || this.fallenBallId);
        break;

      case "BALL_FALL_RESET":
        this.scene.setSimulationEnabled(true);
        this.scene.setInputEnabled(false);
        this.scene.startFailureSpin(payload.ballId || this.fallenBallId);
        break;

      /* 原版过关：下一关标签先出现，计时器连续加时，台面退场后再进场。 */
      case "LEVEL_CLEAR":
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        this.scene.celebrateLevelClear?.();
        if (!payload.preserveToast) {
          globalThis.clearTimeout(this.toastTimer);
          this.toastTimer = null;
          this.ui.hideToast();
        }
        if (!isRogue(this.mode)) {
          this.ui.pulseTimer?.(sharedRules(this.mode).timeAddedPerClearSec);
        }
        this.levelClear = {
          startTime: payload.startTime ?? this.timeRemaining,
          targetTime: payload.targetTime ?? this.timeRemaining,
          nextLoaded: false,
          isFinal: this.currentLevelIndex >= this.levelCount() - 1
        };
        if (this.currentLevelIndex < this.levelCount() - 1) {
          this.ui.updateGameplay({
            // Still the level they just cleared — the fall has not started yet.
            level: this.currentLevelIndex + 1,
            timer: this.levelClear.startTime
          });
          this.scene.startLevelHandoffExit();
        }
        if (!this.levelClear.isFinal) {
          this.audio.clear();
        }
        break;

      case "RUN_COMPLETE":
        this.scene.setPresentation("complete");
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        break;

      /* C12-A · Pause */
      case "PAUSE_MENU":
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        this.ui.renderPause({
          onResume: () => this.resume(),
          onRestart: () => {
            this.audio.start();
            this.restartRun();
          },
          onQuit: () => {
            this.audio.move();
            this.enterState("CONFIRM_QUIT");
          },
          onHowTo: () => {
            this.audio.move();
            this.openHowTo("PAUSE_MENU");
          }
        });
        this.resetGamepadMenuSelection();
        break;

      /* C13 · How to play */
      case "HOW_TO_PLAY":
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        /* 面板只有 Got it 一个收尾控件，所以这里也只有一个回调：
           以前还传了 guided / onClose，renderHowTo 从来没接过。 */
        this.ui.renderHowTo({
          onConfirm: () => {
            this.audio.confirm();
            this.closeHowTo();
          }
        });
        break;

      /* C14 · Confirm quit */
      case "CONFIRM_QUIT":
        this.ui.renderConfirmQuit({
          onCancel: () => {
            this.audio.move();
            this.enterState("PAUSE_MENU");
          },
          onConfirm: () => {
            this.audio.confirm();
            this.enterState("MODE_SELECT");
          }
        });
        this.resetGamepadMenuSelection();
        break;

      /* K4 / C11 · Result — 只解释本局成绩，按钮统一放到下一屏 Rank */
      case "RESULT_CALC": {
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        this.scene.setPresentation("result");
        this.resultCanContinue = false;
        this.score = payload.score || scoreRun(this.levelsCleared, this.timeRemaining);
        if (!payload.score) this.score = this.addBonusToScore(this.score);
        const personalBests = this.recordPersonalBests(
          this.score.totalPoints,
          this.mode
        );
        if (personalBests.isDeviceRecord) this.vibration?.play?.("record");
        this.ui.renderResult({
          score: this.score,
          mode: this.mode,
          drops: this.drops,
          totalLevels: this.levelCount(),
          best: personalBests.previousDevice,
          isRecord: personalBests.isDeviceRecord,
          personalBests,
          /* 标题不再从这里传：它按星级四选一，而星级是 renderResult 自己算的
             （scoreStars），在这里再算一遍等于把同一条规则写两处。ENDLESS 打不
             完全部关卡，scoreStars 里已经有单独的分档，标题跟着它走就对了。 */
          onTick: (kind) => this.resultBeat(kind),
          onReady: () => {
            this.resultCanContinue = true;
          },
          /* 结算板不再有按钮：读完自动进全球榜（K6），
             PLAY AGAIN / Quit 都挪到那一屏上 */
          onAdvance: () => this.advanceToStanding()
        });
        if (!isProcedural(this.mode) && this.score.cleared >= TOTAL_LEVELS) {
          this.audio.victory();
        }
        console.log("[SCORE]", this.score);
        break;
      }

      /* K6 · Global standing — 结算之后的一屏。不出名次、不出人数，
         只出上下几个人和「追上要几分」。 */
      case "GLOBAL_RANK": {
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        this.resultCanContinue = false;
        /* 榜排的是「你的最佳」，不是这一局。最佳不会因为多打一局变低，
           所以打得差不会掉名次——那等于惩罚玩得多的人。这一局单独交代。 */
        const runScore = this.score?.totalPoints ?? 0;
        const bests = this.lastPersonalBests;
        const previousBest = bests?.previousDevice ?? this.personalBest(this.mode);
        const best = Math.max(previousBest, runScore);
        const isRecord = bests?.isDeviceRecord ?? runScore > previousBest;
        const roster = payload.roster || buildRoster(best);
        const meIndex = roster.findIndex((person) => person.isMe);
        this.ui.renderGlobalRank({
          roster,
          headline: standingHeadline(roster, meIndex),
          mode: this.mode,
          sourceLabel: payload.roster
            ? payload.sourceLabel || "SCORE NEIGHBORS"
            : "DEMO SCORE NEIGHBORS",
          best,
          runScore,
          previousBest,
          isRecord,
          onTick: (kind) => this.resultBeat(kind),
          onReady: () => {
            this.resultCanContinue = true;
            this.resetGamepadMenuSelection();
          },
          onRetry: () => {
            this.audio.start();
            this.restartRun();
          },
          onQuit: () => {
            this.audio.confirm();
            this.enterState("MODE_SELECT");
          }
        });
        break;
      }

      /* K5 · Ending — 计分之前的八只甲虫谢幕动画。背景就是玩家结束时的
         实际场景（含该阶段的环境光），压暗用的就是结算页那层 wash。 */
      case "ENDING": {
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        this.endingFinishedElapsed = null;
        this.score = payload.score || scoreRun(this.levelsCleared, this.timeRemaining);
        if (!payload.score) this.score = this.addBonusToScore(this.score);
        this.endingDraw = pickEndingLine({
          cleared: this.score.cleared,
          totalLevels: this.levelCount(),
          drops: this.drops,
          /* 掉虫子是急还是贪，得看还剩多少时间才分得出来 */
          timeRemaining: this.timeRemaining,
          startTime: sharedRules(this.mode).initialTimeSec,
          /* 结算尚未落账，先和设备最佳比一下就够选台词了 */
          isRecord: this.score.totalPoints > this.personalBest(this.mode),
          totalPoints: this.score.totalPoints
        });
        this.endingLine = this.endingDraw.line;

        this.ui.hideHud();
        this.ui.fadeOutScreenForEnding(() => this.ui.clearScreen());
        this.scene.beginEnding(
          {
            onImpact: () => this.audio.hit(0.45),
            onPaperBonk: () => this.audio.endingPaperBonk(),
            onFortuneAppear: () => this.audio.endingFortuneAppear(),
            onFortuneVanish: () => this.audio.endingFortuneVanish(),
            onSpin: () => this.audio.move(),
            onGroupBlink: () =>
              this.audio.rank({ validPhases: ["ENDING"] }),
            /* 第二幕全在场景里演（签语写在叶面上），这里只负责起表：
               从谢幕结束那一刻算 endingTipMs，然后交给结算板。 */
            onFinished: () => {
              this.endingFinishedElapsed = this.stateElapsed;
            }
          },
          { line: this.endingLine }
        );
        break;
      }

      case "CONTEXT_LOST":
        this.scene.setSimulationEnabled(false);
        this.scene.setInputEnabled(false);
        this.ui.renderContextLost(() => location.reload());
        break;

      default:
        break;
    }
  }

  /* 声音与动画在同一个调用点，两者不会漂开 */
  /* 结算板与全球榜共用这一张节拍表。全球榜那几拍：
     board 板落位 / swap 你升一格 / count 数字滚动 / gap 差距标 / best 破纪录 */
  resultBeat(kind) {
    if (kind === "count") this.audio.resultTick();
    else if (kind === "star" || kind === "record" || kind === "swap") {
      this.audio.rank();
    } else if (kind === "board") this.audio.confirm();
    else if (kind === "gap") this.audio.move();
    else if (kind === "best") this.audio.clear();
  }

  /* 结算板没有按钮：读完自己往前走。手动跳过（键盘 / 手柄）走的也是这里，
     两条路都要挡住重复进入，否则会把那一屏重渲染一遍。 */
  advanceToStanding() {
    if (this.state !== "RESULT_CALC" || !this.resultCanContinue) return;
    this.resultCanContinue = false;
    this.audio.confirm();
    this.enterState("GLOBAL_RANK");
  }

  renderTitle() {
    this.ui.renderTitle(this.mode, {
      onMode: (mode) => this.setMode(mode),
      onHowTo: () => {
        this.audio.move();
        this.openHowTo("MODE_SELECT");
      },
      onStart: () => {
        this.audio.start();
        this.requestRunStart();
      },
      onVibrationToggle: (enabled) => {
        this.vibration?.setEnabled(enabled);
        this.ui.setVibrationEnabled?.(this.vibration?.enabled ?? enabled);
      },
      onVibrationLevel: (button) => {
        if (pressVibrationLevel(this.vibration, button) === null) return;
        this.ui.setVibrationIntensity?.(this.vibration?.intensity);
      }
    });
    /* 标题每次重建都要把控件拨回模型的真实值：markup 里写死的是首次运行的
       默认档，玩家上次存的选择在那之后才读出来。 */
    this.ui.setVibrationEnabled?.(this.vibration?.enabled ?? true);
    this.ui.setVibrationIntensity?.(
      this.vibration?.intensity ?? DEFAULT_VIBRATION_INTENSITY
    );
  }

  /**
   * 这一局要打的八块板子。
   *
   * 全局唯一的关卡来源。还没排过局（BOOT、以及任何在 startRun 之前就想画一块板
   * 的地方）就退回正典表 —— 不是容错，是刻意：开机第一眼应该是手工关。
   */
  runLevels() {
    if (!isProcedural(this.mode)) return levelSet(this.mode);
    return this.run?.levels || levelSet("beginner");
  }

  /**
   * 第 `index` 关。两种局的唯一取关入口。
   *
   * 固定局是数组下标；ENDLESS 是一条惰性流，第一次问到才生成（约 31ms，落在
   * 过关结算或下落动画里）。越界返回 null —— 调用方靠它判断「还有没有下一关」。
   */
  levelAt(index) {
    if (index < 0) return null;
    if (isProcedural(this.mode) && this.run?.levelAt) return this.run.levelAt(index);
    const levels = this.runLevels();
    return index < levels.length ? levels[index] : null;
  }

  /** 这一局总共多少关。ENDLESS 是 Infinity —— 结束它的是时钟，不是关卡数。 */
  levelCount() {
    return isProcedural(this.mode) ? Infinity : TOTAL_LEVELS;
  }

  /**
   * 排一局新的。
   *
   * 开销约 240ms（生成器要「摇→验→重摇」），只在真正开局时付。落点是
   * startRun -> LEVEL_INTRO，后面紧跟几秒下落动画，这一下被过场盖住了；换成
   * 在选单里预排，代价是给玩家永远不会玩的局白算一遍。
   *
   * `reseed` 只有真正开新局时为 true。
   */
  planNewRun({ reseed = false } = {}) {
    if (reseed && this.runSeed == null) {
      /* 整条链路上唯一允许的熵。rng.js 之后的一切都必须是确定性的，但 seed 本身
         得从某处来；取到之后立刻记进 this.run.seed，这一局就完全可复现了。 */
      this.pendingSeed = (Math.random() * 0xffffffff) >>> 0;
    }
    const seed = this.runSeed ?? this.pendingSeed ?? undefined;
    /* ENDLESS 没有最后一关，所以没有可以预先建好的数组：板子按需生成、算过就
       缓存。固定长度的一局仍然一次排完。 */
    this.run = isProcedural(this.mode)
      ? createEndlessRun({ seed, mode: this.mode })
      : planRun({ theme: this.theme, seed, mode: this.mode });
    return this.run;
  }

  /**
   * 换主题。只记下选择 —— 板子等 startRun 才排。
   *
   * 标题页上那块板是**展示板**，不是这一局的第一关：它一直是手工关，而且切主题
   * 不该让它跳成一块随机生成的叶子。玩家在选单里看到的是这个游戏最好看的样子。
   */
  setTheme(theme) {
    const resolved = themeById(theme);
    if (this.theme === resolved.id) return;
    this.theme = resolved.id;
    this.ui.updateTitleTheme?.(resolved);
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (globalThis.document?.documentElement) {
      document.documentElement.dataset.mode = mode;
    }
    this.audio.setMode(mode);
    this.audio.move();
    /* ENDLESS 的展示板也用手工关：标题页展示的是这个游戏最好看的样子，
       不该是一块每次刷新都不同的随机叶子。 */
    this.scene.loadLevel(levelSet(mode)[0], mode, {
      preserveCamera: true
    });
    this.ui.updateTitleMode(mode);
  }

  openHowTo(returnState) {
    this.resumeStateAfterModal = returnState;
    this.enterState("HOW_TO_PLAY");
  }

  closeHowTo() {
    const back = this.resumeStateAfterModal || "MODE_SELECT";
    this.resumeStateAfterModal = null;
    this.enterState(back);
  }

  requestRunStart() {
    this.audio.reset({ preserveKeys: ["ui-confirm"] });
    this.offBoardElapsed = 0;
    const sample = this.input.sample(0);
    if (
      this.input.hardwareRequired &&
      (!sample.connected || !sample.presenceValid)
    ) {
      this.beginConnectionRequired(
        sample.connected ? "STEP_OFF" : sample.reason,
        { resumeState: "TEACH_IN", initialize: true, sample }
      );
      return;
    }
    this.enterState("TEACH_IN");
  }

  restartRun() {
    this.audio.reset({ preserveKeys: ["ui-confirm"] });
    const sample = this.input.sample(0);
    if (
      this.input.hardwareRequired &&
      (!sample.connected || !sample.presenceValid)
    ) {
      this.beginConnectionRequired(
        sample.connected ? "STEP_OFF" : sample.reason,
        { resumeState: "LEVEL_INTRO", initialize: true, sample }
      );
      return;
    }
    this.offBoardElapsed = 0;
    this.startRun();
    this.enterState("LEVEL_INTRO");
  }

  beginConnectionRequired(
    reason = "DISCONNECTED",
    { resumeState = this.state, initialize = false, sample } = {}
  ) {
    if (this.state === "CONNECTION_REQUIRED") {
      this.connectionReason = reason || this.connectionReason;
      this.ui.showConnectionRequired?.(this.connectionReason);
      return;
    }
    const currentSample = sample || this.currentInputSample || this.input.sample(0);
    this.connectionResumeContext = {
      state: resumeState,
      stateElapsed: this.stateElapsed,
      countdownStep: this.countdownStep,
      frozenCountdown: this.frozenCountdown,
      initialize
    };
    this.connectionReason = reason || "DISCONNECTED";
    this.connectionSampleFloor = Number(currentSample?.sampleVersion) || 0;
    this.offBoardElapsed = 0;
    const rawBoard = this.input.rawBoardSample?.() || {};
    console.warn(`[HW] Balance Board input paused: ${this.connectionReason}`, {
      connected: Boolean(currentSample?.connected),
      presenceValid: Boolean(currentSample?.presenceValid),
      forceKg: Number(currentSample?.force) || 0,
      staleMs: currentSample?.staleMs,
      sampleVersion: currentSample?.sampleVersion,
      source: currentSample?.source,
      boardReason: rawBoard.reason,
      lastRejectedReason: rawBoard.lastRejectedReason,
      subscriptionId: rawBoard.subscriptionId,
      streamEpoch: rawBoard.streamEpoch,
      sourceSequence: rawBoard.sourceSequence
    });
    this.enterState("CONNECTION_REQUIRED", {
      reason: this.connectionReason
    });
  }

  resumeFromConnection() {
    const resume = this.connectionResumeContext;
    if (!resume) return;
    this.connectionResumeContext = null;
    this.connectionReason = null;
    this.offBoardElapsed = 0;
    this.ui.hideConnectionRequired?.();
    if (resume.initialize) {
      if (resume.state === "LEVEL_INTRO") this.startRun();
      this.enterState(resume.state);
      return;
    }
    const previous = this.state;
    this.previousState = previous;
    this.state = resume.state;
    this.stateElapsed = resume.stateElapsed;
    this.countdownStep = resume.countdownStep;
    this.frozenCountdown = resume.frozenCountdown;
    this.audio.setPhase(this.state);
    this.ui.setTeachInPaused?.(this.state !== "TEACH_IN" || this.visibilityPaused);
    const simulating = [
      "GAMEPLAY",
      "BALL_FALL_DROP",
      "BALL_FALL_RESET"
    ].includes(this.state);
    this.scene.setSimulationEnabled(simulating);
    this.scene.setInputEnabled(this.state === "GAMEPLAY");
    console.log(`[STATE] ${previous} -> ${this.state}`);
  }

  /* 教学卡走完直接进倒计时。这里以前隔着一个 START_LINE：必须把重心稳在
     半径 0.24 内保持 0.6 秒才放行——那是拿身体动作挡门，把入场变成了一场
     必须先通过的考试，而且玩得最差的人等得最久。它不做取零位，拆掉不影响
     校准；硬件在场检查 requestRunStart() 已经做过了。 */
  prepareStartLine() {
    if (this.state !== "TEACH_IN") this.startRun();
    this.enterState("LEVEL_INTRO");
  }

  startRun() {
    if (isProcedural(this.mode)) this.planNewRun({ reseed: true });
    else this.run = null;
    this.currentLevelIndex = 0;
    this.levelsCleared = 0;
    this.drops = 0;
    this.bonusPoints = 0;
    this.dewBank = 0;
    this.potions = 0;
    this.collisionPenaltyUntil?.clear();
    this.levelFalls = 0;
    this.cleanWinStreak = 0;
    this.struggleStreak = 0;
    this.adaptiveDifficulty = 0;
    this.hintShownThisLevel = false;
    this.butterflyHintPending = false;
    this.rogueBlessings = { dewlight: 0, treasureLuck: 0, butterflyBond: 0 };
    this.ui?.setRogueBlessings?.(null);
    this.timeRemaining = isRogue(this.mode)
      ? Infinity
      : sharedRules(this.mode).initialTimeSec;
    this.accumulator = 0;
    this.loadCurrentLevel();
  }

  loadCurrentLevel() {
    const level = this.levelAt(this.currentLevelIndex);
    if (isProcedural(this.mode)) applySkin(level?.weather || "canon");
    else restoreCanon();
    if (globalThis.document?.documentElement) {
      document.documentElement.dataset.weather = isProcedural(this.mode)
        ? level?.weather || "canon"
        : "canon";
    }
    this.scene.loadLevel(level, this.mode);
  }

  pause() {
    if (this.state !== "GAMEPLAY") return;
    this.audio.move();
    this.enterState("PAUSE_MENU");
  }

  resume() {
    if (this.state !== "PAUSE_MENU") return;
    this.audio.confirm();
    this.enterState("GAMEPLAY");
  }

  toggleDebugBoardDisconnect() {
    if (!this.debugBoardDisconnected) {
      if (!INPUT_REQUIRED_STATES.has(this.state)) return false;
      this.debugBoardDisconnected = true;
      this.input.setDebugBoardDisconnected?.(true);
      const sample = this.input.sample(0);
      this.beginConnectionRequired("DEBUG_FORCED_DISCONNECT", { sample });
      console.log("[QA] Balance Board disconnect simulation enabled");
      return true;
    }

    this.input.setDebugBoardDisconnected?.(false);
    this.debugBoardDisconnected = false;
    this.connectionSampleFloor =
      Number(this.input.rawBoardSample?.().sampleVersion) || 0;
    console.log("[QA] Balance Board disconnect simulation disabled");
    return true;
  }

  clearDebugBoardDisconnect() {
    this.input.setDebugBoardDisconnected?.(false);
    this.debugBoardDisconnected = false;
  }

  handleKeyDown(event) {
    const gotoFinalLevel = event.code === "F1";
    const completeRun = event.code === "KeyZ";
    const clearCurrentLevel = event.code === "F2" || event.code === "KeyX";
    const toggleBoardDisconnect = event.code === "KeyP";
    /* F —— 从头放一遍谢幕。第二幕要反复看才调得出来，而正常走到这里要打完
       一整局；按一下就重来一遍，在哪个状态按都行。 */
    const replayEnding = event.code === "KeyF";
    /* R —— 直接跳到全球榜（K6）。和 F 一样，在哪个状态按都行：
       那一屏要反复看邻居和差距的随机结果，走完整一局太慢。 */
    const gotoStanding = event.code === "KeyR";
    const toggleDebugPanel = event.code === "F3" && this.qaMode;
    if (event.repeat || isEditableKeyTarget(event.target)) return;
    if (
      gotoFinalLevel ||
      completeRun ||
      clearCurrentLevel ||
      toggleBoardDisconnect ||
      replayEnding ||
      gotoStanding
      || toggleDebugPanel
    ) {
      event.preventDefault();
      this.audio.unlock();
      if (gotoFinalLevel) this.debugGotoFinalLevel();
      else if (completeRun) this.debugCompleteRun();
      else if (clearCurrentLevel) this.debugClearLevel();
      else if (replayEnding) this.debugGoto("ENDING");
      else if (gotoStanding) this.debugGoto("GLOBAL_RANK");
      else if (toggleDebugPanel) this.toggleDebugPanel();
      else this.toggleDebugBoardDisconnect();
      return;
    }

    this.audio.unlock();
    if (event.code === "Escape") {
      if (this.state === "GAMEPLAY") {
        event.preventDefault();
        this.pause();
      } else if (this.state === "PAUSE_MENU") {
        event.preventDefault();
        this.resume();
      } else if (this.state === "HOW_TO_PLAY") {
        event.preventDefault();
        this.closeHowTo();
      } else if (this.state === "CONFIRM_QUIT") {
        event.preventDefault();
        this.enterState("PAUSE_MENU");
      } else if (this.state === "CONNECTION_REQUIRED") {
        this.enterState("MODE_SELECT");
      }
      return;
    }

    if (this.state === "MODE_SELECT") {
      if (event.code === "ArrowLeft") this.setMode("beginner");
      else if (event.code === "ArrowRight") this.setMode("advanced");
      else if (event.code === "Enter" || event.code === "Space") this.requestRunStart();
    } else if (
      this.state === "RESULT_CALC" &&
      this.resultCanContinue &&
      (event.code === "Enter" || event.code === "Space")
    ) {
      this.advanceToStanding();
    } else if (
      this.state === "GLOBAL_RANK" &&
      this.resultCanContinue &&
      (event.code === "Enter" || event.code === "Space")
    ) {
      this.restartRun();
    }

    if ((this.qaMode || isProcedural(this.mode)) && event.code === "KeyN") {
      event.preventDefault();
      this.debugClearLevel();
    }
    /* 掉球原本是 F —— F 让给了「重放谢幕」（上面那组，任何模式都生效）。 */
    if (this.qaMode && event.code === "KeyG") {
      this.debugDropBall();
    }
    if (this.qaMode && event.code === "KeyC") {
      this.debugCaptureBall();
    }
    if (this.qaMode && event.code === "KeyA") {
      event.preventDefault();
      this.debugAudioTour();
    }
    if (this.qaMode && event.code === "KeyV") {
      event.preventDefault();
      this.setVisibilityPaused(!this.visibilityPaused, "qa");
    }
  }

  /* Kiwii External Game virtual gamepad entry. Direction buttons are
     routed to the input system by the External Game runtime; this method
     only maps the semantic action buttons (A/B/X/Y) and D-pad mode
     selection onto existing controller actions, mirroring the keyboard
     semantics of handleKeyDown. RELEASED/CANCELLED are consumed. */
  handleGamepadAction(buttonId, phase) {
    if (phase === "PRESSED") {
      if (typeof this.audio.prepareExternalInput === "function") {
        void this.audio.prepareExternalInput(this.mode);
      } else {
        void this.audio.unlock();
      }
    }
    const action = resolveGamepadAction({
      state: this.state,
      buttonId,
      phase,
      resultCanContinue: this.resultCanContinue
    });
    if (action === null) return false;
    switch (action) {
      case "begin-setup":
        this.requestRunStart();
        return true;
      case "close-how-to":
        this.audio.confirm();
        this.closeHowTo();
        return true;
      case "confirm-quit":
        this.audio.confirm();
        this.enterState("MODE_SELECT");
        return true;
      case "cancel-quit":
        this.audio.move();
        this.enterState("PAUSE_MENU");
        return true;
      case "return-title":
        this.audio.stopVictory?.();
        this.enterState("MODE_SELECT");
        return true;
      case "select-menu-previous":
        return this.moveGamepadMenuSelection(-1);
      case "select-menu-next":
        return this.moveGamepadMenuSelection(1);
      case "activate-menu-selection":
        return this.activateGamepadMenuSelection();
      case "resume":
        this.resume();
        return true;
      case "pause":
        this.pause();
        return true;
      case "show-standing":
        this.advanceToStanding();
        return true;
      case "restart-run":
        this.restartRun();
        return true;
      case "open-how-to":
        this.openHowTo(this.state === "MODE_SELECT" ? "MODE_SELECT" : "PAUSE_MENU");
        return true;
      case "select-mode-beginner":
        this.setMode("beginner");
        return true;
      case "select-mode-endless":
        this.setMode(ENDLESS_MODE);
        break;
      case "select-mode-advanced":
        this.setMode("advanced");
        return true;
      default:
        return false;
    }
  }

  gamepadMenuOptions() {
    switch (this.state) {
      case "PAUSE_MENU":
        return [
          { id: "resume-button", action: "resume" },
          { id: "restart-button", action: "restart-run" },
          { id: "pause-quit-button", action: "open-quit-confirmation" },
          { id: "pause-howto-button", action: "open-how-to" }
        ];
      case "CONFIRM_QUIT":
        return [
          { id: "quit-cancel", action: "cancel-quit" },
          { id: "quit-confirm", action: "return-title" }
        ];
      case "GLOBAL_RANK":
        return this.resultCanContinue
          ? [
              { id: "retry-button", action: "restart-run" },
              { id: "quit-button", action: "return-title" }
            ]
          : [];
      default:
        return [];
    }
  }

  resetGamepadMenuSelection() {
    this.gamepadMenuIndex = 0;
    this.focusGamepadMenuSelection();
  }

  focusGamepadMenuSelection() {
    const options = this.gamepadMenuOptions();
    if (options.length === 0) return false;
    this.gamepadMenuIndex =
      ((this.gamepadMenuIndex % options.length) + options.length) % options.length;
    this.ui.focusMenuControl?.(options[this.gamepadMenuIndex].id);
    return true;
  }

  moveGamepadMenuSelection(delta) {
    const options = this.gamepadMenuOptions();
    if (options.length === 0) return false;
    this.gamepadMenuIndex =
      (this.gamepadMenuIndex + delta + options.length) % options.length;
    this.audio.move();
    return this.focusGamepadMenuSelection();
  }

  activateGamepadMenuSelection() {
    const options = this.gamepadMenuOptions();
    if (options.length === 0) return false;
    const selected = options[this.gamepadMenuIndex] || options[0];
    switch (selected.action) {
      case "resume":
        this.resume();
        return true;
      case "restart-run":
        this.audio.start();
        this.restartRun();
        return true;
      case "open-quit-confirmation":
        this.audio.move();
        this.enterState("CONFIRM_QUIT");
        return true;
      case "open-how-to":
        this.audio.move();
        this.openHowTo("PAUSE_MENU");
        return true;
      case "cancel-quit":
        this.audio.move();
        this.enterState("PAUSE_MENU");
        return true;
      case "return-title":
        this.audio.confirm();
        this.audio.stopVictory?.();
        this.enterState("MODE_SELECT");
        return true;
      default:
        return false;
    }
  }

  /* Applies a validated External Game checkpoint. This document is a NEW
     instance: a live run re-enters through the level countdown of the
     captured level. Hardware-required restores remain frozen until a newer,
     presence-valid Balance Board sample arrives. */
  restoreExternalGameCheckpoint(checkpoint) {
    if (!checkpoint) {
      this.enterState("MODE_SELECT");
      return "fresh";
    }
    this.setMode(checkpoint.mode);
    if (checkpoint.screen === "MODE_SELECT") {
      this.enterState("MODE_SELECT");
      return "menu";
    }
    this.currentLevelIndex = Math.max(
      0,
      Math.min(TOTAL_LEVELS - 1, checkpoint.level - 1)
    );
    this.timeRemaining = checkpoint.timeRemainingMs / 1000;
    this.levelsCleared = checkpoint.levelsCleared;
    this.drops = checkpoint.drops;
    this.loadCurrentLevel();
    this.enterState("LEVEL_INTRO");
    if (this.input.hardwareRequired) {
      const sample = this.input.sample(0);
      const reason = !sample.connected
        ? sample.reason
        : sample.presenceValid
          ? "WAITING_FOR_FRESH_SAMPLE"
          : "STEP_OFF";
      this.beginConnectionRequired(reason, {
        resumeState: "LEVEL_INTRO",
        sample
      });
      return "run-awaiting-hardware";
    }
    return "run";
  }

  setExternalPaused(paused, source = "external-game") {
    this.externalPaused = Boolean(paused);
    this.applyFreezeState(source);
  }

  setPageHidden(hidden) {
    this.pageHidden = Boolean(hidden);
    this.applyFreezeState("document");
  }

  setBfcachePaused(paused) {
    this.bfcachePaused = Boolean(paused);
    this.applyFreezeState("bfcache");
  }

  applyFreezeState(source) {
    const frozen = this.externalPaused || this.pageHidden || this.bfcachePaused;
    if (frozen === this.visibilityPaused) return;
    this.visibilityPaused = frozen;
    this.ui.setTeachInPaused?.(frozen || this.state !== "TEACH_IN");
    this.audio.handleVisibility(frozen);
    this.lastNow = performance.now();
    console.log(
      `[GAME] Freeze ${frozen ? "applied" : "released"} ` +
        `(external=${this.externalPaused}, page=${this.pageHidden}, ` +
        `bfcache=${this.bfcachePaused}, source=${source})`
    );
    if (frozen) {
      if (this.frameRequestId !== null) {
        cancelAnimationFrame(this.frameRequestId);
        this.frameRequestId = null;
      }
      return;
    }
    if (
      this.rafStartAllowed &&
      this.frameRequestId === null &&
      !this.destroyed
    ) {
      this.frameRequestId = requestAnimationFrame(this.frame);
    }
  }

  setVisibilityPaused(hidden, source = "document") {
    if (String(source).startsWith("external-game")) {
      this.setExternalPaused(hidden, source);
      return;
    }
    this.setPageHidden(hidden);
  }

  handleSceneEvent(event) {
    switch (event.type) {
      case "collision":
        this.audio.hit(event.intensity);
        break;
      case "ballCaptured":
        this.audio.capture();
        this.vibration?.play?.("catch");
        if (this.state === "GAMEPLAY") {
          const stackCount = Math.max(0, Number(event.stackCount) || 0);
          if (stackCount) {
            if (isRogue(this.mode)) {
              const points = stackCount * 5;
              this.bonusPoints += points;
              this.showTimedToast(`Stack delivery · +${points} points`, "success", 1200);
            } else {
              const bonus = stackCount * STACK_CAPTURE_BONUS_SEC;
              this.timeRemaining += bonus;
              this.ui.updateGameplay?.({ level: this.currentLevelIndex + 1, timer: this.timeRemaining });
              this.showTimedToast(`Stack delivery · +${bonus}s`, "success", 1200);
            }
          } else {
            this.showTimedToast("In the hole!", "success", 900);
          }
        }
        console.log(`[EVENT] EV_BALL_CAPTURED ${event.ballId} -> ${event.holeId}`);
        break;
      case "ballFell":
        if (this.state !== "GAMEPLAY") return;
        console.log(`[EVENT] EV_BALL_FELL ${event.ballId}`);
        this.audio.fall();
        this.vibration?.play?.("drop");
        this.fallenBallId = event.ballId;
        this.drops += 1;
        if (isProcedural(this.mode)) {
          this.levelFalls += 1;
          if (isRogue(this.mode) && this.rogueBlessings.butterflyBond > 0) {
            this.butterflyHintPending = true;
          }
          if (this.levelFalls >= 3 && !this.hintShownThisLevel) {
            this.hintShownThisLevel = true;
            this.adaptiveDifficulty = Math.max(-0.3, this.adaptiveDifficulty - 0.08);
            this.butterflyHintPending = true;
          }
        }
        if (!isProcedural(this.mode)) this.ui.penaltyShake?.();
        this.enterState("BALL_FALL_DROP", { ballId: event.ballId });
        break;
      case "allCaptured":
        if (this.state === "GAMEPLAY") {
          this.completeLevel({ preserveToast: true });
        }
        break;
      case "dewCollected":
        if (!isProcedural(this.mode) || this.state !== "GAMEPLAY") return;
        {
          const points = Math.max(0, Number(event.points) || 0) +
            (isRogue(this.mode) ? this.rogueBlessings.dewlight * 2 : 0);
          this.bonusPoints += points;
          this.addDewCurrency(1, `Dew collected · +${points} points`);
        }
        break;
      case "chestCollected":
        if (!isProcedural(this.mode) || this.state !== "GAMEPLAY") return;
        {
          const points = Math.max(0, Number(event.points) || 0) +
            (isRogue(this.mode) ? this.rogueBlessings.treasureLuck * 5 : 0);
          this.bonusPoints += points;
          this.addDewCurrency(event.dew || 2, `Treasure chest · +${points} points`);
        }
        break;
      case "bugFrozen":
        if (this.state === "GAMEPLAY") this.showTimedToast(`Hail freeze · ${event.seconds}s`, "penalty", 900);
        break;
      case "bugStuck":
        if (this.state === "GAMEPLAY") this.showTimedToast("Spider web · stuck for 1s", "penalty", 900);
        break;
      case "fallingBugCaught":
        if (this.state === "GAMEPLAY") this.showTimedToast(`Ladybug caught · stack ×${event.stackCount}`, "success", 900);
        break;
      case "moleDisturbance":
        if (this.state === "GAMEPLAY") this.showTimedToast("Mole surprise!", "penalty", 700);
        break;
      case "wrongHole":
        if (this.state === "GAMEPLAY") {
          const needed = String(event.holeColor || "matching").toUpperCase();
          this.showTimedToast(`Wrong colour · ${needed} beetle needed`, "penalty", 1200);
          this.vibration?.play?.("drop");
        }
        break;
      case "contextLost":
        this.enterState("CONTEXT_LOST");
        break;
      case "contextRestored":
        console.log("[GAME] WebGL context restored");
        break;
      default:
        break;
    }
  }

  showTimedToast(text, tone, durationMs) {
    globalThis.clearTimeout(this.toastTimer);
    this.ui.showToast?.(text, tone);
    this.toastTimer = globalThis.setTimeout(
      () => this.ui.hideToast?.(),
      durationMs
    );
  }

  addDewCurrency(amount, message) {
    this.dewBank += Math.max(0, Math.floor(Number(amount) || 0));
    let brewed = 0;
    while (this.dewBank >= DEW_PER_POTION) {
      this.dewBank -= DEW_PER_POTION;
      this.potions += 1;
      brewed += 1;
    }
    const suffix = brewed
      ? ` · Potion +${brewed}`
      : ` · Dew ${this.dewBank}/${DEW_PER_POTION}`;
    this.showTimedToast(`${message}${suffix}`, "success", brewed ? 1500 : 1000);
  }

  tryPotionRevive() {
    if (!isEndless(this.mode) || this.potions <= 0) return false;
    this.potions -= 1;
    this.timeRemaining = POTION_REVIVE_SEC;
    this.ui.updateGameplay?.({ level: this.currentLevelIndex + 1, timer: this.timeRemaining });
    this.showTimedToast(`Potion revive · +${POTION_REVIVE_SEC}s`, "success", 1600);
    this.vibration?.play?.("catch");
    return true;
  }

  applyEndlessTimePenalty(seconds, reason) {
    if (!isEndless(this.mode) || this.state !== "GAMEPLAY") return false;
    const amount = Math.max(0, Number(seconds) || 0);
    if (!amount) return false;
    this.timeRemaining = Math.max(0, this.timeRemaining - amount);
    this.ui.updateGameplay?.({
      level: this.currentLevelIndex + 1,
      timer: this.timeRemaining
    });
    this.ui.penaltyShake?.();
    this.showTimedToast(`${reason} · −${amount}s`, "penalty", 900);
    return true;
  }

  currentScore() {
    const base = scoreRun(
      this.levelsCleared,
      isRogue(this.mode) ? 0 : this.timeRemaining
    );
    return this.addBonusToScore(base);
  }

  addBonusToScore(base) {
    const bonusPoints = isProcedural(this.mode)
      ? Math.max(0, Math.floor(this.bonusPoints || 0))
      : 0;
    return bonusPoints > 0
      ? { ...base, bonusPoints, totalPoints: base.totalPoints + bonusPoints }
      : base;
  }

  /* C7-A · 3 · 2 · 1 · GO —— 只在第一关（Dantong 2026-07-27）。
     每关都数一遍太拖（8 关要多花近 30 秒），而且过关的 +20s 已经交代了
     「新一关开始」；开场那一次才是真正需要的起跑信号。 */
  tickCountdown(dt = 0) {
    if (this.frozenCountdown) return;
    const sample = this.currentInputSample || this.input.sample(dt);
    this.ui.updateTouchDisplay?.(sample);
    if (this.currentLevelIndex > 0) {
      this.ui.hideCountdown();
      if (this.stateElapsed >= this.duration(UI_TIMING.levelHandoffMs / 1000)) {
        this.enterState("GAMEPLAY");
      }
      return;
    }
    const beat = this.animationMs(UI_TIMING.countdownBeatMs);
    const go = this.animationMs(UI_TIMING.countdownGoMs);
    const lead = this.animationMs(UI_TIMING.countdownLeadInMs);
    const marks = [lead, lead + beat, lead + beat * 2, lead + beat * 3];
    const labels = ["3", "2", "1", "GO"];
    for (let index = marks.length - 1; index >= 0; index -= 1) {
      if (this.stateElapsed >= marks[index] && this.countdownStep < index) {
        this.countdownStep = index;
        this.ui.showCountdown(labels[index], countdownHoldMs(index));
        if (index === 3) this.audio.countdownGo();
        else this.audio.countdownBeat();
        break;
      }
    }
    if (this.stateElapsed >= lead + beat * 3 + go) this.enterState("GAMEPLAY");
  }

  tickGameplay(dt) {
    const sample = this.currentInputSample || this.input.sample(dt);
    this.ui.updateTouchDisplay?.(sample);
    if (!isRogue(this.mode)) {
      this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    }
    this.ui.updateGameplay({
      level: this.currentLevelIndex + 1,
      timer: this.timeRemaining
    });

    if (!isRogue(this.mode) && this.timeRemaining <= 0) {
      if (this.tryPotionRevive()) return;
      this.completeRun();
      return;
    }

    if (this.autoClear && this.stateElapsed >= this.duration(0.35)) {
      this.completeLevel();
      return;
    }

    this.scene.setInputEnabled(true);
    this.scene.updateTilt(sample, dt);
    this.stepPhysics(dt);
  }

  stepPhysics(dt) {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.scene.fixedStep(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps === MAX_SUBSTEPS && this.accumulator >= FIXED_DT) {
      this.accumulator = 0;
    }
  }

  tickBallDrop(dt) {
    if (!isRogue(this.mode)) this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    this.ui.updateGameplay({
      level: this.currentLevelIndex + 1,
      timer: this.timeRemaining
    });
    this.scene.updateTilt({ x: 0, y: 0 }, dt);
    this.ui.updateTouchDisplay?.(
      this.currentInputSample || this.input.sample(dt)
    );
    this.stepPhysics(dt);

    const cleared = this.scene.hasAllFallenBallsClearedBoard();
    const fadedOut = this.scene.hasAllFallenBallsFadedOut();
    const ready = shouldStartFailureSpin(
      this.scene.latestFallenBallElapsed(),
      cleared && fadedOut,
      this.animationMs(UI_TIMING.ballDropMinMs),
      this.animationMs(UI_TIMING.ballDropMaxMs)
    );
    if (ready) {
      this.enterState("BALL_FALL_RESET", { ballId: this.fallenBallId });
    }
  }

  tickBallReset(dt) {
    if (!isRogue(this.mode)) this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    this.ui.updateGameplay({
      level: this.currentLevelIndex + 1,
      timer: this.timeRemaining
    });
    const sample = this.currentInputSample || this.input.sample(dt);
    this.ui.updateTouchDisplay?.(sample);
    this.scene.updateTilt(sample, dt);
    const delay = sharedRules(this.mode).fallResetDelaySec;
    if (this.stateElapsed < this.animationDuration(delay)) return;

    if (!isRogue(this.mode) && this.timeRemaining <= 0) {
      if (this.tryPotionRevive()) {
        this.scene.resetFallenBalls();
        this.fallenBallId = null;
        this.enterState("GAMEPLAY");
        return;
      }
      this.completeRun();
      return;
    }

    this.scene.resetFallenBalls();
    this.fallenBallId = null;
    this.enterState("GAMEPLAY");
    if (this.butterflyHintPending) {
      this.butterflyHintPending = false;
      this.scene.showButterflyHint?.();
      this.showTimedToast("Butterfly guide · follow its path", "success", 1800);
    }
  }

  completeLevel({ preserveToast = false } = {}) {
    if (this.state !== "GAMEPLAY") return;
    this.levelsCleared += 1;
    if (isProcedural(this.mode)) {
      if (this.levelFalls === 0) {
        this.cleanWinStreak += 1;
        this.struggleStreak = 0;
        if (this.cleanWinStreak >= 2) {
          this.adaptiveDifficulty = Math.min(0.3, this.adaptiveDifficulty + 0.08);
          this.cleanWinStreak = 0;
        }
      } else {
        this.struggleStreak += 1;
        this.cleanWinStreak = 0;
        if (this.struggleStreak >= 2) {
          this.adaptiveDifficulty = Math.max(-0.3, this.adaptiveDifficulty - 0.12);
          this.struggleStreak = 0;
        }
      }
      this.run?.setDifficultyOffset?.(
        this.currentLevelIndex + 1,
        this.adaptiveDifficulty
      );
      this.levelFalls = 0;
      this.hintShownThisLevel = false;
      this.butterflyHintPending = false;
    }
    if (
      isRogue(this.mode) &&
      this.levelsCleared % ROGUE_BLESSING_INTERVAL === 0
    ) {
      const blessing = ROGUE_BLESSINGS[
        Math.floor(this.levelsCleared / ROGUE_BLESSING_INTERVAL - 1) % ROGUE_BLESSINGS.length
      ];
      this.rogueBlessings[blessing.id] += 1;
      this.ui.setRogueBlessings?.(this.rogueBlessings);
      this.showTimedToast(
        `${blessing.name} ${this.rogueBlessings[blessing.id]} · ${blessing.description}`,
        "success",
        2600
      );
      preserveToast = true;
    }
    const rules = sharedRules(this.mode);
    const startTime = this.timeRemaining;
    const targetTime = isRogue(this.mode)
      ? Infinity
      : Math.min(rules.timeCapSec, this.timeRemaining + rules.timeAddedPerClearSec);
    console.log(
      `[EVENT] EV_LEVEL_CLEAR level=${this.currentLevelIndex + 1} time=${targetTime.toFixed(2)}`
    );
    const payload = { startTime, targetTime };
    if (preserveToast) payload.preserveToast = true;
    this.enterState("LEVEL_CLEAR", payload);
  }

  finishRun(score = null) {
    if (["BALL_FALL_DROP", "BALL_FALL_RESET"].includes(this.state)) {
      this.scene.resetFallenBalls();
      this.fallenBallId = null;
    }
    this.accumulator = 0;
    this.enterState("RESULT_CALC", {
      score: score || this.currentScore()
    });
  }

  /* 真实对局的收束点：先放甲虫谢幕（ENDING），tip 落幕后才轮到结算板。
     QA / evidence 流程仍走 finishRun 直达结算，节拍断言不受谢幕影响。 */
  completeRun() {
    if (["BALL_FALL_DROP", "BALL_FALL_RESET"].includes(this.state)) {
      this.scene.resetFallenBalls();
      this.fallenBallId = null;
    }
    this.accumulator = 0;
    this.enterState("ENDING", {
      score: this.currentScore()
    });
  }

  shouldShowTouch() {
    return this.forceTouch || this.input.isCoarsePointer();
  }

  connectionIssue(sample, dt) {
    if (!this.input.hardwareRequired && !this.debugBoardDisconnected) {
      this.offBoardElapsed = 0;
      return null;
    }
    if (!sample.connected) {
      this.offBoardElapsed = 0;
      return sample.reason || "DISCONNECTED";
    }
    if (sample.presenceValid) {
      this.offBoardElapsed = 0;
      return null;
    }
    this.offBoardElapsed += Math.max(0, dt);
    return this.offBoardElapsed >= 0.25 ? "STEP_OFF" : null;
  }

  tick(dt) {
    const sample = this.input.sample(dt);
    this.currentInputSample = sample;
    this.ui.updateTouchDisplay?.(sample);

    if (this.state === "CONNECTION_REQUIRED") {
      const hasNewValidSample =
        !this.debugBoardDisconnected &&
        sample.connected &&
        sample.presenceValid &&
        Number(sample.sampleVersion) > this.connectionSampleFloor;
      if (hasNewValidSample) this.resumeFromConnection();
      return;
    }

    if (INPUT_REQUIRED_STATES.has(this.state)) {
      const issue = this.connectionIssue(sample, dt);
      if (issue) {
        this.beginConnectionRequired(issue, { sample });
        return;
      }
    }

    this.stateElapsed += dt;

    switch (this.state) {
      case "CONNECTION_REQUIRED":
        break;
      case "TEACH_IN":
        this.scene.updateTilt({ x: 0, y: 0 }, dt);
        if (this.ui.canAdvanceTeachIn?.() ??
            this.stateElapsed >= this.ms(UI_TIMING.teachingMs)) {
          this.audio.confirm();
          this.prepareStartLine();
        }
        break;
      case "LEVEL_INTRO":
        this.scene.updateTilt({ x: 0, y: 0 }, dt);
        this.tickCountdown(dt);
        break;
      case "GAMEPLAY":
        this.tickGameplay(dt);
        break;
      case "BALL_FALL_DROP":
        this.tickBallDrop(dt);
        break;
      case "BALL_FALL_RESET":
        this.tickBallReset(dt);
        break;
      case "LEVEL_CLEAR": {
        this.scene.updateTilt({ x: 0, y: 0 }, dt);
        const bonusDuration = this.ms(UI_TIMING.levelClearMs);
        const nextLevel = this.levelAt(this.currentLevelIndex + 1);
        const duration = levelClearDurationSec(nextLevel, this.timingScale);
        const startTime = this.levelClear?.startTime ?? this.timeRemaining;
        const targetTime = this.levelClear?.targetTime ?? this.timeRemaining;
        this.timeRemaining = isRogue(this.mode)
          ? Infinity
          : animateBonusTimer(startTime, targetTime, this.stateElapsed, bonusDuration);
        this.ui.updateGameplay({
          level: levelClearHudLevel(
            this.currentLevelIndex,
            this.levelClear?.nextLoaded,
            this.scene.isLevelHandoffActive?.(),
            this.levelCount()
          ),
          timer: this.timeRemaining
        });

        if (
          this.currentLevelIndex < this.levelCount() - 1 &&
          !this.levelClear?.nextLoaded &&
          this.stateElapsed >= this.ms(UI_TIMING.levelBoardEnterAtMs)
        ) {
          this.currentLevelIndex += 1;
          this.loadCurrentLevel();
          this.scene.startLevelHandoffEnter();
          this.levelClear.nextLoaded = true;
        }

        if (
          this.stateElapsed >= duration &&
          !this.scene.isLevelHandoffActive?.()
        ) {
          const isFinal = !!this.levelClear?.isFinal;
          this.timeRemaining = targetTime;
          this.scene.endLevelHandoff();
          this.levelClear = null;
          if (isFinal) {
            this.enterState("RUN_COMPLETE");
          } else {
            this.enterState("GAMEPLAY");
          }
        }
        break;
      }
      case "RUN_COMPLETE":
        /* 结算屏自己会先铺一个整屏大字，这里只需要短暂收尾 */
        if (this.stateElapsed >= this.duration(0.5)) this.completeRun();
        break;
      case "ENDING":
        /* tip 读完，谢幕让位给结算板 */
        if (
          this.endingFinishedElapsed != null &&
          this.stateElapsed - this.endingFinishedElapsed >=
            this.ms(UI_TIMING.endingTipMs)
        ) {
          this.finishRun(this.score);
        }
        break;
      default:
        this.scene.updateTilt({ x: 0, y: 0 }, dt);
        break;
    }
  }

  loop(now) {
    if (this.destroyed) return;
    const { elapsedSec, simulationDt } = frameDurations(this.lastNow, now);
    this.lastNow = now;
    if (!this.visibilityPaused) {
      this.perfWindowSec += elapsedSec;
      this.perfFrames += 1;
      this.maxFrameMs = Math.max(this.maxFrameMs, elapsedSec * 1000);
      if (this.perfWindowSec >= 1) {
        this.fps = this.perfFrames / this.perfWindowSec;
        const stage = document.querySelector("#stage");
        if (stage) {
          stage.dataset.fps = this.fps.toFixed(1);
          stage.dataset.maxFrameMs = this.maxFrameMs.toFixed(1);
        }
        this.perfWindowSec = 0;
        this.perfFrames = 0;
        this.maxFrameMs = 0;
      }
      this.tick(simulationDt);
      this.scene.update(simulationDt);
      this.onSimulatedFrame?.(now);
      this.scene.render();
      this.onRenderedFrame?.(now);
      if (this.qaMode) {
        const stage = document.querySelector("#stage");
        const scene = this.scene.snapshot();
        if (stage) {
          const inputSnapshot = this.input.snapshot();
          stage.dataset.state = this.state;
          stage.dataset.mode = this.mode;
          stage.dataset.levelId = scene.levelId || "";
          stage.dataset.boardConnected = String(inputSnapshot.board.connected);
          stage.dataset.connectionReason = this.connectionReason || "";
          stage.dataset.interruptedState =
            this.connectionResumeContext?.state || "";
          stage.dataset.cop = JSON.stringify({
            x: inputSnapshot.board.copX,
            y: inputSnapshot.board.copY,
            present: inputSnapshot.board.presenceValid
          });
          stage.dataset.sessionBest = String(this.sessionBest());
          stage.dataset.deviceBest = String(this.personalBest());
          stage.dataset.visualPitch = scene.visualPitchDeg.toFixed(2);
          stage.dataset.visualRoll = scene.visualRollDeg.toFixed(2);
          stage.dataset.visualYaw = scene.visualYawDeg.toFixed(2);
          stage.dataset.boardYaw = scene.boardYawDeg.toFixed(2);
          stage.dataset.handoff = scene.handoffPhase || "";
          stage.dataset.boardVisible = String(scene.boardVisible);
          stage.dataset.boardScale = scene.boardScale.toFixed(3);
          stage.dataset.boardOffsetY = scene.boardOffsetY.toFixed(3);
          stage.dataset.cameraPosition = JSON.stringify(scene.cameraPosition);
          stage.dataset.cameraQuaternion = JSON.stringify(
            scene.cameraQuaternion
          );
          stage.dataset.ballOpacities = JSON.stringify(
            scene.balls.map((ball) => ball.opacity)
          );
          stage.dataset.ballVisibility = JSON.stringify(
            scene.balls.map((ball) => ball.visible)
          );
          stage.dataset.visualTheme = scene.visualTheme || "";
          stage.dataset.runtimeSingleField = String(
            scene.runtime?.singleField || false
          );
          stage.dataset.mossWorld = String(scene.mossfall?.world || false);
          stage.dataset.mossLighting = String(scene.mossfall?.lighting || false);
          stage.dataset.mossEffects = String(scene.mossfall?.effects || false);
          stage.dataset.mossPostfx = String(scene.mossfall?.postfx || false);
          stage.dataset.postfxExplicitClear = String(
            scene.mossfall?.postfxExplicitClear || false
          );
          stage.dataset.mossZone = String(scene.mossfall?.zone ?? "");
          stage.dataset.renderPixelRatio = String(scene.renderPixelRatio || 0);
          stage.dataset.leafAdaptive = String(
            scene.mossfall?.leaf?.adaptive || false
          );
          stage.dataset.leafSystem =
            scene.mossfall?.leaf?.system || "";
          stage.dataset.leafBuildFieldMesh = String(
            scene.mossfall?.leaf?.buildFieldMesh || false
          );
          stage.dataset.leafShaderOk = String(
            scene.mossfall?.leaf?.shaderOk || false
          );
          stage.dataset.leafBladeCount = String(
            scene.mossfall?.leaf?.bladeCount || 0
          );
          stage.dataset.leafBurrowFurnitureCount = String(
            scene.mossfall?.leaf?.burrowFurnitureCount || 0
          );
          stage.dataset.leafBurrowGlowCount = String(
            scene.mossfall?.leaf?.burrowGlowCount || 0
          );
          stage.dataset.leafContactShadowLayerCount = String(
            scene.mossfall?.leaf?.contactShadowLayerCount || 0
          );
          stage.dataset.leafBoardPropsCount = String(
            scene.mossfall?.leaf?.boardPropsCount || 0
          );
          stage.dataset.leafCalm = Number(
            scene.mossfall?.leaf?.calm || 0
          ).toFixed(4);
          stage.dataset.leafSagWeights = JSON.stringify(
            scene.mossfall?.leaf?.sagWeights || []
          );
          stage.dataset.leafPulseStrengths = JSON.stringify(
            scene.mossfall?.leaf?.pulseStrengths || []
          );
          stage.dataset.leafTopVertices = String(
            scene.mossfall?.leaf?.topVertices || 0
          );
          stage.dataset.leafTriangles = String(
            scene.mossfall?.leaf?.triangles || 0
          );
          stage.dataset.leafHeightRange = Number(
            scene.mossfall?.leaf?.heightRange || 0
          ).toFixed(4);
          stage.dataset.leafHeightRms = Number(
            scene.mossfall?.leaf?.heightRms || 0
          ).toFixed(4);
          stage.dataset.leafThicknessRange = Number(
            scene.mossfall?.leaf?.thicknessRange || 0
          ).toFixed(4);
          stage.dataset.leafEdgeVertices = String(
            scene.mossfall?.leaf?.edgeVertexCount || 0
          );
          stage.dataset.leafVeinVertices = String(
            scene.mossfall?.leaf?.veinVertexCount || 0
          );
          stage.dataset.levelDepth = Number(scene.levelDepth || 0).toFixed(2);
          stage.dataset.cameraDepth = Number(scene.cameraDepth || 0).toFixed(2);
          stage.dataset.bgmKey = this.audio.bgmTrack?.key || "";
          stage.dataset.bgmPlaying = String(
            Boolean(
              this.audio.bgmSessionActive &&
                this.audio.bgm &&
                !this.audio.bgm.paused
            )
          );
          stage.dataset.bgmTime = Number(
            this.audio.bgm?.currentTime || 0
          ).toFixed(3);
          stage.dataset.audioUnlocked = String(
            this.audio.wasUnlocked || false
          );
          const audioSnapshot = this.audio.snapshot();
          stage.dataset.audioContextState = audioSnapshot.context_state;
          stage.dataset.audioUnlockRequested = String(
            audioSnapshot.unlock_requested
          );
          stage.dataset.audioPendingKeys = JSON.stringify(
            audioSnapshot.pending_cue_keys
          );
          stage.dataset.audioPendingCount = String(
            audioSnapshot.pending_cue_count
          );
          stage.dataset.audioResumeError =
            audioSnapshot.latest_resume_error || "";
          stage.dataset.audioBgmLoadFailed = String(
            audioSnapshot.bgm.load_failed
          );
          stage.dataset.audioBgmPlayPending = String(
            audioSnapshot.bgm.play_pending
          );
          stage.dataset.audioBgmPaused = String(audioSnapshot.bgm.paused);
          stage.dataset.audioBgmPlayError =
            audioSnapshot.bgm.latest_play_error || "";
          stage.dataset.audioHistory = JSON.stringify(
            audioSnapshot.audio_play_history
          );
          stage.dataset.activeVictoryVoices = String(
            audioSnapshot.active_victory_voice_count
          );
          stage.dataset.activeVictoryKeys = JSON.stringify(
            audioSnapshot.active_victory_keys
          );
          stage.dataset.fallenBalls = scene.fallenBallIds.join(",");
          stage.dataset.balls = JSON.stringify(
            scene.balls.map((ball) => ({
              id: ball.id,
              color: ball.color,
              species: ball.species,
              captured: ball.captured,
              radius: ball.radius,
              visible: ball.visible,
              opacity: ball.opacity,
              insectScale: ball.insectScale,
              ballForm: ball.ballForm,
              protrudingFeatures: ball.protrudingFeatures,
              insectLegs: ball.insectLegs,
              insectAntennae: ball.insectAntennae,
              haloOpacity: ball.haloOpacity,
              trailStrength: ball.trailStrength,
              trailVisibleCount: ball.trailVisibleCount,
              ownerCount: ball.ownerCount,
              shellCount: ball.shellCount,
              rigCount: ball.rigCount,
              shadowCount: ball.shadowCount,
              castShadowMeshCount: ball.castShadowMeshCount,
              ghostCount: ball.ghostCount,
              x: ball.position?.x ?? null,
              y: ball.position?.y ?? null,
              z: ball.position?.z ?? null
            }))
          );
          stage.dataset.holes = JSON.stringify(scene.holes);
        }
      }
    }
    if (this.visibilityPaused) {
      this.frameRequestId = null;
    } else {
      this.frameRequestId = requestAnimationFrame(this.frame);
    }
  }

  debugClearLevel() {
    if (this.state === "LEVEL_INTRO") this.enterState("GAMEPLAY");
    if (this.state === "GAMEPLAY") this.completeLevel();
  }

  bindDebugPanel() {
    if (typeof globalThis.document?.getElementById !== "function") return;
    const toggle = document.getElementById("debug-panel-toggle");
    const panel = document.getElementById("debug-panel");
    if (!this.qaMode || !toggle || !panel) return;
    toggle.classList.remove("hidden");
    toggle.onclick = () => this.toggleDebugPanel(true);
    document.getElementById("debug-panel-close").onclick = () => this.toggleDebugPanel(false);
    panel.onclick = (event) => {
      const action = event.target?.dataset?.debugAction;
      if (!action) return;
      if (action === "level") {
        const value = Number(document.getElementById("debug-level-number")?.value || 1);
        this.debugLoadProceduralLevel(value - 1);
      } else if (action === "mechanism") {
        this.debugShowMechanism(document.getElementById("debug-mechanism")?.value);
      } else if (action === "capture") this.debugCaptureBall();
      else if (action === "fall") this.debugDropBall();
      else if (action === "next") this.debugClearLevel();
      else if (action === "hint") this.scene.showButterflyHint?.();
    };
  }

  toggleDebugPanel(force) {
    const panel = document.getElementById("debug-panel");
    const toggle = document.getElementById("debug-panel-toggle");
    if (!panel) return false;
    const open = force ?? panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !open);
    toggle?.setAttribute("aria-expanded", String(open));
    return open;
  }

  setDebugPanelStatus(text) {
    const status = document.getElementById("debug-panel-status");
    if (status) status.textContent = text;
  }

  debugLoadProceduralLevel(index, mode = ENDLESS_MODE) {
    const at = Math.max(0, Math.min(998, Number(index) | 0));
    if (!isProcedural(mode)) mode = ENDLESS_MODE;
    this.setMode(mode);
    if (!this.run?.levelAt || this.run.mode !== mode) this.planNewRun({ reseed: true });
    this.currentLevelIndex = at;
    this.levelsCleared = at;
    this.timeRemaining = isRogue(mode) ? Infinity : Math.max(60, this.timeRemaining || 0);
    this.accumulator = 0;
    this.loadCurrentLevel();
    this.enterState("GAMEPLAY");
    const level = this.levelAt(at);
    this.setDebugPanelStatus(`Level ${at + 1}: ${level.weatherName || level.weather} / ${level.archetype || "authored"}`);
    return level;
  }

  debugShowMechanism(kind) {
    const debugMode = isProcedural(this.mode) ? this.mode : ENDLESS_MODE;
    if (!this.run?.levelAt || this.run.mode !== debugMode) {
      this.setMode(debugMode);
      this.planNewRun({ reseed: true });
    }
    for (let index = 4; index < 160; index += 1) {
      const level = this.run.levelAt(index);
      const board = level.board || {};
      const found = kind === "spike"
        ? board.obstacles?.some((item) => item.kind === "spike")
        : kind === "ink"
          ? board.hazards?.some((item) => item.kind === "ink")
          : kind === "dew"
            ? board.collectibles?.some((item) => item.kind === "dew")
            : board.encounters?.some((item) => item.kind === kind);
      if (found) {
        this.debugLoadProceduralLevel(index, debugMode);
        this.setDebugPanelStatus(`${kind} loaded on level ${index + 1}`);
        return level;
      }
    }
    this.setDebugPanelStatus(`${kind} was not found in this seed`);
    return null;
  }

  debugGotoFinalLevel() {
    globalThis.clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.audio.stopAll();
    this.scene.gameCamera?.skip?.();
    this.scene.resetFallenBalls?.();
    this.scene.endLevelHandoff?.();
    this.ui.clearTimers?.();
    this.ui.hideToast?.();
    this.currentLevelIndex = TOTAL_LEVELS - 1;
    this.levelsCleared = TOTAL_LEVELS - 1;
    this.timeRemaining = 99;
    this.accumulator = 0;
    this.levelClear = null;
    this.fallenBallId = null;
    this.drops = 0;
    this.frozenCountdown = false;
    this.countdownStep = -1;
    this.connectionResumeContext = null;
    this.connectionReason = null;
    this.connectionSampleFloor = 0;
    this.offBoardElapsed = 0;
    this.resultCanContinue = false;
    this.resumeStateAfterModal = null;

    this.loadCurrentLevel();
    this.enterState("GAMEPLAY");
  }

  debugCompleteRun() {
    const activeStates = new Set([
      "LEVEL_INTRO",
      "GAMEPLAY",
      "BALL_FALL_DROP",
      "BALL_FALL_RESET",
      "LEVEL_CLEAR",
      "RUN_COMPLETE",
      "PAUSE_MENU"
    ]);
    if (!activeStates.has(this.state)) return false;

    globalThis.clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.scene.gameCamera?.skip?.();
    this.scene.resetFallenBalls?.();
    this.scene.endLevelHandoff?.();
    this.ui.clearTimers?.();
    this.ui.hideToast?.();
    this.currentLevelIndex = TOTAL_LEVELS - 1;
    this.levelsCleared = TOTAL_LEVELS - 1;
    this.accumulator = 0;
    this.levelClear = null;
    this.fallenBallId = null;
    this.frozenCountdown = false;
    this.countdownStep = -1;
    this.connectionResumeContext = null;
    this.resumeStateAfterModal = null;
    this.loadCurrentLevel();
    this.enterState("GAMEPLAY");
    this.completeLevel();
    return this.state === "LEVEL_CLEAR";
  }

  debugDropBall() {
    if (!this.qaMode || this.state !== "GAMEPLAY") return;
    const ball = this.scene.balls.find((item) => !item.captured);
    if (!ball) return;
    ball.body.position.x = 4.45;
    ball.body.position.y = ball.spawn.y;
    ball.body.velocity.set(0.6, 0, 0);
    this.handleSceneEvent({ type: "ballFell", ballId: ball.id });
  }

  debugCaptureBall() {
    if (!this.qaMode || this.state !== "GAMEPLAY") return;
    const ball = this.scene.balls.find((item) => !item.captured);
    const hole = this.scene.holes.find(
      (item) =>
        !this.scene.balls.some((candidate) => candidate.captureHoleId === item.id)
    );
    if (!ball || !hole) return;
    this.scene.captureBall(ball, hole);
  }

  debugResetBest(mode = this.mode) {
    if (!this.qaMode) return;
    try {
      globalThis.localStorage?.removeItem(this.bestKey(mode));
    } catch {}
    this.ensurePersonalBestState();
    this.sessionBests[mode] = 0;
    delete this.deviceBestCache[mode];
  }

  async debugAudioTour() {
    if (!this.qaMode || this.audioQaRunning) return;
    this.audioQaRunning = true;
    this.audioQaComplete = false;
    this.audioQaError = "";
    this.audioQaFlowEvidence = {};
    const stage = document.querySelector("#stage");
    if (stage) stage.dataset.audioQa = "running";
    const mark = (flow, state = this.state) => {
      this.audioQaFlowEvidence[flow] = {
        state,
        timestamp_ms: Math.round(performance.now() * 1000) / 1000
      };
    };
    const settle = () => new Promise((resolve) => window.setTimeout(resolve, 45));

    try {
      this.audio.unlock();
      await this.audio.preloadAll();
      const auditedAudioFiles = await this.audio.auditAllFiles();

      this.enterState("MODE_SELECT");
      this.setMode(this.mode === "beginner" ? "advanced" : "beginner");
      mark("mode-select");
      await settle();

      this.beginConnectionRequired("DEBUG_FORCED_DISCONNECT", {
        resumeState: "TEACH_IN",
        sample: this.input.sample(0)
      });
      mark("connection-required");
      this.connectionSampleFloor = -1;
      this.resumeFromConnection();
      await settle();

      this.enterState("TEACH_IN");
      mark("teach-in", "TEACH_IN guided How to Play");
      await settle();

      this.enterState("LEVEL_INTRO");
      const beat = this.animationMs(UI_TIMING.countdownBeatMs);
      const lead = this.animationMs(UI_TIMING.countdownLeadInMs);
      for (const elapsed of [lead, lead + beat, lead + beat * 2, lead + beat * 3]) {
        this.stateElapsed = elapsed + 0.001;
        this.tickCountdown();
        await settle();
      }
      mark("countdown", "LEVEL_INTRO 3-2-1-GO");

      this.enterState("GAMEPLAY");
      this.handleSceneEvent({ type: "collision", intensity: 0.72 });
      mark("gameplay-collision");
      await settle();

      this.handleSceneEvent({
        type: "ballCaptured",
        ballId: "audio-qa-ball",
        holeId: "audio-qa-hole"
      });
      mark("ball-capture");
      await settle();

      this.handleSceneEvent({ type: "ballFell", ballId: "audio-qa-ball" });
      mark("ball-fall", "BALL_FALL_DROP");
      await settle();

      this.scene.resetFallenBalls();
      this.fallenBallId = null;
      this.enterState("GAMEPLAY");
      this.completeLevel();
      mark("level-clear", "LEVEL_CLEAR");
      await settle();

      this.enterState("GAMEPLAY");
      this.pause();
      await settle();
      this.resume();
      mark("pause-resume", "PAUSE_MENU -> GAMEPLAY");
      await settle();

      this.currentLevelIndex = TOTAL_LEVELS - 1;
      this.enterState("LEVEL_CLEAR", {
        startTime: this.timeRemaining,
        targetTime: this.timeRemaining
      });
      await settle();

      this.levelsCleared = TOTAL_LEVELS;
      this.finishRun(scoreRun(TOTAL_LEVELS, 24.8));
      mark("finish-crowd", "RESULT_CALC entry");
      mark("well-done", "RESULT_CALC entry");
      this.resultBeat("count");
      this.resultBeat("star");
      mark("result", "RESULT_CALC count and rank reveal");
      await settle();

      const audioSnapshot = this.audio.snapshot();
      let report = document.querySelector("#audio-qa-report");
      if (!report) {
        report = document.createElement("script");
        report.id = "audio-qa-report";
        report.type = "application/json";
        document.body.append(report);
      }
      report.textContent = JSON.stringify({
        page_url: location.href,
        capture_method: "QA-only controller tour captured from GameAudio.snapshot()",
        requested_audio_files: auditedAudioFiles,
        javascript_errors: [],
        flow_evidence: this.audioQaFlowEvidence,
        audio_play_history: audioSnapshot.audio_play_history,
        loop_history: audioSnapshot.loop_history,
        bgm_ramp_ms: audioSnapshot.ramp_ms
      });
      this.audioQaComplete = true;
      if (stage) stage.dataset.audioQa = "complete";
      console.log("[AUDIO QA] complete");
    } catch (error) {
      this.audioQaError = error instanceof Error ? error.message : String(error);
      if (stage) stage.dataset.audioQa = "error";
      console.error("[AUDIO QA] failed", error);
    } finally {
      this.audioQaRunning = false;
    }
  }

  debugGoto(screen, options = {}) {
    if (options.mode) {
      this.mode = options.mode;
      this.audio.setMode(options.mode);
    }
    if (["MODE_SELECT", "CONNECTION_REQUIRED"].includes(screen)) {
      if (screen === "CONNECTION_REQUIRED") {
        this.beginConnectionRequired(
          options.reason || "DEBUG_FORCED_DISCONNECT",
          {
            resumeState: options.resumeState || "GAMEPLAY",
            sample: this.input.sample(0)
          }
        );
        return;
      }
      this.enterState(screen);
      return;
    }
    if (screen === "TEACH_IN") {
      this.enterState("TEACH_IN");
      return;
    }
    if (screen === "GAMEPLAY" || screen === "LEVEL_INTRO") {
      this.currentLevelIndex = Math.max(0, Math.min(TOTAL_LEVELS - 1, (options.level || 1) - 1));
      this.timeRemaining = options.time ?? 60;
      this.levelsCleared = options.cleared ?? this.currentLevelIndex;
      this.loadCurrentLevel();
      this.enterState(screen);
      if (screen === "LEVEL_INTRO" && options.beat != null) {
        const labels = ["3", "2", "1", "GO"];
        this.frozenCountdown = true;
        this.ui.holdCountdown(labels[Math.min(3, Math.max(0, options.beat))]);
      }
      return;
    }
    if (screen === "PAUSE_MENU" || screen === "CONFIRM_QUIT") {
      this.enterState(screen);
      return;
    }
    if (screen === "CONTEXT_LOST") {
      this.enterState("CONTEXT_LOST");
      return;
    }
    if (screen === "HOW_TO_PLAY") {
      this.openHowTo(options.from || "MODE_SELECT");
      return;
    }
    if (screen === "ENDING") {
      this.levelsCleared = options.cleared ?? TOTAL_LEVELS;
      this.timeRemaining = options.time ?? 0;
      this.drops = options.drops ?? this.drops;
      this.score = scoreRun(this.levelsCleared, this.timeRemaining);
      this.enterState("ENDING");
      return;
    }
    /* 预览入口：?screen=GLOBAL_RANK[&cleared=6&time=42]
       直接摆好一局的分数跳到全球榜，不用真打一局。 */
    if (screen === "GLOBAL_RANK") {
      this.levelsCleared = options.cleared ?? 6;
      this.timeRemaining = options.time ?? 41.6;
      this.drops = options.drops ?? this.drops;
      this.score = scoreRun(this.levelsCleared, this.timeRemaining);
      /* 走真实的最佳记账，两种分支才都能预览到：第一次按 R 是新纪录，
         再按一次同样的分就变成「没破纪录」那条。 */
      this.recordPersonalBests(this.score.totalPoints, this.mode);
      this.enterState("GLOBAL_RANK");
      return;
    }
    if (screen === "RESULT_CALC") {
      this.levelsCleared = options.cleared ?? TOTAL_LEVELS;
      /* 掉落数决定 3★ 与 4★ 的分界（scoreStars：全清且零掉落才是 4★），
         不接这个参数就永远只能预览到 4★ 那一档。ENDING / GLOBAL_RANK 两个
         分支本来就接，这里漏了。 */
      this.drops = options.drops ?? this.drops;
      this.timeRemaining = options.time ?? (this.mode === "advanced" ? 22.4 : 63.9);
      this.finishRun(scoreRun(this.levelsCleared, this.timeRemaining));
      /* 跳过揭晓动画到最终态（截图 / 验收用） */
      if (options.settled) {
        this.ui.clearTimers();
        const board = document.getElementById("result-board");
        board?.classList.remove("hidden");
        document.querySelectorAll(".rboard .reveal").forEach((element) =>
          element.classList.add("shown")
        );
        document.querySelectorAll("#result-stars .st").forEach((star) =>
          star.classList.add("pop")
        );
        const total = document.getElementById("result-total");
        if (total) total.textContent = String(this.score.totalPoints);
        document.getElementById("result-next")?.classList.remove("hidden");
        this.resultCanContinue = true;
      }
    }
  }

  snapshot() {
    return {
      state: this.state,
      mode: this.mode,
      level: this.currentLevelIndex + 1,
      timeRemaining: this.timeRemaining,
      levelsCleared: this.levelsCleared,
      score: this.score,
      personalBests: {
        ...this.lastPersonalBests,
        mode: this.mode,
        session: this.sessionBest(),
        device: this.personalBest()
      },
      performance: { fps: this.fps, maxFrameMs: this.maxFrameMs },
      audioQa: {
        running: this.audioQaRunning,
        complete: this.audioQaComplete,
        error: this.audioQaError,
        flowEvidence: { ...this.audioQaFlowEvidence }
      },
      input: this.input.snapshot(),
      scene: this.scene.snapshot()
    };
  }

  beginDestroy() {
    if (this.destroyed) return false;
    this.destroyed = true;
    if (this.frameRequestId !== null) {
      cancelAnimationFrame(this.frameRequestId);
      this.frameRequestId = null;
    }
    window.clearTimeout(this.toastTimer);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("pageshow", this.onPageShow);
    document.removeEventListener("visibilitychange", this.onVisibility);
    return true;
  }

  async stopInputForDestroy() {
    await this.input.destroy();
  }

  finishDestroy() {
    this.ui.destroy?.();
    this.scene.destroy();
    this.audio.destroy();
  }

  async destroy() {
    if (!this.beginDestroy()) return;
    await this.stopInputForDestroy();
    this.finishDestroy();
  }
}
