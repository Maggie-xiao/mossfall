/**
 * MOSS TILT — the level contract, as a runnable function.
 *
 * `tests/mossfall-levels.test.mjs` has always asserted these rules against the
 * sixteen authored boards. Once boards are generated they need the same rules
 * *before* the player sees them, so the contract lives here and the tests call
 * into it. One definition, two consumers — a rule can never drift between the
 * gate and the generator.
 *
 * The headline rule is `canReachAnyHoleSlowly`: flood the board with the
 * steepest tilt the level allows, and check the bug can actually be driven to a
 * burrow. A generated board that fails this is unwinnable, so the generator
 * rejects and redraws rather than shipping it.
 */

import { Field } from "./mossfall/sim/field.js";

/**
 * The slope at which a resting bug breaks loose. Mirrors the constant the
 * physics uses; a route that needs more drive than this is not a route.
 */
export const BREAK_SLOPE = 1 / ((5 / 7) * 16.5);

/** A bug parked on a slope shallower than this is considered at rest. */
export const REST_SLOPE = 0.055;

function capsuleDistance(x, z, obstacle) {
  const dx = obstacle.bx - obstacle.ax;
  const dz = obstacle.bz - obstacle.az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 1e-9
    ? Math.max(
        0,
        Math.min(
          1,
          ((x - obstacle.ax) * dx + (z - obstacle.az) * dz) / lengthSquared
        )
      )
    : 0;
  return Math.hypot(
    x - (obstacle.ax + dx * t),
    z - (obstacle.az + dz * t)
  );
}

/** Signed distance from a point to an obstacle's surface. */
export function obstacleDistance(x, z, obstacle) {
  if (obstacle.ax != null && obstacle.bx != null) {
    return capsuleDistance(x, z, obstacle) - (obstacle.r || 0.15);
  }
  return Math.hypot(
    x - (obstacle.x || 0),
    z - (obstacle.z || 0)
  ) - (obstacle.r || 0.25);
}

/** How many disconnected islands of leaf the board has. */
export function fieldComponentCount(field, step = 0.09) {
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
        if (nextX < 0 || nextZ < 0 || nextX >= nx || nextZ >= nz) continue;
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

/**
 * Can this bug be driven to some burrow using tilt alone?
 *
 * Flood fill over the board's walkable cells. A step between neighbours is
 * allowed only when the level's `maxTilt` still leaves enough drive over the
 * uphill component of the gradient to break the bug loose — so a wall the
 * player cannot climb at full tilt correctly blocks the route.
 *
 * Pass a prebuilt `field` when checking many bugs on one board; building the
 * Field is the expensive part.
 */
export function canReachAnyHoleSlowly(level, bug, { step = 0.1, field } = {}) {
  const solved = field || new Field(level.board);
  const bounds = solved.bounds;
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
      if (solved.sdf(x, z) >= -0.02) continue;

      let blocked = false;
      for (const obstacle of level.board.obstacles) {
        if (obstacleDistance(x, z, obstacle) < bug.r) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      state[index] = 1;
      solved.gradient(x, z, gradient);
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
      if (nextX < 0 || nextZ < 0 || nextX >= nx || nextZ >= nz) continue;
      const next = nextZ * nx + nextX;
      if (state[next] !== 1) continue;

      const scale = direction < 4 ? 1 : 1 / Math.SQRT2;
      const unitX = directionX[direction] * scale;
      const unitZ = directionZ[direction] * scale;
      const startUphill =
        gradientX[current] * unitX + gradientZ[current] * unitZ;
      const endUphill = gradientX[next] * unitX + gradientZ[next] * unitZ;
      if (maxDrive - Math.max(startUphill, endUphill) <= BREAK_SLOPE) continue;

      state[next] = 2;
      queue[tail] = next;
      tail += 1;
    }
  }

  return false;
}

/**
 * Every geometric rule a board must satisfy before a player may see it.
 *
 * Returns `{ ok, problems }` rather than throwing, because the generator's
 * normal control flow is "draw, check, redraw" — a rejected board is expected,
 * not exceptional. `problems` is human-readable and is what the test gate
 * prints when an authored board regresses.
 *
 * `checkRoutes: false` skips the flood fill. The transform layer uses that:
 * mirroring and rotating a board are isometries, so a route that existed before
 * exists after, and re-running the expensive check would prove nothing.
 */
