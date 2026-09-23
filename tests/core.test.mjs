import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  COUNTDOWN_MS,
  frameDurations,
  isEditableKeyTarget,
  levelClearDurationSec,
  levelClearHudLevel,
  parseRuntimeFlags,
  TableTiltController,
  UI_TIMING
} from "../src/controller.js";
import { BGM_TRACK, GameAudio } from "../src/audio.js";
import {
  animateBonusTimer,
  FAILURE_SPIN_DURATION_SEC,
  failureSpinAngle,
  mapCopAxis,
  scoreRun,
  shouldStartFailureSpin,
  stepCriticalDampedAngle
} from "../src/core.js";
import { scoreStars } from "../src/ui.js";
import {
  ADVANCED_DATA,
  BALL_RADIUS,
  BALL_RADIUS_SCALE,
  BASE_BALL_RADIUS,
  BEGINNER_DATA,
  BEGINNER_PLAY_ORDER,
  levelSet,
  PREVIOUS_BALL_RADIUS,
  sharedRules
} from "../src/levels.js";
import {
  failureBallOpacity,
  FAILURE_BALL_FADE_DURATION_SEC,
  rollingRotationForTravel,
  shouldDescendBetweenLevels,
  TableTiltScene
} from "../src/scene.js";

test("QA hooks require the explicit qa=1 query value", () => {
  for (const search of ["", "?qa", "?qa=0", "?qa=false", "?qa=true"]) {
    assert.deepEqual(parseRuntimeFlags(search), {
      qaMode: false,
      autoClear: false,
      forceTouch: false,
      timingScale: 1
    });
  }

  assert.deepEqual(parseRuntimeFlags("?qa=1&autoclear=1&touch=1"), {
    qaMode: true,
    autoClear: true,
    forceTouch: true,
    timingScale: 0.18
  });
  assert.equal(parseRuntimeFlags("?qa=1&realtime=1").timingScale, 1);
});

test("performance timing keeps real long frames while simulation stays bounded", () => {
  assert.deepEqual(frameDurations(1000, 1016), {
    elapsedSec: 0.016,
    simulationDt: 0.016
  });
  assert.deepEqual(frameDurations(1000, 2000), {
    elapsedSec: 1,
    simulationDt: 0.05
  });
});

test("level-clear HUD holds the cleared level until the descent lands", () => {
  // Cleared level 1, next level not yet loaded: still reads 1.
  assert.equal(levelClearHudLevel(0, false, false), 1);
  // Next level loaded and the camera is falling: still reads 1.
  assert.equal(levelClearHudLevel(1, true, true), 1);
  // Descent finished: the new number lands with the player.
  assert.equal(levelClearHudLevel(1, true, false), 2);
  assert.equal(levelClearHudLevel(6, false, false), 7);
  assert.equal(levelClearHudLevel(7, true, true), 7);
  assert.equal(levelClearHudLevel(7, true, false), 8);
});

test("CoP deadzone and response match the production vectors", () => {
  assert.equal(mapCopAxis(0), 0);
  assert.equal(mapCopAxis(0.03), 0);
  assert.ok(Math.abs(mapCopAxis(0.5) - 0.451) < 0.01);
  assert.ok(Math.abs(mapCopAxis(0.75) - 0.720) < 0.01);
  assert.equal(mapCopAxis(1), 1);
});

test("ball visuals rotate around the travel axis instead of sliding", () => {
  const right = rollingRotationForTravel(0.6, 0, 0.3);
  assert.ok(Math.abs(right.angle - 2) < 0.000001);
  assert.ok(Math.abs(right.axisX) < 0.000001);
  assert.ok(Math.abs(right.axisZ + 1) < 0.000001);

  const forward = rollingRotationForTravel(0, 0.45, 0.3);
  assert.ok(Math.abs(forward.angle - 1.5) < 0.000001);
  assert.ok(Math.abs(forward.axisX - 1) < 0.000001);
  assert.ok(Math.abs(forward.axisZ) < 0.000001);

  assert.deepEqual(rollingRotationForTravel(0, 0, 0.3), {
    distance: 0,
    angle: 0,
    axisX: 0,
    axisZ: 0
  });
});

