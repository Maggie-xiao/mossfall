/**
 * MOSS TILT — what one run actually is.
 *
 * This is the only place that answers "which eight boards, in which order,
 * descending through which zones". Everything else — the generator, the variant
 * transforms, the theme bands — is a supplier to this file, and `controller.js`
 * talks only to this file.
 *
 * THE MIX, AND WHY IT IS A MIX
 *
 * A run is not all-generated. The sixteen authored boards are the best boards
 * in the game and they are also the difficulty curve's calibration; throwing
 * them away to prove the generator works would trade quality for novelty. So an
 * authored board, reflected into one of its four isometries, is the *spine* of
 * a run, and generated boards fill the rest. The player meets shapes they could
 * not have seen before alongside shapes that were composed by hand.
 *
 * DETERMINISM
 *
 * A run is a pure function of (theme, seed, mode). Same inputs, same eight
 * boards, forever — which is what lets two players compare a score, what lets
 * the hardware gate replay a fixed board, and what lets a bug report be
 * reproduced from a seed alone.
 *
 * FAILURE
 *
 * The generator can exhaust its retry budget. It must never stall a run, so
 * every generated slot falls back to an authored board. A run of eight authored
 * boards is a worse run than intended; a run of seven boards is a broken game.
 */

import { makeRng, hashSeed, dailySeed } from "./rng.js";
import {
  themeById,
  planDescent,
  descentFor,
  planOrigins,
  THEMES,
  DEFAULT_THEME_ID
} from "./biomes.js";
import { applyVariant, VARIANTS, recolorLevel } from "./level-variants.js";
import { validateLevel } from "./level-validate.js";
import { generateLevel, SPECIES_BY_COLOR } from "./level-gen.js";
import { levelSet, sharedRules } from "./levels.js";
import { SKIN_IDS, skinById } from "./art-skins.js";

export const RUN_LENGTH = 8;

/** 只有这个模式吃程序化内容。 */
export const ENDLESS_MODE = "endless";

/**
 * How much of a run is generated, by mode.
 *
 * Beginner leans on the authored boards: a first-time player should meet the
 * curve someone tuned, not the dice. Advanced leans the other way, because the
 * people replaying it are the ones who have already seen all sixteen.
 */
const GENERATED_SHARE = Object.freeze({
  beginner: 0.5,
  advanced: 0.75
});

/**
 * Difficulty at each slot. Matches the authored ramp: the first board is a
 * single bug on a wide leaf, the last is a crowded board with obstacles.
 * A theme narrows the window — Sunlit Crown never reaches the hardest boards.
 */
function difficultyAt(slot, theme) {
  const [low, high] = theme.difficulty;
  return low + ((high - low) * slot) / (RUN_LENGTH - 1);
}

/**
 * Resolve whatever the caller passed into a concrete 32-bit seed.
 * A string is hashed, a number is used directly, and nothing at all means the
 * daily seed — so the default experience is "everyone gets today's run".
 */
export function resolveSeed(seed) {
  if (seed == null || seed === "daily") return dailySeed();
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  return hashSeed(seed);
}

/**
 * Build one run.
 *
 * Returns the eight level records the scene can load directly, plus the plan
 * that produced them — the plan is what a results screen or a bug report needs
 * in order to say "seed 4821, Dew Hollow, board 5 was a generated ring".
 */
