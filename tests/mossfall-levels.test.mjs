import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVANCED_DATA,
  ADVANCED_PLAY_ORDER,
  BEGINNER_DATA,
  BEGINNER_PLAY_ORDER
} from "../src/levels.js";
import {
  Field,
  buildFieldMesh
} from "../src/mossfall/sim/field.js";

const BEGINNER = BEGINNER_DATA.levels;
const ADVANCED = ADVANCED_DATA.levels;
const ALL_LEVELS = [...BEGINNER, ...ADVANCED];
const BREAK_SLOPE = 1 / ((5 / 7) * 16.5);
const REST_SLOPE = 0.055;
const LEVEL_KEYS = [
  "board",
  "bugs",
  "descent",
  "gameplay",
  "id",
  "maxTilt",
  "name",
  "origin",
  "props",
  "zone"
];
const BOARD_KEYS = [
  "features",
  "holes",
  "movers",
  "obstacles",
  "shapes",
  "smooth"
];
const SHAPE_KINDS = new Set([
  "disc",
  "ellipse",
  "capsule",
  "heart",
  "lobe"
]);
const FEATURE_KINDS = new Set([
  "dish",
  "curl",
  "vein",
  "bump",
  "ridge",
  "ripple"
]);
const SPECIES_BY_COLOR = {
  red: "ladybug",
  black: "scarab",
  teal: "firefly",
  pink: "firefly",
  white: "weevil",
  green: "beetle",
  yellow: "beetle",
  orange: "roly"
};
const EXPECTED_COUNTS = {
  beginner: {
    bugs: [1, 2, 3, 3, 2, 4, 5, 8],
    holes: [1, 1, 1, 2, 2, 1, 2, 4],
    obstacles: [0, 0, 0, 0, 0, 0, 0, 0]
  },
  advanced: {
    bugs: [1, 2, 2, 3, 5, 5, 8, 6],
    holes: [1, 2, 1, 1, 1, 1, 4, 1],
    obstacles: [0, 0, 0, 1, 4, 1, 0, 0]
  }
};
const EXPECTED_COMPONENTS = new Map([
  ["B01", 1],
  ["B02", 1],
  ["B03", 1],
  ["B04", 1],
  ["B05", 1],
  ["B06", 1],
  ["B07", 2],
  ["B08", 1],
  ["A01", 1],
  ["A02", 2],
  ["A03", 1],
  ["A04", 1],
  ["A05", 1],
  ["A06", 1],
  ["A07", 1],
  ["A08", 4]
]);
const EXPECTED_NAMES = [
  "Wide Ellipse Leaf",
  "Twin-Lobe Figure Eight",
  "Three-Lobed Pinwheel",
  "Three-Part Serpentine",
  "Four-Lobed Cross",
  "Five-Leaf Rosette",
  "Opposed Twin Leaves",
  "Four-Part W Leaf",
  "Five-Lobed Star Leaf",
  "Separated Twin Slopes",
  "Subtractive Ring Leaf",
  "Fallen Branch Leaf",
  "Four-Blocker Leaf",
  "Central Valley Leaf",
  "Four Separated Leaves",
  "Wave-Edged Multi-Lobe"
];

function capsuleDistance(x, z, obstacle) {
  const dx = obstacle.bx - obstacle.ax;
  const dz = obstacle.bz - obstacle.az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 1e-9
    ? Math.max(
        0,
        Math.min(
          1,
          ((x - obstacle.ax) * dx + (z - obstacle.az) * dz) /
            lengthSquared
        )
      )
    : 0;
  return Math.hypot(
    x - (obstacle.ax + dx * t),
    z - (obstacle.az + dz * t)
  );
}

function obstacleDistance(x, z, obstacle) {
  if (obstacle.ax != null && obstacle.bx != null) {
    return capsuleDistance(x, z, obstacle) - (obstacle.r || 0.15);
  }
  return Math.hypot(
    x - (obstacle.x || 0),
    z - (obstacle.z || 0)
  ) - (obstacle.r || 0.25);
}

