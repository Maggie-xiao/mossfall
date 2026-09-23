import { BALANCE_BOARD_CONFIG } from "./balance-board-config.js";

export const DEG = Math.PI / 180;

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function mapCopAxis(
  value,
  deadzone = BALANCE_BOARD_CONFIG.response.deadZone,
  exponent = BALANCE_BOARD_CONFIG.response.exponent
) {
  const v = clamp(Number.isFinite(value) ? value : 0, -1, 1);
  const magnitude = Math.abs(v);
  if (magnitude <= deadzone) return 0;
  const normalized = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(v) * Math.pow(normalized, exponent);
}

export function stepCriticalDampedAngle(
  state,
  target,
  dt,
  stiffness = 55,
  damping = 14.83,
  maxAngularSpeed = 95 * DEG
) {
  const accel = stiffness * (target - state.angle) - damping * state.velocity;
  const velocity = clamp(
    state.velocity + accel * dt,
    -maxAngularSpeed,
    maxAngularSpeed
  );
  return {
    angle: state.angle + velocity * dt,
    velocity
  };
}

export function scoreRun(levelsCleared, timeRemainingSec) {
  const cleared = Math.max(0, Math.floor(levelsCleared));
  const levelPoints = cleared * 10;
  const timePoints = Math.floor(Math.max(0, timeRemainingSec));
  return {
    cleared,
    levelPoints,
    timePoints,
    totalPoints: levelPoints + timePoints
  };
}

export function vectorClamp(x, y, limit = 1) {
  const length = Math.hypot(x, y);
  if (length <= limit || length === 0) return { x, y };
  const scale = limit / length;
  return { x: x * scale, y: y * scale };
}

export function rotatePoint([x, z], degrees) {
  const angle = degrees * DEG;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - z * s, x * s + z * c];
}

function rotatedBoxLocalPoint(x, z, part) {
  return rotatePoint(
    [x - part.center[0], z - part.center[1]],
    -(part.rotationDeg || 0)
  );
}

function pointInRoundedBox(x, z, part) {
  const [dx, dz] = rotatedBoxLocalPoint(x, z, part);
  const halfWidth = part.size[0] / 2;
  const halfDepth = part.size[1] / 2;
  const radius = Math.min(
    part.radius || Math.min(part.size[0], part.size[1]) * 0.16,
    halfWidth,
    halfDepth
  );
  const cornerX = Math.max(Math.abs(dx) - (halfWidth - radius), 0);
  const cornerZ = Math.max(Math.abs(dz) - (halfDepth - radius), 0);
  return Math.hypot(cornerX, cornerZ) <= radius;
}

function pointInRotatedBox(x, z, part) {
  const [dx, dz] = rotatedBoxLocalPoint(x, z, part);
  return Math.abs(dx) <= part.size[0] / 2 && Math.abs(dz) <= part.size[1] / 2;
}

export function pointInShapePart(x, z, part) {
  const cx = part.center?.[0] || 0;
  const cz = part.center?.[1] || 0;
  const dx = x - cx;
  const dz = z - cz;

  if (part.type === "ellipse") {
    return (dx / part.size[0]) ** 2 + (dz / part.size[1]) ** 2 <= 1;
  }

  if (part.type === "halfEllipse") {
    const inside =
      (dx / part.size[0]) ** 2 + (dz / part.size[1]) ** 2 <= 1;
    if (!inside) return false;
    return part.facing === "left" ? dx <= 0 : dx >= 0;
  }

  if (part.type === "ring") {
    const outer =
      (dx / part.outer[0]) ** 2 + (dz / part.outer[1]) ** 2 <= 1;
    const inner =
      (dx / part.inner[0]) ** 2 + (dz / part.inner[1]) ** 2 < 1;
    return outer && !inner;
  }

  if (part.type === "radial") {
    const angle = Math.atan2(dz / part.outer[1], dx / part.outer[0]);
    const radius = Math.hypot(dx / part.outer[0], dz / part.outer[1]);
    const phase =
      angle -
      ((part.rotationDeg || 0) * Math.PI) / 180;
    const spoke = Math.cos((phase * part.points) / 2);
    const boundary =
      part.inner[0] / part.outer[0] +
      (1 - part.inner[0] / part.outer[0]) * Math.max(0, spoke);
    return radius <= boundary;
  }

  if (part.type === "roundedBox") {
    return pointInRoundedBox(x, z, part);
  }

  return false;
}