test("render frames leave rolling orientation to LeafSim and InsectView", async () => {
  const source = await readFile(
    new URL("../src/scene.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /advanceBallRoll\(|rollQuaternion/);
  assert.match(source, /ball\.insect\.update\(dt, this\.clockTime, bug\)/);
});

test("failed balls fade completely before the board spin", () => {
  assert.equal(failureBallOpacity(0), 1);
  assert.ok(
    failureBallOpacity(FAILURE_BALL_FADE_DURATION_SEC / 2) < 1
  );
  assert.ok(
    failureBallOpacity(FAILURE_BALL_FADE_DURATION_SEC / 2) > 0
  );
  assert.equal(failureBallOpacity(FAILURE_BALL_FADE_DURATION_SEC), 0);
});

test("opening countdown gives each number enough time to read", () => {
  /* core-luge 正典：无 lead-in，3/2/1 各 1.0s，GO 1.2s，总 4.2s。 */
  assert.equal(UI_TIMING.countdownLeadInMs, 0);
  assert.equal(UI_TIMING.countdownBeatMs, 1000);
  assert.equal(UI_TIMING.countdownGoMs, 1200);
  assert.equal(COUNTDOWN_MS, 4200);
});

test("QA acceleration does not shorten readable gameplay animation beats", () => {
  const controller = Object.create(TableTiltController.prototype);
  controller.timingScale = 0.18;

  assert.ok(Math.abs(controller.duration(2.25) - 0.405) < 0.000001);
  assert.equal(controller.animationDuration(2.25), 2.25);
  assert.equal(controller.animationMs(UI_TIMING.countdownBeatMs), 1);
});

test("score formula reproduces both video-confirmed totals", () => {
  assert.deepEqual(scoreRun(8, 63.9), {
    cleared: 8,
    levelPoints: 80,
    timePoints: 63,
    totalPoints: 143
  });
  assert.equal(scoreRun(8, 22.4).totalPoints, 102);
  assert.equal(scoreRun(5, 0).totalPoints, 50);
});

test("session and device bests are isolated by mode and use final score", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map([
    ["kiwii.tableTilt.best.beginner", "120"],
    ["kiwii.tableTilt.best.advanced", "40"]
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    }
  });

  try {
    const controller = Object.create(TableTiltController.prototype);
    controller.mode = "beginner";

    assert.deepEqual(controller.recordPersonalBests(100), {
      mode: "beginner",
      session: 100,
      device: 120,
      previousSession: 0,
      previousDevice: 120,
      isSessionRecord: true,
      isDeviceRecord: false
    });
    assert.equal(controller.recordPersonalBests(130).device, 130);

    controller.mode = "advanced";
    const advanced = controller.recordPersonalBests(50);
    assert.equal(advanced.session, 50);
    assert.equal(advanced.device, 50);
    assert.equal(advanced.previousDevice, 40);

    assert.equal(controller.sessionBest("beginner"), 130);
    assert.equal(controller.personalBest("beginner"), 130);
    assert.equal(values.get("kiwii.tableTilt.best.beginner"), "130");
    assert.equal(values.get("kiwii.tableTilt.best.advanced"), "50");
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

test("personal best persistence failures degrade to mode-local memory", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw new Error("storage blocked");
      },
      setItem() {
        throw new Error("storage blocked");
      }
    }
  });

  try {
    const controller = Object.create(TableTiltController.prototype);
    controller.mode = "beginner";
    const first = controller.recordPersonalBests(77);
    const lower = controller.recordPersonalBests(60);

    assert.equal(first.session, 77);
    assert.equal(first.device, 77);
    assert.equal(lower.session, 77);
    assert.equal(lower.device, 77);
    assert.equal(lower.isSessionRecord, false);
    assert.equal(lower.isDeviceRecord, false);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

test("corrupt persisted personal best data is treated as empty", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const writes = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => "not-a-score",
      setItem: (key, value) => writes.push([key, value])
    }
  });

  try {
    const controller = Object.create(TableTiltController.prototype);
    controller.mode = "advanced";
    const result = controller.recordPersonalBests(42);
    assert.equal(result.previousDevice, 0);
    assert.equal(result.device, 42);
    assert.deepEqual(writes, [["kiwii.tableTilt.best.advanced", "42"]]);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

test("personal best parser rejects partial, unsafe, and legacy values", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map([
    ["kiwii.tableTilt.best.beginner", "120junk"],
    ["kiwii.tableTilt.best.advanced", "9007199254740992"],
    ["kiwii.tableTilt.best", "999"]
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  });

  try {
    const controller = Object.create(TableTiltController.prototype);
    controller.mode = "beginner";
    assert.equal(controller.personalBest(), 0);

    controller.mode = "advanced";
    assert.equal(controller.personalBest(), 0);
    assert.equal(
      controller.recordPersonalBests(42).device,
      42,
      "a valid current result replaces corrupted storage"
    );
    assert.equal(
      values.get("kiwii.tableTilt.best"),
      "999",
      "the retired unscoped key is never read or rewritten"
    );
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

test("result stars follow the documented four-tier boundaries", () => {
  assert.equal(scoreStars({ cleared: 0, totalPoints: 0 }, 0), 1);
  assert.equal(scoreStars({ cleared: 3, totalPoints: 31 }, 0), 1);
  assert.equal(scoreStars({ cleared: 4, totalPoints: 40 }, 9), 2);
  assert.equal(scoreStars({ cleared: 7, totalPoints: 70 }, 0), 2);
  assert.equal(scoreStars({ cleared: 8, totalPoints: 80 }, 1), 3);
  assert.equal(scoreStars({ cleared: 8, totalPoints: 80 }, 0), 4);
});

test("table response follows the locked baseline without overshoot", () => {
  const target = 3.7 * Math.PI / 180;
  let state = { angle: 0, velocity: 0 };
  for (let i = 0; i < 60; i += 1) {
    state = stepCriticalDampedAngle(state, target, 1 / 120);
  }
  assert.ok(state.angle >= target * 0.88);
  assert.ok(state.angle <= target * 1.02);
});

test("controller level sets expose the authored native Mossfall records", () => {
  assert.deepEqual(
    levelSet("beginner").map((level) => level.bugs.length),
    [1, 2, 3, 3, 2, 4, 5, 8]
  );
  assert.deepEqual(
    levelSet("beginner").map((level) => level.id),
    BEGINNER_PLAY_ORDER
  );
  assert.deepEqual(
    levelSet("advanced").map((level) => level.bugs.length),
    [1, 2, 2, 3, 5, 5, 8, 6]
  );
  for (const level of [
    ...levelSet("beginner"),
    ...levelSet("advanced")
  ]) {
    assert.ok(Array.isArray(level.board.shapes));
    assert.equal("shape" in level, false);
    assert.equal("balls" in level, false);
    assert.equal("holes" in level, false);
  }
  assert.equal(BEGINNER_DATA.levels[0].name, "Wide Ellipse Leaf");
  assert.equal(BEGINNER_DATA.levels[4].name, "Four-Lobed Cross");
  assert.equal(ADVANCED_DATA.levels[0].name, "Five-Lobed Star Leaf");
  assert.equal(ADVANCED_DATA.levels[2].board.shapes[1].sub, true);
  assert.equal(ADVANCED_DATA.levels[6].board.shapes.length, 4);
});

test("difficulty rules use source time bonuses and the 99 second cap", () => {
  assert.equal(sharedRules("beginner").timeAddedPerClearSec, 20);
  assert.equal(sharedRules("advanced").timeAddedPerClearSec, 30);
  assert.equal(sharedRules("beginner").timeCapSec, 99);
  assert.equal(sharedRules("advanced").timeCapSec, 99);
});

test("level clear waits for the authored descent after the next board loads", () => {
  assert.equal(levelClearDurationSec(null), 2.4);
  assert.equal(
    levelClearDurationSec(BEGINNER_DATA.levels[1]),
    1.6 + BEGINNER_DATA.levels[1].descent.duration
  );
  assert.equal(
    levelClearDurationSec(BEGINNER_DATA.levels[1], 0.18),
    (1.6 + BEGINNER_DATA.levels[1].descent.duration) * 0.18
  );
});

test("failure feedback completes one smooth turn before reset is allowed", () => {
  assert.ok(Math.abs(failureSpinAngle(0)) < 0.000001);
  assert.ok(
    Math.abs(
      failureSpinAngle(FAILURE_SPIN_DURATION_SEC / 2) - Math.PI
    ) < 0.001
  );
  assert.ok(
    Math.abs(
      failureSpinAngle(FAILURE_SPIN_DURATION_SEC) - Math.PI * 2
    ) < 0.001
  );
  assert.ok(Math.abs(failureSpinAngle(3) - Math.PI * 2) < 0.001);
  assert.ok(
    sharedRules("beginner").fallResetDelaySec >= FAILURE_SPIN_DURATION_SEC
  );
  assert.ok(
    sharedRules("advanced").fallResetDelaySec >= FAILURE_SPIN_DURATION_SEC
  );
});

test("fall feedback waits for the ball to clear the board before spinning", () => {
  assert.equal(shouldStartFailureSpin(0.2, true, 0.4, 0.9), false);
  assert.equal(shouldStartFailureSpin(0.6, false, 0.4, 0.9), false);
  assert.equal(shouldStartFailureSpin(0.6, true, 0.4, 0.9), true);
  assert.equal(shouldStartFailureSpin(0.9, false, 0.4, 0.9), true);
});

test("starting a fall drop delegates the failure body to TableTiltLeafSim", () => {
  const calls = [];
  const scene = Object.create(TableTiltScene.prototype);
  scene.balls = [];
  scene.failureDropActive = false;
  scene.failureFallenBallIds = new Set();
  scene.sim = {
    bugs: [],
    forceFall: (id) => calls.push(id),
    bugById: () => null
  };

  scene.startFailureDrop("BALL_01");

  assert.equal(scene.failureDropActive, true);
  assert.equal(scene.failureFallenBallIds.has("BALL_01"), true);
  assert.deepEqual(calls, ["BALL_01"]);
});

test("failure tracking discovers a second ball that falls later", () => {
  const firstBug = { id: "BALL_01", state: "falling", y: -1, r: 0.2 };
  const secondBug = { id: "BALL_02", state: "roll", y: 0.4, r: 0.2 };
  const secondBall = {
    id: secondBug.id,
    captured: false,
    failureFadeElapsed: 0.45,
    visualOpacity: 0.25,
    insect: {
      group: { visible: false },
      setOpacity(value) {
        secondBall.appliedOpacity = value;
      }
    }
  };
  const scene = Object.create(TableTiltScene.prototype);
  scene.sim = {
    bugs: [firstBug, secondBug],
    bugById(id) {
      return this.bugs.find((bug) => bug.id === id) || null;
    }
  };
  scene.balls = [
    {
      id: firstBug.id,
      captured: false,
      failureFadeElapsed: 0.7,
      visualOpacity: 0
    },
    secondBall
  ];
  scene.failureFallenBallIds = new Set([firstBug.id]);

  secondBug.state = "falling";
  scene.syncFallingBalls();

  assert.deepEqual([...scene.failureFallenBallIds], [
    firstBug.id,
    secondBug.id
  ]);
  assert.equal(secondBall.failureFadeElapsed, 0);
  assert.equal(secondBall.visualOpacity, 1);
  assert.equal(secondBall.appliedOpacity, 1);
  assert.equal(secondBall.insect.group.visible, true);
  assert.equal(scene.latestFallenBallElapsed(), 0);
  assert.equal(scene.hasAllFallenBallsClearedBoard(), false);
  assert.equal(scene.hasAllFallenBallsFadedOut(), false);
});

test("starting the board spin hides the failed ball", () => {
  const ball = {
    id: "BALL_01",
    captured: false,
    mesh: { visible: true },
    visualOpacity: 1
  };
  const scene = Object.create(TableTiltScene.prototype);
  scene.balls = [ball];
  scene.failureDropActive = true;
  scene.failureActive = false;
  scene.failureElapsed = 0;
  scene.failureStartYaw = 0;
  scene.failureTargetYaw = 0;
  scene.failureFallenBallIds = new Set([ball.id]);
  scene.boardYaw = 0;

  scene.startFailureSpin(ball.id);

  assert.equal(ball.mesh.visible, false);
  assert.equal(ball.visualOpacity, 0);
});

test("edge failure enters a drop phase before the reset spin", () => {
  const controller = Object.create(TableTiltController.prototype);
  const entered = [];
  controller.state = "GAMEPLAY";
  controller.audio = { fall() {} };
  controller.ui = { hideToast() {} };
  controller.enterState = (state, payload) => entered.push({ state, payload });

  controller.handleSceneEvent({ type: "ballFell", ballId: "BALL_01" });

  assert.deepEqual(entered, [
    { state: "BALL_FALL_DROP", payload: { ballId: "BALL_01" } }
  ]);
});

test("fall reset timing follows the most recently tracked falling ball", () => {
  const controller = Object.create(TableTiltController.prototype);
  const entered = [];
  let latestFallElapsed = 0.2;
  let allCleared = false;
  let allFaded = false;
  controller.stateElapsed = 2;
  controller.timeRemaining = 20;
  controller.currentLevelIndex = 0;
  controller.fallenBallId = "BALL_01";
  controller.animationMs = (milliseconds) => milliseconds / 1000;
  controller.ui = {
    updateGameplay() {},
    updateTouchDisplay() {}
  };
  controller.input = { sample: () => ({ x: 0, y: 0 }) };
  controller.scene = {
    updateTilt() {},
    latestFallenBallElapsed: () => latestFallElapsed,
    hasAllFallenBallsClearedBoard: () => allCleared,
    hasAllFallenBallsFadedOut: () => allFaded
  };
  controller.stepPhysics = () => {};
  controller.enterState = (state, payload) => entered.push({ state, payload });

  controller.tickBallDrop(0.016);
  assert.deepEqual(entered, []);

  latestFallElapsed = 0.65;
  allCleared = true;
  allFaded = true;
  controller.tickBallDrop(0.016);
  assert.deepEqual(entered, [
    { state: "BALL_FALL_RESET", payload: { ballId: "BALL_01" } }
  ]);
});

test("level-clear bonus counts through intermediate timer values", () => {
  assert.equal(animateBonusTimer(42, 62, 0, 1.5), 42);
  assert.equal(animateBonusTimer(42, 62, 0.75, 1.5), 52);
  assert.equal(animateBonusTimer(42, 62, 1.5, 1.5), 62);
});

test("ball linear size is twenty percent smaller than the current playtest setting", () => {
  assert.ok(PREVIOUS_BALL_RADIUS > BASE_BALL_RADIUS);
  assert.equal(BALL_RADIUS_SCALE, 1.6);
  assert.ok(Math.abs(BALL_RADIUS / PREVIOUS_BALL_RADIUS - 1.6) < 0.000001);
});

test("native bug records retain non-overlapping spawn positions", () => {
  for (const level of [...BEGINNER_DATA.levels, ...ADVANCED_DATA.levels]) {
    for (let left = 0; left < level.bugs.length; left += 1) {
      for (let right = left + 1; right < level.bugs.length; right += 1) {
        const a = level.bugs[left];
        const b = level.bugs[right];
        const distance = Math.hypot(a.x - b.x, a.z - b.z);
        assert.ok(
          distance >= a.r + b.r,
          `${level.id} ${a.id}/${b.id} overlap at spawn`
        );
      }
    }
  }
});

test("headless teaching retains the four-second minimum", () => {
  const controller = Object.create(TableTiltController.prototype);
  const entered = [];
  let confirms = 0;
  Object.assign(controller, {
    state: "TEACH_IN",
    stateElapsed: 3.999,
    timingScale: 1,
    currentInputSample: null,
    offBoardElapsed: 0,
    debugBoardDisconnected: false,
    input: {
      hardwareRequired: false,
      sample: () => ({
        x: 0,
        y: 0,
        connected: true,
        presenceValid: true,
        sampleVersion: 1
      })
    },
    ui: {
      updateTouchDisplay() {}
    },
    scene: {
      updateTilt() {}
    },
    audio: {
      confirm() {
        confirms += 1;
      }
    },
    prepareStartLine() {
      entered.push("LEVEL_INTRO");
    }
  });

  assert.equal(UI_TIMING.teachingMs, 4000);
  controller.tick(0);
  assert.deepEqual(entered, []);
  controller.tick(0.001);
  assert.deepEqual(entered, ["LEVEL_INTRO"]);
  assert.equal(confirms, 1);
});

test("teaching waits for the visible animation despite an expired simulation clock", () => {
  const controller = Object.create(TableTiltController.prototype);
  let ready = false;
  let transitions = 0;
  Object.assign(controller, {
    state: "TEACH_IN", stateElapsed: 30, timingScale: 1, offBoardElapsed: 0,
    input: { hardwareRequired: false, sample: () => ({ connected: true, presenceValid: true }) },
    ui: { canAdvanceTeachIn: () => ready }, scene: { updateTilt() {} },
    audio: { confirm() {} }, prepareStartLine() { transitions++; }
  });
  controller.tick(1);
  assert.equal(transitions, 0, "loading or incomplete frames cannot be bypassed by wall time");
  ready = true;
  controller.tick(0);
  assert.equal(transitions, 1, "a complete demonstration releases the original countdown path");
});

test("teaching hands straight to the countdown with no start-line gate", () => {
  const controller = Object.create(TableTiltController.prototype);
  const entered = [];
  Object.assign(controller, { state: "TEACH_IN" });
  controller.enterState = (state) => entered.push(state);
  controller.startRun = () => entered.push("startRun");

  controller.prepareStartLine();
  /* 以前这里落的是 START_LINE：必须把重心稳住 0.6 秒才放行。
     那是拿身体动作挡门，教学不挡门。 */
  assert.deepEqual(entered, ["LEVEL_INTRO"]);
});

test("difficulty changes update the existing title without rebuilding it", () => {
  const calls = [];
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, {
    state: "MODE_SELECT",
    mode: "beginner",
    audio: {
      setMode(mode) {
        calls.push(`audio:${mode}`);
      },
      move() {
        calls.push("move");
      }
    },
    scene: {
      loadLevel(level, mode, options) {
        calls.push(
          `load:${level.id}:${mode}:${options?.preserveCamera === true}`
        );
      },
      setPresentation(mode) {
        calls.push(`presentation:${mode}`);
      }
    },
    ui: {
      updateTitleMode(mode) {
        calls.push(`title:${mode}`);
      }
    },
    renderTitle() {
      calls.push("rebuild");
    }
  });

  controller.setMode("advanced");

  assert.equal(controller.mode, "advanced");
  assert.ok(calls.includes("title:advanced"));
  assert.ok(!calls.includes("rebuild"));
  assert.ok(calls.includes("load:A01:advanced:true"));
  assert.ok(!calls.some((call) => call.startsWith("presentation:")));

  controller.currentLevelIndex = 0;
  controller.loadCurrentLevel();
  assert.ok(calls.includes("load:A01:advanced:false"));
});

function connectionController(samples, state = "GAMEPLAY") {
  const queue = [...samples];
  const sceneCalls = [];
  const uiCalls = [];
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, {
    state,
    previousState: "LEVEL_INTRO",
    stateElapsed: 12.5,
    countdownStep: 2,
    frozenCountdown: true,
    timeRemaining: 41,
    currentLevelIndex: 0,
    accumulator: 0,
    autoClear: false,
    offBoardElapsed: 0,
    debugBoardDisconnected: false,
    connectionResumeContext: null,
    connectionReason: null,
    connectionSampleFloor: 0,
    currentInputSample: null,
    input: {
      hardwareRequired: true,
      sample() {
        return queue.shift() || samples.at(-1);
      },
      setDebugBoardDisconnected() {},
      rawBoardSample() {
        return samples.at(-1);
      }
    },
    audio: {
      setPhase(value) {
        sceneCalls.push(`phase:${value}`);
      }
    },
    ui: {
      updateTouchDisplay() {},
      updateGameplay() {},
      showConnectionRequired(reason) {
        uiCalls.push(`show:${reason}`);
      },
      hideConnectionRequired() {
        uiCalls.push("hide");
      }
    },
    scene: {
      setSimulationEnabled(value) {
        sceneCalls.push(`simulation:${value}`);
      },
      setInputEnabled(value) {
        sceneCalls.push(`input:${value}`);
      },
      updateTilt() {},
      fixedStep() {}
    }
  });
  return { controller, sceneCalls, uiCalls };
}

test("connection loss freezes the interrupted run until a newer valid sample arrives", () => {
  const disconnected = {
    x: 0.28,
    y: -0.16,
    connected: false,
    presenceValid: false,
    reason: "SUBSCRIPTION_EPOCH_REPLACED",
    sampleVersion: 10
  };
  const oldValid = {
    ...disconnected,
    connected: true,
    presenceValid: true,
    reason: null
  };
  const freshValid = { ...oldValid, sampleVersion: 11 };
  const { controller, sceneCalls, uiCalls } = connectionController([
    disconnected,
    oldValid,
    freshValid
  ]);

  controller.tick(0.25);
  assert.equal(controller.state, "CONNECTION_REQUIRED");
  assert.equal(controller.timeRemaining, 41);
  assert.deepEqual(controller.connectionResumeContext, {
    state: "GAMEPLAY",
    stateElapsed: 12.5,
    countdownStep: 2,
    frozenCountdown: true,
    initialize: false
  });
  assert.ok(sceneCalls.includes("simulation:false"));
  assert.ok(sceneCalls.includes("input:false"));
  assert.deepEqual(uiCalls, ["show:SUBSCRIPTION_EPOCH_REPLACED"]);

  controller.tick(1);
  assert.equal(controller.state, "CONNECTION_REQUIRED");
  assert.equal(controller.stateElapsed, 0);
  assert.equal(controller.timeRemaining, 41);

  controller.tick(1);
  assert.equal(controller.state, "GAMEPLAY");
  assert.equal(controller.stateElapsed, 12.5);
  assert.equal(controller.timeRemaining, 41);
  assert.equal(controller.connectionResumeContext, null);
  assert.ok(sceneCalls.includes("simulation:true"));
  assert.ok(sceneCalls.includes("input:true"));
  assert.equal(uiCalls.at(-1), "hide");
});

test("step-off uses a short debounce and resumes without restarting the run", () => {
  const offBoard = {
    x: 0.08,
    y: -0.04,
    connected: true,
    presenceValid: false,
    reason: null,
    sampleVersion: 20
  };
  const freshValid = {
    ...offBoard,
    presenceValid: true,
    sampleVersion: 21
  };
  const { controller } = connectionController([
    offBoard,
    offBoard,
    freshValid
  ]);

  controller.tick(0.24);
  assert.equal(controller.state, "GAMEPLAY");
  controller.tick(0.01);
  assert.equal(controller.state, "CONNECTION_REQUIRED");
  assert.equal(controller.connectionReason, "STEP_OFF");
  const frozenTime = controller.timeRemaining;
  controller.tick(0);
  assert.equal(controller.state, "GAMEPLAY");
  assert.equal(controller.timeRemaining, frozenTime);
});

test("P follows the connection-required path, preserves CoP, and waits for a new sample", () => {
  let forced = false;
  let version = 4;
  const controller = Object.create(TableTiltController.prototype);
  const sample = () => ({
    x: 0.31,
    y: -0.22,
    force: 73,
    connected: !forced,
    presenceValid: !forced,
    reason: forced ? "DEBUG_FORCED_DISCONNECT" : null,
    sampleVersion: version
  });
  Object.assign(controller, connectionController([sample()]).controller, {
    state: "GAMEPLAY",
    debugBoardDisconnected: false,
    currentInputSample: sample(),
    input: {
      hardwareRequired: true,
      sample,
      setDebugBoardDisconnected(value) {
        forced = value;
      },
      rawBoardSample() {
        return sample();
      }
    },
    audio: {
      unlock() {},
      setPhase() {}
    }
  });

  const press = (overrides = {}) => {
    let prevented = 0;
    controller.handleKeyDown({
      code: "KeyP",
      repeat: false,
      target: null,
      preventDefault() {
        prevented += 1;
      },
      ...overrides
    });
    return prevented;
  };

  assert.equal(press({ repeat: true }), 0);
  assert.equal(press({ target: { tagName: "INPUT" } }), 0);
  assert.equal(press(), 1);
  assert.equal(controller.state, "CONNECTION_REQUIRED");
  assert.equal(controller.currentInputSample.x, 0.31);
  assert.equal(controller.currentInputSample.y, -0.22);
  assert.equal(controller.connectionSampleFloor, 4);

  assert.equal(press(), 1);
  assert.equal(controller.state, "CONNECTION_REQUIRED");
  controller.tick(0);
  assert.equal(controller.state, "CONNECTION_REQUIRED");
  version = 5;
  controller.tick(0);
  assert.equal(controller.state, "GAMEPLAY");
});

test("External Game checkpoint restore stays behind the fresh hardware gate", () => {
  const entered = [];
  const connectionRequests = [];
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, {
    state: "MODE_SELECT",
    currentLevelIndex: 0,
    timeRemaining: 0,
    levelsCleared: 0,
    drops: 0,
    input: {
      hardwareRequired: true,
      sample: () => ({
        connected: true,
        presenceValid: true,
        sampleVersion: 8
      })
    },
    setMode(mode) {
      this.mode = mode;
    },
    loadCurrentLevel() {
      entered.push("load");
    },
    enterState(state) {
      this.state = state;
      entered.push(state);
    },
    beginConnectionRequired(reason, options) {
      connectionRequests.push({ reason, options });
      this.state = "CONNECTION_REQUIRED";
    }
  });

  const result = controller.restoreExternalGameCheckpoint({
    mode: "advanced",
    screen: "GAMEPLAY",
    level: 4,
    timeRemainingMs: 31_250,
    levelsCleared: 3,
    drops: 2
  });

  assert.equal(result, "run-awaiting-hardware");
  assert.equal(controller.mode, "advanced");
  assert.equal(controller.currentLevelIndex, 3);
  assert.equal(controller.timeRemaining, 31.25);
  assert.deepEqual(entered, ["load", "LEVEL_INTRO"]);
  assert.equal(connectionRequests.length, 1);
  assert.equal(connectionRequests[0].reason, "WAITING_FOR_FRESH_SAMPLE");
  assert.equal(connectionRequests[0].options.resumeState, "LEVEL_INTRO");
  assert.equal(connectionRequests[0].options.sample.sampleVersion, 8);
  assert.equal(controller.state, "CONNECTION_REQUIRED");
});

