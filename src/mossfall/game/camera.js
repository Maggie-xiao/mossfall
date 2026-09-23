/**
 * MOSSFALL — the camera.
 *
 * One job, two halves, and the first half is mostly restraint.
 *
 * **During play the camera is nailed down.** The player is shifting their actual
 * body weight; if the frame drifts while they lean, the loop between "I moved"
 * and "the leaf moved" is broken and the whole thing turns queasy. So there is no
 * orbit, no follow, no zoom, and — importantly — no yaw. The tilt axes are
 * screen-aligned by contract (lean right, beetles go right), which only stays
 * true while the camera looks straight down the -z axis. `frameLevel` picks the
 * one distance at which this level's whole board fits the frame with the same
 * margin as every other level, and then nothing moves except the impulses below,
 * which are springs anchored at zero and therefore cannot accumulate drift.
 *
 * **Between levels it is the only thing on screen.** The descent is authored:
 * pull away from the finished leaf, tip into the fall, accelerate through a long
 * middle, drift around the trunk, then decelerate hard and lock — exactly — into
 * the next fixed gameplay pose. Beats are emitted ahead of the camera so world,
 * fx and audio can dress the shaft just before it arrives.
 */

import * as THREE from 'three';
import {
  clamp, clamp01, lerp, sstep, sstep5, easeInOutCubic, TAU,
} from '../core/math.js';
import { Field } from '../sim/field.js';

const DEG = Math.PI / 180;

/* ===================================================================== *
 * Tunables. Every number here is a composition decision, not a magic
 * constant — dev mode is expected to poke at them live.
 * ===================================================================== */

export const CAMERA_TUNING = {
  /** Fixed three-quarter pitch. Steep enough to read hole positions, shallow
   *  enough that the trunk behind the leaf still tells you where you are. */
  elevation: 40 * DEG,
  fov: 60,
  near: 0.1,
  far: 700,

  /** Fraction of the frame kept clear around the board. Same for every level —
   *  this is what makes a 3 m oval and a 9 m split gallery read identically. */
  margin: 0.14,
  /** Focus sits slightly above the blade, so the leaf hangs a little low in
   *  frame and the canopy above it gets room to establish the place. */
  lift: 0.28,
  /** Vertical headroom over the blade for hole rims, props and beetle bodies. */
  headroom: 0.34,
  minDist: 4.5,
  /** Safety valve only. A wide split platform in a tall portrait frame is the
   *  one case that really does need to be this far back. */
  maxDist: 42,

  /** Hard ceilings on the play-time impulses. Never exceeded, whatever stacks. */
  maxKickPos: 0.02,          // metres
  maxKickRot: 0.4 * DEG,     // radians
  reducedScale: 0.06,        // settings.motion === 'reduced'

  /** Descent. */
  fovKick: 12,               // 60 → 72 at peak fall speed
  pullBack: 0.10,            // of the framing distance, at the top of the fall
  swirlBase: 2.2,            // metres of lateral drift at spec.swirl = 1
  swirlPerDrop: 0.03,        // ...plus this much per metre fallen
  pitchDip: 9 * DEG,         // look further down the faster you are falling
  yawDrift: 3.5 * DEG,
  rollBank: 2.6 * DEG,
  blendTime: 0.7,            // frameLevel(level, false)
};

const CAM = CAMERA_TUNING;

/* ===================================================================== *
 * The fall curve.
 *
 * Authored as a *speed* profile — ease in, hold, brake hard — and integrated
 * once at module load into a normalised position LUT. Doing it this way means
 * the shape of the fall is edited where it is legible (how long is the
 * acceleration? how hard is the stop?) rather than by guessing at the
 * coefficients of a position easing.
 * ===================================================================== */

const FALL_IN = 0.24;    // ease-in ends here
const FALL_OUT = 0.68;   // brake starts here

/** Normalised fall speed, 0..1. Zero at both ends, flat through the middle. */
function fallSpeed(t) {
  return sstep(0, FALL_IN, t) * (1 - sstep5(FALL_OUT, 1, t));
}

const FALL_N = 128;
const FALL_LUT = new Float32Array(FALL_N + 1);
/** Mean of `fallSpeed` over [0,1] — converts normalised speed to metres/second. */
let FALL_MEAN = 1;

(function buildFallLut() {
  const M = 1024;
  const acc = new Float64Array(M + 1);
  let sum = 0;
  let prev = fallSpeed(0);
  for (let i = 1; i <= M; i++) {
    const v = fallSpeed(i / M);
    sum += ((prev + v) * 0.5) / M;
    acc[i] = sum;
    prev = v;
  }
  FALL_MEAN = sum || 1;
  for (let k = 0; k <= FALL_N; k++) {
    const f = (k / FALL_N) * M;
    const i = Math.min(M - 1, f | 0);
    FALL_LUT[k] = lerp(acc[i], acc[i + 1], f - i) / FALL_MEAN;
  }
  FALL_LUT[FALL_N] = 1;
})();

