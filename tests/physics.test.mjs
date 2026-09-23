import assert from "node:assert/strict";
import test from "node:test";

import {
  TABLE_TILT_CAPTURE_HOLD_SEC,
  TableTiltLeafSim
} from "../src/adapters/table-tilt-leaf-sim.js";
import { createRuntimeCore } from "../src/adapters/runtime-core.js";
import { ADVANCED_DATA, BEGINNER_DATA } from "../src/levels.js";
import { TableTiltScene } from "../src/scene.js";

const FIXED_DT = 1 / 120;
const ALL_LEVELS = [...BEGINNER_DATA.levels, ...ADVANCED_DATA.levels];
const EDGE_PATH_ANGLES = Object.freeze({
  B03: (3 * Math.PI) / 16,
  B04: (15 * Math.PI) / 16,
  B07: Math.PI / 16,
  // A04's full-span fallen branch blocks the straight roll; the documented
  // full-tilt path slides along it and drains around the branch end.
  A04: Math.PI / 8,
  A08: Math.PI / 8
});

function legacyLevel(id) {
  return (
    ALL_LEVELS.find((level) => level.id === id) || { id, balls: [] }
  );
}

function flatField() {
  return {
    spec: {},
    holes: [],
    height() {
      return 0;
    },
    normal(x, z, out) {
      out.x = 0;
      out.y = 1;
      out.z = 0;
      return out;
    },
    sample(x, z, out) {
      out.sdf = -100;
      out.h = 0;
      out.hx = 0;
      out.hz = 0;
      return out;
    }
  };
}

function obstacleImpact({
  restitution,
  rebound,
  incomingNormalSpeed,
  tangentialSpeed = 0,
  angle = 0
}) {
  const field = flatField();
  const obstacle = {
    id: "TEST_BLOCKER",
    kind: "snail",
    x: 0,
    z: 0,
    r: 0.25,
    restitution,
    ...(rebound ? { rebound } : {})
  };
  const board = { obstacles: [obstacle] };
  const sim = new TableTiltLeafSim(field, board, { mode: "advanced" });
  sim.reset(
    {
      id: "TEST",
      board,
      bugs: [{ id: "BUG", x: 0, z: 0, r: 0.3 }]
    },
    field
  );

  const bug = sim.bugs[0];
  const nx = Math.cos(angle);
  const nz = Math.sin(angle);
  const tx = -nz;
  const tz = nx;
  const contactRadius = obstacle.r + bug.r;
  bug.x = nx * contactRadius;
  bug.z = nz * contactRadius;
  bug.vx = -incomingNormalSpeed * nx + tangentialSpeed * tx;
  bug.vz = -incomingNormalSpeed * nz + tangentialSpeed * tz;
  bug.speed = Math.hypot(bug.vx, bug.vz);
  bug.restT = 0.8;

  let hitCount = 0;
  sim.events.on("hit", () => {
    hitCount += 1;
  });
  sim._collideObstacles(bug);

  return {
    bug,
    get hitCount() {
      return hitCount;
    },
    normalSpeed: () => bug.vx * nx + bug.vz * nz,
    tangentialSpeed: () => bug.vx * tx + bug.vz * tz,
    collide: () => sim._collideObstacles(bug),
    setNormalVelocity(speed) {
      bug.vx = speed * nx;
      bug.vz = speed * nz;
      bug.speed = Math.abs(speed);
    }
  };
}

function runB01Tracer() {
  const { field, runtimeLevel, sim } = createRuntimeCore(legacyLevel("B01"));
  const bug = sim.bugs[0];
  let capture = null;
  sim.events.on("capture", ({ bug: captured, hole }) => {
    capture = {
      time: sim.time,
      bugId: captured.id,
      holeId: hole.id,
      z: captured.z
    };
  });

  const samples = [];
  for (let step = 0; step < 2400 && !capture; step += 1) {
    sim.setTilt(-0.13, 0);
    sim.step(FIXED_DT);
    if (step % 30 === 0 || bug.captureHoldT > 0) {
      samples.push({
        step,
        time: sim.time,
        z: bug.z,
        speed: bug.speed,
        state: bug.state,
        hold: bug.captureHoldT || 0
      });
    }
  }

  return {
    capture,
    samples,
    field,
    runtimeLevel,
    sim
  };
}