export function planRun({
  theme: themeId = DEFAULT_THEME_ID,
  seed,
  mode = "beginner",
  length = RUN_LENGTH
} = {}) {
  const theme = themeById(themeId);
  const resolvedSeed = resolveSeed(seed);

  // Independent streams per concern. Without this, changing how many draws the
  // generator makes would silently change which zones the run descends — and
  // then "same seed, same run" quietly stops being true across versions.
  const root = makeRng(resolvedSeed);
  const routeRng = root.fork();
  const pickRng = root.fork();
  const variantRng = root.fork();
  const genRng = root.fork();
  const colorRng = root.fork();

  const mirrored = mode === "advanced";
  const zones = planDescent(theme, routeRng, length);

  const descents = [];
  for (let slot = 0; slot < length; slot += 1) {
    descents.push(
      descentFor(slot === 0 ? zones[0] : zones[slot - 1], zones[slot], routeRng, { mirrored })
    );
  }
  const origins = planOrigins(descents, routeRng, { mirrored });

  // The authored pool for this mode, shuffled once so a run never replays the
  // canon order it was authored in.
  const authored = pickRng.shuffle(levelSet(mode));
  let authoredCursor = 0;
  const nextAuthored = () => {
    const entry = authored[authoredCursor % authored.length];
    authoredCursor += 1;
    return entry;
  };

  const share = GENERATED_SHARE[mode] ?? 0.5;
  // Which slots are generated. Slot 0 is always authored: the first board a
  // player sees in a run is the one that teaches the mode, and that should be a
  // board someone composed.
  const generatedSlots = new Set(
    pickRng.sample(
      Array.from({ length: length - 1 }, (_, index) => index + 1),
      Math.round((length - 1) * share)
    )
  );

  const levels = [];
  const plan = [];

  for (let slot = 0; slot < length; slot += 1) {
    const difficulty = difficultyAt(slot, theme);
    const zone = zones[slot];
    // 生成关才需要新 id；授权关**保留原始 id**（B01、A05……）。把它们统统改名成
    // S01..S08 会让「这一局第 4 关是哪块板」在日志、bug 报告和录像里彻底查不回来，
    // 而 nextAuthored 走的是一个洗过的 8 元池、一局最多 8 格，id 不会撞。
    const id = `G${String(slot + 1).padStart(2, "0")}`;

    let level = null;
    let source = "authored";

    if (generatedSlots.has(slot)) {
      level = generateLevel(genRng, {
        difficulty,
        id,
        zone,
        name: `${theme.name} ${slot + 1}`
      });
      source = level ? "generated" : "authored-fallback";
    }

    if (!level) {
      // Authored spine, reflected.
      //
      // The transform is an isometry, so the *geometry* keeps the solvability
      // the test gate already proved — a route cannot vanish under a
      // reflection. But the board is not the whole surface: the `ripple`
      // feature is world-space value noise that deliberately does NOT move with
      // the board, so a spawn that rested at gradient 0.03 can land on a
      // different part of the grain and drift. Measured over 768 generated
      // slots that bit 2% of reflected boards.
      //
      // So reflections get a cheap re-check — resting slopes and clearances,
      // no flood fill, because routes genuinely cannot break. Identity is the
      // last resort and is always legal, being the authored board itself.
      const base = nextAuthored();
      level = null;
      for (const variant of variantRng.shuffle(VARIANTS)) {
        const candidate = applyVariant(base, variant);
        if (validateLevel(candidate, { checkRoutes: false }).ok) {
          level = candidate;
          break;
        }
      }
      level = recolorLevel(level || applyVariant(base, "identity"), colorRng, SPECIES_BY_COLOR);
      level = { ...level, id: base.id, name: base.name };
    }

    const record = {
      ...level,
      zone,
      origin: origins[slot],
      descent: descents[slot]
    };
    levels.push(record);
    plan.push({
      slot,
      id: record.id,
      source,
      zone,
      difficulty: Number(difficulty.toFixed(3)),
      archetype: record.archetype || null,
      variant: record.variant || null,
      bugs: record.bugs.length,
      holes: record.board.holes.length,
      obstacles: record.board.obstacles.length
    });
  }

  return {
    seed: resolvedSeed,
    theme: theme.id,
    themeName: theme.name,
    mode,
    zones,
    levels,
    plan,
    shared: sharedRules(mode)
  };
}

/**
 * A run of purely authored boards in their authored order — the canon run.
 *
 * The evidence gate and the hardware pass both replay fixed boards (B01's
 * capture trace, A03/A08 stress passes). Those must keep meeting the exact
 * geometry they were recorded against, so they ask for this rather than for a
 * seeded run.
 */
