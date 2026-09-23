const MAX_PLAY_HISTORY = 240;
const MAX_REQUEST_HISTORY = 32;
export const BGM_RAMP_MS = Object.freeze({
  start: 480,
  resume: 220,
  stop: 900
});
/* ENDING（签语）仍然有局内 BGM，但结算板必须保持安静。
 *
 * 收束这一段的听感是照 dunesong 的 oracle 排的：最后一关清掉时 BGM 音量
 * 立即归零，但媒体元素保持播放以维持 iOS 音频会话；胜利音效落在干净的静默上。
 * RUN_COMPLETE 那半拍继续静着；两层胜利音效结束后，同一条 BGM 时间线淡入，
 * 一路带到签纸消散。结算板本身不播放普通 BGM，只保留计数和揭晓音效。
 * 所以 RUN_COMPLETE 不在这个集合里：那半拍的静默是留给胜利音效的。
 *
 * 局内静音那一半没有照搬（dunesong 跑起来时是没有 BGM 的）。那是全局听感的
 * 改动，不在这次范围里；真要完全对齐，把 "GAMEPLAY" 和它前后几个从这里删掉
 * 就是了。 */
const BGM_ACTIVE_PHASES = new Set([
  "TEACH_IN",
  "LEVEL_INTRO",
  "GAMEPLAY",
  "BALL_FALL_DROP",
  "BALL_FALL_RESET",
  "LEVEL_CLEAR",
  "ENDING"
]);
const BGM_SILENT_PHASES = new Set(["RESULT_CALC", "GLOBAL_RANK"]);
const BGM_PAUSE_PHASES = new Set([
  "PAUSE_MENU",
  "HOW_TO_PLAY",
  "CONFIRM_QUIT",
  "CONTEXT_LOST"
]);
// Victory belongs to the visible score reveal, not the final clear or ending.
const VICTORY_CUE_PHASES = Object.freeze(["RESULT_CALC"]);
const ENDING_CUE_PHASES = Object.freeze(["ENDING"]);
/* 全球榜（K6）接在结算板后面，同一批计分音要能跨过去——
   少了 GLOBAL_RANK 的话 result-count / result-rank 会被当成过期 cue 丢掉，
   那一屏就是哑的。 */
const RESULT_CUE_PHASES = Object.freeze(["RESULT_CALC", "GLOBAL_RANK"]);

export const BGM_TRACKS = Object.freeze({
  beginner: Object.freeze({
    key: "bgm-balance-beam",
    url: "./audio/bgm/balance-beam-loop.ogg",
    cacheVersion: "b163059c",
    volume: 0.14,
    playbackRate: 1,
    decision: "replace"
  }),
  advanced: Object.freeze({
    key: "bgm-precision-puzzle",
    url: "./audio/bgm/precision-puzzle-loop.ogg",
    cacheVersion: "71ffc52d",
    volume: 0.14,
    playbackRate: 1,
    decision: "replace"
  }),
  endless: Object.freeze({
    key: "bgm-endless-moss-descent",
    url: "./audio/bgm/endless-moss-descent-loop.ogg",
    cacheVersion: "c1b4ce1d",
    volume: 0.14,
    playbackRate: 1,
    decision: "replace"
  }),
  rogue: Object.freeze({
    key: "bgm-endless-moss-descent",
    url: "./audio/bgm/endless-moss-descent-loop.ogg",
    cacheVersion: "c1b4ce1d",
    volume: 0.14,
    playbackRate: 1,
    decision: "replace"
  })
});
export const BGM_TRACK = BGM_TRACKS.beginner;