test("External Game A starts the selected difficulty through the current run-start gate", () => {
  const calls = [];
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, {
    state: "MODE_SELECT",
    mode: "advanced",
    resultCanContinue: false,
    audio: {
      prepareExternalInput(mode) {
        calls.push(`prepare:${mode}`);
      }
    },
    requestRunStart() {
      calls.push(`start:${this.mode}`);
    }
  });

  assert.equal(controller.handleGamepadAction("A", "PRESSED"), true);
  assert.deepEqual(calls, ["prepare:advanced", "start:advanced"]);
});

test("External Game D-pad selects pause/result actions, A confirms, and B returns to title", () => {
  const calls = [];
  const focused = [];
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, {
    state: "PAUSE_MENU",
    mode: "beginner",
    resultCanContinue: true,
    gamepadMenuIndex: 0,
    audio: {
      prepareExternalInput() {},
      move() {
        calls.push("move");
      },
      start() {
        calls.push("start");
      },
      confirm() {
        calls.push("confirm");
      },
      stopVictory() {
        calls.push("stop-victory");
      }
    },
    ui: {
      focusMenuControl(id) {
        focused.push(id);
      }
    },
    restartRun() {
      calls.push("restart");
    },
    enterState(state) {
      this.state = state;
      calls.push(`state:${state}`);
    }
  });

  assert.equal(controller.handleGamepadAction("DOWN", "PRESSED"), true);
  assert.equal(focused.at(-1), "restart-button");
  assert.equal(controller.handleGamepadAction("A", "PRESSED"), true);
  assert.deepEqual(calls.slice(0, 3), ["move", "start", "restart"]);

  controller.state = "GLOBAL_RANK";
  controller.gamepadMenuIndex = 0;
  assert.equal(controller.handleGamepadAction("RIGHT", "PRESSED"), true);
  assert.equal(focused.at(-1), "quit-button");
  assert.equal(controller.handleGamepadAction("A", "PRESSED"), true);
  assert.ok(calls.includes("state:MODE_SELECT"));

  controller.state = "PAUSE_MENU";
  assert.equal(controller.handleGamepadAction("B", "PRESSED"), true);
  assert.deepEqual(calls.slice(-2), ["stop-victory", "state:MODE_SELECT"]);
});