/** Fraction of the drop covered by normalised time `t`. */
function fallProgress(t) {
  const f = clamp01(t) * FALL_N;
  const i = Math.min(FALL_N - 1, f | 0);
  return lerp(FALL_LUT[i], FALL_LUT[i + 1], f - i);
}

/* ===================================================================== *
 * Beats.
 *
 * `t` is where the beat wants to sit in the fall; the scheduler honours the
 * level's ordering but nudges them apart so two never land on the same frame.
 * `side` is an angle around the fall column and `radius` the distance from it,
 * which is all another system needs to place a thing in the camera's path.
 * `lead` is how many seconds of warning the event carries.
 * ===================================================================== */

const BEAT_PROFILES = {
  sunshaft:    { t: 0.14, side: 1.60, radius: 3.0, y:  2.0, dur: 1.5, intensity: 0.9, lead: 0.55 },
  hollow:      { t: 0.22, side: 0.00, radius: 3.4, y:  0.0, dur: 1.1, intensity: 0.8, lead: 0.50 },
  squirrel:    { t: 0.28, side: 0.35, radius: 2.6, y: -0.3, dur: 0.9, intensity: 0.7, lead: 0.50 },
  vines:       { t: 0.36, side: 2.10, radius: 2.2, y:  0.4, dur: 1.3, intensity: 0.8, lead: 0.45 },
  butterflies: { t: 0.44, side: 4.00, radius: 1.4, y:  0.0, dur: 1.2, intensity: 0.7, lead: 0.45 },
  droplets:    { t: 0.50, side: 3.00, radius: 1.1, y:  0.6, dur: 1.0, intensity: 0.6, lead: 0.40 },
  leafbrush:   { t: 0.56, side: 1.20, radius: 0.7, y:  0.0, dur: 0.5, intensity: 1.0, lead: 0.25 },
  waterfall:   { t: 0.62, side: 5.60, radius: 4.2, y:  0.0, dur: 1.6, intensity: 0.9, lead: 0.60 },
  dark:        { t: 0.68, side: 0.00, radius: 0.0, y:  0.0, dur: 1.1, intensity: 1.0, lead: 0.35 },
  fireflies:   { t: 0.76, side: 5.10, radius: 1.8, y: -0.2, dur: 1.5, intensity: 0.8, lead: 0.45 },
  roots:       { t: 0.86, side: 2.60, radius: 3.6, y: -0.5, dur: 1.2, intensity: 0.8, lead: 0.45 },
  garden:      { t: 0.92, side: 0.00, radius: 0.0, y: -1.0, dur: 1.4, intensity: 1.0, lead: 0.70 },
};

const MAX_BEATS = 12;
const BEAT_GAP = 0.075;
const BEAT_FIRST = 0.06;
const BEAT_LAST = 0.94;

/* ===================================================================== *
 * Scratch — this file allocates nothing after construction.
 * ===================================================================== */

const _eul = new THREE.Euler(0, 0, 0, 'YXZ');
const _off = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _org = new THREE.Vector3();
const _orgB = new THREE.Vector3();
/** Two path evaluations per frame at most: the live camera, and a beat anchor. */
const _pathA = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, fov: 60 };
const _pathB = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, fov: 60 };

/**
 * A single decaying spring channel. Impulses are velocity kicks, so the rest
 * state is always exactly zero — no matter how many land, or how fast, the
 * offset returns home and cannot integrate into a drift.
 */
class Kick {
  constructor() { this.x = 0; this.v = 0; this.w = 24; this.z = 0.7; }

  /** `amp` is the peak displacement the player will actually see. For a
   *  critically damped spring a velocity kick V peaks at V/(ωe), so scale. */
  hit(amp, w, zeta) {
    this.w = w; this.z = zeta;
    this.v += amp * w * Math.E;
  }

  step(dt) {
    if (this.x === 0 && this.v === 0) return;
    const k = this.w * this.w;
    const c = 2 * this.z * this.w;
    // Semi-implicit, sub-stepped: a 38 rad/s spring is unstable at a 30 Hz dt.
    let n = 1, h = dt;
    if (h > 0.016) { n = Math.ceil(h / 0.016); h = dt / n; }
    for (let i = 0; i < n; i++) {
      this.v += (-k * this.x - c * this.v) * h;
      this.x += this.v * h;
    }
    if (Math.abs(this.x) < 1e-6 && Math.abs(this.v) < 1e-5) { this.x = 0; this.v = 0; }
  }

  reset() { this.x = 0; this.v = 0; }
}

/** A fixed gameplay viewpoint: where the camera stands and what it frames. */
class Pose {
  constructor() {
    this.pos = new THREE.Vector3(0, 6, 8);
    this.focus = new THREE.Vector3(0, 0, 0);
    this.dist = 10;
  }
  copy(o) { this.pos.copy(o.pos); this.focus.copy(o.focus); this.dist = o.dist; return this; }
}

/* ===================================================================== *
 * GameCamera
 * ===================================================================== */