export const SFX_DEFINITIONS = Object.freeze({
  "ui-move": {
    url: "./audio/sfx/ui-move.ogg",
    cacheVersion: "1cf8588f",
    volume: 0.2,
    decision: "replace",
    maxVoices: 3
  },
  "ui-confirm": {
    url: "./audio/sfx/ui-confirm.ogg",
    cacheVersion: "33b17a9a",
    volume: 0.3,
    decision: "replace",
    maxVoices: 3
  },
  /* core-luge 的正典 START 音，逐字节相同（正典第 4 条：没有的加）。
     它跟 ui-confirm 是两个音——ui-confirm 是通用确认，这个只属于开局那一下。
     level 0.22 / 单声部 / replace，绑在按钮的 action handler 上，
     激活瞬间响，不是按下就响。 */
  "ui-start": {
    url: "./audio/sfx/ui-start.wav",
    cacheVersion: "1a3589f2",
    volume: 0.22,
    decision: "replace",
    maxVoices: 1
  },
  "countdown-beat": {
    url: "./audio/sfx/dune-countdown-tick.wav",
    cacheVersion: "9cc05b7a",
    volume: 0.3,
    decision: "replace",
    maxVoices: 2
  },
  "countdown-go": {
    url: "./audio/sfx/dune-countdown-go.wav",
    cacheVersion: "a62c9dc8",
    volume: 0.34,
    decision: "replace",
    maxVoices: 2
  },
  "ball-impact": {
    url: "./audio/sfx/ball-impact.ogg",
    cacheVersion: "6e797cf8",
    volume: 0.18,
    decision: "replace",
    maxVoices: 8
  },
  "ball-capture": {
    url: "./audio/sfx/ball-capture.ogg",
    cacheVersion: "d21d0f0b",
    volume: 0.26,
    decision: "layer",
    maxVoices: 4
  },
  "ball-fall": {
    url: "./audio/sfx/ball-fall.ogg",
    cacheVersion: "0b574cea",
    volume: 0.32,
    decision: "replace",
    maxVoices: 2
  },
  "ending-paper-bonk": {
    url: "./audio/sfx/ending-paper-bonk.ogg",
    cacheVersion: "90cb364b",
    volume: 0.55,
    decision: "replace",
    maxVoices: 1
  },
  "ending-paper-crumple": {
    url: "./audio/sfx/ending-paper-crumple.ogg",
    cacheVersion: "d1819b47",
    volume: 0.82,
    decision: "add",
    maxVoices: 1
  },
  "ending-fortune-appear": {
    url: "./audio/sfx/ending-fortune-appear.ogg",
    cacheVersion: "9d4ffc50",
    volume: 0.42,
    decision: "add",
    maxVoices: 1
  },
  "ending-fortune-vanish": {
    url: "./audio/sfx/ending-fortune-vanish.ogg",
    cacheVersion: "bc94bdda",
    volume: 0.42,
    decision: "add",
    maxVoices: 1
  },
  "level-clear": {
    url: "./audio/sfx/level-clear.ogg",
    cacheVersion: "6f952e25",
    volume: 0.4,
    decision: "replace",
    maxVoices: 2,
    fadeOutMs: 70
  },
  "finish-crowd": {
    url: "./audio/sfx/finish-crowd.mp3",
    cacheVersion: "50fa4e07",
    volume: 0.72,
    decision: "replace",
    maxVoices: 1
  },
  "well-done": {
    url: "./audio/sfx/well_done.wav",
    cacheVersion: "df8b96bc",
    volume: 1,
    decision: "replace",
    maxVoices: 1
  },
  "result-count": {
    url: "./audio/sfx/result-count.ogg",
    cacheVersion: "869442f5",
    volume: 0.14,
    decision: "replace",
    maxVoices: 6
  },
  "result-rank": {
    url: "./audio/sfx/result-rank.ogg",
    cacheVersion: "57c074e6",
    volume: 0.24,
    decision: "replace",
    maxVoices: 4
  }
});

function timestampMs() {
  if (typeof performance !== "undefined" && performance.now) {
    return Math.round(performance.now() * 1000) / 1000;
  }
  return Date.now();
}

function audioRequestUrl(definition) {
  if (!definition.cacheVersion || definition.url.startsWith("data:")) {
    return definition.url;
  }
  const separator = definition.url.includes("?") ? "&" : "?";
  return `${definition.url}${separator}v=${definition.cacheVersion}`;
}