function fieldComponentCount(field, step = 0.09) {
  const bounds = field.bounds;
  const nx = Math.ceil((bounds.maxX - bounds.minX) / step) + 1;
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / step) + 1;
  const solid = new Uint8Array(nx * nz);

  for (let zIndex = 0; zIndex < nz; zIndex += 1) {
    for (let xIndex = 0; xIndex < nx; xIndex += 1) {
      const x = bounds.minX + xIndex * step;
      const z = bounds.minZ + zIndex * step;
      if (field.sdf(x, z) < 0) solid[zIndex * nx + xIndex] = 1;
    }
  }

  const queue = new Int32Array(nx * nz);
  let components = 0;
  for (let start = 0; start < solid.length; start += 1) {
    if (solid[start] !== 1) continue;
    components += 1;
    let head = 0;
    let tail = 0;
    solid[start] = 2;
    queue[tail] = start;
    tail += 1;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      const xIndex = current % nx;
      const zIndex = Math.floor(current / nx);
      const neighbors = [
        [xIndex - 1, zIndex],
        [xIndex + 1, zIndex],
        [xIndex, zIndex - 1],
        [xIndex, zIndex + 1]
      ];
      for (const [nextX, nextZ] of neighbors) {
        if (
          nextX < 0 ||
          nextZ < 0 ||
          nextX >= nx ||
          nextZ >= nz
        ) {
          continue;
        }
        const next = nextZ * nx + nextX;
        if (solid[next] !== 1) continue;
        solid[next] = 2;
        queue[tail] = next;
        tail += 1;
      }
    }
  }

  return components;
}

function meshComponentCount(mesh) {
  const parent = new Int32Array(mesh.topCount);
  const used = new Uint8Array(mesh.topCount);
  for (let index = 0; index < parent.length; index += 1) {
    parent[index] = index;
  }

  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const join = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (let index = 0; index < mesh.index.length; index += 3) {
    const a = mesh.index[index];
    const b = mesh.index[index + 1];
    const c = mesh.index[index + 2];
    used[a] = 1;
    used[b] = 1;
    used[c] = 1;
    join(a, b);
    join(b, c);
  }

  const roots = new Set();
  for (let index = 0; index < used.length; index += 1) {
    if (used[index]) roots.add(find(index));
  }
  return roots.size;
}

function canReachAnyHoleSlowly(level, bug, step = 0.1) {
  const field = new Field(level.board);
  const bounds = field.bounds;
  const nx = Math.ceil((bounds.maxX - bounds.minX) / step) + 1;
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / step) + 1;
  const state = new Uint8Array(nx * nz);
  const gradientX = new Float32Array(nx * nz);
  const gradientZ = new Float32Array(nx * nz);
  const gradient = { hx: 0, hz: 0 };

  for (let zIndex = 0; zIndex < nz; zIndex += 1) {
    for (let xIndex = 0; xIndex < nx; xIndex += 1) {
      const index = zIndex * nx + xIndex;
      const x = bounds.minX + xIndex * step;
      const z = bounds.minZ + zIndex * step;
      if (field.sdf(x, z) >= -0.02) continue;

      let blocked = false;
      for (const obstacle of level.board.obstacles) {
        if (obstacleDistance(x, z, obstacle) < bug.r) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      state[index] = 1;
      field.gradient(x, z, gradient);
      gradientX[index] = gradient.hx;
      gradientZ[index] = gradient.hz;
    }
  }

  let startX = Math.round((bug.x - bounds.minX) / step);
  let startZ = Math.round((bug.z - bounds.minZ) / step);
  startX = Math.max(0, Math.min(nx - 1, startX));
  startZ = Math.max(0, Math.min(nz - 1, startZ));
  const start = startZ * nx + startX;
  if (state[start] !== 1) return false;

  const queue = new Int32Array(nx * nz);
  let head = 0;
  let tail = 0;
  state[start] = 2;
  queue[tail] = start;
  tail += 1;

  const directionX = [1, -1, 0, 0, 1, 1, -1, -1];
  const directionZ = [0, 0, 1, -1, 1, -1, 1, -1];
  const maxDrive = Math.tan(level.maxTilt);

  while (head < tail) {
    const current = queue[head];
    head += 1;
    const xIndex = current % nx;
    const zIndex = Math.floor(current / nx);
    const x = bounds.minX + xIndex * step;
    const z = bounds.minZ + zIndex * step;

    for (const target of level.board.holes) {
      const captureRadius = target.r - bug.r * 0.3;
      if (
        target.target !== false &&
        Math.hypot(x - target.x, z - target.z) < captureRadius
      ) {
        return true;
      }
    }

    for (let direction = 0; direction < 8; direction += 1) {
      const nextX = xIndex + directionX[direction];
      const nextZ = zIndex + directionZ[direction];
      if (
        nextX < 0 ||
        nextZ < 0 ||
        nextX >= nx ||
        nextZ >= nz
      ) {
        continue;
      }
      const next = nextZ * nx + nextX;
      if (state[next] !== 1) continue;

      const scale = direction < 4 ? 1 : 1 / Math.SQRT2;
      const unitX = directionX[direction] * scale;
      const unitZ = directionZ[direction] * scale;
      const startUphill =
        gradientX[current] * unitX +
        gradientZ[current] * unitZ;
      const endUphill =
        gradientX[next] * unitX +
        gradientZ[next] * unitZ;
      if (
        maxDrive - Math.max(startUphill, endUphill) <=
        BREAK_SLOPE
      ) {
        continue;
      }

      state[next] = 2;
      queue[tail] = next;
      tail += 1;
    }
  }

  return false;
}

