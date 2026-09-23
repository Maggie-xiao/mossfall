/**
 * MOSSFALL — quality tiers and the performance governor.
 *
 * One job: decide how much machine we are allowed to spend, and keep that
 * decision stable. Every renderer in the game reads the same tier object, so a
 * downgrade is a single event rather than nine modules each guessing.
 *
 * Two things matter more than picking the *right* tier:
 *
 *   1. Never oscillate. A governor that flips between medium and high every few
 *      seconds is worse than one that guesses low and stays there — the eye
 *      forgives a softer image instantly and never forgives a pulsing one. So
 *      the governor is strictly ratcheted: one drop and one recovery per
 *      session, after which it latches shut and stops looking.
 *   2. Never react to the warm-up. The first second and a half of a level is
 *      shader compilation and texture upload; the framerate there says nothing
 *      about the steady state. Those frames are ignored outright.
 */

import { clamp, nowSeconds } from './math.js';

/* ===================================================================== *
 * Tiers
 * ===================================================================== *
 *
 * `instanceScale` is the escape hatch: any module that wants a count we did
 * not think to name here can multiply its own default by it and land in the
 * right ballpark without this file having to know about it.
 *
 * `insect` duplicates `name`. `render/insect.js` resolves a tier by probing
 * `q.insect || q.tier || q.name`, and `tier` is a number — 0 is falsy and 1/2
 * are not strings, so without this field every beetle would silently build at
 * medium detail. Naming the tier explicitly is cheaper than a contract change.
 */

export const QUALITY = {
  low: {
    name: 'low',
    tier: 0,
    insect: 'low',

    pixelRatio: 1.0,          // hard cap on devicePixelRatio
    antialias: false,         // renderer MSAA (canvas); see postSamples for the post path

    shadows: false,
    shadowMapSize: 512,
    shadowSoft: false,
    contactShadows: true,     // the cheap blob under each beetle — always worth it

    leafRes: 56,              // buildFieldMesh opts.res
    leafSkirt: true,
    insectDetail: 0,          // 0..2 → segment counts in render/insect.js
    maxLights: 2,

    particles: 420,           // total CPU-driven particle slots across all pools
    motes: 300,               // GPU-animated ambient motes
    trails: false,
    silkStrands: 1,

    instanceScale: 0.45,
    instances: {
      canopyShells: 2,
      leafClusters: 220,
      vines: 5,
      props: 14,
      mossPatches: 40,
      flowers: 12,
      creatures: 2,
      godrays: 0,
      descentBands: 3,
    },

    postfx: false,
    postSamples: 0,           // MSAA samples on the scene render target
    bloomSteps: 1,            // 0 = no bloom, 1 = half res only, 2 = half + quarter
    chroma: 0,                // edge chromatic warmth (0 disables the taps)

    anisotropy: 1,
    textureSize: 128,         // offscreen canvas textures (beetle spots, bark)
  },

  medium: {
    name: 'medium',
    tier: 1,
    insect: 'medium',

    pixelRatio: 1.5,
    antialias: false,

    shadows: true,
    shadowMapSize: 1024,
    shadowSoft: true,
    contactShadows: true,

    leafRes: 88,
    leafSkirt: true,
    insectDetail: 1,
    maxLights: 3,

    particles: 1100,
    motes: 1200,
    trails: true,
    silkStrands: 2,

    instanceScale: 1.0,
    instances: {
      canopyShells: 3,
      leafClusters: 520,
      vines: 9,
      props: 26,
      mossPatches: 90,
      flowers: 30,
      creatures: 4,
      godrays: 3,
      descentBands: 5,
    },

    postfx: true,
    postSamples: 2,
    bloomSteps: 2,
    chroma: 0.7,

    anisotropy: 4,
    textureSize: 256,
  },

  high: {
    name: 'high',
    tier: 2,
    insect: 'high',

    pixelRatio: 2.0,
    antialias: true,

    shadows: true,
    shadowMapSize: 2048,
    shadowSoft: true,
    contactShadows: true,

    leafRes: 128,
    leafSkirt: true,
    insectDetail: 2,
    maxLights: 3,

    particles: 2200,
    motes: 2600,
    trails: true,
    silkStrands: 3,

    instanceScale: 1.6,
    instances: {
      canopyShells: 4,
      leafClusters: 900,
      vines: 14,
      props: 40,
      mossPatches: 160,
      flowers: 60,
      creatures: 6,
      godrays: 6,
      descentBands: 7,
    },

    postfx: true,
    postSamples: 4,
    bloomSteps: 2,
    chroma: 1.0,

    anisotropy: 8,
    textureSize: 512,
  },
};

