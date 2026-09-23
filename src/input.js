import { clamp, vectorClamp } from "./core.js";
import { BALANCE_BOARD_CONFIG } from "./balance-board-config.js";

export const COP_X_LIMIT =
  BALANCE_BOARD_CONFIG.simulatorMapping.halfWidthCm;
export const COP_Y_LIMIT =
  BALANCE_BOARD_CONFIG.simulatorMapping.halfHeightCm;
export const COP_X_MIN = -COP_X_LIMIT;
export const COP_X_MAX = COP_X_LIMIT;
export const COP_Y_MIN = -COP_Y_LIMIT;
export const COP_Y_MAX = COP_Y_LIMIT;
export const BALANCE_BOARD_STALE_MS = BALANCE_BOARD_CONFIG.maxDataAgeMs;
export const DEBUG_BOARD_DISCONNECT_REASON = "DEBUG_FORCED_DISCONNECT";
const LOST_NOTE_MS = 2000;
const HARDWARE_WARNING_INTERVAL_MS = 2000;
const REASON_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const SEQUENCE_RESET_REASONS = new Set([
  "DEBUG_PROTOTYPE_UNAVAILABLE",
  "DISCONNECTED",
  "HOST_NOT_READY",
  "WAITING_FOR_FIRST_SAMPLE"
]);

function finiteNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function strictFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unavailable(reason, fallback = "UNAVAILABLE") {
  const normalized = String(reason || fallback);
  return {
    available: false,
    reason: REASON_PATTERN.test(normalized) ? normalized : fallback
  };
}

export function normalizeCopAxis(value, min, max) {
  const numericValue = finiteNumber(value);
  if (numericValue === null) return null;

  // Raw CoP zero is the board origin; scale each side from zero to its limit.
  const scale = numericValue < 0 ? Math.abs(min) : max;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return clamp(numericValue / scale, -1, 1);
}

export function mapCopToGame(
  sample,
  mapping = BALANCE_BOARD_CONFIG.simulatorMapping
) {
  const halfWidthCm = finiteNumber(mapping?.halfWidthCm);
  const halfHeightCm = finiteNumber(mapping?.halfHeightCm);
  if (
    halfWidthCm === null ||
    halfHeightCm === null ||
    halfWidthCm <= 0 ||
    halfHeightCm <= 0
  ) {
    return null;
  }

  const copX = finiteNumber(sample?.copX);
  const copY = finiteNumber(sample?.copY);
  const force = finiteNumber(sample?.force);
  if (copX === null || copY === null || force === null) return null;

  let x = normalizeCopAxis(copX, -halfWidthCm, halfWidthCm);
  let y = normalizeCopAxis(copY, -halfHeightCm, halfHeightCm);
  if (x === null || y === null) return null;
  if (mapping.invertX === true) x = -x;
  if (mapping.invertY === true) y = -y;
  return { x, y, forceKg: force };
}

export function validateBoardFrame(
  board,
  {
    mapping = BALANCE_BOARD_CONFIG.simulatorMapping,
    maxDataAgeMs = BALANCE_BOARD_CONFIG.maxDataAgeMs
  } = {}
) {
  if (!board || typeof board !== "object") {
    return unavailable("INVALID_SAMPLE");
  }
  if (board.available !== true) {
    return unavailable(board.reason);
  }

  const flags = strictFiniteNumber(board.flags);
  const sequenceId = strictFiniteNumber(board.sequenceId);
  const copX = strictFiniteNumber(board.copX);
  const copY = strictFiniteNumber(board.copY);
  const force = strictFiniteNumber(board.force);
  const capturedAtMs = strictFiniteNumber(board.capturedAtMs);
  const dataAgeMs = strictFiniteNumber(board.dataAgeMs);
  if (
    !Number.isSafeInteger(flags) ||
    !Number.isSafeInteger(sequenceId) ||
    copX === null ||
    copY === null ||
    force === null ||
    !Number.isSafeInteger(capturedAtMs) ||
    capturedAtMs < 0 ||
    !Number.isSafeInteger(dataAgeMs) ||
    dataAgeMs < 0
  ) {
    return unavailable("INVALID_SAMPLE");
  }
  if (!Number.isFinite(maxDataAgeMs) || maxDataAgeMs < 0) {
    return unavailable("INVALID_FRESHNESS_POLICY");
  }
  if (dataAgeMs > maxDataAgeMs) {
    return unavailable("PROJECT_STALE");
  }

  const mapped = mapCopToGame({ copX, copY, force }, mapping);
  if (!mapped) return unavailable("INVALID_MAPPING");
  return {
    available: true,
    flags,
    sequenceId,
    copX,
    copY,
    force,
    capturedAtMs,
    dataAgeMs,
    x: mapped.x,
    y: mapped.y
  };
}