function runEdgePath(level) {
  const mode = level.id.startsWith("A") ? "advanced" : "beginner";
  const { field, runtimeLevel, sim } = createRuntimeCore(level, mode);
  const angle = EDGE_PATH_ANGLES[level.id] || 0;
  const pitch = Math.sin(angle) * runtimeLevel.maxTilt;
  const roll = -Math.cos(angle) * runtimeLevel.maxTilt;
  let fall = null;
  sim.events.on("fall", ({ bug }) => {
    fall ||= {
      bugId: bug.id,
      time: sim.time,
      x: bug.x,
      z: bug.z,
      sdf: field.sdf(bug.x, bug.z)
    };
  });

  for (let step = 0; step < 8 / FIXED_DT && !fall; step += 1) {
    sim.setTilt(pitch, roll);
    sim.step(FIXED_DT);
  }
  return fall;
}

test("TableTiltLeafSim restores legacy inertia tuning for each mode", () => {
  const beginner = createRuntimeCore(legacyLevel("B01"), "beginner").sim;
  const advanced = createRuntimeCore(legacyLevel("A01"), "advanced").sim;

  assert.deepEqual(
    {
      gravity: beginner.tuning.gravity,
      linearDamp: beginner.tuning.linearDamp,
      rollFriction: beginner.tuning.rollFriction,
      restSpeed: beginner.tuning.restSpeed
    },
    {
      gravity: 9.81,
      linearDamp: 0.027,
      rollFriction: 0.1,
      restSpeed: 0.045
    }
  );
  assert.equal(advanced.tuning.gravity, 9.81);
  assert.equal(advanced.tuning.linearDamp, 0.022);
  assert.equal(advanced.tuning.rollFriction, 0.1);
  assert.equal(advanced.tuning.restSpeed, 0.045);
});

test("a beetle rolling at 3 m/s retains at least 2.4 m/s after three seconds", () => {
  const field = flatField();
  const sim = new TableTiltLeafSim(field, {}, { mode: "beginner" });
  sim.reset(
    {
      board: {},
      bugs: [{ id: "INERTIA", x: 0, z: 0, r: 0.3 }]
    },
    field
  );
  const bug = sim.bugs[0];
  bug.vx = 3;
  bug.speed = 3;

  for (let step = 0; step < 3 / FIXED_DT; step += 1) {
    sim.step(FIXED_DT);
  }

  assert.ok(
    bug.speed >= 2.4,
    `expected at least 2.4 m/s after three seconds, got ${bug.speed}`
  );
});

test("A05 rebound metadata survives native obstacle baking", () => {
  const { sim } = createRuntimeCore(legacyLevel("A05"), "advanced");
  assert.deepEqual(
    sim.obstacles.map(({ id, e, rebound }) => ({ id, e, rebound })),
    [
      {
        id: "BLOCK_01",
        e: 0.55,
        rebound: { normalSpeedMin: 0.3, normalSpeedMax: 0.72 }
      },
      {
        id: "BLOCK_02",
        e: 0.55,
        rebound: { normalSpeedMin: 0.3, normalSpeedMax: 0.72 }
      },
      {
        id: "BLOCK_03",
        e: 0.22,
        rebound: { normalSpeedMin: 0.1, normalSpeedMax: 0.26 }
      },
      {
        id: "BLOCK_04",
        e: 0.22,
        rebound: { normalSpeedMin: 0.1, normalSpeedMax: 0.26 }
      }
    ]
  );
});