export function canonRun(mode = "beginner") {
  const levels = levelSet(mode);
  return {
    seed: 0,
    theme: "canon",
    themeName: "Canon",
    mode,
    zones: levels.map((level) => level.zone),
    levels,
    plan: levels.map((level, slot) => ({
      slot,
      id: level.id,
      source: "canon",
      zone: level.zone,
      difficulty: slot / (levels.length - 1),
      archetype: null,
      variant: null,
      bugs: level.bugs.length,
      holes: level.board.holes.length,
      obstacles: level.board.obstacles.length
    })),
    shared: sharedRules(mode)
  };
}

/* ===================================================================== *
 * Endless
 * ===================================================================== */

/** How many boards one descent cycle spends before a new theme is drawn. */
const CYCLE_LENGTH = 8;

/**
 * How fast endless gets hard. Level 1 opens at the easiest board the generator
 * makes; by level 19 it is drawing from the top of the range and stays there.
 * The clock is what ends the run after that, not the difficulty curve.
 */
const RAMP_LEVELS = 18;

/**
 * An endless run: boards drawn on demand, forever, until the clock runs out.
 *
 * WHY IT IS LAZY
 *
 * There is no last level, so there is no array to build. `levelAt` generates on
 * first request and caches, which costs ~31 ms — paid during the level-clear
 * bonus tally or the descent, both of which are already several seconds long.
 *
 * WHY THE THEME ROTATES
 *
 * A theme is a depth band of the tree (see biomes.js), and a band has a floor.
 * Descend a band in eight boards and there is nowhere lower to go; stay there
 * and the player stares at one palette for the rest of the run. So each cycle
 * of eight draws a new theme and descends again. The run keeps falling and the
 * light keeps changing, which is the whole point of the descent.
 *
 * Difficulty ignores the theme window here. In a fixed run the window keeps
 * Sunlit Crown gentle; in endless the theme is scenery and the ramp is global,
 * because an endless mode that caps its own difficulty ends in boredom rather
 * than defeat.
 */
