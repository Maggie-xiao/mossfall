/**
 * MOSS TILT — variant transforms.
 *
 * The cheapest honest variety in the game: take an authored board and reflect
 * it. Because every transform here is an *isometry* of the board plane, a route
 * that existed before exists after, at the same length and the same slope — so
 * the expensive flood fill does not need to run again. That is the whole reason
 * to prefer these over "nudge the numbers a bit", which would need full
 * revalidation and could still land on an unwinnable board.
 *
 * ONE CAVEAT, found by measuring rather than by reasoning: the `ripple` feature
 * is world-space value noise and is deliberately NOT transformed (see
 * `mapFeature`). The board moves under it, so a spawn can land on a different
 * part of the grain. Ripple is capped below the resting slope, so it can never
 * break a route — but it can tip a bug that was resting at 0.03 over the 0.055
 * line, which happened on about 2% of reflected boards. Callers must therefore
 * still run the cheap half of `validateLevel` (`checkRoutes: false`) on a
 * reflection; `run-plan.js` does, and falls back to identity.
 *
 * Only the four transforms that preserve the bounding box's aspect ratio are
 * used. The leaf is a wide shape (up to 4.2 x 3.2 m) framed by a camera that
 * does not re-fit per level, so a 90-degree rotation would push the board out
 * of frame even though the physics would be perfectly fine.
 *
 * SIGN CONVENTIONS, because the two rotatable primitives disagree and guessing
 * gets it backwards:
 *   - `ellipse` and `heart` rotate the *sample point* by -rot
 *     (`lx = dx*cos + dz*sin`), so the shape turns by +rot.
 *   - `lobe` adds rot to the sample *angle* (`th = atan2(dz, dx) + rot`), so
 *     the shape turns by -rot.
 * `tests/level-variants.test.mjs` proves both numerically against the Field.
 */

/** Identity. Kept in the table so "no transform" is a normal draw, not a null. */
const IDENTITY = {
  id: "identity",
  point: (x, z) => [x, z],
  ellipseRot: (rot) => rot,
  lobeRot: (rot) => rot,
  vector: (ax, az) => [ax, az],
  handed: false
};

/** Reflect across the Z axis: x -> -x. */
const MIRROR_X = {
  id: "mirror-x",
  point: (x, z) => [-x, z],
  // Reflection conjugates rotation: M R(r) M = R(-r).
  ellipseRot: (rot) => -rot,
  // atan2(dz, -dx) = PI - atan2(dz, dx), so the lobe phase inverts and shifts.
  lobeRot: (rot) => -rot - Math.PI,
  vector: (ax, az) => [-ax, az],
  handed: true
};

/** Reflect across the X axis: z -> -z. */
const MIRROR_Z = {
  id: "mirror-z",
  point: (x, z) => [x, -z],
  ellipseRot: (rot) => -rot,
  lobeRot: (rot) => -rot,
  vector: (ax, az) => [ax, -az],
  handed: true
};

/** Half turn. The composition of both mirrors, so handedness is preserved. */
const ROTATE_180 = {
  id: "rotate-180",
  point: (x, z) => [-x, -z],
  ellipseRot: (rot) => rot + Math.PI,
  lobeRot: (rot) => rot - Math.PI,
  vector: (ax, az) => [-ax, -az],
  handed: false
};

export const VARIANTS = Object.freeze([
  IDENTITY,
  MIRROR_X,
  MIRROR_Z,
  ROTATE_180
]);

export const VARIANT_IDS = Object.freeze(VARIANTS.map((entry) => entry.id));

export function variantById(id) {
  return VARIANTS.find((entry) => entry.id === id) || IDENTITY;
}

function mapShape(shape, t) {
  const out = { ...shape };
  // `_cos`/`_sin` are Field's bake-time cache of `rot`. Carrying a stale pair
  // into a transformed shape would silently un-rotate it, so drop them and let
  // Field re-bake.
  delete out._cos;
  delete out._sin;

  switch (shape.kind) {
    case "disc": {
      [out.x, out.z] = t.point(shape.x, shape.z);
      break;
    }
    case "ellipse": {
      [out.x, out.z] = t.point(shape.x, shape.z);
      out.rot = t.ellipseRot(shape.rot || 0);
      break;
    }
    case "heart": {
      [out.x, out.z] = t.point(shape.x, shape.z);
      out.rot = t.ellipseRot(shape.rot || 0);
      break;
    }
    case "lobe": {
      [out.x, out.z] = t.point(shape.x, shape.z);
      out.rot = t.lobeRot(shape.rot || 0);
      break;
    }
    case "capsule": {
      [out.ax, out.az] = t.point(shape.ax, shape.az);
      [out.bx, out.bz] = t.point(shape.bx, shape.bz);
      break;
    }
    default:
      break;
  }
  return out;
}

