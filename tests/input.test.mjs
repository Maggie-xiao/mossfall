import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BALANCE_BOARD_CONFIG } from "../src/balance-board-config.js";
import {
  BALANCE_BOARD_STALE_MS,
  COP_X_LIMIT,
  COP_X_MAX,
  COP_X_MIN,
  COP_Y_LIMIT,
  COP_Y_MAX,
  COP_Y_MIN,
  InputSystem,
  mapCopToGame,
  normalizeBoardFrame,
  normalizeCopAxis,
  validateBoardFrame
} from "../src/input.js";

function validFrame(overrides = {}) {
  return {
    available: true,
    flags: 0,
    sequenceId: 1,
    copX: 0,
    copY: 0,
    force: 76,
    capturedAtMs: 1_700_000_000_000,
    dataAgeMs: 0,
    ...overrides
  };
}

function createInput(now = 1000) {
  const input = Object.create(InputSystem.prototype);
  input.qaInput = null;
  input.keys = new Set();
  input.keyboard = { x: 0, y: 0 };
  input.touch = { active: false, x: 0, y: 0, pointerId: null };
  input.touchRoot = null;
  input.touchKnob = null;
  input.touchBindings = null;
  input.board = {
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
    sampleVersion: 0
  };
  input.hardwareRequired = false;
  input.lastHardwareState = "unknown";
  input.lastHardwareWarnings = new Map();
  input.lastSequenceId = null;
  input.pollTimer = null;
  input.sourceStartGeneration = 0;
  input.sourceActive = false;
  input.sourceTransition = Promise.resolve();
  input.destroyed = false;
  input.debugBoardDisconnected = false;
  input.localSampleVersion = 0;
  input.updateKeyboard = () => {};
  input.nowMs = () => now;
  return input;
}

function withWindow(value, callback) {
  const previousWindow = globalThis.window;
  globalThis.window = value;
  try {
    return callback();
  } finally {
    globalThis.window = previousWindow;
  }
}

test("project CoP configuration owns cadence, mapping, response, and force gates", () => {
  assert.equal(BALANCE_BOARD_STALE_MS, 500);
  assert.deepEqual(BALANCE_BOARD_CONFIG.simulatorMapping, {
    halfWidthCm: 16,
    halfHeightCm: 9,
    invertX: false,
    invertY: true
  });
  assert.deepEqual(BALANCE_BOARD_CONFIG.response, {
    deadZone: 0.03,
    exponent: 1.1,
    horizontalGameplayGain: 1.2,
    verticalGameplaySensitivity: 2.4,
    displayResponsePerSecond: 10
  });
  assert.deepEqual(BALANCE_BOARD_CONFIG.force, {
    minimumPresenceKg: 5,
    standingPresenceRatio: 0.22
  });
});

