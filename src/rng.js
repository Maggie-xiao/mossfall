/**
 * MOSS TILT — deterministic randomness.
 *
 * Every random decision in a run — which levels, which variant transform, which
 * biome, which insect colours — is drawn from one seeded stream. Same seed in,
 * byte-identical run out. That is not a nicety: `npm run runtime:evidence`
 * replays a fixed capture trace, the hardware gate replays fixed levels, and a
 * player comparing a daily score with a friend needs the same eight boards.
 *
 * `Math.random` is therefore banned everywhere downstream of this module.
 */

/** mulberry32 — 32-bit state, uniform, fast, and stable across engines. */
export function makeRng(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Uniform in [min, max). */
  next.range = (min, max) => min + next() * (max - min);

  /** Uniform integer in [min, max]. */
  next.int = (min, max) => Math.floor(min + next() * (max - min + 1));

  /** True with probability p. */
  next.chance = (p) => next() < p;

  /** One element of `list`. */
  next.pick = (list) => list[Math.floor(next() * list.length)];

  /** A new array, Fisher-Yates shuffled. Never mutates the input. */
  next.shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  /**
   * `count` distinct elements of `list`, in shuffled order. Returns fewer only
   * when the list is shorter than `count`.
   */
  next.sample = (list, count) => next.shuffle(list).slice(0, count);

  /**
   * A fresh independent stream, derived from this one. Use this to give each
   * subsystem its own stream so adding a draw in the level generator cannot
   * shift which biome the art layer picks.
   */
  next.fork = () => makeRng(Math.floor(next() * 0xffffffff));

  return next;
}

/** FNV-1a. Turns a string seed ("2026-08-31", a room code) into a 32-bit int. */
export function hashSeed(text) {
  let hash = 0x811c9dc5;
  const source = String(text);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The seed for a given local day, as `YYYY-MM-DD` hashed. Everyone playing the
 * same calendar day in the same timezone gets the same run.
 */
export function dailySeed(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return hashSeed(`${year}-${month}-${day}`);
}