export function validateLevel(level, { checkRoutes = true, field } = {}) {
  const problems = [];
  const id = level.id || "level";
  const solved = field || new Field(level.board);
  const gradient = { hx: 0, hz: 0 };

  if (!level.bugs.length) problems.push(`${id} has no bugs`);
  if (!level.board.holes.length) problems.push(`${id} has no burrows`);
  // Everything below reads `level.bugs[0]`-shaped data, so an empty board has
  // to bail here rather than fall through into `Math.max()` of nothing.
  if (problems.length) return { ok: false, problems };

  const largestBug = Math.max(...level.bugs.map((bug) => bug.r));

  if (level.colorMatch) {
    const availableByColor = new Map();
    const requiredByColor = new Map();
    for (const target of level.board.holes) {
      if (target.target === false || !target.color) continue;
      availableByColor.set(
        target.color,
        (availableByColor.get(target.color) || 0) + 1
      );
    }
    for (const bug of level.bugs) {
      requiredByColor.set(bug.color, (requiredByColor.get(bug.color) || 0) + 1);
    }
    for (const [color, required] of requiredByColor) {
      const available = availableByColor.get(color) || 0;
      if (required > available) {
        problems.push(
          `${id} needs ${required} ${color} burrows but has ${available}`
        );
      }
    }
  }

  for (const shape of level.board.shapes) {
    if (shape.kind !== "capsule" || shape.sub) continue;
    if (shape.r * 2 < largestBug * 3) {
      problems.push(`${id} has a bridge narrower than three bug radii`);
    }
  }

  for (const target of level.board.holes) {
    const required = 1.3 * (target.r + largestBug);
    if (-solved.sdf(target.x, target.z) < required - 0.02) {
      problems.push(`${id} ${target.id} is too close to the leaf edge`);
    }
    if (target.style !== "bite") {
      problems.push(`${id} ${target.id} must use the shallow true-opening style`);
    }
  }

  for (let left = 0; left < level.board.holes.length; left += 1) {
    for (let right = left + 1; right < level.board.holes.length; right += 1) {
      const a = level.board.holes[left];
      const b = level.board.holes[right];
      if (Math.hypot(a.x - b.x, a.z - b.z) - (a.r + b.r) < 0.25) {
        problems.push(`${id} holes overlap`);
      }
    }
  }

  for (const bug of level.bugs) {
    if (!solved.inside(bug.x, bug.z)) {
      problems.push(`${id} ${bug.id} is off-board`);
      continue;
    }
    if (-solved.sdf(bug.x, bug.z) < 0.5) {
      problems.push(`${id} ${bug.id} starts too close to the rim`);
    }
    solved.gradient(bug.x, bug.z, gradient);
    if (Math.hypot(gradient.hx, gradient.hz) >= REST_SLOPE) {
      problems.push(`${id} ${bug.id} starts on a creeping slope`);
    }

    for (const target of level.board.holes) {
      const gap =
        Math.hypot(bug.x - target.x, bug.z - target.z) - (bug.r + target.r);
      if (gap < 0.15) {
        problems.push(`${id} ${bug.id} starts too close to ${target.id}`);
      }
    }
    for (const obstacle of level.board.obstacles) {
      if (obstacleDistance(bug.x, bug.z, obstacle) - bug.r < 0.1) {
        problems.push(`${id} ${bug.id} starts against ${obstacle.id}`);
      }
    }
  }

  for (let left = 0; left < level.bugs.length; left += 1) {
    for (let right = left + 1; right < level.bugs.length; right += 1) {
      const a = level.bugs[left];
      const b = level.bugs[right];
      if (Math.hypot(a.x - b.x, a.z - b.z) - (a.r + b.r) < 0.15) {
        problems.push(`${id} ${a.id}/${b.id} overlap at spawn`);
      }
    }
  }

  if (checkRoutes) {
    for (const bug of level.bugs) {
      if (!canReachAnyHoleSlowly(level, bug, { field: solved })) {
        problems.push(`${id} ${bug.id} has no slow route to a burrow`);
      }
    }
  }

  return { ok: problems.length === 0, problems };
}