test("injected input source start and stop are serialized and idempotent", async () => {
  const previousDocument = globalThis.document;
  const calls = [];
  globalThis.document = { hidden: false };

  try {
    const input = createInput();
    input.inputSource = {
      async start() {
        calls.push("start");
      },
      async stop() {
        calls.push("stop");
      }
    };

    input.startPolling();
    input.startPolling();
    await input.sourceTransition;
    assert.deepEqual(calls, ["start"]);
    assert.equal(input.sourceActive, true);

    input.stopPolling();
    input.stopPolling();
    await input.sourceTransition;
    assert.deepEqual(calls, ["start", "stop"]);
    assert.equal(input.sourceActive, false);

    input.startPolling();
    await input.sourceTransition;
    assert.deepEqual(calls, ["start", "stop", "start"]);
    assert.equal(input.sourceActive, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("late Android hardware admission replaces the simulator without overlapping owners", async () => {
  const previousDocument = globalThis.document;
  const calls = [];
  globalThis.document = { hidden: false };

  try {
    const input = createInput();
    const simulator = {
      async start() {
        calls.push("simulator:start");
      },
      async stop() {
        calls.push("simulator:stop");
      }
    };
    const hardware = {
      setResetListener() {},
      async start() {
        calls.push("hardware:start");
      },
      async stop() {
        calls.push("hardware:stop");
      }
    };
    input.inputSource = simulator;
    input.startPolling();
    await input.sourceTransition;

    assert.equal(
      await input.replaceInputSource(hardware, { hardwareRequired: true }),
      true
    );
    assert.deepEqual(calls, [
      "simulator:start",
      "simulator:stop",
      "hardware:start"
    ]);
    assert.strictEqual(input.inputSource, hardware);
    assert.equal(input.hardwareRequired, true);
    assert.equal(input.board.reason, "INPUT_SOURCE_REPLACED");

    globalThis.document = {
      hidden: false,
      removeEventListener() {}
    };
    await withWindow(
      {
        clearInterval() {},
        removeEventListener() {}
      },
      () => input.destroy()
    );
    assert.deepEqual(calls, [
      "simulator:start",
      "simulator:stop",
      "hardware:start",
      "hardware:stop"
    ]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("CoP axes map every project checkpoint around raw zero", () => {
  assert.equal(COP_X_LIMIT, 16);
  assert.equal(COP_Y_LIMIT, 9);
  assert.equal(normalizeCopAxis(COP_X_MIN, COP_X_MIN, COP_X_MAX), -1);
  assert.equal(normalizeCopAxis(-8, COP_X_MIN, COP_X_MAX), -0.5);
  assert.equal(normalizeCopAxis(0, COP_X_MIN, COP_X_MAX), 0);
  assert.equal(normalizeCopAxis(8, COP_X_MIN, COP_X_MAX), 0.5);
  assert.equal(normalizeCopAxis(COP_X_MAX, COP_X_MIN, COP_X_MAX), 1);
  assert.equal(normalizeCopAxis(COP_Y_MIN, COP_Y_MIN, COP_Y_MAX), -1);
  assert.equal(normalizeCopAxis(-4.5, COP_Y_MIN, COP_Y_MAX), -0.5);
  assert.equal(normalizeCopAxis(0, COP_Y_MIN, COP_Y_MAX), 0);
  assert.equal(normalizeCopAxis(4.5, COP_Y_MIN, COP_Y_MAX), 0.5);
  assert.equal(normalizeCopAxis(COP_Y_MAX, COP_Y_MIN, COP_Y_MAX), 1);
});

test("centimeter extents are isolated to the explicit simulator mapping", () => {
  const workbenchUiMapping = {
    halfWidthCm: 35,
    halfHeightCm: 17,
    invertX: true,
    invertY: true
  };
  assert.deepEqual(
    mapCopToGame(
      { copX: 17.5, copY: -8.5, force: 70 },
      workbenchUiMapping
    ),
    { x: -0.5, y: 0.5, forceKg: 70 }
  );
  assert.deepEqual(
    mapCopToGame({ copX: 70, copY: -34, force: 70 }, workbenchUiMapping),
    { x: -1, y: 1, forceKg: 70 }
  );
  assert.equal(BALANCE_BOARD_CONFIG.simulatorMapping.halfWidthCm, 16);
  assert.equal(BALANCE_BOARD_CONFIG.simulatorMapping.halfHeightCm, 9);
  assert.equal(BALANCE_BOARD_CONFIG.mapping, undefined);
});

test("valid payloads preserve raw cm/kg values and debug metadata", () => {
  const frame = validFrame({
    flags: 3,
    sequenceId: 17,
    copX: 8,
    copY: -4.5,
    force: 76,
    capturedAtMs: 1_700_000_000_123,
    dataAgeMs: 12
  });
  assert.deepEqual(normalizeBoardFrame(frame), {
    ...frame,
    x: 0.5,
    y: 0.5
  });
});

test("unavailable and malformed payloads retain diagnostic reasons", () => {
  assert.deepEqual(validateBoardFrame({ available: false, reason: "STALE" }), {
    available: false,
    reason: "STALE"
  });
  assert.deepEqual(validateBoardFrame(null), {
    available: false,
    reason: "INVALID_SAMPLE"
  });
});

test("protocol fields must be finite typed values with a fresh data age", () => {
  for (const frame of [
    validFrame({ flags: 0.5 }),
    validFrame({ sequenceId: "1" }),
    validFrame({ copX: NaN }),
    validFrame({ copY: Infinity }),
    validFrame({ force: "76" }),
    validFrame({ capturedAtMs: -1 }),
    validFrame({ dataAgeMs: -1 })
  ]) {
    assert.deepEqual(validateBoardFrame(frame), {
      available: false,
      reason: "INVALID_SAMPLE"
    });
  }

  assert.equal(
    validateBoardFrame(validFrame({ dataAgeMs: BALANCE_BOARD_STALE_MS }))
      .available,
    true
  );
  assert.deepEqual(
    validateBoardFrame(
      validFrame({ dataAgeMs: BALANCE_BOARD_STALE_MS + 1 })
    ),
    { available: false, reason: "PROJECT_STALE" }
  );
});

test("duplicate and out-of-order sequence IDs never refresh the accepted sample", () => {
  let now = 1000;
  let payload = validFrame({ sequenceId: 10, dataAgeMs: 5 });
  const input = createInput();
  input.nowMs = () => now;

  const accept = () => {
    const frame = validateBoardFrame(payload);
    return frame.available
      ? input.acceptBoard(frame, now)
      : input.rejectBoard(frame.reason, now);
  };
  assert.equal(accept(), true);
      assert.equal(input.board.lastSampleMs, 1000);

      now += 20;
      assert.equal(accept(), false);
      assert.equal(input.board.reason, "DUPLICATE_SEQUENCE");
      assert.equal(input.board.lastSampleMs, 1000);

      payload = validFrame({ sequenceId: 9, dataAgeMs: 25 });
      assert.equal(accept(), false);
      assert.equal(input.board.reason, "OUT_OF_ORDER_SEQUENCE");
      assert.equal(input.board.lastSampleMs, 1000);

      payload = validFrame({ sequenceId: 11, dataAgeMs: 25 });
      assert.equal(accept(), true);
      assert.equal(input.board.lastSampleMs, 1020);
      assert.equal(input.board.sequenceId, 11);

      payload = validFrame({ sequenceId: 11, dataAgeMs: 25 });
      now += BALANCE_BOARD_STALE_MS + 1;
      assert.equal(accept(), false);
      assert.equal(input.board.available, false);
      assert.equal(input.lastSequenceId, 11);

      payload = validFrame({ sequenceId: 12, dataAgeMs: 0 });
      assert.equal(accept(), true);
      assert.equal(input.board.sequenceId, 12);
});

test("host data age and local elapsed time combine into the freshness policy", () => {
  let now = 1000;
  const input = createInput();
  input.nowMs = () => now;
  input.acceptBoard(
    validateBoardFrame(validFrame({ sequenceId: 4, dataAgeMs: 400 })),
    now
  );

  assert.equal(input.boardAgeMs(), 400);
  now += 100;
  assert.equal(input.rawBoardSample().connected, true);
  now += 1;
  assert.equal(input.rawBoardSample().connected, false);
  assert.equal(input.board.reason, "PROJECT_STALE");
  assert.equal(input.lastSequenceId, null);
});

test("debug disconnect override hides a fresh board without mutating it", () => {
  const input = createInput();
  input.acceptBoard(validateBoardFrame(validFrame({ sequenceId: 4 })));

  assert.equal(input.sample(0).connected, true);
  input.setDebugBoardDisconnected(true);

  const hidden = input.sample(0);
  assert.equal(hidden.x, 0);
  assert.equal(Object.is(hidden.y, -0), true);
  assert.equal(hidden.force, 76);
  assert.equal(hidden.connected, false);
  assert.equal(hidden.presenceValid, false);
  assert.equal(hidden.source, "balance-board");
  assert.equal(hidden.reason, "DEBUG_FORCED_DISCONNECT");
  assert.notDeepEqual(
    { x: hidden.x, y: hidden.y, force: hidden.force },
    { x: 0, y: 0, force: 0 }
  );
  assert.equal(input.rawBoardSample().connected, false);
  assert.equal(input.rawBoardSample().reason, "DEBUG_FORCED_DISCONNECT");
  assert.equal(input.board.available, true);
  assert.equal(input.board.sequenceId, 4);

  input.setDebugBoardDisconnected(false);
  assert.equal(input.sample(0).connected, true);
});

test("input snapshots expose raw metadata and the latest rejection reason", () => {
  const input = createInput();
  input.acceptBoard(
    validateBoardFrame(
      validFrame({
        flags: 5,
        sequenceId: 8,
        copX: 2,
        copY: -3,
        dataAgeMs: 7
      })
    )
  );
  input.rejectBoard("DUPLICATE_SEQUENCE");

  assert.deepEqual(input.snapshot().board, {
    available: true,
    connected: true,
    reason: "DUPLICATE_SEQUENCE",
    lastRejectedReason: "DUPLICATE_SEQUENCE",
    flags: 5,
    sequenceId: 8,
    copX: 2,
    copY: -3,
    force: 76,
    capturedAtMs: 1_700_000_000_000,
    dataAgeMs: 7,
    effectiveDataAgeMs: 7,
    presenceValid: true,
    sampleVersion: 1
  });
});

test("hardware loss activates fallback and a reset sequence can recover", () => {
  let now = 1000;
  let payload = validFrame({ sequenceId: 42 });
  const input = createInput();
  input.nowMs = () => now;

  const accept = () => {
    const frame = validateBoardFrame(payload);
    return frame.available
      ? input.acceptBoard(frame, now)
      : input.rejectBoard(frame.reason, now);
  };
  accept();
      assert.equal(input.sample(1 / 60).source, "balance-board");

      payload = { available: false, reason: "DISCONNECTED" };
      now += BALANCE_BOARD_STALE_MS + 1;
      accept();
      input.keyboard = { x: -0.25, y: 0.75 };
      assert.deepEqual(
        {
          source: input.sample(1 / 60).source,
          x: input.sample(1 / 60).x,
          y: input.sample(1 / 60).y
        },
        { source: "keyboard", x: -0.25, y: 0.75 }
      );
      assert.equal(input.lastSequenceId, null);

      input.touch = {
        active: true,
        x: 0.3,
        y: -0.2,
        pointerId: 7
      };
      assert.equal(input.sample(1 / 60).source, "touch");

      payload = validFrame({ sequenceId: 1 });
      now += BALANCE_BOARD_CONFIG.pollIntervalMs;
      accept();
      assert.equal(input.sample(1 / 60).source, "balance-board");
      assert.equal(input.board.sequenceId, 1);
});

test("canonical source samples enter gameplay and epoch resets clear accepted input", () => {
  const input = createInput();
  input.inputSource = {
    setResetListener(listener) {
      this.onReset = listener;
    }
  };
  input.bindInputSource();
  input.acceptInputSourceSample({
    available: true,
    sourceKind: "KIWII_GAME_SDK",
    subscriptionId: "sub-a",
    streamEpoch: "7",
    eventSequence: "100",
    eventOrderAuthority: "HOST_EVENT_ENVELOPE",
    sourceSequence: "18446744073709551615",
    flags: 3,
    copX: 8,
    copY: 4.5,
    force: 71.2,
    x: 0.5,
    y: -0.5,
    capturedAtNs: "1700000000000000000",
    publishedAtNs: "1700000000010000000",
    dataAgeMs: 10,
    deliveryPolicy: {},
    deliveryObservation: {}
  });

  assert.deepEqual(
    {
      source: input.sample(0).source,
      connected: input.sample(0).connected,
      x: input.sample(0).x,
      y: input.sample(0).y,
      sourceSequence: input.sample(0).sourceSequence
    },
    {
      source: "balance-board",
      connected: true,
      x: 0.5,
      y: -0.5,
      sourceSequence: "18446744073709551615"
    }
  );

  input.inputSource.onReset({ reason: "SUBSCRIPTION_EPOCH_REPLACED" });
  assert.equal(input.board.available, false);
  assert.equal(input.board.reason, "SUBSCRIPTION_EPOCH_REPLACED");
});

test("visibility and BFCache preserve the hardware subscription identity", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  const windowListeners = new Map();
  const documentListeners = new Map();
  let startCalls = 0;
  let stopCalls = 0;
  let deliver = () => {};
  const inputSource = {
    setResetListener() {},
    async start(listener) {
      startCalls += 1;
      deliver = listener;
    },
    async stop() {
      stopCalls += 1;
    }
  };

  globalThis.window = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener() {},
    clearInterval() {}
  };
  globalThis.document = {
    hidden: false,
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener() {}
  };
  globalThis.location = { search: "" };

  const input = new InputSystem(null, { inputSource, hardwareRequired: true });
  try {
    await input.sourceTransition;
    deliver({
      available: true,
      sourceKind: "KIWII_GAME_SDK",
      subscriptionId: "sub-stable",
      streamEpoch: "epoch-stable",
      eventSequence: "8",
      eventOrderAuthority: "HOST_EVENT_ENVELOPE",
      sourceSequence: "55",
      flags: 3,
      copX: 4,
      copY: -2,
      force: 70,
      x: 0.04,
      y: -0.02,
      capturedAtNs: "100",
      publishedAtNs: "110",
      dataAgeMs: 10,
      deliveryPolicy: {},
      deliveryObservation: {}
    });

    globalThis.document.hidden = true;
    documentListeners.get("visibilitychange")();
    windowListeners.get("pagehide")({ persisted: true });
    globalThis.document.hidden = false;
    windowListeners.get("pageshow")({ persisted: true });
    documentListeners.get("visibilitychange")();
    await input.sourceTransition;

    assert.equal(startCalls, 1);
    assert.equal(stopCalls, 0);
    assert.strictEqual(input.inputSource, inputSource);
    assert.equal(input.board.subscriptionId, "sub-stable");
    assert.equal(input.board.streamEpoch, "epoch-stable");
    assert.equal(input.board.sourceSequence, "55");
  } finally {
    await input.destroy();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.location = previousLocation;
  }
});

test("hardware Semantic CoP enters gameplay without neutral subtraction", () => {
  const input = createInput();
  input.acceptInputSourceSample({
    available: true,
    sourceKind: "KIWII_GAME_SDK",
    subscriptionId: "sub-a",
    streamEpoch: "7",
    eventSequence: "100",
    eventOrderAuthority: "HOST_EVENT_ENVELOPE",
    sourceSequence: "44",
    flags: 3,
    copX: 10,
    copY: -5,
    force: 71,
    x: 0.1,
    y: -0.05,
    capturedAtNs: "1700000000000000000",
    publishedAtNs: "1700000000010000000",
    dataAgeMs: 10,
    deliveryPolicy: {},
    deliveryObservation: {}
  });

  const sample = input.sample(0);
  assert.equal(sample.x, 0.1);
  assert.equal(sample.y, -0.05);
});

test("keyboard up and down follow the modeled screen direction", () => {
  const input = Object.create(InputSystem.prototype);
  input.keys = new Set(["ArrowUp"]);
  input.keyboard = { x: 0, y: 0 };

  for (let step = 0; step < 60; step += 1) {
    input.updateKeyboard(1 / 60);
  }
  assert.equal(input.keyboard.y, -1);

  input.keys = new Set(["KeyS"]);
  for (let step = 0; step < 60; step += 1) {
    input.updateKeyboard(1 / 60);
  }
  assert.equal(input.keyboard.y, 1);
});

test("pointer and legacy touch controls register cancellable cleanup paths", () => {
  for (const pointerSupported of [true, false]) {
    const added = [];
    const removed = [];
    const root = {
      style: {},
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 100
      }),
      addEventListener(type, listener) {
        added.push({ type, listener });
      },
      removeEventListener(type, listener) {
        removed.push({ type, listener });
      }
    };
    const input = createInput();
    input.touchRoot = root;
    input.touchKnob = null;

    withWindow(
      { PointerEvent: pointerSupported ? class PointerEvent {} : undefined },
      () => {
        input.bindTouch();
        input.unbindTouch();
      }
    );

    const expected = pointerSupported
      ? [
          "pointerdown",
          "pointermove",
          "pointerup",
          "pointercancel",
          "lostpointercapture"
        ]
      : ["touchstart", "touchmove", "touchend", "touchcancel"];
    assert.deepEqual(added.map((entry) => entry.type), expected);
    assert.deepEqual(removed.map((entry) => entry.type), expected);
    assert.equal(input.touchBindings, null);
  }
});

test("pointer fallback captures, reports both axes, and returns to neutral", () => {
  const listeners = new Map();
  const captured = [];
  const root = {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 100
    }),
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener() {},
    setPointerCapture(pointerId) {
      captured.push(pointerId);
    }
  };
  const input = createInput();
  input.touchRoot = root;
  input.touchKnob = null;

  withWindow({ PointerEvent: class PointerEvent {} }, () => input.bindTouch());

  let prevented = 0;
  listeners.get("pointerdown")({
    pointerId: 9,
    clientX: 184,
    clientY: 50,
    cancelable: true,
    preventDefault() {
      prevented += 1;
    }
  });
  assert.equal(input.touch.active, true);
  assert.equal(input.touch.pointerId, 9);
  assert.deepEqual(captured, [9]);
  assert.ok(input.touch.x > 0.99);
  assert.ok(Math.abs(input.touch.y) < 1e-9);
  assert.equal(input.snapshot().fallback.touchActive, true);

  listeners.get("pointermove")({
    pointerId: 9,
    clientX: 100,
    clientY: 8,
    cancelable: true,
    preventDefault() {
      prevented += 1;
    }
  });
  assert.ok(Math.abs(input.touch.x) < 1e-9);
  assert.ok(input.touch.y > 0.99);

  listeners.get("pointerup")({ pointerId: 9 });
  assert.deepEqual(input.touch, {
    active: false,
    x: 0,
    y: 0,
    pointerId: null
  });
  assert.equal(input.snapshot().fallback.touchActive, false);
  assert.equal(prevented, 2);
});

test("destroy clears polling and all window, document, and touch listeners", async () => {
  const previousDocument = globalThis.document;
  const removedWindowEvents = [];
  const removedDocumentEvents = [];
  const cleared = [];
  const input = createInput();
  input.pollTimer = 12;
  input.onKeyDown = () => {};
  input.onKeyUp = () => {};
  input.onWindowBlur = () => {};
  input.onPageHide = () => {};
  input.onPageShow = () => {};
  input.onVisibilityChange = () => {};
  input.unbindTouch = () => {
    input.touchBindings = null;
  };
  globalThis.document = {
    removeEventListener(type) {
      removedDocumentEvents.push(type);
    }
  };

  try {
    await withWindow(
      {
        clearInterval(id) {
          cleared.push(id);
        },
        removeEventListener(type) {
          removedWindowEvents.push(type);
        }
      },
      () => input.destroy()
    );
  } finally {
    globalThis.document = previousDocument;
  }

  assert.deepEqual(cleared, [12]);
  assert.deepEqual(removedWindowEvents, [
    "keydown",
    "keyup",
    "blur",
    "pagehide",
    "pageshow"
  ]);
  assert.deepEqual(removedDocumentEvents, ["visibilitychange"]);
  assert.equal(input.pollTimer, null);
  assert.equal(input.destroyed, true);
});

test("candidate hardware code uses the SDK and contains no ambient bridge", async () => {
  const [inputSource, mainSource, hostSource] = await Promise.all([
    readFile(new URL("../src/input.js", import.meta.url), "utf8"),
    readFile(new URL("../src/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/hardware-host.js", import.meta.url), "utf8")
  ]);
  const candidateSource = `${inputSource}\n${mainSource}\n${hostSource}`;
  assert.match(candidateSource, /new hardwareSdk\.KiwiiHardwareClient\(/);
  assert.match(candidateSource, /createAndroidDevelopmentHardwareGameSdk/);
  assert.match(candidateSource, /createIosDevelopmentHardwareGameSdk/);
  assert.match(candidateSource, /IOS_PREINSTALLED_PORT/);
  assert.doesNotMatch(candidateSource, /\bcreateDevelopmentHardwareGameSdk\b/);
  assert.doesNotMatch(candidateSource, /KiwiiBridge|addJavascriptInterface/);
});

test("the CoP adapter contains no cross-frame smoothing state", async () => {
  const source = await readFile(
    new URL("../src/input.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    source,
    /lowPass|smoothedCop|filteredInput|previousCop|movingAverage|\bEMA\b/
  );
  assert.doesNotMatch(source, /touchKnob\.style\.transform/);
});
