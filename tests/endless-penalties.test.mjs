import assert from "node:assert/strict";
import test from "node:test";

import {
  COLLISION_PENALTY_COOLDOWN_MS,
  DEW_PER_POTION,
  ENDLESS_FALL_PENALTY_SEC,
  ENDLESS_OBSTACLE_PENALTY_SEC,
  POTION_REVIVE_SEC,
  ROGUE_BLESSING_INTERVAL,
  TableTiltController
} from "../src/controller.js";

function controllerStub(mode = "endless") {
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, {
    mode,
    state: "GAMEPLAY",
    timeRemaining: 30,
    currentLevelIndex: 4,
    collisionPenaltyUntil: new Map(),
    audio: { hit() {}, fall() {}, capture() {} },
    vibration: { play() {} },
    ui: {
      updateGameplay() {},
      penaltyShake() {},
      showToast() {},
      hideToast() {},
      setRogueBlessings() {}
    },
    showTimedToast() {},
    enterState(next) { this.state = next; },
    drops: 0,
    bonusPoints: 0,
    levelFalls: 0,
    cleanWinStreak: 0,
    struggleStreak: 0,
    adaptiveDifficulty: 0,
    hintShownThisLevel: false,
    butterflyHintPending: false,
    rogueBlessings: { dewlight: 0, treasureLuck: 0, butterflyBond: 0 },
    run: { setDifficultyOffset() {} },
    scene: { showButterflyHint() {} },
    fallenBallId: null
  });
  return controller;
}

test("N skips an endless leaf without QA and ignores repeated presses", () => {
  const controller = controllerStub();
  controller.audio.unlock = () => {};
  let skips = 0;
  let prevented = 0;
  controller.debugClearLevel = () => { skips += 1; };
  const event = { code: "KeyN", repeat: false, target: null, preventDefault() { prevented += 1; } };
  controller.handleKeyDown(event);
  assert.equal(skips, 1);
  assert.equal(prevented, 1);
  controller.handleKeyDown({ ...event, repeat: true });
  assert.equal(skips, 1);
  controller.mode = "beginner";
  controller.handleKeyDown(event);
  assert.equal(skips, 1);
});

test("F3 toggles the QA panel without stealing the D movement key", () => {
  const controller = controllerStub();
  controller.qaMode = true;
  controller.audio.unlock = () => {};
  let toggles = 0;
  controller.toggleDebugPanel = () => { toggles += 1; };
  controller.handleKeyDown({ code: "KeyD", repeat: false, target: null, preventDefault() {} });
  assert.equal(toggles, 0);
  controller.handleKeyDown({ code: "F3", repeat: false, target: null, preventDefault() {} });
  assert.equal(toggles, 1);
});

test("endless obstacle impacts keep time unchanged", () => {
  const controller = controllerStub();
  const event = {
    type: "collision",
    intensity: 0.5,
    ballId: "BALL_01",
    obstacleId: "SPIKE_01",
    obstacleKind: "spike"
  };
  controller.handleSceneEvent(event);
  assert.equal(controller.timeRemaining, 30);
  controller.handleSceneEvent(event);
  assert.equal(controller.timeRemaining, 30);
  assert.equal(ENDLESS_OBSTACLE_PENALTY_SEC, 0);
});

test("an endless fall keeps time unchanged and enters recovery", () => {
  const controller = controllerStub();
  controller.handleSceneEvent({ type: "ballFell", ballId: "BALL_02" });
  assert.equal(controller.timeRemaining, 30);
  assert.equal(ENDLESS_FALL_PENALTY_SEC, 0);
  assert.equal(controller.drops, 1);
  assert.equal(controller.state, "BALL_FALL_DROP");
});

test("authored modes keep their established timing", () => {
  const controller = controllerStub("beginner");
  controller.handleSceneEvent({
    type: "collision",
    intensity: 0.5,
    ballId: "BALL_01",
    obstacleId: "BLOCK_01"
  });
  assert.equal(controller.timeRemaining, 30);
});