test("every External Game PRESSED prepares audio even without a menu action", () => {
  const calls = [];
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, {
    state: "GAMEPLAY",
    mode: "beginner",
    resultCanContinue: false,
    audio: {
      prepareExternalInput(mode) {
        calls.push(mode);
      }
    }
  });

  assert.equal(controller.handleGamepadAction("UP", "PRESSED"), false);
  assert.equal(controller.handleGamepadAction("UP", "RELEASED"), false);
  assert.equal(controller.handleGamepadAction("UP", "CANCELLED"), false);
  assert.deepEqual(calls, ["beginner"]);
});

test("editable targets include form controls and contenteditable nodes", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(isEditableKeyTarget({ tagName }), true);
  }
  assert.equal(isEditableKeyTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isEditableKeyTarget({ tagName: "BUTTON" }), false);
});

test("level handoff keeps the leaf visible while the camera begins descending", () => {
  let boardVisible = true;
  let hideCalls = 0;
  let loadCalls = 0;
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, {
    state: "LEVEL_CLEAR",
    stateElapsed: 0,
    timingScale: 1,
    mode: "beginner",
    currentLevelIndex: 0,
    timeRemaining: 50,
    levelClear: {
      startTime: 50,
      targetTime: 70,
      nextLoaded: false,
      boardHidden: false,
      isFinal: false
    },
    currentInputSample: null,
    offBoardElapsed: 0,
    debugBoardDisconnected: false,
    input: {
      hardwareRequired: false,
      sample: () => ({
        x: 0,
        y: 0,
        connected: true,
        presenceValid: true,
        sampleVersion: 1
      })
    },
    scene: {
      updateTilt() {},
      hideLevelBoard() {
        hideCalls += 1;
        boardVisible = false;
      },
      loadLevel() {
        loadCalls += 1;
      },
      startLevelHandoffEnter() {
        boardVisible = true;
      },
      isLevelHandoffActive: () => true
    },
    ui: {
      updateGameplay() {},
      updateTouchDisplay() {}
    }
  });

  assert.equal(shouldDescendBetweenLevels("exit"), true);
  controller.tick(UI_TIMING.levelBoardExitMs / 1000);
  assert.equal(boardVisible, true);
  assert.equal(hideCalls, 0);

  controller.tick(
    (UI_TIMING.levelBoardEnterAtMs - UI_TIMING.levelBoardExitMs) / 1000
  );
  assert.equal(loadCalls, 1);
  assert.equal(boardVisible, true);
});