test("all 16 records use the frozen native Mossfall schema", () => {
  assert.equal(BEGINNER.length, 8);
  assert.equal(ADVANCED.length, 8);

  for (const level of ALL_LEVELS) {
    assert.deepEqual(Object.keys(level).sort(), LEVEL_KEYS);
    assert.deepEqual(Object.keys(level.board).sort(), BOARD_KEYS);
    assert.deepEqual(level.gameplay, {
      captureHoldSec: 0.075,
      fallMode: "board-reset"
    });
    assert.equal("shape" in level, false);
    assert.equal("balls" in level, false);
    assert.equal("holes" in level, false);
    assert.equal("slopes" in level, false);

    for (const shape of level.board.shapes) {
      assert.ok(
        SHAPE_KINDS.has(shape.kind),
        `${level.id} uses non-native shape ${shape.kind}`
      );
    }
    for (const feature of level.board.features) {
      assert.ok(
        FEATURE_KINDS.has(feature.kind),
        `${level.id} uses non-native feature ${feature.kind}`
      );
    }
  }
});

test("legacy object counts and insect identities are preserved", () => {
  for (const [mode, levels] of [
    ["beginner", BEGINNER],
    ["advanced", ADVANCED]
  ]) {
    const expected = EXPECTED_COUNTS[mode];
    assert.deepEqual(
      levels.map((level) => level.bugs.length),
      expected.bugs
    );
    assert.deepEqual(
      levels.map((level) => level.board.holes.length),
      expected.holes
    );
    assert.deepEqual(
      levels.map((level) => level.board.obstacles.length),
      expected.obstacles
    );
    assert.deepEqual(
      levels.map((level) => level.board.movers.length),
      Array(8).fill(0)
    );
  }

  for (const level of ALL_LEVELS) {
    for (const bug of level.bugs) {
      assert.equal(
        bug.species,
        SPECIES_BY_COLOR[bug.color],
        `${level.id} ${bug.id} has the wrong species for ${bug.color}`
      );
    }
  }
});

test("play order uses the configured content in the eight descent slots", () => {
  assert.deepEqual(BEGINNER.map((level) => level.id), BEGINNER_PLAY_ORDER);
  assert.deepEqual(ADVANCED.map((level) => level.id), ADVANCED_PLAY_ORDER);
  for (let index = 0; index < 8; index += 1) {
    const beginner = BEGINNER[index];
    const advanced = ADVANCED[index];
    assert.equal(beginner.zone, index);
    assert.equal(advanced.zone, index);
    assert.equal(advanced.origin.x, -beginner.origin.x);
    assert.equal(advanced.origin.y, beginner.origin.y);
    assert.equal(advanced.origin.z, -beginner.origin.z);
    assert.equal(advanced.descent.drop, beginner.descent.drop);
    assert.equal(advanced.descent.duration, beginner.descent.duration);
    assert.deepEqual(advanced.descent.beats, beginner.descent.beats);
    assert.equal(advanced.descent.swirl, -beginner.descent.swirl);

    if (index > 0) {
      assert.ok(beginner.origin.y < BEGINNER[index - 1].origin.y);
      assert.ok(advanced.origin.y < ADVANCED[index - 1].origin.y);
      assert.equal(
        beginner.origin.y,
        BEGINNER[index - 1].origin.y - beginner.descent.drop
      );
      assert.equal(
        advanced.origin.y,
        ADVANCED[index - 1].origin.y - advanced.descent.drop
      );
    }
  }
});