export function normalizeBoardFrame(
  board,
  mapping = BALANCE_BOARD_CONFIG.simulatorMapping
) {
  const validated = validateBoardFrame(board, { mapping });
  return validated.available ? validated : null;
}

export class BrowserInputAdapterSource {
  constructor() {
    this.listener = null;
  }

  setResetListener(listener) {
    this.onReset = listener;
  }

  start(listener) {
    this.listener = listener;
    listener({
      available: false,
      reason: "LOCAL_SIMULATOR_ACTIVE"
    });
  }

  stop() {
    this.listener = null;
  }
}

export class InputSystem {
  constructor(
    touchRoot,
    {
      inputSource = new BrowserInputAdapterSource(),
      hardwareRequired = false
    } = {}
  ) {
    this.keys = new Set();
    this.keyboard = { x: 0, y: 0 };
    /* Kiwii External Game virtual gamepad: the Host D-pad drives the
       same tilt vector convention as the keyboard fallback (screen-up is
       negative y) with the same smoothing rates. Inert unless the
       External Game runtime forwards gamepad phases into it. */
    this.gamepadTiltButtons = new Set();
    this.gamepadTilt = { x: 0, y: 0 };
    this.touch = { active: false, x: 0, y: 0, pointerId: null };
    this.board = {
      available: false,
      reason: "WAITING_FOR_FIRST_SAMPLE",
      lastRejectedReason: "WAITING_FOR_FIRST_SAMPLE",
      flags: 0,
      sequenceId: null,
      copX: 0,
      copY: 0,
      force: 0,
      capturedAtMs: 0,
      dataAgeMs: 0,
      lastSampleMs: -Infinity,
      sampleVersion: 0,
      sourceKind: "LOCAL_SIMULATOR",
      subscriptionId: null,
      streamEpoch: null,
      eventSequence: null,
      eventOrderAuthority: null,
      sourceSequence: null,
      capturedAtNs: null,
      publishedAtNs: null,
      deliveryPolicy: null,
      deliveryObservation: null
    };
    this.hardwareRequired = Boolean(hardwareRequired);
    this.lastHardwareState = "unknown";
    this.lastHardwareWarnings = new Map();
    this.lastSequenceId = null;
    this.pollTimer = null;
    this.sourceStartGeneration = 0;
    this.sourceActive = false;
    this.sourceTransition = Promise.resolve();
    this.inputSource = inputSource;
    this.destroyed = false;
    this.debugBoardDisconnected = false;
    this.localSampleVersion = 0;
    this.touchRoot = touchRoot;
    this.touchBindings = null;
    const params = new URLSearchParams(location.search);
    this.qaInput =
      params.has("inputX") || params.has("inputY")
        ? {
            x: clamp(Number(params.get("inputX")) || 0, -1, 1),
            y: clamp(Number(params.get("inputY")) || 0, -1, 1)
          }
        : null;

    this.onKeyDown = (event) => {
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "KeyA",
          "KeyD",
          "KeyW",
          "KeyS"
        ].includes(event.code)
      ) {
        event.preventDefault();
        this.keys.add(event.code);
      }
    };
    this.onKeyUp = (event) => this.keys.delete(event.code);
    this.onWindowBlur = () => this.resetFallbackState();
    this.onVisibilityChange = () => {
      if (document.hidden) {
        this.resetFallbackState();
      }
    };
    this.onPageHide = () => {
      this.resetFallbackState();
    };
    this.onPageShow = () => {};

    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onWindowBlur);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("pageshow", this.onPageShow);
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    this.bindInputSource();
    this.bindTouch();
    this.startPolling();
  }

  nowMs() {
    return performance.now();
  }

  warnHardware(key, message, error) {
    const now = this.nowMs();
    const lastWarning = this.lastHardwareWarnings.get(key) ?? -Infinity;
    if (now - lastWarning < HARDWARE_WARNING_INTERVAL_MS) return;
    this.lastHardwareWarnings.set(key, now);
    if (error === undefined) console.warn(message);
    else console.warn(message, error);
  }

  boardAgeMs(now = this.nowMs()) {
    if (!Number.isFinite(this.board.lastSampleMs)) return Infinity;
    return (
      Math.max(0, Number(this.board.dataAgeMs) || 0) +
      Math.max(0, now - this.board.lastSampleMs)
    );
  }

  rejectBoard(reason, now = this.nowMs()) {
    this.board.reason = reason;
    this.board.lastRejectedReason = reason;
    if (this.boardAgeMs(now) <= BALANCE_BOARD_STALE_MS) return false;

    this.board.available = false;
    if (SEQUENCE_RESET_REASONS.has(reason)) {
      this.lastSequenceId = null;
    }
    if (this.lastHardwareState !== "fallback") {
      console.log(
        "[HW] Balance board unavailable; keyboard/touch fallback active"
      );
      this.lastHardwareState = "fallback";
    }
    return false;
  }

  acceptBoard(frame, now = this.nowMs()) {
    if (this.lastSequenceId !== null) {
      if (frame.sequenceId === this.lastSequenceId) {
        return this.rejectBoard("DUPLICATE_SEQUENCE", now);
      }
      if (frame.sequenceId < this.lastSequenceId) {
        return this.rejectBoard("OUT_OF_ORDER_SEQUENCE", now);
      }
    }

    this.lastSequenceId = frame.sequenceId;
    Object.assign(this.board, frame, {
      available: true,
      reason: null,
      lastSampleMs: now,
      sampleVersion: (Number(this.board.sampleVersion) || 0) + 1
    });
    if (this.lastHardwareState !== "connected") {
      console.log("[HW] Balance board connected");
      this.lastHardwareState = "connected";
    }
    return true;
  }

  bindInputSource() {
    this.inputSource?.setResetListener?.((event) => {
      this.resetHardwareStream(event?.reason || "STREAM_RESET");
    });
  }

  async replaceInputSource(
    inputSource,
    { hardwareRequired = this.hardwareRequired } = {}
  ) {
    if (!inputSource || inputSource === this.inputSource) return false;
    const previousSource = this.inputSource;
    this.sourceStartGeneration += 1;
    this.sourceActive = false;
    this.sourceTransition = this.sourceTransition
      .then(() => previousSource?.stop?.())
      .catch((error) => {
        this.warnHardware(
          "INPUT_SOURCE_REPLACE_STOP_FAILED",
          "[HW] Previous Balance Board input source cleanup failed",
          error
        );
      });
    await this.sourceTransition;
    if (this.destroyed) {
      await inputSource.stop?.();
      return false;
    }
    this.inputSource = inputSource;
    this.hardwareRequired = Boolean(hardwareRequired);
    this.resetHardwareStream("INPUT_SOURCE_REPLACED");
    this.bindInputSource();
    this.startPolling();
    await this.sourceTransition;
    return true;
  }

  resetHardwareStream(reason = "STREAM_RESET") {
    this.lastSequenceId = null;
    Object.assign(this.board, {
      available: false,
      reason,
      lastRejectedReason: reason,
      sequenceId: null,
      sourceSequence: null,
      eventSequence: null,
      subscriptionId: null,
      streamEpoch: null,
      lastSampleMs: -Infinity
    });
  }

  expireStaleHardware(now = this.nowMs()) {
    if (
      this.board.available &&
      this.boardAgeMs(now) > BALANCE_BOARD_STALE_MS
    ) {
      this.resetHardwareStream("PROJECT_STALE");
      return true;
    }
    return false;
  }

  acceptInputSourceSample(sample, now = this.nowMs()) {
    if (!sample?.available) {
      return this.rejectBoard(sample?.reason || "INPUT_SOURCE_UNAVAILABLE", now);
    }
    if (sample.sourceKind !== "KIWII_GAME_SDK") {
      return this.rejectBoard("INVALID_INPUT_SOURCE_SAMPLE", now);
    }
    const numericFields = [
      sample.x,
      sample.y,
      sample.copX,
      sample.copY,
      sample.force,
      sample.dataAgeMs
    ];
    if (numericFields.some((value) => !Number.isFinite(value))) {
      return this.rejectBoard("INVALID_INPUT_SOURCE_SAMPLE", now);
    }
    Object.assign(this.board, sample, {
      available: true,
      reason: null,
      lastRejectedReason: null,
      sequenceId: null,
      capturedAtMs: 0,
      lastSampleMs: now,
      sampleVersion: (Number(this.board.sampleVersion) || 0) + 1
    });
    if (this.lastHardwareState !== "connected") {
      console.log("[HW] Balance board connected through Kiwii Game SDK");
      this.lastHardwareState = "connected";
    }
    return true;
  }

  startPolling() {
    if (
      this.destroyed ||
      (typeof document !== "undefined" && document.hidden)
    ) {
      return;
    }
    if (!this.inputSource) {
      this.resetHardwareStream("INPUT_SOURCE_UNAVAILABLE");
      return;
    }
    if (this.sourceActive) return this.sourceTransition;
    this.sourceActive = true;
    const generation = ++this.sourceStartGeneration;
    this.sourceTransition = this.sourceTransition
      .then(() => {
        if (
          this.destroyed ||
          generation !== this.sourceStartGeneration ||
          !this.sourceActive
        ) {
          return;
        }
        return this.inputSource.start((sample) => {
          if (
            !this.destroyed &&
            generation === this.sourceStartGeneration
          ) {
            this.acceptInputSourceSample(sample);
          }
        });
      })
      .catch((error) => {
        if (generation !== this.sourceStartGeneration) return;
        this.sourceActive = false;
        const reason = error?.code || "INPUT_SOURCE_START_FAILED";
        this.warnHardware(
          reason,
          `[HW] Balance Board input source failed: ${reason}`,
          error
        );
        this.resetHardwareStream(reason);
      });
    return this.sourceTransition;
  }

  stopPolling() {
    this.sourceStartGeneration += 1;
    if (this.inputSource && this.sourceActive) {
      this.sourceActive = false;
      this.sourceTransition = this.sourceTransition
        .then(() => this.inputSource.stop?.())
        .catch((error) => {
          this.warnHardware(
            "INPUT_SOURCE_STOP_FAILED",
            "[HW] Balance Board input source cleanup failed",
            error
          );
        });
    }
    if (this.pollTimer === null) return;
    window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  resetTouch() {
    this.touch.active = false;
    this.touch.pointerId = null;
    this.touch.x = 0;
    this.touch.y = 0;
  }

  resetFallbackState() {
    this.keys.clear();
    this.keyboard.x = 0;
    this.keyboard.y = 0;
    this.releaseGamepadTilt();
    this.resetTouch();
  }

  bindTouch() {
    if (!this.touchRoot || this.touchBindings) return;

    const updateFromClient = (clientX, clientY) => {
      const rect = this.touchRoot.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      /* The invisible gameplay surface maps both axes independently. */
      const radiusX = Math.max(1, rect.width * 0.42);
      const radiusY = Math.max(1, rect.height * 0.42);
      const rawX = (clientX - cx) / radiusX;
      const rawY = (cy - clientY) / radiusY;
      const value = vectorClamp(rawX, rawY, 1);
      this.touch.x = value.x;
      this.touch.y = value.y;
    };

    if (typeof window.PointerEvent === "function") {
      const onPointerDown = (event) => {
        if (event.cancelable) event.preventDefault();
        this.touch.active = true;
        this.touch.pointerId = event.pointerId;
        try {
          this.touchRoot.setPointerCapture?.(event.pointerId);
        } catch {
          // Capture can fail if the pointer ended during the event dispatch.
        }
        updateFromClient(event.clientX, event.clientY);
      };
      const onPointerMove = (event) => {
        if (!this.touch.active || event.pointerId !== this.touch.pointerId) {
          return;
        }
        if (event.cancelable) event.preventDefault();
        updateFromClient(event.clientX, event.clientY);
      };
      const onPointerRelease = (event) => {
        if (event.pointerId !== this.touch.pointerId) return;
        this.resetTouch();
      };

      this.touchBindings = {
        mode: "pointer",
        onPointerDown,
        onPointerMove,
        onPointerRelease
      };
      this.touchRoot.addEventListener("pointerdown", onPointerDown);
      this.touchRoot.addEventListener("pointermove", onPointerMove);
      this.touchRoot.addEventListener("pointerup", onPointerRelease);
      this.touchRoot.addEventListener("pointercancel", onPointerRelease);
      this.touchRoot.addEventListener(
        "lostpointercapture",
        onPointerRelease
      );
      return;
    }

    const findTouch = (touches, identifier) =>
      Array.from(touches || []).find(
        (touch) => touch.identifier === identifier
      );
    const onTouchStart = (event) => {
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      if (event.cancelable) event.preventDefault();
      this.touch.active = true;
      this.touch.pointerId = touch.identifier;
      updateFromClient(touch.clientX, touch.clientY);
    };
    const onTouchMove = (event) => {
      const touch = findTouch(event.touches, this.touch.pointerId);
      if (!this.touch.active || !touch) return;
      if (event.cancelable) event.preventDefault();
      updateFromClient(touch.clientX, touch.clientY);
    };
    const onTouchRelease = (event) => {
      const touch = findTouch(event.changedTouches, this.touch.pointerId);
      if (!touch) return;
      if (event.cancelable) event.preventDefault();
      this.resetTouch();
    };

    this.touchBindings = {
      mode: "touch",
      onTouchStart,
      onTouchMove,
      onTouchRelease
    };
    this.touchRoot.addEventListener("touchstart", onTouchStart, {
      passive: false
    });
    this.touchRoot.addEventListener("touchmove", onTouchMove, {
      passive: false
    });
    this.touchRoot.addEventListener("touchend", onTouchRelease, {
      passive: false
    });
    this.touchRoot.addEventListener("touchcancel", onTouchRelease, {
      passive: false
    });
  }

  unbindTouch() {
    if (!this.touchRoot || !this.touchBindings) return;
    const bindings = this.touchBindings;
    if (bindings.mode === "pointer") {
      this.touchRoot.removeEventListener(
        "pointerdown",
        bindings.onPointerDown
      );
      this.touchRoot.removeEventListener(
        "pointermove",
        bindings.onPointerMove
      );
      this.touchRoot.removeEventListener(
        "pointerup",
        bindings.onPointerRelease
      );
      this.touchRoot.removeEventListener(
        "pointercancel",
        bindings.onPointerRelease
      );
      this.touchRoot.removeEventListener(
        "lostpointercapture",
        bindings.onPointerRelease
      );
    } else {
      this.touchRoot.removeEventListener(
        "touchstart",
        bindings.onTouchStart
      );
      this.touchRoot.removeEventListener("touchmove", bindings.onTouchMove);
      this.touchRoot.removeEventListener(
        "touchend",
        bindings.onTouchRelease
      );
      this.touchRoot.removeEventListener(
        "touchcancel",
        bindings.onTouchRelease
      );
    }
    this.touchBindings = null;
  }

  updateKeyboard(dt) {
    const left = this.keys.has("ArrowLeft") || this.keys.has("KeyA");
    const right = this.keys.has("ArrowRight") || this.keys.has("KeyD");
    const up = this.keys.has("ArrowUp") || this.keys.has("KeyW");
    const down = this.keys.has("ArrowDown") || this.keys.has("KeyS");
    const targetX = Number(right) - Number(left);
    const targetY = Number(down) - Number(up);
    const target = vectorClamp(targetX, targetY, 1);

    const approach = (current, next) => {
      const rate = next === 0 ? 3.6 : 2.8;
      const delta = clamp(next - current, -rate * dt, rate * dt);
      return current + delta;
    };

    this.keyboard.x = approach(this.keyboard.x, target.x);
    this.keyboard.y = approach(this.keyboard.y, target.y);
  }

  /* External Game gamepad tilt state machine. PRESSED holds a button,
     RELEASED and CANCELLED both release it (a host releaseAll sends
     CANCELLED), and re-pressing an already held button is idempotent.
     Only direction buttons participate; A/B/X/Y never reach this path. */
  setGamepadTiltButton(buttonId, phase) {
    const buttons = this.gamepadTiltButtons || (this.gamepadTiltButtons = new Set());
    if (!this.gamepadTilt) this.gamepadTilt = { x: 0, y: 0 };
    const isDirection = ["UP", "DOWN", "LEFT", "RIGHT"].includes(buttonId);
    const isRelease = phase === "RELEASED" || phase === "CANCELLED";
    if (!isDirection || (!isRelease && phase !== "PRESSED")) return false;
    if (phase === "PRESSED") {
      const added = !buttons.has(buttonId);
      buttons.add(buttonId);
      return added;
    }
    return buttons.delete(buttonId);
  }

  gamepadTiltActive() {
    return (this.gamepadTiltButtons?.size || 0) > 0;
  }

  releaseGamepadTilt() {
    this.gamepadTiltButtons?.clear?.();
    this.gamepadTilt = { x: 0, y: 0 };
  }

  updateGamepadTilt(dt) {
    if (!this.gamepadTiltActive()) {
      this.gamepadTilt = { x: 0, y: 0 };
      return;
    }
    const left = this.gamepadTiltButtons.has("LEFT");
    const right = this.gamepadTiltButtons.has("RIGHT");
    const up = this.gamepadTiltButtons.has("UP");
    const down = this.gamepadTiltButtons.has("DOWN");
    const targetX = Number(right) - Number(left);
    const targetY = Number(down) - Number(up);
    const target = vectorClamp(targetX, targetY, 1);

    const approach = (current, next) => {
      const rate = next === 0 ? 3.6 : 2.8;
      const delta = clamp(next - current, -rate * dt, rate * dt);
      return current + delta;
    };

    this.gamepadTilt.x = approach(this.gamepadTilt.x, target.x);
    this.gamepadTilt.y = approach(this.gamepadTilt.y, target.y);
  }

  setDebugBoardDisconnected(disconnected) {
    this.debugBoardDisconnected = Boolean(disconnected);
  }

  sample(dt) {
    this.updateKeyboard(dt);
    this.updateGamepadTilt(dt);
    this.expireStaleHardware();
    this.localSampleVersion += 1;
    if (this.qaInput) {
      return {
        x: this.qaInput.x,
        y: this.qaInput.y,
        force: 80,
        connected: !this.debugBoardDisconnected,
        presenceValid: !this.debugBoardDisconnected,
        source: "qa",
        staleMs: 0,
        reason: this.debugBoardDisconnected
          ? DEBUG_BOARD_DISCONNECT_REASON
          : null,
        sampleVersion: this.localSampleVersion
      };
    }
    const now = this.nowMs();
    const effectiveDataAgeMs = this.boardAgeMs(now);
    const hardwareFresh =
      this.board.available &&
      effectiveDataAgeMs <= BALANCE_BOARD_STALE_MS;
    const frame = hardwareFresh
      ? this.board.sourceKind === "KIWII_GAME_SDK"
        ? this.board
        : normalizeBoardFrame(this.board)
      : null;

    if (frame) {
      const connected = !this.debugBoardDisconnected;
      return {
        x: frame.x,
        y: frame.y,
        force: frame.force,
        connected,
        presenceValid:
          connected &&
          frame.force >= BALANCE_BOARD_CONFIG.force.minimumPresenceKg,
        source: "balance-board",
        staleMs: effectiveDataAgeMs,
        reason: connected ? null : DEBUG_BOARD_DISCONNECT_REASON,
        sampleVersion: frame.sampleVersion,
        flags: frame.flags,
        sequenceId: frame.sequenceId,
        capturedAtMs: frame.capturedAtMs,
        dataAgeMs: frame.dataAgeMs,
        subscriptionId: frame.subscriptionId,
        streamEpoch: frame.streamEpoch,
        eventSequence: frame.eventSequence,
        eventOrderAuthority: frame.eventOrderAuthority,
        sourceSequence: frame.sourceSequence,
        capturedAtNs: frame.capturedAtNs,
        publishedAtNs: frame.publishedAtNs
      };
    }

    if (this.hardwareRequired) {
      return {
        x: Number.isFinite(this.board.x) ? this.board.x : 0,
        y: Number.isFinite(this.board.y) ? this.board.y : 0,
        force: Number.isFinite(this.board.force) ? this.board.force : 0,
        connected: false,
        presenceValid: false,
        source: this.debugBoardDisconnected
          ? "debug-board-disconnect"
          : "balance-board",
        staleMs: effectiveDataAgeMs,
        reason: this.debugBoardDisconnected
          ? DEBUG_BOARD_DISCONNECT_REASON
          : this.board.reason,
        sampleVersion: this.board.sampleVersion
      };
    }
    /* Host gamepad buttons outrank the local keyboard: they only exist in
       the External Game Host, where keyboard events never arrive, and
       direct touch still wins when the document is the phone full game. */
    const fallback = this.touch.active
      ? this.touch
      : this.gamepadTiltActive()
        ? this.gamepadTilt
        : this.keyboard;
    return {
      x: fallback.x,
      y: fallback.y,
      force: 80,
      connected: !this.debugBoardDisconnected,
      presenceValid: !this.debugBoardDisconnected,
      source: this.touch.active
        ? "touch"
        : this.gamepadTiltActive()
          ? "kiwii-gamepad"
          : "keyboard",
      staleMs: effectiveDataAgeMs,
      reason: this.debugBoardDisconnected
        ? DEBUG_BOARD_DISCONNECT_REASON
        : null,
      sampleVersion: this.localSampleVersion
    };
  }

  rawBoardSample() {
    this.expireStaleHardware();
    const effectiveDataAgeMs = this.boardAgeMs();
    return {
      ...this.board,
      reason: this.debugBoardDisconnected
        ? DEBUG_BOARD_DISCONNECT_REASON
        : this.board.reason,
      effectiveDataAgeMs,
      presenceValid:
        !this.debugBoardDisconnected &&
        this.board.available &&
        effectiveDataAgeMs <= BALANCE_BOARD_STALE_MS &&
        this.board.force >= BALANCE_BOARD_CONFIG.force.minimumPresenceKg,
      connected:
        !this.debugBoardDisconnected &&
        this.board.available &&
        effectiveDataAgeMs <= BALANCE_BOARD_STALE_MS
    };
  }

  snapshot() {
    const board = this.rawBoardSample();
    return {
      board: {
        available: board.available,
        connected: board.connected,
        reason: board.reason,
        lastRejectedReason: board.lastRejectedReason,
        flags: board.flags,
        sequenceId: board.sequenceId,
        copX: board.copX,
        copY: board.copY,
        force: board.force,
        capturedAtMs: board.capturedAtMs,
        dataAgeMs: board.dataAgeMs,
        effectiveDataAgeMs: board.effectiveDataAgeMs,
        presenceValid: board.presenceValid,
        sampleVersion: board.sampleVersion,
        ...(board.sourceKind === "KIWII_GAME_SDK"
          ? {
              sourceKind: board.sourceKind,
              subscriptionId: board.subscriptionId,
              streamEpoch: board.streamEpoch,
              eventSequence: board.eventSequence,
              eventOrderAuthority: board.eventOrderAuthority,
              sourceSequence: board.sourceSequence,
              capturedAtNs: board.capturedAtNs,
              publishedAtNs: board.publishedAtNs,
              deliveryPolicy: board.deliveryPolicy,
              deliveryObservation: board.deliveryObservation
            }
          : {})
      },
      fallback: {
        keyboardActive: this.keys.size > 0,
        touchActive: this.touch.active,
        gamepadActive: this.gamepadTiltActive()
      }
    };
  }

  shouldShowLostConnectionNote() {
    return Number.isFinite(this.board.lastSampleMs) &&
      this.boardAgeMs() > LOST_NOTE_MS;
  }

  isCoarsePointer() {
    /* 不要用 `"ontouchstart" in window`：桌面 Chrome 默认就是 true，
       会把触摸摇杆铺到桌面上——局内右下角凭空多一个蓝点。
       只认「主输入设备是手指」这一个信号。 */
    return window.matchMedia?.("(pointer: coarse)")?.matches === true;
  }

  async destroy() {
    if (this.destroyed) return this.sourceTransition;
    this.destroyed = true;
    this.stopPolling();
    this.unbindTouch();
    this.resetFallbackState();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onWindowBlur);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("pageshow", this.onPageShow);
    document.removeEventListener(
      "visibilitychange",
      this.onVisibilityChange
    );
    await this.sourceTransition;
  }
}