test("F1 stops final victory voices while preserving normal BGM lifecycle", async () => {
  for (const initialState of ["LEVEL_CLEAR", "RUN_COMPLETE"]) {
    let victoryStopCalls = 0;
    let transientStopCalls = 0;
    let bgmPauseCalls = 0;
    let bgmPlayCalls = 0;
    const audio = new GameAudio();
    audio.phase = initialState;
    audio.wasUnlocked = true;
    audio.unlock = () => Promise.resolve(true);
    audio.voices = [
      {
        key: "finish-crowd",
        group: "victory",
        source: {
          stop() {
            victoryStopCalls += 1;
          }
        }
      },
      {
        key: "level-clear",
        group: null,
        source: {
          stop() {
            transientStopCalls += 1;
          }
        }
      }
    ];
    audio.bgmSessionActive = true;
    audio.bgmStartedAt = 1;
    audio.bgm = {
      currentTime: 12.5,
      duration: 60,
      volume: BGM_TRACK.volume,
      play() {
        bgmPlayCalls += 1;
        return Promise.resolve();
      },
      pause() {
        bgmPauseCalls += 1;
      }
    };
    audio.rampBgm = (target, _duration, onComplete) => {
      audio.bgm.volume = target;
      onComplete?.();
    };

    const controller = Object.create(TableTiltController.prototype);
    Object.assign(controller, {
      state: initialState,
      previousState: "GAMEPLAY",
      stateElapsed: 0,
      mode: "beginner",
      qaMode: false,
      currentLevelIndex: 7,
      levelsCleared: 8,
      timeRemaining: 62,
      accumulator: 0,
      offBoardElapsed: 0,
      levelClear: { isFinal: true },
      fallenBallId: null,
      frozenCountdown: false,
      countdownStep: -1,
      connectionResumeContext: null,
      connectionReason: null,
      connectionSampleFloor: 0,
      resultCanContinue: false,
      resumeStateAfterModal: null,
      toastTimer: null,
      audio,
      input: {
        isCoarsePointer: () => false
      },
      ui: {
        clearTimers() {},
        hideToast() {},
        hideCountdown() {},
        beginGameplay() {}
      },
      scene: {
        gameCamera: { skip() {} },
        resetFallenBalls() {},
        endLevelHandoff() {},
        loadLevel() {},
        setPresentation() {},
        setSimulationEnabled() {},
        setInputEnabled() {}
      }
    });

    controller.handleKeyDown({
      code: "F1",
      repeat: false,
      preventDefault() {}
    });
    await Promise.resolve();

    assert.equal(controller.state, "GAMEPLAY", initialState);
    assert.equal(controller.currentLevelIndex, 7, initialState);
    assert.equal(controller.levelsCleared, 7, initialState);
    assert.equal(controller.timeRemaining, 99, initialState);
    assert.equal(
      audio.voices.filter((voice) => voice.group === "victory").length,
      0,
      initialState
    );
    assert.equal(audio.voices.length, 0, initialState);
    assert.equal(victoryStopCalls, 1, initialState);
    assert.equal(transientStopCalls, 1, initialState);
    assert.equal(audio.phase, "GAMEPLAY", initialState);
    assert.equal(audio.bgmSessionActive, true, initialState);
    assert.equal(audio.bgm.currentTime, 12.5, initialState);
    assert.equal(bgmPauseCalls, 0, initialState);
    assert.equal(bgmPlayCalls, 1, initialState);
  }
});