export function pointInBoardShape(x, z, shape) {
  return (shape?.parts || []).some((part) => pointInShapePart(x, z, part));
}

function boundaryEdgePoint(edge, x, z, step) {
  switch (edge) {
    case "bottom":
      return [x + step / 2, z];
    case "right":
      return [x + step, z + step / 2];
    case "top":
      return [x + step / 2, z + step];
    default:
      return [x, z + step / 2];
  }
}

export function boardBoundarySegments(
  shape,
  { min = -1.2, max = 1.2, step = 0.04 } = {}
) {
  const segments = [];
  const addSegment = (edgeA, edgeB, x, z) => {
    segments.push({
      a: boundaryEdgePoint(edgeA, x, z, step),
      b: boundaryEdgePoint(edgeB, x, z, step)
    });
  };

  for (let x = min; x < max; x += step) {
    for (let z = min; z < max; z += step) {
      const bottomLeft = pointInBoardShape(x, z, shape);
      const bottomRight = pointInBoardShape(x + step, z, shape);
      const topRight = pointInBoardShape(x + step, z + step, shape);
      const topLeft = pointInBoardShape(x, z + step, shape);
      const mask =
        (bottomLeft ? 1 : 0) |
        (bottomRight ? 2 : 0) |
        (topRight ? 4 : 0) |
        (topLeft ? 8 : 0);

      switch (mask) {
        case 0:
        case 15:
          break;
        case 1:
          addSegment("left", "bottom", x, z);
          break;
        case 2:
          addSegment("bottom", "right", x, z);
          break;
        case 3:
          addSegment("left", "right", x, z);
          break;
        case 4:
          addSegment("right", "top", x, z);
          break;
        case 5:
          if (pointInBoardShape(x + step / 2, z + step / 2, shape)) {
            addSegment("top", "left", x, z);
            addSegment("bottom", "right", x, z);
          } else {
            addSegment("left", "bottom", x, z);
            addSegment("right", "top", x, z);
          }
          break;
        case 6:
          addSegment("bottom", "top", x, z);
          break;
        case 7:
          addSegment("left", "top", x, z);
          break;
        case 8:
          addSegment("top", "left", x, z);
          break;
        case 9:
          addSegment("top", "bottom", x, z);
          break;
        case 10:
          if (pointInBoardShape(x + step / 2, z + step / 2, shape)) {
            addSegment("left", "bottom", x, z);
            addSegment("right", "top", x, z);
          } else {
            addSegment("bottom", "right", x, z);
            addSegment("top", "left", x, z);
          }
          break;
        case 11:
          addSegment("right", "top", x, z);
          break;
        case 12:
          addSegment("right", "left", x, z);
          break;
        case 13:
          addSegment("bottom", "right", x, z);
          break;
        case 14:
          addSegment("left", "bottom", x, z);
          break;
        default:
          break;
      }
    }
  }

  return segments;
}

export function easeInOutCubic(value) {
  const t = clamp(value, 0, 1);
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeInOutSine(value) {
  const t = clamp(value, 0, 1);
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export const FAILURE_SPIN_DURATION_SEC = 2.2;

export function failureSpinAngle(
  elapsedSec,
  durationSec = FAILURE_SPIN_DURATION_SEC
) {
  const progress = clamp(elapsedSec / Math.max(0.001, durationSec), 0, 1);
  return Math.PI * 2 * easeInOutSine(progress);
}

export function shouldStartFailureSpin(
  elapsedSec,
  ballClearedBoard,
  minDropSec,
  maxDropSec
) {
  const elapsed = Math.max(0, elapsedSec);
  if (elapsed >= Math.max(minDropSec, maxDropSec)) return true;
  return elapsed >= Math.max(0, minDropSec) && ballClearedBoard;
}

export function animateBonusTimer(
  startSeconds,
  targetSeconds,
  elapsedSec,
  durationSec
) {
  const progress = clamp(elapsedSec / Math.max(0.001, durationSec), 0, 1);
  return startSeconds + (targetSeconds - startSeconds) * progress;
}

export function fitProgress(elapsedSec, requiredSec) {
  return clamp(elapsedSec / Math.max(0.001, requiredSec), 0, 1);
}
