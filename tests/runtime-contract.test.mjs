import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createRuntimeCore } from "../src/adapters/runtime-core.js";
import { normalizeRuntimeLevel } from "../src/adapters/runtime-level.js";
import {
  BALANCE_BOARD_X_GAIN,
  BALANCE_BOARD_Y_SENSITIVITY,
  calculateRenderPixelRatio,
  MAX_RENDER_BACKING_PIXELS,
  mapGameplayTiltInput,
  TableTiltScene
} from "../src/scene.js";
import { ADVANCED_DATA, BEGINNER_DATA } from "../src/levels.js";

const ALL_LEVELS = [...BEGINNER_DATA.levels, ...ADVANCED_DATA.levels];

test("runtime consumes the 16 authored native Field records directly", () => {
  assert.equal(ALL_LEVELS.length, 16);
  for (const level of ALL_LEVELS) {
    assert.ok(Array.isArray(level.board.shapes));
    assert.equal(Object.hasOwn(level.board, "parts"), false);
    for (const shape of level.board.shapes) {
      assert.equal(Object.hasOwn(shape, "type"), false);
      assert.ok(typeof shape.kind === "string");
    }
  }
});

test("runtime zone index follows the mapped journey slot before the level ID", () => {
  const thirdBeginner = normalizeRuntimeLevel(BEGINNER_DATA.levels[2]);
  const fifthBeginner = normalizeRuntimeLevel(BEGINNER_DATA.levels[4]);
  assert.equal(thirdBeginner.id, "B04");
  assert.equal(thirdBeginner.index, 2);
  assert.equal(fifthBeginner.id, "B03");
  assert.equal(fifthBeginner.index, 4);
  assert.equal(normalizeRuntimeLevel(ADVANCED_DATA.levels[2]).index, 2);
});

test("legacy top-level balls normalize without reconstructing board geometry", () => {
  const board = BEGINNER_DATA.levels[0].board;
  const runtime = normalizeRuntimeLevel({
    id: "legacy-ball-shell",
    board,
    balls: [
      {
        id: "BALL_01",
        color: "black",
        species: "scarab",
        spawn: [0.25, -0.5],
        radius: 0.12
      }
    ]
  });
  assert.equal(runtime.board, board);
  assert.equal(runtime.bugs.length, 1);
  assert.deepEqual(
    {
      id: runtime.bugs[0].id,
      color: runtime.bugs[0].color,
      species: runtime.bugs[0].species,
      x: runtime.bugs[0].x,
      z: runtime.bugs[0].z
    },
    {
      id: "BALL_01",
      color: "blue",
      species: "scarab",
      x: 1.05,
      z: -1.3
    }
  );
});

