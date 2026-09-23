import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as THREE from "three";
import { normalizeRuntimeLevel } from "../src/adapters/runtime-level.js";
import { createRuntimeCore } from "../src/adapters/runtime-core.js";
import { GameCamera } from "../src/mossfall/game/camera.js";
import { LeafPlatform } from "../src/mossfall/render/leaf.js";
import { buildFieldMesh } from "../src/mossfall/sim/field.js";
import { ADVANCED_DATA, BEGINNER_DATA } from "../src/levels.js";

const ALL_LEVELS = [...BEGINNER_DATA.levels, ...ADVANCED_DATA.levels];
const levelById = (id) => ALL_LEVELS.find((level) => level.id === id);

async function sha256(url) {
  const bytes = await readFile(url);
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

test("upstream Mossfall modules match the SHA-256 manifest", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../src/mossfall/upstream-sha256.json", import.meta.url),
      "utf8"
    )
  );
  assert.equal(manifest.threeVersion, "0.169.0");
  assert.equal(manifest.sourcePolicy, "read-only");
  assert.ok(manifest.files.length >= 14);
  for (const record of manifest.files) {
    assert.equal(
      await sha256(
        new URL(`../src/mossfall/${record.file}`, import.meta.url)
      ),
      record.sha256,
      `${record.file} drifted from the read-only upstream source`
    );
  }
});

test("native level.board records pass through without geometry translation", async () => {
  const board = levelById("B01").board;
  const runtime = normalizeRuntimeLevel({
    id: "B01-native",
    board,
    bugs: [{ id: "BUG", x: 0, z: 0, r: 0.3 }]
  });
  assert.equal(runtime.board, board);

  const nativeBurrow = {
    smooth: 0.2,
    shapes: [{ kind: "disc", x: 0, z: 0, r: 3 }],
    holes: [{ id: "H", x: 0, z: 0, r: 0.5, target: true }]
  };
  const normalizedBurrow = normalizeRuntimeLevel({
    id: "native-burrow",
    board: nativeBurrow,
    bugs: []
  });
  assert.notEqual(normalizedBurrow.board, nativeBurrow);
  assert.equal(normalizedBurrow.board.shapes, nativeBurrow.shapes);
  assert.deepEqual(normalizedBurrow.board.holes[0], {
    ...nativeBurrow.holes[0],
    style: "bite",
    glow: 0
  });

  const source = await readFile(
    new URL("../src/adapters/runtime-level.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /shape\.parts|pointInBoardShape|BoardFieldAdapter/);
});

test("one Field instance drives LeafSim, LeafPlatform, and GameCamera", () => {
  const { field, runtimeLevel, sim } = createRuntimeCore(levelById("B01"));
  const leaf = new LeafPlatform(field, runtimeLevel, "low");
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 700);
  const gameCamera = new GameCamera(camera);
  gameCamera.frameLevel(runtimeLevel);

  assert.equal(sim.field, field);
  assert.equal(leaf.field, field);
  assert.equal(gameCamera._fieldFor(runtimeLevel), field);

  const bug = sim.bugs[0];
  bug.restT = 1;
  leaf.update(1 / 60, 1, sim.bugs);
  const activeShadowSlots = [];
  for (let slot = 0; slot < 8; slot += 1) {
    const base = slot * 4;
    if (
      leaf._shadowAlpha
        .subarray(base, base + 4)
        .some((value) => value > 0)
    ) {
      activeShadowSlots.push(slot);
    }
  }
  assert.deepEqual(activeShadowSlots, [0]);
  assert.equal(leaf.shadows.geometry.getAttribute("position").count, 8 * 4);

  leaf.dispose();
  sim.dispose();
  gameCamera.dispose();
});

test("authored native meshes preserve B03, A03, and A08 topology", () => {
  for (const level of ALL_LEVELS) {
    const { field } = createRuntimeCore(level);
    const mesh = buildFieldMesh(field, {
      res: 56,
      skirt: true,
      thickness: 0.055
    });
    assert.ok(mesh.topCount > 100, `${level.id} produced an empty mesh`);
    assert.ok(mesh.index.length > 400, `${level.id} produced too few faces`);
  }

  const b03 = createRuntimeCore(levelById("B03")).field;
  assert.ok(b03.sdf(0, 0) < 0);
  assert.ok(b03.sdf(3.15, 1.95) < 0);
  assert.ok(b03.sdf(3.15, 0) > 0);

  const a03 = createRuntimeCore(levelById("A03")).field;
  assert.ok(a03.sdf(0, 0) > 0);
  assert.ok(a03.sdf(3.1, 0) < 0);

  const a08 = createRuntimeCore(levelById("A08")).field;
  assert.ok(a08.sdf(0, 0) > 0);
  for (const [x, z] of [
    [-2.184, -1.04],
    [2.184, -1.04],
    [-2.184, 1.04],
    [2.184, 1.04]
  ]) {
    assert.ok(a08.sdf(x, z) < 0);
  }
});

test("capture openings are real cuts with one thin lip and no active cavity", () => {
  for (const level of ALL_LEVELS) {
    const { field, runtimeLevel, sim } = createRuntimeCore(level);
    const leaf = new LeafPlatform(field, runtimeLevel, "medium");
    assert.ok(leaf.furniture, `${level.id} has no hole lip geometry`);
    assert.equal(Boolean(leaf.glow), false, `${level.id} regained hole glow`);
    assert.equal(
      leaf.group.children.filter((child) => child.name === "leafBurrows").length,
      1
    );
    const positions = leaf.furniture.geometry.getAttribute("position");
    const perHole = new Map(
      field.holes.map((hole) => [
        hole.id,
        { hole, minY: Infinity, maxY: -Infinity, vertices: 0 }
      ])
    );
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      let nearest = field.holes[0];
      let nearestDistance = Infinity;
      for (const hole of field.holes) {
        const distance = Math.hypot(x - hole.x, z - hole.z);
        if (distance < nearestDistance) {
          nearest = hole;
          nearestDistance = distance;
        }
      }
      const stats = perHole.get(nearest.id);
      stats.minY = Math.min(stats.minY, y);
      stats.maxY = Math.max(stats.maxY, y);
      stats.vertices += 1;
    }
    for (const { hole, minY, maxY, vertices } of perHole.values()) {
      const surfaceY = field.height(hole.x, hole.z);
      assert.equal(hole.style, "bite");
      assert.ok(field.sdf(hole.x, hole.z) < 0);
      assert.ok(field.visualSdf(hole.x, hole.z) > 0);
      assert.ok(vertices > 0, `${level.id} ${hole.id} has no lip vertices`);
      assert.ok(
        minY >= surfaceY - 0.025,
        `${level.id} ${hole.id} extends into a throat/floor`
      );
      assert.ok(
        maxY <= surfaceY + 0.025,
        `${level.id} ${hole.id} extends into a cone/funnel`
      );
      assert.ok(
        maxY - minY <= 0.04,
        `${level.id} ${hole.id} presentation is not a thin lip`
      );
    }
    leaf.dispose();
    sim.dispose();
  }
});