test("Z enters the real final-level victory chain once and ignores editable targets", () => {
  const entered = [];
  let prevented = 0;
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, {
    state: "GAMEPLAY",
    previousState: "LEVEL_INTRO",
    stateElapsed: 0,
    mode: "beginner",
    qaMode: false,
    currentLevelIndex: 2,
    levelsCleared: 2,
    timeRemaining: 42,
    accumulator: 0,
    offBoardElapsed: 0,
    levelClear: null,
    fallenBallId: null,
    frozenCountdown: false,
    countdownStep: -1,
    connectionResumeContext: null,
    resumeStateAfterModal: null,
    toastTimer: null,
    audio: {
      unlock() {},
      setPhase() {},
      stopBgm() {},
      victory() {},
      clear() {}
    },
    input: { isCoarsePointer: () => false },
    ui: {
      clearTimers() {},
      hideToast() {},
      hideCountdown() {},
      beginGameplay() {},
      pulseTimer() {},
      updateGameplay() {}
    },
    scene: {
      gameCamera: { skip() {} },
      resetFallenBalls() {},
      endLevelHandoff() {},
      loadLevel() {},
      setPresentation() {},
      setSimulationEnabled() {},
      setInputEnabled() {},
      celebrateLevelClear() {}
    }
  });
  const enterState = controller.enterState.bind(controller);
  controller.enterState = (state, payload = {}) => {
    entered.push(state);
    return enterState(state, payload);
  };

  controller.handleKeyDown({
    code: "KeyZ",
    repeat: false,
    target: null,
    preventDefault() {
      prevented += 1;
    }
  });
  assert.equal(prevented, 1);
  assert.equal(controller.currentLevelIndex, 7);
  assert.equal(controller.levelsCleared, 8);
  assert.equal(controller.state, "LEVEL_CLEAR");
  assert.deepEqual(entered, ["GAMEPLAY", "LEVEL_CLEAR"]);

  controller.handleKeyDown({
    code: "KeyZ",
    repeat: true,
    target: null,
    preventDefault() {
      prevented += 1;
    }
  });
  controller.handleKeyDown({
    code: "KeyZ",
    repeat: false,
    target: { tagName: "INPUT" },
    preventDefault() {
      prevented += 1;
    }
  });
  assert.equal(prevented, 1);
  assert.equal(controller.levelsCleared, 8);
});