function mapFeature(feature, t) {
  const out = { ...feature };
  switch (feature.kind) {
    case "dish":
    case "bump": {
      [out.x, out.z] = t.point(feature.x || 0, feature.z || 0);
      break;
    }
    case "vein":
    case "ridge": {
      if (feature.pts) {
        out.pts = feature.pts.map(([x, z]) => t.point(x, z));
      }
      break;
    }
    case "slope": {
      // A gradient direction, not a position — rotates as a vector.
      [out.ax, out.az] = t.vector(feature.ax || 0, feature.az || 0);
      break;
    }
    case "curl":
      // Derived from the sdf itself, so it follows the outline for free.
      break;
    case "ripple":
      // World-space value noise, deliberately left alone: the board moves under
      // the grain, so a reflected leaf is differently textured for free.
      //
      // Not quite free, though. The grain carries a slope of its own (capped by
      // RIPPLE_MAX_SLOPE at 0.027, under the 0.055 rest slope), so it cannot
      // break a route but it CAN tip a spawn that was resting near the limit.
      // See the caveat in this file's header: reflections still need the cheap
      // half of validateLevel.
      break;
    default:
      break;
  }
  return out;
}

function mapObstacle(obstacle, t) {
  const out = { ...obstacle };
  if (obstacle.ax != null && obstacle.bx != null) {
    [out.ax, out.az] = t.point(obstacle.ax, obstacle.az);
    [out.bx, out.bz] = t.point(obstacle.bx, obstacle.bz);
  } else {
    [out.x, out.z] = t.point(obstacle.x || 0, obstacle.z || 0);
  }
  return out;
}

function mapPlaced(entry, t) {
  const out = { ...entry };
  [out.x, out.z] = t.point(entry.x, entry.z);
  return out;
}

/**
 * Apply an isometry to a whole level record.
 *
 * The result is a fresh object; the input is never mutated, because the canon
 * level table is module state shared by every run.
 */
export function applyVariant(level, transform) {
  const t = typeof transform === "string" ? variantById(transform) : transform;
  if (!t || t === IDENTITY) {
    return { ...level, variant: IDENTITY.id };
  }

  return {
    ...level,
    variant: t.id,
    board: {
      ...level.board,
      shapes: level.board.shapes.map((shape) => mapShape(shape, t)),
      features: level.board.features.map((feature) => mapFeature(feature, t)),
      holes: level.board.holes.map((entry) => mapPlaced(entry, t)),
      obstacles: level.board.obstacles.map((entry) => mapObstacle(entry, t)),
      movers: level.board.movers.map((entry) => mapObstacle(entry, t))
    },
    bugs: level.bugs.map((entry) => mapPlaced(entry, t)),
    props: (level.props || []).map((entry) => mapPlaced(entry, t))
  };
}

/**
 * Reassign which insect species sits on which spawn, and which burrow accepts
 * which colour.
 *
 * The pairing is what the player reads, so shuffling it changes the puzzle's
 * surface without touching its geometry. The invariant that matters: the
 * multiset of bug colours and the multiset of hole colours are both preserved,
 * and each hole colour still has at least one bug of that colour. Anything
 * looser can produce a level with an unmatchable insect.
 */
export function recolorLevel(level, rng, speciesByColor) {
  const bugColors = level.bugs.map((bug) => bug.color);
  const holeColors = level.board.holes.map((hole) => hole.color);

  // Which distinct colours are in play, and how the holes consume them.
  const palette = [...new Set(bugColors)];
  if (palette.length < 2) return level;

  // A permutation of the palette, applied consistently to bugs and holes, keeps
  // every colour relationship intact while changing every colour on screen.
  const shuffled = rng.shuffle(palette);
  const remap = new Map(palette.map((color, index) => [color, shuffled[index]]));

  const recolor = (color) => remap.get(color) || color;

  return {
    ...level,
    board: {
      ...level.board,
      holes: level.board.holes.map((hole, index) => ({
        ...hole,
        color: recolor(holeColors[index])
      }))
    },
    bugs: level.bugs.map((bug, index) => {
      const color = recolor(bugColors[index]);
      return {
        ...bug,
        color,
        species: speciesByColor[color] || bug.species
      };
    })
  };
}