export function createEndlessRun({ seed, mode = ENDLESS_MODE, skin = "canon" } = {}) {
  const resolvedSeed = resolveSeed(seed);
  /* 皮肤决定这一局的配色池。暖世界必须配冷虫，否则 palette.js 的第一条铁律
     （甲虫是画面唯一饱和物）在秋色里会当场失效 —— 渲出来看过，红瓢虫在赭石
     叶面上确实糊掉。 */
  const requestedSkin = skinById(skin);
  const weatherPool = requestedSkin.id === "canon"
    ? SKIN_IDS
    : [requestedSkin.id];

  /**
   * Every draw is derived from (seed, what, index) rather than from a running
   * stream, so `levelAt(40)` returns the same board whether or not levels 0-39
   * were asked for first. A shared stream would make the run depend on call
   * order — fine while play is strictly sequential, wrong the moment anything
   * caches, resumes, or previews ahead.
   */
  const streamFor = (what, index) =>
    makeRng(hashSeed(`${resolvedSeed}:${what}:${index}`));

  const cycles = [];
  const levels = [];
  const plan = [];
  const difficultyOffsets = [];

  /** Theme + descent route for cycle `index`, drawn once and remembered. */
  const cycleAt = (index) => {
    if (!cycles[index]) {
      const rng = streamFor("cycle", index);
      // 不连着抽到同一个主题。允许重复的话「换一棵树」有时换出一棵一模一样的，
      // 而这个模式的全部意义就是每一段都不一样。
      const previous = index > 0 ? cycleAt(index - 1).theme.id : null;
      const pool = THEMES.filter((entry) => entry.id !== previous);
      const theme = rng.pick(pool.length ? pool : THEMES);
      const previousWeather = index > 0 ? cycleAt(index - 1).weather.id : null;
      const weatherChoices = weatherPool.filter((id) => id !== previousWeather);
      const weather = skinById(
        rng.pick(weatherChoices.length ? weatherChoices : weatherPool)
      );
      cycles[index] = {
        theme,
        weather,
        zones: planDescent(theme, rng, CYCLE_LENGTH),
        // Each cycle gets its own shuffled authored pool, so the boards that
        // anchor cycle 3 are not the ones that anchored cycle 1.
        authored: rng.shuffle(levelSet("beginner")),
        cursor: 0
      };
    }
    return cycles[index];
  };

  const difficultyAtIndex = (index) =>
    Math.min(1, index / RAMP_LEVELS);

  function build(index) {
    const cycle = cycleAt(Math.floor(index / CYCLE_LENGTH));
    const step = index % CYCLE_LENGTH;
    const zone = cycle.zones[step];
    const baseDifficulty = difficultyAtIndex(index);
    const difficulty = Math.max(
      0,
      Math.min(1, baseDifficulty + (difficultyOffsets[index] || 0))
    );
    const id = `E${String(index + 1).padStart(3, "0")}`;

    const rng = streamFor("level", index);
    let level = generateLevel(rng, {
      difficulty,
      id,
      zone,
      name: `${cycle.theme.name} ${step + 1}`,
      colors: cycle.weather.insectBias || null
    });
    let source = level ? "generated" : "authored-fallback";

    if (!level) {
      // Same fallback contract as a fixed run: an authored board reflected,
      // re-checked cheaply because world-space ripple can tip a resting spawn.
      const base = cycle.authored[cycle.cursor % cycle.authored.length];
      cycle.cursor += 1;
      for (const variant of rng.shuffle(VARIANTS)) {
        const candidate = applyVariant(base, variant);
        if (validateLevel(candidate, { checkRoutes: false }).ok) {
          level = candidate;
          break;
        }
      }
      level = recolorLevel(level || applyVariant(base, "identity"), rng, SPECIES_BY_COLOR);
      level = { ...level, id: base.id, name: base.name };
    }

    // The zone a cycle boundary falls FROM is the previous cycle's floor, which
    // is below the new cycle's crown. Descending cannot go up, so a boundary is
    // not a step down the same tree — it is leaving one tree and falling into
    // the canopy of the next. Give it a long fall so it reads that way instead
    // of reading as a teleport back up.
    const boundary = step === 0 && index > 0;
    const previousZone = boundary
      ? zone
      : (index === 0 ? zone : cycleAt(Math.floor((index - 1) / CYCLE_LENGTH))
          .zones[(index - 1) % CYCLE_LENGTH]);

    const descent = descentFor(previousZone, zone, rng);
    if (boundary) {
      descent.drop = Number((descent.drop * 2.1).toFixed(2));
      descent.duration = Number((descent.duration * 1.6).toFixed(2));
    }

    const record = {
      ...level,
      weather: cycle.weather.id,
      weatherName: cycle.weather.nameZh || cycle.weather.name,
      clearRule: level.colorMatch ? "match-all" : "capture-all",
      zone,
      origin: {
        x: Number(rng.range(-2.2, 2.2).toFixed(2)),
        y: -index * 62,
        z: Number(rng.range(-0.6, 1.1).toFixed(2))
      },
      descent
    };

    levels[index] = record;
    plan[index] = {
      slot: index,
      id: record.id,
      source,
      theme: cycle.theme.id,
      weather: cycle.weather.id,
      boundary,
      zone,
      difficulty: Number(difficulty.toFixed(3)),
      baseDifficulty: Number(baseDifficulty.toFixed(3)),
      archetype: record.archetype || null,
      variant: record.variant || null,
      bugs: record.bugs.length,
      holes: record.board.holes.length,
      obstacles: record.board.obstacles.length
    };
    return record;
  }

  return {
    seed: resolvedSeed,
    mode,
    endless: true,
    skin: "rotating",
    theme: "rotating",
    themeName: "Endless",
    shared: sharedRules(mode),

    /** The board at `index`, generated on first ask. Never returns null. */
    levelAt(index) {
      const at = Math.max(0, index | 0);
      return levels[at] || build(at);
    },

    /** What has been drawn so far. Grows as the player descends. */
    get levels() {
      return levels;
    },
    get plan() {
      return plan;
    },
    themeAt(index) {
      return cycleAt(Math.floor(Math.max(0, index | 0) / CYCLE_LENGTH)).theme;
    },
    setDifficultyOffset(index, offset) {
      const at = Math.max(0, index | 0);
      if (levels[at]) return false;
      difficultyOffsets[at] = Math.max(-0.3, Math.min(0.3, Number(offset) || 0));
      return true;
    }
  };
}