test("large and small A05 snails clamp low, normal, and high rebounds", () => {
  const cases = [
    {
      label: "large low",
      restitution: 0.55,
      rebound: { normalSpeedMin: 0.3, normalSpeedMax: 0.72 },
      incoming: 0.3,
      expected: 0.3
    },
    {
      label: "large normal",
      restitution: 0.55,
      rebound: { normalSpeedMin: 0.3, normalSpeedMax: 0.72 },
      incoming: 1,
      expected: 0.55
    },
    {
      label: "large high",
      restitution: 0.55,
      rebound: { normalSpeedMin: 0.3, normalSpeedMax: 0.72 },
      incoming: 2,
      expected: 0.72
    },
    {
      label: "small low",
      restitution: 0.22,
      rebound: { normalSpeedMin: 0.1, normalSpeedMax: 0.26 },
      incoming: 0.3,
      expected: 0.1
    },
    {
      label: "small normal",
      restitution: 0.22,
      rebound: { normalSpeedMin: 0.1, normalSpeedMax: 0.26 },
      incoming: 0.8,
      expected: 0.176
    },
    {
      label: "small high",
      restitution: 0.22,
      rebound: { normalSpeedMin: 0.1, normalSpeedMax: 0.26 },
      incoming: 2,
      expected: 0.26
    }
  ];

  for (const entry of cases) {
    const impact = obstacleImpact({
      restitution: entry.restitution,
      rebound: entry.rebound,
      incomingNormalSpeed: entry.incoming
    });
    assert.ok(
      Math.abs(impact.normalSpeed() - entry.expected) < 1e-9,
      `${entry.label} produced ${impact.normalSpeed()}`
    );
    assert.equal(impact.hitCount, 1, `${entry.label} lost the native hit event`);
    assert.equal(impact.bug.restT, 0, `${entry.label} did not wake the beetle`);
    assert.equal(impact.bug.speed, impact.normalSpeed());
  }
});

test("glancing A05 impacts preserve tangent speed and rebound outward", () => {
  const impact = obstacleImpact({
    restitution: 0.55,
    rebound: { normalSpeedMin: 0.3, normalSpeedMax: 0.72 },
    incomingNormalSpeed: 1,
    tangentialSpeed: 0.37,
    angle: Math.PI / 4
  });

  assert.ok(Math.abs(impact.normalSpeed() - 0.55) < 1e-9);
  assert.ok(Math.abs(impact.tangentialSpeed() - 0.37) < 1e-9);
  assert.ok(impact.normalSpeed() > 0);
  assert.ok(
    Math.abs(
      impact.bug.speed - Math.hypot(impact.normalSpeed(), 0.37)
    ) < 1e-9
  );
});

test("resting and sub-threshold obstacle contacts do not receive repeated kicks", () => {
  const impact = obstacleImpact({
    restitution: 0.55,
    rebound: { normalSpeedMin: 0.3, normalSpeedMax: 0.72 },
    incomingNormalSpeed: 0.3
  });
  assert.ok(Math.abs(impact.normalSpeed() - 0.3) < 1e-9);

  impact.collide();
  assert.ok(Math.abs(impact.normalSpeed() - 0.3) < 1e-9);
  assert.equal(impact.hitCount, 1);

  impact.setNormalVelocity(-0.2);
  impact.bug.restT = 0.8;
  impact.collide();
  assert.ok(Math.abs(impact.normalSpeed() - 0.11) < 1e-9);
  assert.equal(impact.hitCount, 1);
  assert.equal(impact.bug.restT, 0.8);

  impact.setNormalVelocity(0);
  impact.collide();
  assert.equal(impact.normalSpeed(), 0);
  assert.equal(impact.hitCount, 1);
});

test("untagged obstacles retain native restitution without rebound clamping", () => {
  const impact = obstacleImpact({
    restitution: 0.55,
    incomingNormalSpeed: 0.3,
    tangentialSpeed: 0.2
  });

  assert.ok(Math.abs(impact.normalSpeed() - 0.165) < 1e-9);
  assert.ok(Math.abs(impact.tangentialSpeed() - 0.2) < 1e-9);
  assert.equal(impact.hitCount, 1);
  assert.equal(impact.bug.restT, 0.8);
});