test("shape identities preserve the 16 legacy topology roles", () => {
  assert.deepEqual(
    ALL_LEVELS.map((level) => level.name),
    EXPECTED_NAMES
  );
  assert.deepEqual(
    BEGINNER.map((level) => level.board.shapes.map((shape) => shape.kind)),
    [
      ["ellipse"],
      ["ellipse", "ellipse"],
      ["disc", "capsule", "capsule", "capsule"],
      ["ellipse", "ellipse", "ellipse", "capsule", "capsule"],
      ["capsule", "capsule", "capsule", "capsule"],
      ["lobe", "disc"],
      ["ellipse", "ellipse"],
      ["capsule", "capsule", "capsule", "capsule"]
    ]
  );
  assert.equal(ADVANCED[0].board.shapes[0].lobes, 5);
  assert.equal(ADVANCED[1].board.shapes.length, 2);
  assert.equal(ADVANCED[2].board.shapes[1].sub, true);
  assert.ok(
    ADVANCED[3].board.obstacles.some(
      (obstacle) =>
        obstacle.kind === "twig" &&
        Math.abs(obstacle.bz - obstacle.az) === 3.5 &&
        obstacle.r === 0.19
    ),
    "A04's fallen branch keeps the old midrib's exact footprint"
  );
  assert.ok(
    !ADVANCED[3].board.features.some((feature) => feature.kind === "ridge"),
    "A04's raised midrib was replaced by the branch"
  );
  assert.equal(ADVANCED[4].board.obstacles.length, 4);
  assert.ok(
    ADVANCED[4].board.obstacles.every(
      (obstacle) => obstacle.kind === "snail"
    ),
    "A05's four blockers are snails so BoardSnails claims every seat"
  );
  assert.deepEqual(
    ADVANCED[4].board.obstacles.map(({ id, shell }) => ({ id, shell })),
    [
      { id: "BLOCK_01", shell: "fresh" },
      { id: "BLOCK_02", shell: "fresh" },
      { id: "BLOCK_03", shell: "aged" },
      { id: "BLOCK_04", shell: "aged" }
    ],
    "the hard 0.55 pair reads fresh and the soft 0.22 pair reads aged"
  );
  assert.deepEqual(
    ADVANCED[4].board.obstacles.map(
      ({ id, restitution, rebound }) => ({ id, restitution, rebound })
    ),
    [
      {
        id: "BLOCK_01",
        restitution: 0.55,
        rebound: { normalSpeedMin: 0.3, normalSpeedMax: 0.72 }
      },
      {
        id: "BLOCK_02",
        restitution: 0.55,
        rebound: { normalSpeedMin: 0.3, normalSpeedMax: 0.72 }
      },
      {
        id: "BLOCK_03",
        restitution: 0.22,
        rebound: { normalSpeedMin: 0.1, normalSpeedMax: 0.26 }
      },
      {
        id: "BLOCK_04",
        restitution: 0.22,
        rebound: { normalSpeedMin: 0.1, normalSpeedMax: 0.26 }
      }
    ]
  );
  assert.deepEqual(
    ALL_LEVELS.flatMap((level) =>
      level.board.obstacles
        .filter((obstacle) => obstacle.rebound)
        .map((obstacle) => `${level.id}:${obstacle.id}`)
    ),
    [
      "A05:BLOCK_01",
      "A05:BLOCK_02",
      "A05:BLOCK_03",
      "A05:BLOCK_04"
    ]
  );
  assert.ok(
    ADVANCED[5].board.features.some(
      (feature) => feature.kind === "ridge" && feature.amp < 0
    )
  );
  assert.equal(ADVANCED[6].board.shapes.length, 4);
  assert.ok(
    ADVANCED[7].board.shapes.some(
      (shape) => shape.kind === "lobe" && shape.lobes === 10
    )
  );

  for (let index = 0; index < 8; index += 1) {
    const beginnerCurl = BEGINNER[index].board.features.find(
      (feature) => feature.kind === "curl"
    );
    const advancedCurl = ADVANCED[index].board.features.find(
      (feature) => feature.kind === "curl"
    );
    assert.ok(
      beginnerCurl.amp >= advancedCurl.amp + 0.08,
      `${BEGINNER[index].id} must keep the stronger beginner curl`
    );
  }
});

test("every board builds a non-empty Field mesh without topology bridges", () => {
  for (const level of ALL_LEVELS) {
    const field = new Field(level.board);
    const expectedComponents = EXPECTED_COMPONENTS.get(level.id);
    assert.equal(
      fieldComponentCount(field),
      expectedComponents,
      `${level.id} Field component count changed`
    );

    const mesh = buildFieldMesh(field, {
      res: 72,
      skirt: false,
      thickness: 0.055,
      edgeFade: 0.75
    });
    assert.ok(mesh.topCount > 300, `${level.id} produced an empty mesh`);
    assert.ok(mesh.index.length > 900, `${level.id} produced too few faces`);
    assert.equal(
      meshComponentCount(mesh),
      expectedComponents,
      `${level.id} mesh bridged a deliberate void`
    );

    for (let index = 0; index < mesh.topCount; index += 1) {
      const x = mesh.position[index * 3];
      const z = mesh.position[index * 3 + 2];
      assert.ok(
        field.visualSdf(x, z) <= Math.max(0.08, mesh.cell * 1.1),
        `${level.id} mesh contains a vertex outside its visual Field`
      );
    }
  }
});