/** Ascending, so `QUALITY_NAMES[tier]` round-trips. */
export const QUALITY_NAMES = ['low', 'medium', 'high'];

/**
 * Accepts a tier name, `'auto'`, a tier index, or a tier object, and always
 * returns a tier object. Deliberately total — a bad value from a stale
 * localStorage entry must not be able to stop the game booting.
 */
export function resolveQuality(name) {
  if (name && typeof name === 'object' && typeof name.tier === 'number') return name;
  if (typeof name === 'number' && QUALITY_NAMES[name]) return QUALITY[QUALITY_NAMES[name]];
  const key = String(name || 'auto').toLowerCase();
  if (key === 'auto') return QUALITY[autoDetect()];
  return QUALITY[key] || QUALITY.medium;
}

/* ===================================================================== *
 * Auto-detection
 * ===================================================================== */

/** Renderer strings that mean "there is no GPU here". */
const RE_SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|virgl|apple software/i;

/** Old integrated and old mobile parts. Anything here gets `low`, no argument. */
const RE_WEAK = new RegExp([
  'intel.*(gma|hd graphics (2|3|4|5)\\d{3}|hd graphics$)',
  'mali-(4|t6|t7|t8)',
  'adreno.*(2\\d\\d|3\\d\\d|4\\d\\d|5\\d\\d)',
  'powervr.*(sgx|g6|ge8)',
  'videocore',
  'tegra',
  'geforce (6|7|8|9)\\d{2}m?\\b',
  'radeon.*(hd [2-6]\\d{3}|r5 )',
].join('|'), 'i');

/** Capable-but-not-generous parts. These cap out at `medium`. */
const RE_MID = new RegExp([
  'intel.*(uhd|iris|hd graphics [6-9]\\d{3})',
  'adreno.*(6\\d\\d|7\\d\\d)',
  'mali-g',
  'apple gpu',
  'geforce (mx|gtx (7|9)\\d\\d)',
  'radeon.*(vega|rx 5[45]0)',
].join('|'), 'i');

/**
 * Conservative mobile test. Wants two independent signals — a phone-ish user
 * agent *and* the absence of a fine pointer — so a touchscreen laptop is not
 * mistaken for a phone and needlessly starved.
 */
function isMobile() {
  try {
    const ua = (navigator.userAgent || '') + ' ' + (navigator.platform || '');
    const uaMobile = /android|iphone|ipod|ipad|iemobile|opera mini|blackberry|windows phone/i.test(ua);
    // iPadOS 13+ reports as a Mac; the touch-point count gives it away.
    const iPadish = /macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 2;
    const coarse = typeof matchMedia === 'function'
      && matchMedia('(pointer: coarse)').matches
      && !matchMedia('(any-pointer: fine)').matches;
    return uaMobile || iPadish || (coarse && (navigator.maxTouchPoints || 0) > 0);
  } catch (e) {
    return false;
  }
}

/**
 * One throwaway context, sniffed and immediately released. Losing the context
 * explicitly matters: browsers cap the number of live WebGL contexts, and the
 * game is about to want one of its own.
 */
function gpuSniff() {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return null;
    let renderer = '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    if (!renderer) renderer = String(gl.getParameter(gl.RENDERER) || '');
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return { renderer, maxTex, webgl2 };
  } catch (e) {
    return null;
  }
}

let _autoCache = null;

/**
 * Pick a starting tier from what the machine is willing to tell us. Returns a
 * tier *name*, so `resolveQuality(autoDetect())` is the whole story.
 *
 * Note the asymmetry: every signal here can only ever cap the tier, never raise
 * it. A wrong guess downward costs a little sharpness; a wrong guess upward
 * costs the first ten seconds of the game, which is the only ten seconds a
 * player will give us.
 */