test("rim hit payloads bypass the obstacle rebound hook", () => {
  const field = flatField();
  const sim = new TableTiltLeafSim(field, {}, { mode: "advanced" });
  sim.reset(
    {
      id: "RIM",
      board: {},
      bugs: [{ id: "BUG", x: 0, z: 0, r: 0.3 }]
    },
    field
  );
  const bug = sim.bugs[0];
  bug.vx = 0.4;
  bug.vz = -0.2;
  bug.speed = Math.hypot(bug.vx, bug.vz);
  bug.restT = 0.7;

  assert.doesNotThrow(() => {
    sim.events.emit("hit", {
      bug,
      other: null,
      kind: "rim",
      edge: true,
      speed: bug.speed
    });
  });
  assert.equal(bug.vx, 0.4);
  assert.equal(bug.vz, -0.2);
  assert.equal(bug.restT, 0.7);
});

test("B01 native tracer is deterministic and captures through one Field", () => {
  const first = runB01Tracer();
  assert.ok(first.capture, "B01 tracer never captured");
  assert.equal(first.capture.bugId, "BALL_01");
  assert.equal(first.capture.holeId, "HOLE_01");
  assert.ok(first.capture.time > 1.5 && first.capture.time < 2);
  assert.equal(first.runtimeLevel.field, first.field);
  assert.equal(first.sim.field, first.field);
  assert.ok(first.samples.some((sample) => sample.hold > 0 && sample.hold < 1));

  for (let run = 0; run < 4; run += 1) {
    const replay = runB01Tracer();
    assert.equal(replay.capture.time, first.capture.time);
    assert.equal(replay.capture.z, first.capture.z);
  }
});

test("all 16 Fields have a deterministic full-tilt path over the native edge", () => {
  for (const level of ALL_LEVELS) {
    const first = runEdgePath(level);
    assert.ok(first, `${level.id} never entered falling`);
    assert.ok(first.sdf >= 0, `${level.id} fell before crossing the Field edge`);

    const replay = runEdgePath(level);
    assert.deepEqual(replay, first, `${level.id} edge path was not deterministic`);
  }
});

test("capture waits nine fixed steps and the same hole is reusable", () => {
  const { sim } = createRuntimeCore(legacyLevel("A03"), "advanced");
  const hole = sim.holes[0];
  const [first, second] = sim.bugs;
  assert.equal(Math.ceil(TABLE_TILT_CAPTURE_HOLD_SEC / FIXED_DT), 9);

  for (const bug of [first, second]) {
    bug.x = hole.x;
    bug.z = hole.z;
    bug.y = sim.field.height(hole.x, hole.z) + bug.r;
    bug.vx = bug.vz = bug.speed = 0;
    for (let step = 0; step < 8; step += 1) sim.step(FIXED_DT);
    assert.equal(bug.state, "roll");
    sim.step(FIXED_DT);
    assert.equal(bug.state, "captured");
    assert.equal(bug.hole.id, hole.id);
  }
  assert.equal(sim.remaining, 0);
});

test("capture hold has no speed gate", () => {
  const { sim } = createRuntimeCore(legacyLevel("B01"));
  const bug = sim.bugs[0];
  const hole = sim.holes[0];
  bug.x = hole.x;
  bug.z = hole.z;
  bug.y = sim.field.height(hole.x, hole.z) + bug.r;
  bug.vx = 8;
  bug.vz = 0;
  bug.speed = 8;
  sim.tuning.rollFriction = 0;
  sim.tuning.linearDamp = 0;

  for (let step = 0; step < 9; step += 1) {
    bug.x = hole.x;
    bug.z = hole.z;
    sim.step(FIXED_DT);
  }
  assert.equal(bug.state, "captured");
});

test("match-all runtime levels reject a bug entering the wrong-colour hole", () => {
  const source = structuredClone(legacyLevel("A08"));
  source.colorMatch = undefined;
  source.clearRule = "match-all";
  const { runtimeLevel, sim } = createRuntimeCore(source, "advanced");
  const bug = sim.bugs.find((entry) => entry.color === "blue");
  const wrongHole = sim.holes.find((entry) => entry.color !== bug.color);
  let captures = 0;
  let rejects = 0;
  sim.events.on("capture", () => { captures += 1; });
  sim.events.on("wrongHole", () => { rejects += 1; });

  assert.equal(runtimeLevel.colorMatch, true);
  assert.equal(sim.forceCapture(bug, wrongHole), false);
  assert.equal(bug.state, "roll");
  assert.equal(sim.remaining, sim.bugs.length);
  assert.equal(captures, 0);
  assert.equal(rejects, 1);
});

