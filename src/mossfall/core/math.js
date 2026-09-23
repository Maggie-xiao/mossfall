/**
 * MOSSFALL — small maths.
 *
 * Everything here is allocation-free and framerate-independent. `damp` and the
 * springs are the two functions the whole game's *feel* rests on: they are
 * exponential, so they behave identically at 60, 120 and 144 Hz.
 */

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const mix = lerp;

/** Frame-rate independent exponential approach. `rate` is roughly 1/e per second. */
export const damp = (cur, tgt, rate, dt) => tgt + (cur - tgt) * Math.exp(-rate * dt);

/** Hermite smoothstep. */
export function sstep(a, b, x) {
  const t = clamp01((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
}

/** Quintic smootherstep — zero 1st *and* 2nd derivative at the ends. */
export function sstep5(a, b, x) {
  const t = clamp01((x - a) / (b - a || 1e-9));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Polynomial smooth minimum (Inigo Quilez). Blends two SDFs into one organic
 * surface instead of a crease — this is what makes a leaf built from three
 * ellipses read as a single grown thing rather than a boolean.
 */
export function smin(a, b, k) {
  if (k <= 1e-6) return a < b ? a : b;
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** Smooth subtraction, same family. */
export function smax(a, b, k) {
  if (k <= 1e-6) return a > b ? a : b;
  const h = clamp01(0.5 - (0.5 * (b - a)) / k);
  return lerp(b, a, h) + k * h * (1 - h);
}

/* --- easings ---------------------------------------------------------- */
export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => t * (2 - t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export function easeOutBack(t, s = 1.70158) {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}
export function easeOutElastic(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const p = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * p) + 1;
}
export function easeOutBounce(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

/* --- input conditioning ------------------------------------------------ */

/** Remove a dead zone without losing the full range: output still reaches ±1. */
export function deadzone(v, dz) {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

/** x·|x|^k — gentle near centre, exactly ±1 at full deflection. */
export const expo = (v, k) => v * Math.pow(Math.abs(v), k);

export const nowSeconds = () =>
  (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;

/**
 * One-euro filter. Smooths hard while the signal is quiet and gets out of the
 * way the instant it moves — the only low-pass that fixes noisy input without
 * adding the lag that makes body control feel dead.
 */
export class OneEuroFilter {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  reset() { this._x = null; this._dx = 0; }
  _alpha(cutoff, dt) {
    const tau = 1 / (TAU * cutoff);
    return 1 / (1 + tau / Math.max(dt, 1e-6));
  }
  filter(x, dt) {
    if (!isFinite(x)) return this._x || 0;
    if (this._x === null) { this._x = x; this._dx = 0; return x; }
    const dx = (x - this._x) / Math.max(dt, 1e-6);
    const ad = this._alpha(this.dCutoff, dt);
    this._dx = this._dx + ad * (dx - this._dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this._dx);
    const a = this._alpha(cutoff, dt);
    this._x = this._x + a * (x - this._x);
    return this._x;
  }
}

/** Fixed-window mean. Used for jitter metrics and cost budgeting. */
export class RollingAverage {
  constructor(n = 20) { this.n = n; this.buf = new Float32Array(n); this.reset(); }
  reset() { this.buf.fill(0); this.i = 0; this.count = 0; this.sum = 0; }
  push(v) {
    if (!isFinite(v)) return this.value;
    if (this.count === this.n) this.sum -= this.buf[this.i];
    else this.count++;
    this.buf[this.i] = v;
    this.sum += v;
    this.i = (this.i + 1) % this.n;
    return this.value;
  }
  get value() { return this.count ? this.sum / this.count : 0; }
}

/**
 * Critically-damped 2D spring. The leaf's tilt runs through one of these — it is
 * why the platform feels like it has mass instead of tracking the body 1:1.
 * Semi-implicit so it is unconditionally stable at any dt we will ever see.
 */
export class Spring2 {
  constructor({ freq = 9, damping = 1 } = {}) {
    this.freq = freq;
    this.damping = damping;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.out = { x: 0, y: 0 };
  }
  set(x, y) { this.x = x; this.y = y; this.vx = 0; this.vy = 0; }
  step(dt, tx, ty) {
    const w = this.freq;
    const k = w * w;
    const c = 2 * this.damping * w;
    // Sub-step if someone hands us a huge dt (tab restore) so it cannot explode.
    let n = 1, h = dt;
    if (h > 1 / 45) { n = Math.ceil(h * 45); h = dt / n; }
    for (let i = 0; i < n; i++) {
      this.vx += (k * (tx - this.x) - c * this.vx) * h;
      this.vy += (k * (ty - this.y) - c * this.vy) * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
    }
    this.out.x = this.x; this.out.y = this.y;
    return this.out;
  }
}

/* --- deterministic randomness ------------------------------------------ */

/** mulberry32 — tiny, fast, good enough, and identical across machines. */
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randRange = (rng, a, b) => a + (b - a) * rng();
export const randInt = (rng, a, b) => Math.floor(a + (b - a + 1) * rng());
export const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

/** Cheap value noise on a 2D lattice — for organic surface ripple and sway. */
export function valueNoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (a, b) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263);
    n = (n ^ (n >>> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}

/* --- 2D geometry helpers used by the field and the sim ------------------ */

export const len2 = (x, y) => Math.hypot(x, y);
export const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** Distance from p to segment ab, and the closest point's parameter. */
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp01(t);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Angle wrapped into (-π, π]. */
export function wrapPi(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