export class GameAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.sfxVolume = 1;
    this.phase = "BOOT";
    this.lastHitAt = -Infinity;
    this.maxVoices = 24;
    this.voices = [];
    this.buffers = new Map();
    this.loading = new Map();
    this.requestRecords = new Map();
    this.playHistory = [];
    this.loopHistory = [];
    this.unlockRequested = false;
    this.wasUnlocked = false;
    this.unlockPromise = null;
    this.latestResumeError = "";
    this.pendingCues = new Map();
    this.pendingCueTimer = null;
    this.pendingCueGeneration = 0;
    this.destroyed = false;
    this.bgmTrack = BGM_TRACKS.beginner;
    this.bgm = null;
    this.bgmErrorHandler = null;
    this.bgmLoadFailed = false;
    this.bgmFailed = false;
    this.latestBgmPlayError = "";
    this.bgmPlayPromise = null;
    this.bgmSessionActive = false;
    this.bgmStartedAt = null;
    this.bgmFadeTimer = null;
    this.bgmPausedByVisibility = false;
    this.victoryBgmHold = false;
  }

  setPhase(phase) {
    this.phase = phase || "UNKNOWN";
    this.discardInvalidPendingCues();
    this.syncBgm();
    this.flushPendingCues();
  }

  unlock() {
    if (this.destroyed) return Promise.resolve(false);
    this.unlockRequested = true;
    this.ensureBgm();
    if (!this.context && typeof window !== "undefined") {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        try {
          this.context = new AudioContext();
          this.master = this.context.createGain();
          this.master.gain.value = 0.82;
          this.master.connect(this.context.destination);
        } catch (error) {
          this.latestResumeError =
            error instanceof Error ? error.message : String(error);
        }
      }
    }

    if (!this.context) {
      this.wasUnlocked = false;
      this.syncBgm();
      return Promise.resolve(false);
    }

    this.preloadAll();
    if (this.unlockPromise) return this.unlockPromise;

    const attempt = async () => {
      try {
        if (
          ["suspended", "interrupted"].includes(this.context?.state) &&
          typeof this.context.resume === "function"
        ) {
          await this.context.resume();
        }
      } catch (error) {
        this.latestResumeError =
          error instanceof Error ? error.message : String(error);
      }

      const ready =
        Boolean(this.context) &&
        (this.context.state === "running" ||
          typeof this.context.state === "undefined");
      this.wasUnlocked = ready;
      if (ready) this.latestResumeError = "";
      this.syncBgm();
      return ready;
    };

    this.unlockPromise = attempt()
      .then((ready) => {
        if (ready) this.flushPendingCues();
        return ready;
      })
      .finally(() => {
        this.unlockPromise = null;
      });
    return this.unlockPromise;
  }

  setSfxVolume(value) {
    this.sfxVolume = Math.max(0, Math.min(1, Number(value) || 0));
  }

  setMode(mode) {
    const nextTrack = BGM_TRACKS[mode] || BGM_TRACKS.beginner;
    if (this.bgmTrack.key === nextTrack.key) return;
    const shouldRestart = this.bgmSessionActive;
    this.stopBgm({ fadeMs: 0 });
    this.releaseBgmErrorListener();
    this.bgm = null;
    this.bgmLoadFailed = false;
    this.bgmFailed = false;
    this.latestBgmPlayError = "";
    this.bgmTrack = nextTrack;
    if (shouldRestart) this.syncBgm();
  }

  ensureBgm() {
    if (this.bgm || typeof Audio === "undefined") return this.bgm;
    const audio = new Audio(audioRequestUrl(this.bgmTrack));
    audio.preload = "auto";
    audio.loop = true;
    audio.volume = 0;
    audio.playbackRate = this.bgmTrack.playbackRate;
    audio.preservesPitch = true;
    this.bgmErrorHandler = () => {
      this.bgmLoadFailed = true;
      this.bgmFailed = true;
    };
    audio.addEventListener("error", this.bgmErrorHandler, { once: true });
    audio.load();
    this.bgm = audio;
    return audio;
  }

  releaseBgmErrorListener() {
    if (this.bgm && this.bgmErrorHandler) {
      this.bgm.removeEventListener("error", this.bgmErrorHandler);
    }
    this.bgmErrorHandler = null;
  }

  releaseBgmMedia() {
    const bgm = this.bgm;
    this.releaseBgmErrorListener();
    this.bgm = null;
    this.bgmPlayPromise = null;
    if (!bgm) return;
    try {
      if (bgm.paused !== true) bgm.pause();
      bgm.currentTime = 0;
    } catch {
      // The media element may already be detached by the browser.
    }
    try {
      if (typeof bgm.removeAttribute === "function") {
        bgm.removeAttribute("src");
      } else {
        bgm.src = "";
      }
      bgm.load?.();
    } catch {
      // Source release is best-effort during final page teardown.
    }
  }

  clearBgmFade() {
    if (this.bgmFadeTimer !== null) {
      clearTimeout(this.bgmFadeTimer);
      this.bgmFadeTimer = null;
    }
  }

  rampBgm(target, durationMs = 280, onComplete = null) {
    if (!this.bgm) return;
    this.clearBgmFade();
    const startVolume = this.bgm.volume;
    const startedAt = timestampMs();
    const duration = Math.max(0, durationMs);
    const tick = () => {
      if (!this.bgm) return;
      const progress =
        duration === 0
          ? 1
          : Math.min(1, (timestampMs() - startedAt) / duration);
      this.bgm.volume = startVolume + (target - startVolume) * progress;
      if (progress >= 1) {
        this.bgmFadeTimer = null;
        onComplete?.();
        return;
      }
      this.bgmFadeTimer = setTimeout(tick, 32);
    };
    tick();
  }

  recordBgmPlayError(error) {
    this.latestBgmPlayError =
      error instanceof Error ? error.message : String(error);
  }

  startBgm() {
    const audio = this.ensureBgm();
    if (
      !audio ||
      this.bgmLoadFailed ||
      !this.wasUnlocked ||
      this.bgmPausedByVisibility ||
      !BGM_ACTIVE_PHASES.has(this.phase)
    ) {
      return this.bgmPlayPromise;
    }
    if (this.bgmPlayPromise) return this.bgmPlayPromise;
    if (this.bgmSessionActive && audio.paused === false) {
      this.latestBgmPlayError = "";
      if (!this.victoryBgmHold && audio.volume !== this.bgmTrack.volume) {
        this.rampBgm(this.bgmTrack.volume, BGM_RAMP_MS.resume);
      }
      return Promise.resolve(true);
    }

    const resuming = this.bgmSessionActive;
    if (!resuming) {
      this.bgmSessionActive = true;
      this.bgmStartedAt = timestampMs();
      audio.volume = 0;
    }

    let playResult;
    try {
      playResult = audio.play();
    } catch (error) {
      this.recordBgmPlayError(error);
      if (!resuming) {
        this.bgmSessionActive = false;
        this.bgmStartedAt = null;
      }
      return Promise.resolve(false);
    }

    const attempt = Promise.resolve(playResult)
      .then(() => {
        if (
          this.destroyed ||
          this.bgm !== audio ||
          this.bgmPausedByVisibility ||
          this.victoryBgmHold ||
          !BGM_ACTIVE_PHASES.has(this.phase)
        ) {
          audio.pause();
          return false;
        }
        this.latestBgmPlayError = "";
        if (!resuming) {
          this.recordPlay(this.bgmTrack.key, "sample", false);
        }
        this.rampBgm(
          this.bgmTrack.volume,
          resuming ? BGM_RAMP_MS.resume : BGM_RAMP_MS.start
        );
        return true;
      })
      .catch((error) => {
        if (this.destroyed || this.bgm !== audio) return false;
        this.recordBgmPlayError(error);
        if (!resuming) {
          this.bgmSessionActive = false;
          this.bgmStartedAt = null;
        }
        return false;
      });
    let trackedPromise;
    trackedPromise = attempt.finally(() => {
      if (this.bgmPlayPromise === trackedPromise) {
        this.bgmPlayPromise = null;
      }
    });
    this.bgmPlayPromise = trackedPromise;
    return trackedPromise;
  }

  async prepareExternalInput(modeKey = null) {
    if (modeKey) this.setMode(modeKey);
    const ready = await this.unlock();
    if (!ready) return false;
    if (this.bgmPlayPromise) await this.bgmPlayPromise;
    await this.startBgm();
    return true;
  }

  pauseBgm() {
    if (!this.bgm || !this.bgmSessionActive) return;
    this.clearBgmFade();
    this.bgm.pause();
  }

  stopBgm({ fadeMs = BGM_RAMP_MS.stop, reset = true } = {}) {
    if (!this.bgm) return;
    const finalize = () => {
      if (!this.bgm) return;
      this.bgm.pause();
      if (reset) this.bgm.currentTime = 0;
      if (this.bgmSessionActive && this.bgmStartedAt !== null) {
        const stoppedAt = timestampMs();
        const durationMs =
          (Number(this.bgm.duration) || 0) * 1000 /
          Math.max(0.01, this.bgmTrack.playbackRate);
        this.loopHistory.push({
          key: this.bgmTrack.key,
          start_timestamp_ms: Math.round(this.bgmStartedAt),
          stop_timestamp_ms: Math.round(stoppedAt),
          loop_duration_ms: Math.round(durationMs),
          completed_cycles:
            durationMs > 0
              ? Math.floor((stoppedAt - this.bgmStartedAt) / durationMs)
              : 0,
          source: "audio-manager",
          implementation: "sample"
        });
        if (this.loopHistory.length > MAX_PLAY_HISTORY) {
          this.loopHistory.splice(
            0,
            this.loopHistory.length - MAX_PLAY_HISTORY
          );
        }
      }
      this.bgmSessionActive = false;
      this.bgmStartedAt = null;
      this.bgm.volume = 0;
    };
    if (!this.bgmSessionActive || fadeMs <= 0) {
      this.clearBgmFade();
      finalize();
      return;
    }
    this.rampBgm(0, fadeMs, finalize);
  }

  syncBgm() {
    if (this.victoryBgmHold) {
      if (this.bgm && this.bgmSessionActive) {
        this.clearBgmFade();
        this.bgm.volume = 0;
      }
      return;
    }
    if (BGM_SILENT_PHASES.has(this.phase)) {
      if (this.bgmSessionActive) this.stopBgm({ fadeMs: 0 });
      return;
    }
    if (BGM_ACTIVE_PHASES.has(this.phase)) {
      this.startBgm();
    } else if (BGM_PAUSE_PHASES.has(this.phase) && this.bgmSessionActive) {
      this.pauseBgm();
    } else if (this.bgmSessionActive) {
      this.stopBgm();
    }
  }

  preloadAll() {
    if (!this.context || this.destroyed) return Promise.resolve([]);
    return Promise.allSettled(
      Object.keys(SFX_DEFINITIONS).map((key) => this.loadBuffer(key))
    );
  }

  async auditAllFiles() {
    if (!this.context) {
      throw new Error("AudioContext unavailable for the audio audit");
    }
    await this.preloadAll();
    const records = [...this.requestRecords.values()].map((record) => ({
      ...record
    }));
    for (const track of Object.values(BGM_TRACKS)) {
      const response = await fetch(audioRequestUrl(track), { cache: "no-cache" });
      const bytes = await response.arrayBuffer();
      await this.context.decodeAudioData(bytes.slice(0));
      records.push({
        key: track.key,
        url: response.url,
        status: response.status,
        ok: response.ok,
        decoded: true,
        content_type:
          response.headers.get("content-type") || "application/octet-stream"
      });
    }
    return records;
  }

  async loadBuffer(key) {
    if (this.buffers.has(key)) return this.buffers.get(key);
    if (this.loading.has(key)) return this.loading.get(key);
    const definition = SFX_DEFINITIONS[key];
    if (!definition || !this.context || typeof fetch !== "function") return null;

    const promise = (async () => {
      let response = null;
      const requestUrl = audioRequestUrl(definition);
      try {
        response = await fetch(requestUrl, { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        const buffer = await this.context.decodeAudioData(bytes.slice(0));
        this.buffers.set(key, buffer);
        this.recordRequest(key, {
          url: response.url,
          status: response.status,
          ok: true,
          decoded: true,
          content_type:
            response.headers.get("content-type") || "application/octet-stream"
        });
        return buffer;
      } catch (error) {
        this.recordRequest(key, {
          url: response?.url || new URL(requestUrl, location.href).href,
          status: response?.status || 0,
          ok: false,
          decoded: false,
          content_type:
            response?.headers.get("content-type") || "application/octet-stream",
          error: error instanceof Error ? error.message : String(error)
        });
        return null;
      } finally {
        this.loading.delete(key);
      }
    })();
    this.loading.set(key, promise);
    return promise;
  }

  recordRequest(key, record) {
    this.requestRecords.set(key, { key, ...record });
    while (this.requestRecords.size > MAX_REQUEST_HISTORY) {
      const oldestKey = this.requestRecords.keys().next().value;
      this.requestRecords.delete(oldestKey);
    }
  }

  recordPlay(key, implementation, fallback, delay = 0) {
    const definition =
      SFX_DEFINITIONS[key] || (key === this.bgmTrack.key ? this.bgmTrack : null);
    if (!definition) return;
    this.playHistory.push({
      key,
      timestamp_ms: timestampMs(),
      phase: this.phase,
      source: "audio-manager",
      implementation,
      decision: definition.decision,
      fallback,
      scheduled_delay_ms: Math.round(Math.max(0, delay) * 1000)
    });
    if (this.playHistory.length > MAX_PLAY_HISTORY) {
      this.playHistory.splice(0, this.playHistory.length - MAX_PLAY_HISTORY);
    }
  }

  isContextRunning() {
    return Boolean(
      this.context &&
        this.master &&
        (this.context.state === "running" ||
          typeof this.context.state === "undefined")
    );
  }

  pendingCueIsValid(entry) {
    return (
      !entry.validPhases ||
      entry.validPhases.size === 0 ||
      entry.validPhases.has(this.phase)
    );
  }

  clearPendingCueTimer() {
    if (this.pendingCueTimer !== null) {
      clearTimeout(this.pendingCueTimer);
      this.pendingCueTimer = null;
    }
  }

  schedulePendingCueFlush() {
    this.clearPendingCueTimer();
    if (this.destroyed || this.pendingCues.size === 0) return;

    const now = timestampMs();
    let nextAt = Infinity;
    for (const entry of this.pendingCues.values()) {
      const playbackReady =
        !this.bgmPausedByVisibility &&
        this.isContextRunning();
      if (entry.deferExpiryWhileBlocked && !playbackReady) continue;
      const readyToSchedule = playbackReady && this.buffers.has(entry.key);
      nextAt = Math.min(
        nextAt,
        readyToSchedule && entry.targetAtMs > now
          ? entry.targetAtMs
          : entry.expiresAtMs
      );
    }
    if (!Number.isFinite(nextAt)) return;
    this.pendingCueTimer = setTimeout(() => {
      this.pendingCueTimer = null;
      this.flushPendingCues();
    }, Math.max(0, nextAt - now));
  }

  queueCue(
    key,
    sampleOptions,
    {
      maxWaitMs,
      validPhases = [],
      coalesce = true,
      deferExpiryWhileBlocked = false
    } = {}
  ) {
    if (this.destroyed || !SFX_DEFINITIONS[key]) return false;
    const now = timestampMs();
    const delayMs = Math.max(0, Number(sampleOptions.delay) || 0) * 1000;
    const existing = this.pendingCues.get(key);
    if (existing && !coalesce) return false;

    const generation = ++this.pendingCueGeneration;
    this.pendingCues.set(key, {
      key,
      generation,
      sampleOptions: { ...sampleOptions, delay: 0 },
      validPhases: new Set(validPhases),
      requestedAtMs: now,
      targetAtMs: now + delayMs,
      expiresAtMs: now + Math.max(delayMs, Number(maxWaitMs) || 0),
      maxWaitMs: Math.max(delayMs, Number(maxWaitMs) || 0),
      deferExpiryWhileBlocked: Boolean(deferExpiryWhileBlocked),
      expiryDeferredAtMs: null
    });

    const unlockPromise = Promise.resolve(this.unlock());
    const loadPromise = Promise.resolve(this.loadBuffer(key));
    Promise.allSettled([unlockPromise, loadPromise]).then(() => {
      if (this.pendingCues.get(key)?.generation !== generation) return;
      this.flushPendingCues();
    });
    this.flushPendingCues();
    return true;
  }

  clearPendingCues({ group = null } = {}) {
    for (const [key, entry] of this.pendingCues) {
      if (group === null || entry.sampleOptions.group === group) {
        this.pendingCues.delete(key);
      }
    }
    this.schedulePendingCueFlush();
  }

  discardInvalidPendingCues() {
    for (const [key, entry] of this.pendingCues) {
      if (!this.pendingCueIsValid(entry)) this.pendingCues.delete(key);
    }
    this.schedulePendingCueFlush();
    this.releaseVictoryBgmIfFinished();
  }

  flushPendingCues() {
    if (this.destroyed) return;
    this.clearPendingCueTimer();
    const now = timestampMs();
    for (const [key, entry] of this.pendingCues) {
      if (!this.pendingCueIsValid(entry)) {
        this.pendingCues.delete(key);
        continue;
      }
      const playbackBlocked =
        this.bgmPausedByVisibility || !this.isContextRunning();
      if (entry.deferExpiryWhileBlocked && playbackBlocked) {
        if (entry.expiryDeferredAtMs === null) {
          entry.expiryDeferredAtMs = now;
        }
        continue;
      }
      if (
        entry.deferExpiryWhileBlocked &&
        entry.expiryDeferredAtMs !== null
      ) {
        const blockedFor = Math.max(0, now - entry.expiryDeferredAtMs);
        entry.targetAtMs += blockedFor;
        entry.expiresAtMs = now + entry.maxWaitMs;
        entry.expiryDeferredAtMs = null;
      }
      if (now >= entry.expiresAtMs) {
        this.pendingCues.delete(key);
        continue;
      }
      if (
        this.bgmPausedByVisibility ||
        now < entry.targetAtMs ||
        !this.isContextRunning() ||
        !this.buffers.has(key)
      ) {
        continue;
      }
      if (this.playSample(key, entry.sampleOptions)) {
        this.pendingCues.delete(key);
        this.recordPlay(key, "sample", false, 0);
      }
    }
    this.schedulePendingCueFlush();
    this.releaseVictoryBgmIfFinished();
  }

  tone({
    frequency = 440,
    endFrequency = frequency,
    duration = 0.12,
    type = "sine",
    gain = 0.2,
    delay = 0
  }) {
    void this.unlock();
    if (this.bgmPausedByVisibility || !this.isContextRunning()) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFrequency),
      now + duration
    );
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  trimVoices(key, perCueLimit) {
    const matching = this.voices.filter((voice) => voice.key === key);
    const voicesToStop = [];
    if (matching.length >= perCueLimit) {
      voicesToStop.push(matching[0]);
    }
    if (this.voices.length - voicesToStop.length >= this.maxVoices) {
      const oldest = this.voices.find((voice) => !voicesToStop.includes(voice));
      if (oldest) voicesToStop.push(oldest);
    }
    for (const voice of voicesToStop) {
      this.stopVoice(voice);
    }
  }

  playSample(
    key,
    {
      volume = 1,
      playbackRate = 1,
      delay = 0,
      loop = false,
      group = null,
      direct = false
    } = {}
  ) {
    void this.unlock();
    const definition = SFX_DEFINITIONS[key];
    const buffer = this.buffers.get(key);
    if (
      !definition ||
      !buffer ||
      this.bgmPausedByVisibility ||
      !this.isContextRunning()
    ) {
      this.loadBuffer(key);
      return false;
    }

    this.trimVoices(key, definition.maxVoices);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.75, Math.min(1.25, playbackRate));
    const baseGain = definition.volume * this.sfxVolume * volume;
    gain.gain.value = baseGain;
    source.loop = loop;
    source.connect(gain);
    gain.connect(direct ? this.context.destination : this.master);

    const scheduledDelay = Math.max(0, Number(delay) || 0);
    const voice = {
      key,
      source,
      gain,
      baseGain,
      group,
      startedAt: this.context.currentTime + scheduledDelay
    };
    const audibleDuration = Number(buffer.duration) / source.playbackRate.value;
    const fadeOutSeconds = Math.min(
      audibleDuration,
      Math.max(0, Number(definition.fadeOutMs) || 0) / 1000
    );
    if (!loop && Number.isFinite(audibleDuration) && fadeOutSeconds > 0) {
      const fadeEnd = voice.startedAt + audibleDuration;
      const fadeStart = fadeEnd - fadeOutSeconds;
      gain.gain.setValueAtTime(baseGain, voice.startedAt);
      gain.gain.setValueAtTime(baseGain, fadeStart);
      gain.gain.linearRampToValueAtTime(0.0001, fadeEnd);
    }
    this.voices.push(voice);
    source.onended = () => {
      const index = this.voices.indexOf(voice);
      if (index >= 0) this.voices.splice(index, 1);
      this.releaseVictoryBgmIfFinished();
    };
    source.start(voice.startedAt);
    return true;
  }

  playCue(
    key,
    {
      fallback,
      layer = false,
      volume,
      playbackRate,
      delay = 0,
      loop = false,
      group = null,
      direct = false,
      pending = null
    } = {}
  ) {
    const sampleOptions = {
      volume,
      playbackRate,
      delay,
      loop,
      group,
      direct
    };
    if (pending && delay > 0) {
      this.queueCue(key, sampleOptions, pending);
      return false;
    }
    const samplePlayed = this.playSample(key, {
      ...sampleOptions
    });
    if (samplePlayed) this.recordPlay(key, "sample", false, delay);

    if (layer) {
      fallback?.();
      this.recordPlay(key, "procedural", !samplePlayed, delay);
      return samplePlayed;
    }

    if (!samplePlayed) {
      if (pending) {
        this.queueCue(key, sampleOptions, pending);
        return false;
      }
      fallback?.();
      this.recordPlay(key, "procedural", true, delay);
    }
    return samplePlayed;
  }

  move() {
    this.playCue("ui-move", {
      fallback: () =>
        this.tone({
          frequency: 380,
          endFrequency: 430,
          duration: 0.07,
          gain: 0.11
        })
    });
  }

  /* 开局那一下。Replay 走同一个音。 */
  start() {
    this.playCue("ui-start", {
      fallback: () => this.confirm()
    });
  }

  confirm() {
    this.playCue("ui-confirm", {
      fallback: () =>
        this.tone({
          frequency: 520,
          endFrequency: 720,
          duration: 0.11,
          gain: 0.16
        })
    });
  }

  countdownBeat() {
    this.playCue("countdown-beat", {
      fallback: () =>
        this.tone({
          frequency: 430,
          endFrequency: 430,
          duration: 0.055,
          gain: 0.11
        })
    });
  }

  countdownGo() {
    this.playCue("countdown-go", {
      fallback: () =>
        this.tone({
          frequency: 560,
          endFrequency: 820,
          duration: 0.15,
          gain: 0.16
        })
    });
  }

  hit(intensity = 0.5) {
    const now = timestampMs();
    if (now - this.lastHitAt < 60) return;
    this.lastHitAt = now;
    const clamped = Math.max(0, Math.min(1, intensity));
    this.playCue("ball-impact", {
      volume: 0.65 + clamped * 0.55,
      playbackRate: 0.9 + clamped * 0.16 + (Math.random() - 0.5) * 0.05,
      fallback: () =>
        this.tone({
          frequency: 180 + clamped * 80,
          endFrequency: 100,
          duration: 0.07,
          type: "triangle",
          gain: 0.06 + clamped * 0.07
        })
    });
  }

  capture() {
    this.playCue("ball-capture", {
      volume: 1.15,
      layer: true,
      fallback: () =>
        this.tone({
          frequency: 620,
          endFrequency: 1050,
          duration: 0.16,
          gain: 0.14
        })
    });
    this.playCue("ui-confirm", {
      volume: 0.72,
      playbackRate: 1.08,
      fallback: () =>
        this.tone({
          frequency: 820,
          endFrequency: 1220,
          duration: 0.13,
          gain: 0.08,
          delay: 0.03
        })
    });
    this.pulseHandles(3);
  }

  fall() {
    this.playCue("ball-fall", {
      fallback: () =>
        this.tone({
          frequency: 300,
          endFrequency: 90,
          duration: 0.34,
          type: "triangle",
          gain: 0.18
        })
    });
    this.pulseHandles(1);
  }

  endingPaperBonk() {
    this.playCue("ending-paper-bonk", {
      fallback: () => this.hit(0.45),
      pending: {
        maxWaitMs: 1500,
        validPhases: ENDING_CUE_PHASES
      }
    });
    this.playCue("ending-paper-crumple", {
      delay: 0.6,
      pending: {
        maxWaitMs: 1500,
        validPhases: ENDING_CUE_PHASES
      }
    });
  }

  endingFortuneAppear() {
    this.playCue("ending-fortune-appear", {
      pending: {
        maxWaitMs: 1500,
        validPhases: ENDING_CUE_PHASES
      }
    });
  }

  endingFortuneVanish() {
    this.playCue("ending-fortune-vanish", {
      pending: {
        maxWaitMs: 1500,
        validPhases: ENDING_CUE_PHASES
      }
    });
  }

  clear() {
    this.playCue("level-clear", {
      fallback: () =>
        this.tone({
          frequency: 980,
          endFrequency: 1320,
          duration: 0.32,
          type: "sine",
          gain: 0.11
        })
    });
    this.pulseHandles(3);
  }

  victory() {
    this.stopVictory({ resumeBgm: false });
    this.victoryBgmHold = true;
    if (this.bgm && this.bgmSessionActive) {
      this.clearBgmFade();
      this.bgm.volume = 0;
    }
    this.playCue("finish-crowd", {
      volume: 1.05,
      delay: 0,
      group: "victory",
      direct: true,
      pending: {
        maxWaitMs: 1500,
        validPhases: VICTORY_CUE_PHASES,
        deferExpiryWhileBlocked: true
      }
    });
    this.playCue("well-done", {
      volume: 0.98,
      delay: 0,
      group: "victory",
      direct: true,
      pending: {
        maxWaitMs: 1500,
        validPhases: VICTORY_CUE_PHASES,
        deferExpiryWhileBlocked: true
      }
    });
    this.releaseVictoryBgmIfFinished();
    this.pulseHandles(3);
  }

  releaseVictoryBgmIfFinished() {
    if (
      !this.victoryBgmHold ||
      this.voices.some((voice) => voice.group === "victory") ||
      [...this.pendingCues.values()].some(
        (entry) => entry.sampleOptions.group === "victory"
      )
    ) {
      return;
    }
    this.victoryBgmHold = false;
    this.syncBgm();
  }

  stopVictory({ resumeBgm = true } = {}) {
    this.clearPendingCues({ group: "victory" });
    for (const voice of [...this.voices]) {
      if (voice.group === "victory") this.stopVoice(voice);
    }
    if (!this.victoryBgmHold) return;
    this.victoryBgmHold = false;
    if (resumeBgm) this.syncBgm();
  }

  resultTick() {
    this.playCue("result-count", {
      fallback: () =>
        this.tone({
          frequency: 660,
          endFrequency: 690,
          duration: 0.045,
          gain: 0.08
        }),
      pending: {
        maxWaitMs: 180,
        validPhases: RESULT_CUE_PHASES,
        coalesce: true
      }
    });
  }

  rank({ validPhases = RESULT_CUE_PHASES } = {}) {
    this.playCue("result-rank", {
      fallback: () =>
        this.tone({
          frequency: 700,
          endFrequency: 980,
          duration: 0.18,
          gain: 0.15
        }),
      pending: {
        maxWaitMs: 750,
        validPhases
      }
    });
  }

  stopVoice(voice) {
    const index = this.voices.indexOf(voice);
    if (index >= 0) this.voices.splice(index, 1);
    try {
      voice.source.stop();
    } catch {
      // A voice may already have ended between snapshot and cleanup.
    }
  }

  stopAll({ preserveKeys = [] } = {}) {
    const preserved = new Set(preserveKeys);
    for (const voice of [...this.voices]) {
      if (!preserved.has(voice.key)) this.stopVoice(voice);
    }
    if (!this.voices.some((voice) => voice.group === "victory")) {
      this.victoryBgmHold = false;
    }
  }

  reset(options) {
    this.clearPendingCues();
    this.stopAll(options);
    this.stopBgm({ fadeMs: 0 });
    this.lastHitAt = -Infinity;
  }

  handleVisibility(hidden) {
    this.bgmPausedByVisibility = hidden;
    if (hidden) {
      this.pauseBgm();
      this.context?.suspend().catch(() => {});
    } else if (this.unlockRequested) {
      void this.prepareExternalInput();
    }
  }

  pulseHandles(_effectId) {
    // Reserved for a future published Game SDK haptics capability.
  }

  snapshot() {
    return {
      owner_count: this.destroyed ? 0 : 1,
      unlocked: this.wasUnlocked,
      unlock_requested: this.unlockRequested,
      context_state: this.context?.state || "unavailable",
      latest_resume_error: this.latestResumeError,
      pending_cue_count: this.pendingCues.size,
      pending_cue_keys: [...this.pendingCues.keys()],
      loaded_keys: [...this.buffers.keys()],
      active_voice_count: this.voices.length,
      active_victory_voice_count: this.voices.filter(
        (voice) => voice.group === "victory"
      ).length,
      active_victory_keys: this.voices
        .filter((voice) => voice.group === "victory")
        .map((voice) => voice.key),
      victory_bgm_hold: this.victoryBgmHold,
      requested_audio_files: [...this.requestRecords.values()],
      audio_play_history: this.playHistory.map((entry) => ({ ...entry })),
      loop_history: this.loopHistory.map((entry) => ({ ...entry })),
      ramp_ms: { ...BGM_RAMP_MS },
      bgm: {
        key: this.bgmTrack.key,
        url: this.bgmTrack.url,
        playing: Boolean(
          this.bgmSessionActive && this.bgm && this.bgm.paused !== true
        ),
        session_active: this.bgmSessionActive,
        load_failed: this.bgmLoadFailed,
        failed: this.bgmFailed,
        latest_play_error: this.latestBgmPlayError,
        play_pending: Boolean(this.bgmPlayPromise),
        paused: Boolean(this.bgm?.paused),
        current_time: Number(this.bgm?.currentTime || 0)
      }
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearPendingCues();
    this.clearPendingCueTimer();
    this.stopAll();
    this.stopBgm({ fadeMs: 0 });
    this.releaseBgmMedia();
    if (
      this.context &&
      this.context.state !== "closed" &&
      typeof this.context.close === "function"
    ) {
      this.context.close().catch(() => {});
    }
  }
}