test("native semantic colors normalize to Mossfall render keys", () => {
  const source = {
    id: "native-colors",
    board: {
      smooth: 0.1,
      shapes: [{ kind: "disc", x: 0, z: 0, r: 4 }],
      features: [],
      holes: [
        {
          id: "HOLE_01",
          color: "white",
          x: 0,
          z: -1,
          r: 0.5,
          target: true,
          style: "bite",
          glow: 0
        }
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      { id: "BLACK", color: "black", species: "scarab", x: -1, z: 0, r: 0.3 },
      { id: "PINK", color: "pink", species: "firefly", x: 0, z: 0, r: 0.3 },
      { id: "WHITE", color: "white", species: "weevil", x: 1, z: 0, r: 0.3 }
    ]
  };
  const runtime = normalizeRuntimeLevel(source);
  assert.deepEqual(runtime.bugs.map((bug) => bug.color), [
    "blue",
    "purple",
    "yellow"
  ]);
  assert.deepEqual(runtime.bugs.map((bug) => bug.species), [
    "scarab",
    "firefly",
    "weevil"
  ]);
  assert.equal(runtime.board.holes[0].color, "yellow");
  assert.equal(source.bugs[0].color, "black");
});

test("scene tilt authority comes from runtimeLevel.maxTilt", () => {
  const scene = Object.create(TableTiltScene.prototype);
  scene.runtimeLevel = { maxTilt: 0.045 };
  scene.inputEnabled = true;
  scene.roll = { angle: 0, velocity: 0 };
  scene.pitch = { angle: 0, velocity: 0 };
  for (let step = 0; step < 360; step += 1) {
    scene.updateTilt({ x: 1, y: 1 }, 1 / 120);
  }
  assert.ok(Math.abs(scene.roll.angle - 0.045) < 0.0001);
  assert.ok(Math.abs(scene.pitch.angle - 0.045) < 0.0001);
});

test("scene applies the tuned hardware response with stronger vertical control", () => {
  assert.equal(BALANCE_BOARD_X_GAIN, 1.2);
  assert.equal(BALANCE_BOARD_Y_SENSITIVITY, 2.4);

  const tenPercent = mapGameplayTiltInput({
    x: 0.1,
    y: 0.1,
    source: "balance-board"
  });
  const twentyPercent = mapGameplayTiltInput({
    x: 0.2,
    y: 0.2,
    source: "balance-board"
  });
  assert.ok(Math.abs(tenPercent.x - 0.073) < 0.002);
  assert.ok(Math.abs(tenPercent.y - 0.186) < 0.002);
  assert.ok(Math.abs(twentyPercent.x - 0.186) < 0.002);
  assert.ok(Math.abs(twentyPercent.y - 0.430) < 0.002);

  const hardwareTarget = mapGameplayTiltInput({
    x: 0.5,
    y: 0.5,
    source: "balance-board"
  });
  const keyboardTarget = mapGameplayTiltInput({
    x: 0.5,
    y: 0.5,
    source: "keyboard"
  });
  assert.ok(hardwareTarget.x > keyboardTarget.x);
  assert.equal(hardwareTarget.y, 1);
  assert.equal(keyboardTarget.y, keyboardTarget.x);

  const hardwareScene = Object.create(TableTiltScene.prototype);
  hardwareScene.runtimeLevel = { maxTilt: 0.2 };
  hardwareScene.inputEnabled = true;
  hardwareScene.roll = { angle: 0, velocity: 0 };
  hardwareScene.pitch = { angle: 0, velocity: 0 };
  hardwareScene.updateTilt(
    { x: 0, y: 0.5, source: "balance-board" },
    1 / 120
  );

  const keyboardScene = Object.create(TableTiltScene.prototype);
  keyboardScene.runtimeLevel = { maxTilt: 0.2 };
  keyboardScene.inputEnabled = true;
  keyboardScene.roll = { angle: 0, velocity: 0 };
  keyboardScene.pitch = { angle: 0, velocity: 0 };
  keyboardScene.updateTilt(
    { x: 0, y: 0.5, source: "keyboard" },
    1 / 120
  );

  assert.ok(hardwareScene.pitch.angle > keyboardScene.pitch.angle);
});

test("large viewports stay inside the 1080p backing-pixel budget", () => {
  assert.equal(MAX_RENDER_BACKING_PIXELS, 1920 * 1080);
  const cases = [
    {
      width: 4096,
      height: 2160,
      dpr: 2,
      expected: Math.sqrt((1920 * 1080) / (4096 * 2160))
    },
    { width: 3840, height: 2160, dpr: 2, expected: 0.5 },
    {
      width: 2560,
      height: 1080,
      dpr: 2,
      expected: Math.sqrt((1920 * 1080) / (2560 * 1080))
    },
    { width: 1920, height: 1080, dpr: 2, expected: 1 },
    { width: 402, height: 874, dpr: 3, expected: 1.5 }
  ];

  for (const { width, height, dpr, expected } of cases) {
    const ratio = calculateRenderPixelRatio(width, height, dpr);
    assert.ok(Math.abs(ratio - expected) < Number.EPSILON * 4);
    assert.ok(ratio <= dpr);
    assert.ok(ratio <= 1.5);
    assert.ok(
      width * height * ratio ** 2 <= MAX_RENDER_BACKING_PIXELS + 1,
      `${width}x${height} at ${ratio} exceeded the backing-pixel budget`
    );
  }
});

test("capture adapter contains hold logic but no capture-speed gate", async () => {
  const source = await readFile(
    new URL("../src/adapters/table-tilt-leaf-sim.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /captureHoldSec/);
  assert.match(source, /hold\.elapsed/);
  assert.doesNotMatch(source, /captureSpeed/);
});

test("all authored level cores retain one Field identity", () => {
  for (const level of ALL_LEVELS) {
    const { field, runtimeLevel, sim } = createRuntimeCore(
      level,
      level.id.startsWith("A") ? "advanced" : "beginner"
    );
    assert.equal(runtimeLevel.field, field);
    assert.equal(sim.field, field);
    sim.dispose();
  }
});

test("scene creates one upstream insect owner per simulated bug", async () => {
  const source = await readFile(
    new URL("../src/scene.js", import.meta.url),
    "utf8"
  );
  assert.equal((source.match(/new TableTiltInsectView\(/g) || []).length, 1);
  assert.doesNotMatch(
    source,
    /createGhost|ghostMesh|createBallTrail|SporeHalo|haloMesh/
  );
  assert.match(source, /ownerCount:\s*insect\.ownerCount/);
  assert.match(source, /shellCount:\s*insect\.shellCount/);
  assert.match(source, /rigCount:\s*insect\.rigCount/);
  assert.match(source, /shadowCount:\s*index < shadowSlots/);
  assert.match(source, /castShadowMeshCount:\s*insect\.castShadowMeshCount/);
});

test("package lock resolves Three r169 with no Cannon package", async () => {
  const lock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8")
  );
  assert.equal(lock.packages[""].dependencies.three, "0.169.0");
  assert.equal(lock.packages[""].dependencies["cannon-es"], undefined);
  assert.equal(lock.packages["node_modules/three"].version, "0.169.0");
  assert.equal(lock.packages["node_modules/cannon-es"], undefined);
});