test("F2 and X use the normal clear flow only from intro or gameplay", () => {
  for (const [index, initialState] of ["LEVEL_INTRO", "GAMEPLAY"].entries()) {
    const entered = [];
    const controller = Object.create(TableTiltController.prototype);
    Object.assign(controller, {
      state: initialState,
      mode: "beginner",
      qaMode: false,
      currentLevelIndex: 3,
      levelsCleared: 3,
      timeRemaining: 41,
      audio: { unlock() {} }
    });
    controller.enterState = (state, payload = {}) => {
      controller.state = state;
      entered.push({ state, payload });
    };
    let prevented = 0;

    controller.handleKeyDown({
      code: index === 0 ? "F2" : "KeyX",
      repeat: false,
      preventDefault() {
        prevented += 1;
      }
    });

    assert.equal(prevented, 1);
    assert.equal(controller.levelsCleared, 4);
    assert.deepEqual(
      entered.map((entry) => entry.state),
      initialState === "LEVEL_INTRO"
        ? ["GAMEPLAY", "LEVEL_CLEAR"]
        : ["LEVEL_CLEAR"]
    );
    assert.deepEqual(entered.at(-1).payload, {
      startTime: 41,
      targetTime: 61
    });
  }

  const paused = Object.create(TableTiltController.prototype);
  let pausedClears = 0;
  let pausedPrevented = 0;
  Object.assign(paused, {
    state: "PAUSE_MENU",
    qaMode: false,
    audio: { unlock() {} },
    completeLevel() {
      pausedClears += 1;
    }
  });
  paused.handleKeyDown({
    code: "KeyX",
    repeat: false,
    preventDefault() {
      pausedPrevented += 1;
    }
  });
  assert.equal(pausedPrevented, 1);
  assert.equal(pausedClears, 0);
});