test("a fall emits one whole-board failure payload and reset preserves captures", () => {
  const { sim } = createRuntimeCore(legacyLevel("B03"));
  const captured = sim.bugs[0];
  const falling = sim.bugs[1];
  sim.forceCapture(captured, sim.holes[0]);

  const failures = [];
  sim.events.on("boardFailure", (payload) => {
    failures.push({
      triggerBugId: payload.triggerBugId,
      bugIds: [...payload.bugIds],
      capturedBugIds: [...payload.capturedBugIds]
    });
  });
  sim.forceFall(falling);
  sim.forceFall(falling);

  assert.deepEqual(failures, [
    {
      triggerBugId: falling.id,
      bugIds: [falling.id],
      capturedBugIds: [captured.id]
    }
  ]);
  sim.resetUncaptured();
  assert.equal(captured.state, "captured");
  assert.equal(falling.state, "roll");
});

test("a second beetle that falls later keeps descending before board reset", () => {
  const { sim } = createRuntimeCore(legacyLevel("B03"));
  const [first, second] = sim.bugs;
  const scene = Object.create(TableTiltScene.prototype);
  scene.sim = sim;
  scene.physicsEnabled = true;
  scene.pitch = { angle: 0, velocity: 0 };
  scene.roll = { angle: 0, velocity: 0 };
  scene.simTime = 0;
  scene.failureDropActive = false;
  scene.failureActive = false;
  scene.failureElapsed = 0;
  scene.failureFallenBallIds = new Set();
  scene.balls = sim.bugs.map((bug) => ({
    id: bug.id,
    get captured() {
      return bug.state === "captured";
    },
    simBug: bug,
    failureFadeElapsed: 0,
    captureFadeElapsed: 0,
    visualOpacity: 1,
    insect: {
      group: { visible: true },
      update() {},
      setOpacity() {}
    }
  }));

  scene.startFailureDrop(first.id);
  assert.equal(first.state, "falling");
  assert.equal(second.state, "roll");

  for (let step = 0; step < 30; step += 1) {
    scene.fixedStep(FIXED_DT);
    scene.updateBallVisuals(FIXED_DT);
  }

  sim.forceFall(second);
  const secondStartY = second.y;
  scene.fixedStep(FIXED_DT);
  scene.updateBallVisuals(FIXED_DT);
  assert.equal(scene.failureFallenBallIds.has(second.id), true);

  for (let step = 0; step < 90; step += 1) {
    scene.fixedStep(FIXED_DT);
    scene.updateBallVisuals(FIXED_DT);
  }

  assert.ok(second.y < secondStartY - 0.5);
  assert.equal(scene.hasAllFallenBallsClearedBoard(), true);
  assert.equal(scene.hasAllFallenBallsFadedOut(), true);
  assert.ok(scene.latestFallenBallElapsed() >= 0.58);
});

test("B03, A03, and A08 fixture stress stays finite", () => {
  for (const id of ["B03", "A03", "A08"]) {
    for (let cycle = 0; cycle < 12; cycle += 1) {
      const mode = id.startsWith("A") ? "advanced" : "beginner";
      const { field, sim } = createRuntimeCore(legacyLevel(id), mode);
      const sign = cycle % 2 === 0 ? 1 : -1;
      for (let step = 0; step < 360; step += 1) {
        sim.setTilt(0.08 * sign, -0.07 * sign);
        sim.step(FIXED_DT);
      }
      for (const bug of sim.bugs) {
        assert.ok(Number.isFinite(bug.x), `${id} x became non-finite`);
        assert.ok(Number.isFinite(bug.y), `${id} y became non-finite`);
        assert.ok(Number.isFinite(bug.z), `${id} z became non-finite`);
      }
      assert.equal(sim.field, field);
      sim.dispose();
    }
  }
});
