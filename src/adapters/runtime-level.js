const X_SCALE = 4.2;
const Z_SCALE = 2.6;
const RADIUS_SCALE = 2.6;
const SPECIES = ["ladybug", "beetle", "scarab", "roly", "firefly", "weevil"];
const COLORS = Object.freeze({
  black: "blue",
  pink: "purple",
  white: "yellow"
});

function normalizeColor(color) {
  return COLORS[color] || color || "green";
}

function zoneIndex(level) {
  if (Number.isFinite(level?.index)) return level.index;
  if (Number.isFinite(level?.zone)) return level.zone;
  const match = String(level?.id || "").match(/(\d+)$/);
  return Math.max(0, Math.min(7, (Number(match?.[1]) || 1) - 1));
}

function normalizeBug(ball, index) {
  const spawn = ball?.spawn || [ball?.x ?? 0, ball?.z ?? 0];
  return {
    id: ball?.id || `BALL_${String(index + 1).padStart(2, "0")}`,
    color: normalizeColor(ball?.color),
    species: ball?.species || SPECIES[(ball?.face ?? index) % SPECIES.length],
    x: Number.isFinite(ball?.x) ? ball.x : (spawn[0] || 0) * X_SCALE,
    z: Number.isFinite(ball?.z) ? ball.z : (spawn[1] || 0) * Z_SCALE,
    r: Number.isFinite(ball?.r)
      ? ball.r
      : Math.max(0.18, (ball?.radius || 0.11692067343024425) * RADIUS_SCALE),
    mass: Number.isFinite(ball?.mass) ? ball.mass : 1
  };
}

function normalizeCaptureHolePresentation(board) {
  const holes = Array.isArray(board?.holes) ? board.holes : [];
  if (
    holes.every(
      (hole) =>
        hole?.style === "bite" &&
        Number(hole?.glow || 0) === 0 &&
        (!hole?.color || normalizeColor(hole.color) === hole.color)
    )
  ) {
    return board;
  }
  return {
    ...board,
    holes: holes.map((hole) => ({
      ...hole,
      style: "bite",
      glow: 0,
      ...(hole?.color ? { color: normalizeColor(hole.color) } : {})
    }))
  };
}

export function normalizeRuntimeLevel(level, mode = "beginner") {
  if (!level) throw new Error("A level record is required");
  const sourceBoard = level.board;
  if (!sourceBoard || !Array.isArray(sourceBoard.shapes)) {
    throw new Error(
      `Level ${level.id || "(unknown)"} has no native Mossfall level.board`
    );
  }
  const board = normalizeCaptureHolePresentation(sourceBoard);

  const sourceBugs = Array.isArray(level.bugs)
    ? level.bugs
    : Array.isArray(level.balls)
      ? level.balls
      : [];
  const bugs = sourceBugs.map(normalizeBug);
  const index = zoneIndex(level);
  return {
    ...level,
    colorMatch: level.colorMatch === true || level.clearRule === "match-all",
    index,
    mode,
    board,
    bugs,
    origin:
      level.origin ||
      { x: 0, y: -index * 30, z: 0 },
    maxTilt:
      Number.isFinite(level.maxTilt)
        ? level.maxTilt
        : Number.isFinite(level.maxTiltDeg)
          ? (level.maxTiltDeg * Math.PI) / 180
          : ((mode === "advanced" ? 12.5 : 11.5) * Math.PI) / 180,
    descent:
      level.descent ||
      { drop: 30, duration: 1, beats: [], swirl: 0.2 }
  };
}