export class GameCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} ctx  { events, settings } — everything else is ignored.
   */
  constructor(camera, ctx = {}) {
    this.camera = camera || null;
    this.ctx = ctx || {};
    this.events = this.ctx.events || null;
    this.settings = this.ctx.settings || null;

    this._mode = 'fixed';               // 'fixed' | 'blend' | 'descent'
    this._level = null;
    this._levelFrom = null;
    this._levelTo = null;

    this._pose = new Pose();
    this._poseFrom = new Pose();
    this._poseTo = new Pose();
    this._blendFrom = new THREE.Vector3();
    this._blendT = 0;
    this._warp = new THREE.Vector3();   // decaying correction after a reframe
    this._descentP = 0;

    // Dev-only framing override, `{ dist, height }` in metres, or null for the
    // solved framing. Kept here rather than in CAMERA_TUNING because distance
    // and height are *results* of the solve, not inputs to it — see
    // `setFramingOverride`.
    this._devPose = null;

    this._basePos = new THREE.Vector3(0, 6, 8);
    this._basePitch = -this._elev();
    this._baseYaw = 0;
    this._baseRoll = 0;
    this._fov = CAM.fov;
    this._appliedFov = -1;
    this._focus = new THREE.Vector3();
    this._focusDist = 10;
    this._aspect = 0;

    /* impulse channels: three translation (camera-local), three rotation */
    this._kp = [new Kick(), new Kick(), new Kick()];
    this._kr = [new Kick(), new Kick(), new Kick()];
    this._flip = 1;
    this._nseed = 0x2f6e2b1;

    /* level bookkeeping — Fields are rebuilt rather than borrowed, so framing
     * can never be computed against whatever board the sim happens to hold. */
    this._fields = new Map();
    this._origins = new Map();
    this._column = new THREE.Vector3(0, 0, 0);

    this._descent = {
      active: false, id: 0, time: 0, duration: 1,
      drop: 0, swirl: 0, phase: 0, pull: 0,
      pitchDip: 0, yawDrift: 0, rollBank: 0, fovKick: 0,
      zoneFrom: 0, zoneTo: 0,
      from: this._poseFrom, to: this._poseTo,
      resolve: null,
    };

    this._beats = [];
    for (let i = 0; i < MAX_BEATS; i++) {
      this._beats.push({ kind: '', t: 0, fireT: 0, fired: true, profile: null });
    }
    this._beatCount = 0;
    this._beat = {
      kind: '', t: 0, time: 0, delay: 0, progress: 0,
      x: 0, y: 0, z: 0, side: 0, radius: 0,
      duration: 0, intensity: 1, speed: 0,
      zoneFrom: 0, zoneTo: 0, descentId: 0,
    };

    if (this.camera) {
      const c = this.camera;
      c.rotation.order = 'YXZ';
      c.fov = CAM.fov;
      c.near = CAM.near;
      c.far = CAM.far;
      this._aspect = c.aspect;
      this._appliedFov = c.fov;
      try { c.updateProjectionMatrix(); } catch (e) { /* headless camera stub */ }
    }
  }

  get isDescending() { return this._descent.active; }

  /* ------------------------------------------------------------------ *
   * Framing
   * ------------------------------------------------------------------ */

  /**
   * Lock the fixed gameplay view onto `level`. `immediate` (the default) snaps;
   * false eases over ~0.7 s, which is what a restart wants.
   */
  frameLevel(level, immediate = true) {
    if (!this.camera || !level) return;
    try {
      if (this._descent.active) this._finishDescent(true);
      this._level = level;
      this._aspect = this.camera.aspect;
      this._computePose(level, this._pose);
      this._focusDist = this._pose.dist;

      if (immediate !== false) {
        this._mode = 'fixed';
        this._basePos.copy(this._pose.pos);
        this._warp.set(0, 0, 0);
        this._resetKicks();
      } else {
        this._mode = 'blend';
        this._blendFrom.copy(this._basePos);
        this._blendT = 0;
      }
      this._basePitch = -this._elev();
      this._baseYaw = 0;
      this._baseRoll = 0;
      this._fov = CAM.fov;
      this._compose();
    } catch (err) {
      console.error('[camera] frameLevel failed:', err);
    }
  }

  /** Effective three-quarter pitch: the dev override if one is set, else the tunable. */
  _elev() {
    const d = this._devPose;
    if (!d) return CAM.elevation;
    return Math.atan2(Math.max(0.05, d.height), Math.max(0.05, d.dist));
  }

  /**
   * Dev mode only. `fov` and `margin` are genuine inputs to the framing solve
   * and go straight into the tunables; `distance` and `height` are not — the
   * solver *derives* them from the board bounds — so they are stored as an
   * explicit ground-distance/height pair that replaces the solved result.
   * Touching either one seeds the other from the live pose, so grabbing one
   * slider does not fling the camera along the other axis.
   *
   * `margin` arrives as a zoom-out factor (1.15 = "show it at 1/1.15 of the
   * frame"), which is the reciprocal of the fraction the solver wants.
   */
  setFramingOverride(key, value) {
    const v = +value;
    if (!isFinite(v)) return;
    if (key === 'fov') {
      CAM.fov = clamp(v, 15, 100);
    } else if (key === 'margin') {
      CAM.margin = clamp(1 - 1 / Math.max(1, v), 0, 0.6);
    } else if (key === 'distance' || key === 'height') {
      if (!this._devPose) {
        const e = CAM.elevation;
        const d = this._pose.dist || 12;
        this._devPose = { dist: d * Math.cos(e), height: d * Math.sin(e) };
      }
      this._devPose[key === 'distance' ? 'dist' : 'height'] = clamp(v, 0.5, 120);
    } else {
      return;
    }
    if (this._level) this.frameLevel(this._level, true);
  }

  /** Drop every dev framing override and go back to the solved pose. */
  clearFramingOverride() {
    this._devPose = null;
    if (this._level) this.frameLevel(this._level, true);
  }

  /**
   * The world point the frame is built around. Lighting uses it to keep the
   * shadow frustum tight. **Reused vector — copy it if you keep it.**
   */
  focusPoint() { return this._focus; }

  /**
   * Where this level's board group belongs in world space. Levels that carry an
   * explicit `origin` get it back unchanged; ones that do not are stacked down
   * the fall column by their own `descent.drop`. Exposed so the director and the
   * world can place the board at the exact point the camera is framing.
   * **Reused vector — copy it.**
   */
  originFor(level) { return this._originOf(level, _org); }

  /* ------------------------------------------------------------------ *
   * Per-frame
   * ------------------------------------------------------------------ */

  update(dt, elapsed) {
    const cam = this.camera;
    if (!cam) return;
    dt = clamp(dt || 0, 0, 0.1);

    // A resize mid-anything re-solves every pose in place; the descent lerps
    // toward `_poseTo`, so moving the target is all that is needed.
    if (Math.abs(cam.aspect - this._aspect) > 1e-4) this._reframe();

    if (this._mode === 'descent') {
      this._stepDescent(dt);
    } else if (this._mode === 'blend') {
      this._blendT += dt;
      const t = CAM.blendTime > 0 ? clamp01(this._blendT / CAM.blendTime) : 1;
      const e = easeInOutCubic(t);
      this._basePos.lerpVectors(this._blendFrom, this._pose.pos, e);
      this._focusDist = this._pose.dist;
      if (t >= 1) { this._mode = 'fixed'; this._basePos.copy(this._pose.pos); }
    } else {
      this._basePos.copy(this._pose.pos);
      this._basePitch = -this._elev();
      this._baseYaw = 0;
      this._baseRoll = 0;
      this._fov = CAM.fov;
      this._focusDist = this._pose.dist;
    }

    // Applied before it decays, so the frame a resize lands on is continuous.
    if (this._warp.lengthSq() > 1e-8) {
      this._basePos.add(this._warp);
      this._warp.multiplyScalar(Math.exp(-3.0 * dt));
    } else if (this._warp.x || this._warp.y || this._warp.z) {
      this._warp.set(0, 0, 0);
    }

    for (let i = 0; i < 3; i++) { this._kp[i].step(dt); this._kr[i].step(dt); }
    this._compose();
  }

  /* ------------------------------------------------------------------ *
   * Impulses
   * ------------------------------------------------------------------ */

  /**
   * The only motion during play. Each is a velocity kick on the spring channels
   * above, sized so the *whole budget* — every impulse that could be live at
   * once — stays inside 2 cm and 0.4°. That is deliberately almost subliminal:
   * it should register as weight, never as a camera doing something.
   */
  impulse(kind, strength = 1) {
    const s = clamp(strength == null ? 1 : strength, 0, 2) * this._motionScale();
    if (s <= 0.0005) return;
    const kp = this._kp, kr = this._kr;
    switch (kind) {
      case 'land':
        // A beetle touches down: the frame takes the weight and dips.
        kp[1].hit(-0.013 * s, 30, 0.55);
        kr[0].hit(-0.0050 * s, 30, 0.55);
        break;
      case 'capture': {
        // Soft pulse — a breath in, and a whisper of roll that alternates so
        // three captures in a row do not feel like one repeated cue.
        const f = (this._flip = -this._flip);
        kp[2].hit(-0.007 * s, 17, 0.85);
        kr[1].hit(0.0018 * s * f, 17, 0.85);
        kr[0].hit(-0.0012 * s, 17, 0.85);
        break;
      }
      case 'win':
        // Restrained push-in: slow enough to read as a swell, still home in 0.5 s.
        kp[2].hit(-0.018 * s, 13, 1.0);
        kr[0].hit(-0.0028 * s, 13, 1.0);
        break;
      case 'shake': {
        // Environmental, rare. Direction varies but the budget does not.
        const a = this._noiseAngle();
        kp[0].hit(Math.cos(a) * 0.011 * s, 38, 0.45);
        kp[1].hit(Math.sin(a) * 0.009 * s, 38, 0.45);
        kr[2].hit(Math.cos(a * 1.7) * 0.0055 * s, 38, 0.45);
        kr[0].hit(Math.sin(a * 2.3) * 0.0040 * s, 38, 0.45);
        break;
      }
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ *
   * Descent
   * ------------------------------------------------------------------ */

  /**
   * The cinematic fall from `from`'s leaf down to `to`'s. Resolves when the
   * camera has locked into the next gameplay pose. Never rejects: a malformed
   * spec degrades to an instant cut so the level still starts.
   *
   * @param {object} from   the level just completed
   * @param {object} to     the level being fallen into
   * @param {object} spec   `to.descent` — { drop, duration, beats, swirl }
   * @returns {Promise<void>}
   */
  startDescent(from, to, spec) {
    if (!this.camera || !to) {
      if (to) this.frameLevel(to, true);
      return Promise.resolve();
    }
    try {
      if (this._descent.active) this._finishDescent(true);

      const s = spec || to.descent || {};
      const drop = Math.max(1, +s.drop || 40);
      const duration = clamp(+s.duration || 4.0, 0.6, 20);
      const reduced = this._motionScale() < 0.5;

      // Resolve both ends of the fall *before* framing, so a level without an
      // explicit origin gets stacked `drop` metres below the one above it.
      this._originOf(from, _org);
      if (from && to && !to.origin && !this._origins.has(this._keyOf(to))) {
        this._column.copy(_org);
        this._column.y -= drop;
      }
      this._originOf(to, _orgB);

      this._levelFrom = from || this._level;
      this._levelTo = to;
      this._aspect = this.camera.aspect;
      this._computePose(to, this._poseTo);
      if (this._levelFrom) {
        this._computePose(this._levelFrom, this._poseFrom);
      } else {
        // Falling into the first leaf: there is no leaf above to leave, so the
        // fall simply starts `drop` metres over the destination.
        this._poseFrom.copy(this._poseTo);
        this._poseFrom.pos.y += drop;
        this._poseFrom.focus.y += drop;
      }

      const d = this._descent;
      d.active = true;
      d.id++;
      d.time = 0;
      d.duration = duration;
      d.drop = drop;
      // Deterministic per-fall phase: consecutive falls spiral differently
      // without ever being random, so a replay looks like the same journey.
      // The destination index on its own does not identify a fall, though. The
      // finale drops back onto the leaf it has just lifted off, so keyed on the
      // destination alone it inherits that leaf's phase and swirls exactly like
      // the descent that first arrived there — the one thing this number exists
      // to prevent. A fall that does not advance down the run is therefore
      // turned half a circle away from the one that did, which is the smallest
      // change that separates them and leaves the eight authored descents
      // sitting on the numbers they were composed against.
      const toI = to.index | 0;
      const fromI = this._levelFrom ? this._levelFrom.index | 0 : toI - 1;
      d.phase = (toI * 1.7 + 0.4 + (fromI >= toI ? Math.PI : 0)) % TAU;
      d.swirl = Math.max(0, +s.swirl || 0) * (CAM.swirlBase + drop * CAM.swirlPerDrop)
        * (reduced ? 0.15 : 1);
      d.pull = clamp(this._poseFrom.dist * CAM.pullBack, 0.25, 1.2);
      d.pitchDip = CAM.pitchDip * (reduced ? 0.2 : 1);
      d.yawDrift = CAM.yawDrift * (reduced ? 0 : 1);
      d.rollBank = CAM.rollBank * (reduced ? 0 : 1);
      d.fovKick = CAM.fovKick * (reduced ? 0.25 : 1);
      d.zoneFrom = (from && from.zone) | 0;
      d.zoneTo = (to.zone) | 0;

      this._scheduleBeats(s, duration);
      this._mode = 'descent';
      this._focusDist = this._poseFrom.dist;

      return new Promise((resolve) => { d.resolve = resolve; });
    } catch (err) {
      console.error('[camera] startDescent failed:', err);
      this.frameLevel(to, true);
      return Promise.resolve();
    }
  }

  /** Jump to the end of the descent cleanly. Safe to call at any time. */
  skip() {
    if (!this._descent.active) return;
    this._finishDescent(true);
  }

  dispose() {
    if (this._descent.active) this._finishDescent(true);
    this._fields.clear();
    this._origins.clear();
    this._level = this._levelFrom = this._levelTo = null;
    this.events = null;
  }

  /* ================================================================== *
   * Internals
   * ================================================================== */

  _motionScale() {
    const st = this.settings || (this.ctx && this.ctx.settings);
    return st && st.motion === 'reduced' ? CAM.reducedScale : 1;
  }

  /** Cheap deterministic angle sequence for shake direction. */
  _noiseAngle() {
    this._nseed = ((this._nseed || 1) * 1103515245 + 12345) & 0x7fffffff;
    return (this._nseed / 0x7fffffff) * TAU;
  }

  _resetKicks() {
    for (let i = 0; i < 3; i++) { this._kp[i].reset(); this._kr[i].reset(); }
  }

  _keyOf(level) {
    return level && level.id != null ? String(level.id) : '#' + ((level && level.index) | 0);
  }

  /**
   * Board origin in world space. Explicit `level.origin` always wins; otherwise
   * levels are stacked down a single column, advanced one `descent.drop` at a
   * time by `startDescent`. Cached so re-framing the same level never moves it.
   */
  _originOf(level, out) {
    out.set(0, 0, 0);
    if (!level) return out;
    const key = this._keyOf(level);
    const cached = this._origins.get(key);
    const o = level.origin;
    if (o) {
      if (Array.isArray(o)) out.set(+o[0] || 0, +o[1] || 0, +o[2] || 0);
      else out.set(+o.x || 0, +o.y || 0, +o.z || 0);
    } else if (cached) {
      return out.copy(cached);
    } else {
      out.copy(this._column);
    }
    if (cached) cached.copy(out);
    else this._origins.set(key, out.clone());   // one allocation per level, ever
    return out;
  }

  /** The level's Field. Built here rather than borrowed, so framing is never
   *  computed against whatever board another system currently holds. */
  _fieldFor(level) {
    if (!level) return null;
    if (level.field && level.field.bounds && typeof level.field.height === 'function') {
      return level.field;
    }
    const key = this._keyOf(level);
    if (this._fields.has(key)) return this._fields.get(key);
    let f = null;
    try { f = new Field(level.board || {}); } catch (err) { f = null; }
    this._fields.set(key, f);
    return f;
  }

  /**
   * Solve the one distance at which this board exactly fills the frame minus
   * the margin.
   *
   * With yaw locked to zero the projection is closed-form: for a point at
   * (x, y, z) relative to the focus, screen-up is `y·cosE − z·sinE` and view
   * depth is `D − y·sinE − z·cosE`. Each constraint |screen| ≤ tan·depth is
   * therefore linear in D, so the answer is just the largest requirement over
   * the eight corners of the board's box — no iteration, no guessing.
   */
  _computePose(level, out) {
    const cam = this.camera;
    const f = this._fieldFor(level);

    let minX = -3.5, maxX = 3.5, minZ = -3.5, maxZ = 3.5;
    let hMin = 0, hMax = 0.3;
    if (f && f.bounds) {
      const b = f.bounds;
      minX = b.minX; maxX = b.maxX; minZ = b.minZ; maxZ = b.maxZ;
      hMin = Infinity; hMax = -Infinity;
      for (let j = 0; j <= 10; j++) {
        const z = lerp(minZ, maxZ, j / 10);
        for (let i = 0; i <= 10; i++) {
          const x = lerp(minX, maxX, i / 10);
          if (f.sdf(x, z) > 0.2) continue;
          const h = f.height(x, z);
          if (h < hMin) hMin = h;
          if (h > hMax) hMax = h;
        }
      }
      if (!isFinite(hMin) || !isFinite(hMax)) { hMin = 0; hMax = 0.3; }
    }

    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const ex = Math.max(0.5, (maxX - minX) * 0.5);
    const ez = Math.max(0.5, (maxZ - minZ) * 0.5);

    // The leaf *tilts*, so its corners swing vertically by up to sin(maxTilt)
    // times the half-span. Frame the swept volume, not the flat blade, or the
    // far edge climbs out of shot the moment the player leans hard.
    const tilt = clamp(+level.maxTilt || 0.2, 0, 0.6);
    const swing = Math.sin(tilt) * Math.max(ex, ez);
    const yLo = hMin - swing - 0.12;
    const yHi = hMax + swing + CAM.headroom;
    const focusY = (yLo + yHi) * 0.5 + CAM.lift;

    const aspect = cam && cam.aspect > 0.05 ? cam.aspect : 16 / 9;
    const tV = Math.tan(CAM.fov * DEG * 0.5) * (1 - CAM.margin);
    const tH = tV * aspect;
    const sinE = Math.sin(this._elev());
    const cosE = Math.cos(this._elev());

    let D = CAM.minDist;
    for (let i = 0; i < 8; i++) {
      const x = (i & 1) ? maxX - cx : minX - cx;
      const z = (i & 2) ? maxZ - cz : minZ - cz;
      const y = (i & 4) ? yHi - focusY : yLo - focusY;
      const back = y * sinE + z * cosE;          // how far this corner reaches toward the lens
      const up = y * cosE - z * sinE;
      const dv = Math.abs(up) / tV + back;
      const dh = Math.abs(x) / tH + back;
      if (dv > D) D = dv;
      if (dh > D) D = dh;
    }
    D = clamp(D, CAM.minDist, CAM.maxDist);
    // Dev override replaces the solved distance wholesale — the elevation it
    // implies is already baked into sinE/cosE above via `_elev()`.
    if (this._devPose) D = Math.hypot(this._devPose.dist, this._devPose.height);

    const o = this._originOf(level, _org);
    out.focus.set(o.x + cx, o.y + focusY, o.z + cz);
    out.pos.set(out.focus.x, out.focus.y + D * sinE, out.focus.z + D * cosE);
    out.dist = D;
    return out;
  }

  _reframe() {
    const cam = this.camera;
    if (!cam) return;
    this._aspect = cam.aspect;
    try {
      const falling = this._mode === 'descent';
      let ox = 0, oy = 0, oz = 0;
      if (falling) {
        this._pathAt(this._descentP, _pathB);
        ox = _pathB.x; oy = _pathB.y; oz = _pathB.z;
      }

      if (this._level) this._computePose(this._level, this._pose);
      if (this._levelFrom) this._computePose(this._levelFrom, this._poseFrom);
      if (this._levelTo) this._computePose(this._levelTo, this._poseTo);

      if (falling) {
        // A phone flipping to portrait mid-fall moves both ends of the path by
        // metres. Carry the difference as a decaying offset rather than cutting
        // — the framing corrects itself over a second and nothing teleports.
        this._pathAt(this._descentP, _pathB);
        this._warp.x += ox - _pathB.x;
        this._warp.y += oy - _pathB.y;
        this._warp.z += oz - _pathB.z;
      } else if (this._mode === 'fixed') {
        this._basePos.copy(this._pose.pos);
      }
    } catch (err) {
      console.error('[camera] reframe failed:', err);
    }
  }

  /* --- descent path -------------------------------------------------- */

  /**
   * The whole fall as a pure function of normalised time. Pure on purpose: the
   * beat scheduler evaluates it *ahead* of the camera to find out where the
   * lens will be when a beat lands, and gets the same answer the camera will.
   */
  _pathAt(p, out) {
    const d = this._descent;
    const t = clamp01(p);
    const fp = fallProgress(t);
    const le = easeInOutCubic(t);
    const v = fallSpeed(t);

    const a = d.from.pos, b = d.to.pos;
    out.x = lerp(a.x, b.x, le);
    out.y = lerp(a.y, b.y, fp);
    out.z = lerp(a.z, b.z, le);

    // sin² envelope: exactly zero value *and* zero slope at both ends, so the
    // swirl cannot tug the camera as it locks onto the next gameplay pose.
    const s = Math.sin(Math.PI * t);
    const env = s * s;
    const ang = t * Math.PI * 1.7 + d.phase;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    out.x += sa * d.swirl * env;
    out.z += ca * d.swirl * env * 0.6;     // shallower in depth: keeps the shaft readable

    // Pull away from the finished leaf first — a beat of "we are leaving here"
    // before gravity takes over. Parabola, back to zero by a third of the fall.
    if (t < 0.34) {
      const u = t / 0.34;
      const pb = u * (1 - u) * 4 * d.pull;
      out.y += pb * Math.sin(this._elev());
      out.z += pb * Math.cos(this._elev());
    }

    // Falling faster makes you look further down the shaft; the dip rides the
    // speed curve, so it returns to the framing pitch precisely when the fall
    // stops. Bank into the drift the way an operator would.
    out.pitch = -this._elev() - d.pitchDip * v;
    out.yaw = d.yawDrift * env * sa;
    out.roll = -d.rollBank * env * ca;
    // FOV is what actually communicates speed — the geometry alone reads as a
    // slow lift. Slightly super-linear so the widening is felt, not measured.
    out.fov = CAM.fov + d.fovKick * Math.pow(v, 1.25);
    return out;
  }

  _stepDescent(dt) {
    const d = this._descent;
    d.time += dt;
    const p = d.duration > 0 ? clamp01(d.time / d.duration) : 1;
    this._descentP = p;

    // Beats before the pose, so a system that places geometry this frame is
    // dressing the shaft the camera is about to move through, not one behind.
    for (let i = 0; i < this._beatCount; i++) {
      const b = this._beats[i];
      if (!b.fired && p >= b.fireT) { b.fired = true; this._emitBeat(b, p); }
    }

    this._pathAt(p, _pathA);
    this._basePos.set(_pathA.x, _pathA.y, _pathA.z);
    this._basePitch = _pathA.pitch;
    this._baseYaw = _pathA.yaw;
    this._baseRoll = _pathA.roll;
    this._fov = _pathA.fov;
    this._focusDist = lerp(d.from.dist, d.to.dist, easeInOutCubic(p));

    if (p >= 1) this._finishDescent(false);
  }

  _finishDescent(skipped) {
    const d = this._descent;
    d.active = false;
    for (let i = 0; i < this._beatCount; i++) this._beats[i].fired = true;
    this._beatCount = 0;

    if (this._levelTo) {
      this._level = this._levelTo;
      this._pose.copy(this._poseTo);
    }
    this._levelFrom = null;
    this._levelTo = null;

    this._mode = 'fixed';
    this._descentP = 0;
    // A reframe still in flight keeps bleeding off into the fixed pose (it
    // converges to exactly zero within a second) — dropping it here would turn
    // a resize in the last second of a fall into a cut on the lock frame. A
    // skip is different: the player asked to be here *now*, so no residue.
    if (skipped) this._warp.set(0, 0, 0);
    this._basePos.copy(this._pose.pos);
    this._basePitch = -this._elev();
    this._baseYaw = 0;
    this._baseRoll = 0;
    this._fov = CAM.fov;
    this._focusDist = this._pose.dist;

    this._resetKicks();
    // A landing has weight. Skipping does not — the player asked to be here.
    if (!skipped) this.impulse('land', 0.55);
    this._compose();

    const resolve = d.resolve;
    d.resolve = null;
    if (resolve) { try { resolve(); } catch (err) { console.error('[camera] descent resolve threw:', err); } }
  }

  /* --- beats --------------------------------------------------------- */

  _scheduleBeats(spec, duration) {
    const names = Array.isArray(spec.beats) ? spec.beats : null;
    this._beatCount = 0;
    if (!names) return;

    const list = this._beats;
    const n = Math.min(names.length, MAX_BEATS);
    for (let i = 0; i < n; i++) {
      const profile = BEAT_PROFILES[names[i]];
      if (!profile) continue;
      const b = list[this._beatCount++];
      b.kind = names[i];
      b.profile = profile;
      b.t = profile.t;
      b.fired = false;
    }

    // Insertion sort by the beat's own preferred moment — the level author
    // lists what happens, the vocabulary decides when it reads best.
    for (let i = 1; i < this._beatCount; i++) {
      const b = list[i];
      let j = i - 1;
      while (j >= 0 && list[j].t > b.t) { list[j + 1] = list[j]; j--; }
      list[j + 1] = b;
    }

    // Then pull them apart so two never land on the same frame, and keep the
    // last one clear of the lock-on so it is not stepped on by the landing.
    let prev = BEAT_FIRST - BEAT_GAP;
    for (let i = 0; i < this._beatCount; i++) {
      const b = list[i];
      b.t = clamp(b.t, prev + BEAT_GAP, BEAT_LAST);
      prev = b.t;
      b.fireT = clamp01(b.t - b.profile.lead / duration);
    }
  }

  _emitBeat(b, p) {
    const d = this._descent;
    const pr = b.profile;
    this._pathAt(b.t, _pathB);
    const side = pr.side + d.phase;
    const pay = this._beat;
    pay.kind = b.kind;
    pay.t = b.t;
    pay.time = b.t * d.duration;
    pay.delay = Math.max(0, (b.t - p) * d.duration);
    pay.progress = p;
    pay.x = _pathB.x + Math.cos(side) * pr.radius;
    pay.y = _pathB.y + pr.y;
    pay.z = _pathB.z + Math.sin(side) * pr.radius;
    pay.side = side;
    pay.radius = pr.radius;
    pay.duration = pr.dur;
    pay.intensity = pr.intensity;
    pay.speed = (d.drop * fallSpeed(b.t)) / (d.duration * FALL_MEAN);
    pay.zoneFrom = d.zoneFrom;
    pay.zoneTo = d.zoneTo;
    pay.descentId = d.id;
    this._emit('descentBeat', pay);
  }

  _emit(name, payload) {
    const bus = this.events;
    if (!bus || typeof bus.emit !== 'function') return;
    try { bus.emit(name, payload); } catch (err) { console.error('[camera] emit failed:', err); }
  }

  /* --- composition --------------------------------------------------- */

  /**
   * Base pose + clamped impulse offset. The clamps are applied to the *sum*,
   * so no combination of simultaneous impulses can break the 2 cm / 0.4° law.
   */
  _compose() {
    const cam = this.camera;
    if (!cam) return;
    // Clamp the *composed* offset, not each axis — the budget is a total. The
    // sum, not the length: the yaw and roll axes are 40 deg apart here, not
    // orthogonal, so only |rx|+|ry|+|rz| actually bounds the resulting angle.
    const mr = CAM.maxKickRot;
    let rx = this._kr[0].x, ry = this._kr[1].x, rz = this._kr[2].x;
    const rsum = Math.abs(rx) + Math.abs(ry) + Math.abs(rz);
    if (rsum > mr) { const s = mr / rsum; rx *= s; ry *= s; rz *= s; }

    _eul.set(this._basePitch + rx, this._baseYaw + ry, this._baseRoll + rz, 'YXZ');
    cam.quaternion.setFromEuler(_eul);

    _off.set(this._kp[0].x, this._kp[1].x, this._kp[2].x);
    const l2 = _off.lengthSq();
    const mp = CAM.maxKickPos;
    if (l2 > mp * mp) _off.multiplyScalar(mp / Math.sqrt(l2));
    _off.applyQuaternion(cam.quaternion);       // local: 'push in' means toward the leaf
    cam.position.copy(this._basePos).add(_off);

    if (Math.abs(this._fov - this._appliedFov) > 0.01) {
      cam.fov = this._fov;
      this._appliedFov = this._fov;
      try { cam.updateProjectionMatrix(); } catch (err) { /* stub camera */ }
    }
    // Make the camera authoritative for anything that reads its matrices during
    // this frame's update pass (shadow fitting, billboards) rather than at draw.
    try { cam.updateMatrixWorld(true); } catch (err) { /* stub camera */ }

    if (this._mode === 'descent') {
      _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      this._focus.copy(cam.position).addScaledVector(_fwd, this._focusDist);
    } else {
      this._focus.copy(this._pose.focus);
    }
  }
}

export default GameCamera;