export function autoDetect() {
  if (_autoCache) return _autoCache;
  let cap = 2;
  try {
    const gpu = gpuSniff();
    if (!gpu) {
      cap = 0;                                    // no context at all: assume the worst
    } else {
      const r = gpu.renderer;
      if (RE_SOFTWARE.test(r)) cap = 0;
      else if (RE_WEAK.test(r)) cap = 0;
      else if (RE_MID.test(r)) cap = Math.min(cap, 1);
      if (!gpu.webgl2) cap = 0;
      if (gpu.maxTex && gpu.maxTex < 8192) cap = Math.min(cap, 1);
      if (gpu.maxTex && gpu.maxTex < 4096) cap = 0;
      // An unmasked-renderer-free browser (privacy.resistFingerprinting, Safari
      // with the extension off) tells us nothing. Do not gamble on `high`.
      if (!r) cap = Math.min(cap, 1);
    }

    const mem = navigator.deviceMemory;           // Chromium only, in GB
    if (typeof mem === 'number' && mem > 0) {
      if (mem <= 2) cap = 0;
      else if (mem <= 4) cap = Math.min(cap, 1);
    }

    const cores = navigator.hardwareConcurrency;
    if (typeof cores === 'number' && cores > 0) {
      if (cores <= 2) cap = 0;
      else if (cores <= 4) cap = Math.min(cap, 1);
    }

    if (isMobile()) cap = Math.min(cap, 1);

    // Fill rate, not geometry, is what kills this game: a 5K panel at dpr 2 is
    // four times the pixels of a laptop for the same scene.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = (window.innerWidth || 1280) * (window.innerHeight || 720) * dpr * dpr;
    if (px > 6.0e6 && cap > 1) cap = 1;
    if (px > 1.2e7 && cap > 0) cap = 0;
  } catch (e) {
    cap = 1;
  }
  _autoCache = QUALITY_NAMES[clamp(cap, 0, 2)];
  return _autoCache;
}

/**
 * Apply the parts of a tier that belong to the renderer itself. Optional —
 * `main.js` may do this by hand — but it keeps the pixel-ratio cap and the
 * shadow map in one place when the governor changes tier mid-run.
 */
export function applyRendererQuality(renderer, quality, THREE) {
  const q = resolveQuality(quality);
  if (!renderer || !q) return q;
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = !!q.shadows;
      if (THREE) {
        renderer.shadowMap.type = q.shadowSoft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      }
      renderer.shadowMap.needsUpdate = true;
    }
  } catch (e) { /* a renderer that refuses these is still a usable renderer */ }
  return q;
}

/* ===================================================================== *
 * Governor
 * ===================================================================== */

const DEFAULTS = {
  downFps: 48,        // below this for `downHold` seconds → drop a tier
  downHold: 3.0,
  upFps: 58,          // above this for `upHold` seconds → climb, once, ever
  upHold: 20.0,
  warmup: 1.6,        // ≈ 90 frames at 60 Hz: shader compile, first uploads
  settle: 5.0,        // ignore everything for this long after a change
  maxDown: 1,         // one cut per session, in each direction. See the header.
  maxUp: 1,
};

export class PerfGovernor {
  /**
   * @param {object} bus    an EventBus, or any `{ events: EventBus }` context
   * @param {object} opts   `{ quality, downFps, downHold, upFps, upHold, floor, ceiling }`
   */
  constructor(bus, opts = {}) {
    this.bus = (bus && typeof bus.emit === 'function') ? bus
      : (bus && bus.events && typeof bus.events.emit === 'function') ? bus.events
        : null;

    this.downFps = num(opts.downFps, DEFAULTS.downFps);
    this.downHold = num(opts.downHold, DEFAULTS.downHold);
    this.upFps = num(opts.upFps, DEFAULTS.upFps);
    this.upHold = num(opts.upHold, DEFAULTS.upHold);
    this.warmup = num(opts.warmup, DEFAULTS.warmup);
    this.settle = num(opts.settle, DEFAULTS.settle);
    // Exposed so dev mode can loosen the ratchet while tuning; the shipping
    // defaults are 1 and 1, which is the only setting that cannot pulse.
    this.maxDown = Math.max(0, num(opts.maxDown, DEFAULTS.maxDown) | 0);
    this.maxUp = Math.max(0, num(opts.maxUp, DEFAULTS.maxUp) | 0);

    this.floor = clamp(resolveQuality(opts.floor || 'low').tier, 0, 2);
    this.quality = resolveQuality(opts.quality != null ? opts.quality : 'auto');
    // A hard cap on what the governor may ever climb *itself* to, for a caller
    // that knows something about this machine we never will — a kiosk build, a
    // capture rig, a test harness. Absent one there is no cap here, because the
    // tier being asked for is already the bound (`_start`, just below). Seeding
    // it from the boot tier instead reads like a safety net and is not one: the
    // player raising quality in Settings would have to raise the ceiling with
    // it, at which point the ceiling is a cap that caps nothing and quietly
    // opens whenever it is asked to.
    this.ceiling = opts.ceiling != null
      ? clamp(resolveQuality(opts.ceiling).tier, this.floor, 2)
      : 2;

    // The tier currently being asked for: what detection settled on at boot,
    // and thereafter whatever the player picks in Settings. An upgrade may
    // never take us past it, because a tier above it is one nobody asked for
    // and one this machine has given us no reason to believe it can hold.
    this._start = this.quality.tier;

    this._downs = 0;
    this._ups = 0;
    this._latched = false;

    this._t = 0;          // seconds of governed time observed
    this._last = -1;      // wall clock of the previous update
    this._lowFor = 0;
    this._highFor = 0;
    this._sinceChange = 0;
    this.fps = 60;

    // Reused, per the bus contract — listeners that keep it must copy it.
    this._payload = { name: this.quality.name, tier: this.quality.tier, quality: this.quality, from: this.quality.name, fps: 60, reason: 'init' };
  }