test("collectible dew adds to endless final score", () => {
  const controller = controllerStub();
  controller.levelsCleared = 3;
  controller.handleSceneEvent({ type: "dewCollected", points: 5 });
  controller.handleSceneEvent({ type: "dewCollected", points: 5 });
  assert.equal(controller.bonusPoints, 10);
  assert.deepEqual(controller.currentScore(), {
    cleared: 3,
    levelPoints: 30,
    timePoints: 30,
    bonusPoints: 10,
    totalPoints: 70
  });
});

test("authored modes ignore collectible dew", () => {
  const controller = controllerStub("advanced");
  controller.handleSceneEvent({ type: "dewCollected", points: 5 });
  assert.equal(controller.bonusPoints, 0);
});

test("dew automatically brews a revive potion at the configured threshold", () => {
  const controller = controllerStub();
  controller.dewBank = DEW_PER_POTION - 1;
  controller.potions = 0;
  controller.addDewCurrency(1, "Dew collected");
  assert.equal(controller.dewBank, 0);
  assert.equal(controller.potions, 1);
});

test("a potion revives an endless run with twelve seconds", () => {
  const controller = controllerStub();
  controller.timeRemaining = 0;
  controller.potions = 1;
  assert.equal(controller.tryPotionRevive(), true);
  assert.equal(controller.potions, 0);
  assert.equal(controller.timeRemaining, POTION_REVIVE_SEC);
});

test("stacked falling ladybugs award time when their carrier is captured", () => {
  const controller = controllerStub();
  controller.handleSceneEvent({ type: "ballCaptured", ballId: "BALL_01", holeId: "HOLE_01", stackCount: 3 });
  assert.equal(controller.timeRemaining, 39);
});

test("a wrong-colour hole gives feedback without changing time", () => {
  const controller = controllerStub();
  controller.handleSceneEvent({
    type: "wrongHole",
    ballId: "BALL_01",
    ballColor: "red",
    holeId: "HOLE_02",
    holeColor: "teal"
  });
  assert.equal(controller.timeRemaining, 30);
});

test("rogue mode keeps rewards but ignores timed penalties", () => {
  const controller = controllerStub("rogue");
  controller.timeRemaining = Infinity;
  controller.bonusPoints = 10;
  assert.equal(controller.applyEndlessTimePenalty(5, "fall"), false);
  assert.equal(controller.timeRemaining, Infinity);
  const score = controller.currentScore();
  assert.equal(score.timePoints, 0);
  assert.equal(score.bonusPoints, 10);
});

test("rogue mode stacks a forest blessing every three clears", () => {
  const controller = controllerStub("rogue");
  controller.timeRemaining = Infinity;
  controller.levelsCleared = ROGUE_BLESSING_INTERVAL - 1;
  controller.completeLevel();
  assert.equal(controller.rogueBlessings.dewlight, 1);
  controller.state = "GAMEPLAY";
  controller.handleSceneEvent({ type: "dewCollected", points: 5 });
  assert.equal(controller.bonusPoints, 7);
});

test("two clean clears raise future endless difficulty", () => {
  const offsets = [];
  const controller = controllerStub();
  controller.run.setDifficultyOffset = (index, value) => offsets.push([index, value]);
  controller.completeLevel();
  controller.state = "GAMEPLAY";
  controller.currentLevelIndex = 1;
  controller.completeLevel();
  assert.equal(controller.adaptiveDifficulty, 0.08);
  assert.deepEqual(offsets.at(-1), [2, 0.08]);
});

test("two struggled clears lower future endless difficulty", () => {
  const controller = controllerStub();
  controller.levelFalls = 1;
  controller.completeLevel();
  controller.state = "GAMEPLAY";
  controller.currentLevelIndex = 1;
  controller.levelFalls = 2;
  controller.completeLevel();
  assert.equal(controller.adaptiveDifficulty, -0.12);
});

test("a third fall schedules one butterfly guide and immediate assistance", () => {
  const controller = controllerStub();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    controller.state = "GAMEPLAY";
    controller.handleSceneEvent({ type: "ballFell", ballId: `BALL_0${attempt + 1}` });
  }
  assert.equal(controller.levelFalls, 3);
  assert.equal(controller.butterflyHintPending, true);
  assert.equal(controller.hintShownThisLevel, true);
  assert.equal(controller.adaptiveDifficulty, -0.08);
});