test("X on the final level reaches the normal result calculation", () => {
  const transitions = [];
  let clearCalls = 0;
  let victoryCalls = 0;
  let stopBgmCalls = 0;
  const endingAudioCalls = [];
  let endingCallbacks = null;
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, {
    state: "GAMEPLAY",
    previousState: "LEVEL_INTRO",
    stateElapsed: 0,
    timingScale: 1,
    mode: "beginner",
    qaMode: false,
    currentLevelIndex: 7,
    levelsCleared: 7,
    timeRemaining: 42,
    accumulator: 0,
    levelClear: null,
    resultCanContinue: false,
    scene: {
      setSimulationEnabled() {},
      setInputEnabled() {},
      setPresentation() {},
      celebrateLevelClear() {},
      updateTilt() {},
      isLevelHandoffActive: () => false,
      endLevelHandoff() {},
      beginEnding(callbacks) {
        endingCallbacks = callbacks;
      },
      endEnding() {}
    },
    input: {
      hardwareRequired: false,
      isCoarsePointer: () => false,
      sample: () => ({
        x: 0,
        y: 0,
        connected: true,
        presenceValid: true,
        sampleVersion: 1
      })
    },
    audio: {
      unlock() {},
      setPhase(state) {
        transitions.push(state);
      },
      clear() {
        clearCalls += 1;
      },
      victory() {
        victoryCalls += 1;
      },
      endingPaperBonk() {
        endingAudioCalls.push("paper-bonk");
      },
      endingFortuneAppear() {
        endingAudioCalls.push("fortune-appear");
      },
      endingFortuneVanish() {
        endingAudioCalls.push("fortune-vanish");
      },
      stopBgm({ fadeMs }) {
        assert.equal(fadeMs, 0);
        stopBgmCalls += 1;
      }
    },
    ui: {
      hideToast() {},
      hideHud() {},
      pulseTimer() {},
      updateGameplay() {},
      renderResult() {},
      fadeOutScreenForEnding(onGone) {
        onGone?.();
      },
      clearScreen() {},
      showEndingTip() {}
    }
  });
  controller.personalBest = () => 0;
  controller.savePersonalBest = () => {};

  controller.handleKeyDown({
    code: "KeyX",
    repeat: false,
    preventDefault() {}
  });
  assert.equal(controller.state, "LEVEL_CLEAR");
  assert.equal(controller.levelsCleared, 8);
  assert.equal(controller.levelClear.isFinal, true);
  assert.equal(clearCalls, 0);
  assert.equal(victoryCalls, 0);
  assert.equal(stopBgmCalls, 0);

  controller.tick(levelClearDurationSec(null));
  assert.equal(controller.state, "RUN_COMPLETE");
  assert.equal(victoryCalls, 0);
  controller.tick(0.5);

  /* 收束点先进谢幕动画；tip 读完（UI_TIMING.endingTipMs）才轮到结算板 */
  assert.equal(controller.state, "ENDING");
  assert.equal(victoryCalls, 0);
  assert.equal(controller.score.cleared, 8);
  assert.ok(endingCallbacks, "ENDING hands the director its callbacks");
  endingCallbacks.onPaperBonk();
  endingCallbacks.onFortuneAppear();
  endingCallbacks.onFortuneVanish();
  assert.deepEqual(endingAudioCalls, [
    "paper-bonk",
    "fortune-appear",
    "fortune-vanish"
  ]);
  endingCallbacks.onFinished();
  controller.tick(UI_TIMING.endingTipMs / 1000 + 0.1);

  assert.equal(controller.state, "RESULT_CALC");
  assert.equal(controller.score.cleared, 8);
  assert.equal(victoryCalls, 1);
  assert.ok(transitions.includes("LEVEL_CLEAR"));
  assert.ok(transitions.includes("RUN_COMPLETE"));
  assert.ok(transitions.includes("ENDING"));
  assert.ok(transitions.includes("RESULT_CALC"));

  controller.levelsCleared = 3;
  controller.finishRun(scoreRun(3, 0));
  assert.equal(
    victoryCalls,
    1,
    "an incomplete result must not replay the victory cue"
  );
});

test("final capture toast remains visible for its dwell after entering level clear", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduledToast = null;
  let hideCalls = 0;
  let shownToast = null;

  globalThis.setTimeout = (callback, durationMs) => {
    scheduledToast = { callback, durationMs };
    return 17;
  };
  globalThis.clearTimeout = () => {};

  try {
    const controller = Object.create(TableTiltController.prototype);
    Object.assign(controller, {
      state: "GAMEPLAY",
      previousState: "LEVEL_INTRO",
      stateElapsed: 0,
      timingScale: 1,
      mode: "beginner",
      currentLevelIndex: 7,
      levelsCleared: 7,
      timeRemaining: 42,
      toastTimer: null,
      audio: {
        capture() {},
        setPhase() {},
        clear() {},
        stopBgm() {},
        victory() {}
      },
      scene: {
        setSimulationEnabled() {},
        setInputEnabled() {},
        celebrateLevelClear() {}
      },
      ui: {
        showToast(text, tone) {
          shownToast = { text, tone };
        },
        hideToast() {
          hideCalls += 1;
        },
        pulseTimer() {}
      }
    });

    controller.handleSceneEvent({
      type: "ballCaptured",
      ballId: "BALL_01",
      holeId: "HOLE_01"
    });
    controller.handleSceneEvent({ type: "allCaptured" });

    assert.equal(controller.state, "LEVEL_CLEAR");
    assert.deepEqual(shownToast, { text: "In the hole!", tone: "success" });
    assert.equal(scheduledToast?.durationMs, 900);
    assert.equal(hideCalls, 0);

    scheduledToast.callback();
    assert.equal(hideCalls, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
