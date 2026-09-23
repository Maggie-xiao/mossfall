/**
 * MOSS TILT — themes, as depth bands of the authored world.
 *
 * WHY THIS IS NOT A PALETTE GENERATOR
 *
 * `mossfall/data/palette.js` holds eight zones that were art-directed by hand,
 * and its header states the two rules the art depends on: beetles are the only
 * fully saturated things on screen, and the palette *is* the sense of depth.
 *
 * The obvious way to add visual variety — shift the hue, cool the fog, remix
 * the ramp — breaks both. It breaks the first because any drift of the
 * environment toward beetle hues costs the beetles their legibility, and it
 * breaks the second because the ramp is not smooth: zone 6 (Lantern Deep) turns
 * its glow bioluminescent green before zone 7 (Ancient Heart) returns to gold.
 * Measured against a three-anchor interpolation, that beat alone is a 128/255
 * error in the red channel. A generated ramp would quietly delete it.
 *
 * So nothing here invents colour. A theme is a *route through the eight
 * authored zones*: which depth band of the tree this run descends, and which
 * zones inside it the run actually visits. Every frame is a palette that
 * already shipped, and every run still looks different, because the journey
 * differs. Art risk is zero by construction.
 *
 * The one invariant a route must keep is the descent itself: zones are visited
 * in increasing order, so light keeps falling and fog keeps cooling. A run that
 * bounced between crown and deep would read as broken, not varied.
 */

import { ZONES } from "./mossfall/data/palette.js";

export const ZONE_COUNT = ZONES.length;

/**
 * Descent scenery beats. These are the `descent.beats` strings the existing
 * levels already use, grouped by the depth where they read correctly — a
 * waterfall in the sunlit crown or butterflies in the root dark would both look
 * like a bug.
 */
const BEATS_BY_DEPTH = Object.freeze({
  shallow: ["sunshaft", "leafbrush", "butterflies", "vines"],
  middle: ["hollow", "vines", "squirrel", "droplets", "leafbrush"],
  deep: ["waterfall", "dark", "fireflies", "roots", "garden", "hollow"]
});

function beatsFor(zoneIndex) {
  if (zoneIndex <= 2) return BEATS_BY_DEPTH.shallow;
  if (zoneIndex <= 5) return BEATS_BY_DEPTH.middle;
  return BEATS_BY_DEPTH.deep;
}

/**
 * The themes a player picks between.
 *
 * `band` is the inclusive range of authored zones the theme may visit. Bands
 * overlap on purpose: the tree is continuous, and a Dew Hollow run that opens
 * one zone above the hollow proper still reads as the hollow.
 *
 * `difficulty` biases which level archetypes the generator is allowed to draw,
 * so the theme is a gameplay choice as well as a look.
 */
export const THEMES = Object.freeze([
  {
    id: "full-descent",
    name: "Full Descent",
    nameZh: "全程下降",
    blurb: "Crown to root, the whole tree in one run.",
    band: [0, 7],
    difficulty: [0, 1],
    canon: true
  },
  {
    id: "sunlit-crown",
    name: "Sunlit Crown",
    nameZh: "晨光林冠",
    blurb: "High, open and bright. Wide leaves and long sightlines.",
    band: [0, 3],
    difficulty: [0, 0.55]
  },
  {
    id: "dew-hollow",
    name: "Dew Hollow",
    nameZh: "露水回廊",
    blurb: "Cooling green, split galleries, water in the air.",
    band: [3, 6],
    difficulty: [0.35, 0.85]
  },
  {
    id: "lantern-deep",
    name: "Lantern Deep",
    nameZh: "灯笼深渊",
    blurb: "Bioluminescent dark. Small leaves, long falls.",
    band: [5, 7],
    difficulty: [0.6, 1]
  }
]);

export const DEFAULT_THEME_ID = "full-descent";

export function themeById(id) {
  return THEMES.find((entry) => entry.id === id)
    || THEMES.find((entry) => entry.id === DEFAULT_THEME_ID);
}

/**
 * Choose the `count` zones this run descends through.
 *
 * The result is non-decreasing, starts at the band's top and ends at its floor,
 * so every run still reads as a descent that arrives somewhere. Between those
 * two fixed ends the interior is drawn freely, which is what makes two runs of
 * the same theme feel different: one lingers in the gallery, the next drops
 * past it.
 *
 * Repeats are allowed and wanted. A band of three zones stretched over eight
 * levels *must* repeat, and dwelling two levels in one zone reads as arriving
 * somewhere rather than as a missing step.
 */
export function planDescent(theme, rng, count = 8) {
  const [top, floor] = theme.band;
  if (count <= 1) return [top];

  const span = floor - top;
  const route = [top];
  for (let step = 1; step < count - 1; step += 1) {
    const previous = route[route.length - 1];
    // Jitter around the evenly-paced position rather than descending greedily.
    // A greedy draw is legal but reads badly: it plunges to the floor in the
    // first few levels and then dwells there for the rest of the run, which
    // looks like the descent broke rather than like a journey.
    const ideal = top + (span * step) / (count - 1);
    const lowest = Math.max(previous, Math.ceil(ideal) - 1, top);
    const highest = Math.min(floor, Math.floor(ideal) + 1);
    route.push(rng.int(lowest, Math.max(lowest, highest)));
  }
  route.push(floor);
  return route;
}

/**
 * The descent presentation for one slot: how far the camera falls, how long it
 * takes, and which scenery beats stream past.
 *
 * Drop and duration scale with how many zones this step crosses, so a two-zone
 * plunge genuinely takes longer than dwelling in place. A dwell still travels —
 * the tree keeps going down even when the light does not change.
 */
export function descentFor(fromZone, toZone, rng, { mirrored = false } = {}) {
  const crossed = Math.max(0, toZone - fromZone);
  const depth = toZone / Math.max(1, ZONE_COUNT - 1);

  const drop = 30 + depth * 44 + crossed * 13 + rng.range(-3, 3);
  const duration = 4.2 + depth * 2.4 + crossed * 0.7 + rng.range(-0.25, 0.25);

  const pool = beatsFor(toZone);
  const beats = rng.sample(pool, rng.int(3, Math.min(4, pool.length)));
  const swirl = rng.range(0.22, 0.42) * (mirrored ? -1 : 1);

  return {
    drop: Number(drop.toFixed(2)),
    duration: Number(duration.toFixed(2)),
    beats,
    swirl: Number(swirl.toFixed(3))
  };
}

/**
 * Where a run starts in world space, and how each level hangs below the last.
 *
 * Mirrors the shape of the authored `JOURNEY` table: x and z drift a little
 * either side of the trunk so consecutive leaves are not stacked in a column,
 * and y accumulates the drops.
 */
export function planOrigins(descents, rng, { mirrored = false } = {}) {
  const origins = [];
  let y = 0;
  for (let index = 0; index < descents.length; index += 1) {
    const side = mirrored ? -1 : 1;
    origins.push({
      x: Number((rng.range(-2.2, 2.2) * side).toFixed(2)),
      y: Number(y.toFixed(2)),
      z: Number((rng.range(-0.6, 1.1) * side).toFixed(2))
    });
    y -= descents[index].drop + rng.range(2, 8);
  }
  return origins;
}