  get name() { return this.quality.name; }
  get tier() { return this.quality.tier; }
  /** True once no further change of any kind is possible this session. */
  get latched() { return this._latched; }

  /**
   * Feed the measured framerate. Safe at any call rate — `Loop.onStats` fires
   * about twice a second, but a caller ticking this every frame gets identical
   * behaviour because the windows are measured in wall time, not in calls.
   */
  update(fps) {
    if (this._latched) return this.quality;
    if (!isFinite(fps) || fps <= 0) return this.quality;

    const now = nowSeconds();
    let dt = this._last < 0 ? 0 : now - this._last;
    this._last = now;
    // A tab that was hidden hands back a multi-second gap; that is not evidence
    // of a slow GPU, so throw it away rather than instantly downgrading.
    if (!(dt > 0) || dt > 1.5) dt = 0;

    this.fps = fps;
    this._t += dt;
    this._sinceChange += dt;
    if (this._t < this.warmup || this._sinceChange < this.settle) {
      this._lowFor = 0;
      this._highFor = 0;
      return this.quality;
    }

    if (fps < this.downFps) { this._lowFor += dt; this._highFor = 0; }
    else if (fps > this.upFps) { this._highFor += dt; this._lowFor = 0; }
    else { this._lowFor = Math.max(0, this._lowFor - dt * 0.5); this._highFor = 0; }

    if (this._lowFor >= this.downHold && this._canDrop()) {
      this._downs++;
      this._set(this.quality.tier - 1, 'slow');
    } else if (this._highFor >= this.upHold && this._canClimb()) {
      this._ups++;
      this._set(this.quality.tier + 1, 'headroom');
    }

    // Latch the moment no further change of any kind is reachable — one cut
    // and one recovery is the whole budget, and a machine that booted at the
    // floor was never offered a climb it did not earn. Past this point we stop
    // looking entirely, which is the only real guarantee the image cannot pulse.
    if (!this._canDrop() && !this._canClimb()) this._latched = true;

    return this.quality;
  }

  _canDrop() {
    return this._downs < this.maxDown && this.quality.tier > this.floor;
  }

  /** A climb is only ever offered to undo a cut we made ourselves, and never
   *  past the tier currently being asked for — the tier we booted at while
   *  nobody has touched Settings, and whatever the player last picked once
   *  somebody has. Climbing higher than that would be us raising the image on
   *  our own initiative, which is the pulsing the ratchet exists to prevent. */
  _canClimb() {
    return this._ups < this.maxUp
      && this._downs > 0
      && this.quality.tier < Math.min(this.ceiling, this._start);
  }

  /** Force a tier (dev mode, settings screen). Counts as a change, not a strike. */
  setQuality(name) {
    const q = resolveQuality(name);
    if (!q || q === this.quality) return this.quality;
    // A deliberate choice becomes the new baseline and spends none of the
    // budget: the ratchet exists to stop *us* pulsing the image, not to stop a
    // player who asked for more from being caught when their machine cannot
    // hold it. The strikes start over from whatever they just picked.
    this._start = q.tier;
    // `ceiling` is deliberately untouched in both directions. It belongs to
    // whoever constructed the governor, and a pick is the player talking to
    // `_start`, not to them. The two bound `_canClimb` together, so a pick above
    // a supplied ceiling still plays at exactly the tier the player asked for —
    // it is only the automatic recovery afterwards that stays inside the cap.
    this._downs = 0;
    this._ups = 0;
    this._latched = false;
    this._set(q.tier, 'manual');
    return this.quality;
  }

  /** New level, new evidence: forget the strikes but keep the ratchet counters. */
  reset() {
    this._t = 0;
    this._last = -1;
    this._lowFor = 0;
    this._highFor = 0;
    this._sinceChange = 0;
  }

  dispose() { this.bus = null; }

  _set(tier, reason) {
    const next = QUALITY[QUALITY_NAMES[clamp(tier, 0, 2)]];
    if (!next || next === this.quality) return;
    const from = this.quality.name;
    this.quality = next;
    this._sinceChange = 0;
    this._lowFor = 0;
    this._highFor = 0;
    const p = this._payload;
    p.name = next.name;
    p.tier = next.tier;
    p.quality = next;
    p.from = from;
    p.fps = this.fps;
    p.reason = reason;
    if (this.bus) this.bus.emit('quality', p);
  }
}

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}