test("ring and separated leaves retain their explicit voids", () => {
  const paired = new Field(BEGINNER[6].board);
  assert.ok(paired.sdf(-2.35, 0) < 0);
  assert.ok(paired.sdf(2.35, 0) < 0);
  assert.ok(paired.sdf(0, 0) > 0);

  const slopes = new Field(ADVANCED[1].board);
  assert.ok(slopes.sdf(-2.2, 0) < 0);
  assert.ok(slopes.sdf(2.2, 0) < 0);
  assert.ok(slopes.sdf(0, 0) > 0);

  const ring = new Field(ADVANCED[2].board);
  assert.ok(ring.sdf(0, 0) > 0);
  assert.ok(ring.sdf(2.7, 0) < 0);

  const platforms = new Field(ADVANCED[6].board);
  assert.ok(platforms.sdf(-2.2, -1.75) < 0);
  assert.ok(platforms.sdf(2.2, 1.75) < 0);
  assert.ok(platforms.sdf(0, 0) > 0);
});

test("holes, bridges, spawns, and obstacle clearances meet the safety contract", () => {
  const gradient = { hx: 0, hz: 0 };

  for (const level of ALL_LEVELS) {
    const field = new Field(level.board);
    const largestBug = Math.max(...level.bugs.map((bug) => bug.r));

    for (const shape of level.board.shapes) {
      if (shape.kind !== "capsule" || shape.sub) continue;
      assert.ok(
        shape.r * 2 >= largestBug * 3,
        `${level.id} has a bridge narrower than three bug radii`
      );
    }

    for (const target of level.board.holes) {
      const required = 1.3 * (target.r + largestBug);
      assert.ok(
        -field.sdf(target.x, target.z) >= required - 0.02,
        `${level.id} ${target.id} is too close to the leaf edge`
      );
      assert.equal(
        target.style,
        "bite",
        `${level.id} ${target.id} must use the shallow true-opening style`
      );
    }

    for (let left = 0; left < level.board.holes.length; left += 1) {
      for (
        let right = left + 1;
        right < level.board.holes.length;
        right += 1
      ) {
        const a = level.board.holes[left];
        const b = level.board.holes[right];
        const gap =
          Math.hypot(a.x - b.x, a.z - b.z) -
          (a.r + b.r);
        assert.ok(gap >= 0.25, `${level.id} holes overlap`);
      }
    }

    for (const bug of level.bugs) {
      assert.ok(field.inside(bug.x, bug.z), `${level.id} ${bug.id} is off-board`);
      assert.ok(
        -field.sdf(bug.x, bug.z) >= 0.5,
        `${level.id} ${bug.id} starts too close to the rim`
      );
      field.gradient(bug.x, bug.z, gradient);
      assert.ok(
        Math.hypot(gradient.hx, gradient.hz) < REST_SLOPE,
        `${level.id} ${bug.id} starts on a creeping slope`
      );

      for (const target of level.board.holes) {
        const gap =
          Math.hypot(bug.x - target.x, bug.z - target.z) -
          (bug.r + target.r);
        assert.ok(
          gap >= 0.15,
          `${level.id} ${bug.id} starts too close to ${target.id}`
        );
      }
      for (const obstacle of level.board.obstacles) {
        assert.ok(
          obstacleDistance(bug.x, bug.z, obstacle) - bug.r >= 0.1,
          `${level.id} ${bug.id} starts against ${obstacle.id}`
        );
      }
    }

    for (let left = 0; left < level.bugs.length; left += 1) {
      for (let right = left + 1; right < level.bugs.length; right += 1) {
        const a = level.bugs[left];
        const b = level.bugs[right];
        const gap =
          Math.hypot(a.x - b.x, a.z - b.z) -
          (a.r + b.r);
        assert.ok(
          gap >= 0.15,
          `${level.id} ${a.id}/${b.id} overlap at spawn`
        );
      }
    }
  }
});

test("every bug retains a tilt-only route to a reachable burrow", () => {
  for (const level of ALL_LEVELS) {
    for (const bug of level.bugs) {
      assert.ok(
        canReachAnyHoleSlowly(level, bug),
        `${level.id} ${bug.id} has no slow route to a burrow`
      );
    }
  }
});
