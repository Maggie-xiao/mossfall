/**
 * MOSSFALL — particles.
 *
 * One job: every mote, spark and thread of silk in the game, out of a fixed
 * pool that is allocated once and then never grows.
 *
 * Two different problems live here, solved two different ways.
 *
 * The ambient motes — the pollen, spores, droplets and fireflies that give the
 * canopy its depth — number in the thousands and must cost effectively nothing.
 * They are therefore *entirely* GPU-side: a static cloud of random points is
 * uploaded once, and the vertex shader drifts, swirls, twinkles and wraps them
 * around the camera every frame. The CPU touches a handful of uniforms and
 * nothing else. Because the cloud wraps toroidally about the camera, the field
 * follows the player through a sixty-metre descent without a single respawn.
 *
 * The event particles — dust, sparkle, burst, trails — are few, short-lived and
 * need real physics, so they are CPU-integrated into pre-allocated typed arrays
 * that *are* the vertex attributes. A ring buffer hands out slots; the oldest
 * live particle is overwritten when the pool is full, which is the right
 * failure mode (the thing the player just did always reads) and needs no free
 * list. Only the touched slice of each buffer is uploaded.
 *
 * Sprites are drawn analytically in the fragment shader — a gaussian core with
 * one rotated off-centre highlight. No texture files, and a mote reads as a
 * tiny translucent seed catching the light rather than as a flat dot.
 */

import * as THREE from 'three';
import {
  clamp, clamp01, damp, TAU, makeRng, easeOutCubic, easeInOutCubic, easeOutBack,
} from '../core/math.js';
import { zoneFor, INSECTS, WORLD } from '../data/palette.js';
import { resolveQuality } from '../core/settings.js';

/* ===================================================================== *
 * Shaders
 * ===================================================================== */

/**
 * Shared by both point systems so three compiles one program for both.
 * `vSoft` is the gaussian exponent: ~1.5 is a haze, ~6 a hard little spark.
 *
 * The tonemapping/colorspace includes are what keep these sprites consistent
 * with every built-in material in the scene. When post is on and the scene is
 * drawn into a render target, three forces NoToneMapping and a linear output
 * space, so both chunks compile away to nothing and post does the grading —
 * which is exactly the behaviour we want, for free.
 */
const FRAG_POINT = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
varying float vRot;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;

  // Gaussian core, windowed so the sprite reaches exactly zero at the quad
  // edge — without the window a bright particle shows its square.
  float g = exp(-r2 * vSoft) * (1.0 - r2 * r2);

  // One rotated highlight lobe. Barely visible alone, but across a thousand
  // motes it is the difference between "particles" and "things in the air".
  float c = cos(vRot), s = sin(vRot);
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c) - vec2(0.33, 0.30);
  float hi = exp(-dot(q, q) * 8.0);

  float a = g * vAlpha;
  if (a <= 0.0025) discard;

  gl_FragColor = vec4(vColor * (1.0 + hi * 0.6), a);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Fog for additive sprites has to remove them, not tint them toward the fog. */
const GLSL_FOG = /* glsl */`
float fogAmount(float depth) {
  if (uFog.z > 0.0) return 1.0 - exp2(-uFog.z * uFog.z * depth * depth * 1.442695);
  return clamp((depth - uFog.x) / max(uFog.y - uFog.x, 1e-4), 0.0, 1.0);
}
`;

/**
 * `projectionMatrix[1][1]` is 1/tan(fov/2); multiplied by half the drawing
 * buffer height it turns a world-space radius at distance `depth` into pixels.
 * three only computes that for its own PointsMaterial, so we do it here rather
 * than demand a renderer reference the Effects contract does not give us.
 */
const VERT_POOL = /* glsl */`
attribute vec3 aColor;
attribute vec4 aParams;      // x size (m), y alpha, z rotation, w softness

uniform float uScale;        // drawing-buffer height * 0.5
uniform float uSizeMul;
uniform float uAlphaMul;
uniform vec3 uFog;           // near, far, density (density > 0 => exponential)

varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
varying float vRot;

${GLSL_FOG}

void main() {
  vColor = aColor;
  vSoft = aParams.w;
  vRot = aParams.z;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float depth = -mv.z;
  vAlpha = aParams.y * uAlphaMul * (1.0 - fogAmount(depth));

  if (vAlpha <= 0.0025 || depth <= 0.02) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);   // beyond the far plane: clipped
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(
    aParams.x * uSizeMul * uScale * projectionMatrix[1][1] / depth, 1.0, 110.0);
}
`;

const VERT_MOTE = /* glsl */`
attribute vec4 aSeed;        // xyz base point in the cell, w density hash
attribute vec4 aMote;        // x size, y swirl scale, z swirl phase, w twinkle phase

uniform float uTime;
uniform float uDrift;        // CPU-integrated vertical drift, wrapped to the cell
uniform float uSize;
uniform float uAlpha;
uniform float uDensity;
uniform float uScale;
uniform vec3 uCam;
uniform vec3 uBox;           // half extents of the wrapping cell
uniform vec3 uColorLo;
uniform vec3 uColorHi;
uniform vec3 uFog;
uniform vec4 uKind;          // x sizeMul, y swirl, z twinkleFreq, w pulsiness

varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
varying float vRot;

${GLSL_FOG}

void main() {
  vec3 p = aSeed.xyz;
  p.y += uDrift;

  float sw = aMote.y * uKind.y;
  p.x += sin(uTime * 0.31 + aMote.z) * sw;
  p.z += cos(uTime * 0.24 + aMote.z * 1.7) * sw;
  p.y += sin(uTime * 0.17 + aMote.w * 6.2831853) * sw * 0.4;

  // Wrap the cloud around the camera. This is why a long descent never needs a
  // respawn: the field is infinite and periodic.
  vec3 rel = mod(p - uCam + uBox, 2.0 * uBox) - uBox;

  vec4 mv = modelViewMatrix * vec4(uCam + rel, 1.0);
  float depth = -mv.z;

  float tw = sin(uTime * uKind.z + aMote.w * 6.2831853);
  float bright = mix(0.62 + 0.38 * tw, pow(max(tw, 0.0), 3.0), uKind.w);

  // Fade at the cell wall, or motes visibly pop in and out as they wrap.
  vec3 e = abs(rel) / uBox;
  float rim = 1.0 - smoothstep(0.70, 1.0, max(e.x, max(e.y, e.z)));
  float near = smoothstep(0.5, 2.4, depth);
  float live = step(aSeed.w, uDensity);

  vColor = mix(uColorLo, uColorHi, fract(aMote.w * 3.7 + 0.11));
  vSoft = mix(2.7, 1.7, uKind.w);
  vRot = aMote.z;
  vAlpha = uAlpha * bright * rim * near * live * (1.0 - fogAmount(depth));

  if (vAlpha <= 0.0025 || depth <= 0.02) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(
    aMote.x * uKind.x * uSize * uScale * projectionMatrix[1][1] / depth, 1.0, 64.0);
}
`;

const VERT_SILK = /* glsl */`
attribute vec2 aUV;          // x = 0..1 along the strand, y = -1..1 across it
varying vec2 vUv;
void main() {
  vUv = aUV;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG_SILK = /* glsl */`
uniform vec3 uColor;
uniform float uAlpha;
uniform float uHead;         // how far along the strand has been spun, 0..1
varying vec2 vUv;

void main() {
  float across = 1.0 - abs(vUv.y);
  if (across <= 0.0) discard;

  // A thread, not a ribbon: a bright filament with a soft glow either side.
  float core = pow(across, 5.0);
  float halo = pow(across, 1.4) * 0.30;

  // The spinning head runs down the thread as it reaches, and the strand does
  // not exist beyond it.
  float grown = smoothstep(uHead + 0.035, uHead - 0.015, vUv.x);
  float d = (vUv.x - uHead) * 8.0;
  float head = exp(-d * d);

  float a = (core + halo) * uAlpha * grown * (0.5 + 0.9 * head);
  if (a <= 0.003) discard;

  gl_FragColor = vec4(uColor * (1.0 + head * 1.8), a);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ===================================================================== *
 * Scratch — hoisted so nothing in a per-frame path allocates
 * ===================================================================== */

const _cA = new THREE.Color();
const _cB = new THREE.Color();
const _camDefault = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _view = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _wp = new THREE.Vector3();

/** Accepts a palette hex, a CSS string, an insect key, a Color or an INSECTS entry. */
function toColor(c, out) {
  try {
    if (c == null) return out.setRGB(1, 1, 1);
    if (typeof c === 'number') return out.setHex(c);
    if (typeof c === 'string') {
      const ins = INSECTS[c];
      return ins ? out.setHex(ins.glow) : out.set(c);
    }
    if (c.isColor) return out.copy(c);
    if (typeof c.glow === 'number') return out.setHex(c.glow);
    if (typeof c.shell === 'number') return out.setHex(c.shell);
  } catch (err) { /* unreadable colour: fall through to white */ }
  return out.setRGB(1, 1, 1);
}

/** Ambient mote personalities. `rise` is metres per second, signed. */
const MOTE_KINDS = {
  pollen: { sizeMul: 1.00, swirl: 0.60, twinkle: 1.70, pulse: 0.00, rise: 0.30, alpha: 0.50, density: 1.00 },
  spore: { sizeMul: 1.30, swirl: 0.85, twinkle: 1.05, pulse: 0.00, rise: -0.14, alpha: 0.46, density: 0.85 },
  droplet: { sizeMul: 0.80, swirl: 0.22, twinkle: 0.75, pulse: 0.00, rise: -0.70, alpha: 0.66, density: 0.70 },
  firefly: { sizeMul: 1.85, swirl: 1.05, twinkle: 1.30, pulse: 0.85, rise: 0.06, alpha: 1.00, density: 0.45 },
};
const KIND_KEYS = ['sizeMul', 'swirl', 'twinkle', 'pulse', 'rise', 'alpha', 'density'];

/* Fade/scale curves for the CPU pools. */
const C_PUFF = 0, C_SPARK = 1, C_BURST = 2, C_TRAIL = 3;

/* ===================================================================== *
 * MoteField — the GPU-animated ambient cloud
 * ===================================================================== */

class MoteField {
  constructor(count, boxX, boxY, boxZ, shared, rng) {
    this.count = Math.max(0, count | 0);
    this.ok = false;
    this.intensity = 1;
    if (!this.count) return;

    const seed = new Float32Array(this.count * 4);
    const mote = new Float32Array(this.count * 4);
    const pos = new Float32Array(this.count * 3);   // three requires it; unread
    for (let i = 0; i < this.count; i++) {
      const s = i * 4;
      seed[s] = (rng() * 2 - 1) * boxX;
      seed[s + 1] = (rng() * 2 - 1) * boxY;
      seed[s + 2] = (rng() * 2 - 1) * boxZ;
      seed[s + 3] = rng();
      // Sizes skew small: a few large motes near the lens read as depth, a
      // field of uniformly sized ones reads as a flat texture.
      const u = rng();
      mote[s] = 0.030 + u * u * 0.085;
      mote[s + 1] = 0.35 + rng() * 1.1;
      mote[s + 2] = rng() * TAU;
      mote[s + 3] = rng();
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aMote', new THREE.BufferAttribute(mote, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = {
      uTime: { value: 0 },
      uDrift: { value: 0 },
      uSize: { value: 1 },
      uAlpha: { value: 0 },
      uDensity: { value: 1 },
      uScale: shared.uScale,
      uCam: shared.uCam,
      uFog: shared.uFog,
      uBox: { value: new THREE.Vector3(boxX, boxY, boxZ) },
      uColorLo: { value: new THREE.Color(0xffffff) },
      uColorHi: { value: new THREE.Color(0xffffff) },
      uKind: { value: new THREE.Vector4(1, 0.6, 1.7, 0) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT_MOTE,
      fragmentShader: FRAG_POINT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });

    this.geometry = g;
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 18;
    this.points.visible = false;

    this.boxY = boxY;
    this.drift = 0;
    this.cur = Object.assign({}, MOTE_KINDS.pollen);
    this.tgt = Object.assign({}, MOTE_KINDS.pollen);
    this.loT = new THREE.Color(0xffffff);
    this.hiT = new THREE.Color(0xffffff);
    this.ok = true;
  }

  setKind(name, immediate) {
    if (!this.ok) return;
    const k = MOTE_KINDS[name] || MOTE_KINDS.pollen;
    for (let i = 0; i < KIND_KEYS.length; i++) {
      const key = KIND_KEYS[i];
      this.tgt[key] = k[key];
      if (immediate) this.cur[key] = k[key];
    }
  }

  setColors(lo, hi, immediate) {
    if (!this.ok) return;
    this.loT.copy(lo);
    this.hiT.copy(hi);
    if (immediate) {
      this.uniforms.uColorLo.value.copy(lo);
      this.uniforms.uColorHi.value.copy(hi);
    }
  }

  update(dt, time) {
    if (!this.ok || !this.points.visible) return;
    const u = this.uniforms;
    const rate = 1.6;
    for (let i = 0; i < KIND_KEYS.length; i++) {
      const k = KIND_KEYS[i];
      this.cur[k] = damp(this.cur[k], this.tgt[k], rate, dt);
    }
    const lo = u.uColorLo.value, hi = u.uColorHi.value;
    lo.r = damp(lo.r, this.loT.r, rate, dt);
    lo.g = damp(lo.g, this.loT.g, rate, dt);
    lo.b = damp(lo.b, this.loT.b, rate, dt);
    hi.r = damp(hi.r, this.hiT.r, rate, dt);
    hi.g = damp(hi.g, this.hiT.g, rate, dt);
    hi.b = damp(hi.b, this.hiT.b, rate, dt);

    // Drift is integrated here rather than in the shader and wrapped to exactly
    // one cell height, so the wrap stays seamless and float precision never
    // decays over a long session — `t * speed` inside the shader does both badly.
    const span = 2 * this.boxY;
    this.drift += this.cur.rise * dt;
    if (this.drift >= span) this.drift -= span;
    else if (this.drift < 0) this.drift += span;

    u.uTime.value = time;
    u.uDrift.value = this.drift;
    u.uAlpha.value = this.cur.alpha * this.intensity;
    u.uDensity.value = this.cur.density;
    u.uKind.value.set(this.cur.sizeMul, this.cur.swirl, this.cur.twinkle, this.cur.pulse);
  }

  dispose() {
    if (!this.ok) return;
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ===================================================================== *
 * ParticlePool — the CPU-integrated event families
 * ===================================================================== */

class ParticlePool {
  constructor(cap, opts, shared) {
    this.cap = Math.max(8, cap | 0);
    const n = this.cap;

    // These three Float32Arrays *are* the vertex attributes: the simulation
    // writes straight into the buffers that get uploaded.
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.par = new Float32Array(n * 4);

    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.invLife = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.curve = new Uint8Array(n);

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aPar = new THREE.BufferAttribute(this.par, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aParams', this.aPar);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = {
      uScale: shared.uScale,
      uFog: shared.uFog,
      uSizeMul: { value: opts.sizeMul != null ? opts.sizeMul : 1 },
      uAlphaMul: { value: opts.alphaMul != null ? opts.alphaMul : 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT_POOL,
      fragmentShader: FRAG_POINT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });

    this.geometry = g;
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.renderOrder != null ? opts.renderOrder : 20;

    this.head = 0;
    this.used = 0;      // high-water mark; the draw range never exceeds it
    this.alive = 0;
    this._lo = 0;
    this._hi = -1;
  }

  /**
   * Ring-buffer allocation. When the pool is full the oldest live particle
   * loses, which is the right answer: the event the player just caused must
   * always be the one they see.
   */
  spawn(x, y, z, vx, vy, vz, r, g, b, size, alpha, life, soft, drag, grav, curve, spin) {
    const i = this.head;
    this.head = (i + 1) % this.cap;
    if (i >= this.used) this.used = i + 1;
    if (this.life[i] <= 0) this.alive++;

    const p3 = i * 3, p4 = i * 4;
    this.pos[p3] = x; this.pos[p3 + 1] = y; this.pos[p3 + 2] = z;
    this.vel[p3] = vx; this.vel[p3 + 1] = vy; this.vel[p3 + 2] = vz;
    this.col[p3] = r; this.col[p3 + 1] = g; this.col[p3 + 2] = b;
    this.par[p4] = size;
    this.par[p4 + 1] = alpha;
    this.par[p4 + 2] = spin * 3.1;
    this.par[p4 + 3] = soft;

    this.life[i] = life;
    this.invLife[i] = 1 / Math.max(life, 1e-4);
    this.a0[i] = alpha;
    this.s0[i] = size;
    this.spin[i] = spin;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.curve[i] = curve;
    this._dirty(i, i);
    return i;
  }

  _dirty(lo, hi) {
    if (this._hi < 0) { this._lo = lo; this._hi = hi; return; }
    if (lo < this._lo) this._lo = lo;
    if (hi > this._hi) this._hi = hi;
  }

  update(dt) {
    const n = this.used;
    if (!n) return;
    let alive = 0;
    let lo = -1, hi = -1;

    for (let i = 0; i < n; i++) {
      let l = this.life[i];
      if (l <= 0) continue;
      l -= dt;
      const p3 = i * 3, p4 = i * 4;

      if (l <= 0) {
        this.life[i] = 0;
        this.par[p4] = 0;
        this.par[p4 + 1] = 0;
        if (lo < 0) lo = i;
        hi = i;
        continue;
      }
      this.life[i] = l;
      alive++;

      // Semi-implicit drag: stable at any dt and needs no exp() per particle.
      const f = 1 / (1 + this.drag[i] * dt);
      const vx = this.vel[p3] * f;
      const vy = (this.vel[p3 + 1] + this.grav[i] * dt) * f;
      const vz = this.vel[p3 + 2] * f;
      this.vel[p3] = vx; this.vel[p3 + 1] = vy; this.vel[p3 + 2] = vz;
      this.pos[p3] += vx * dt;
      this.pos[p3 + 1] += vy * dt;
      this.pos[p3 + 2] += vz * dt;

      const age = 1 - l * this.invLife[i];
      const k = 1 - age;
      const rot = this.par[p4 + 2] + this.spin[i] * dt;
      this.par[p4 + 2] = rot;

      let size, alpha;
      switch (this.curve[i]) {
        case C_PUFF:
          size = this.s0[i] * (0.55 + 0.95 * age);
          alpha = this.a0[i] * k * clamp01(age * 7);
          break;
        case C_SPARK:
          size = this.s0[i] * (1 - 0.5 * age);
          alpha = this.a0[i] * k * k * (0.6 + 0.4 * Math.sin(rot * 2.3));
          break;
        case C_BURST:
          size = this.s0[i] * (0.45 + 1.5 * easeOutCubic(age));
          alpha = this.a0[i] * k * k * k;
          break;
        default:  // C_TRAIL
          size = this.s0[i] * (1 - 0.62 * age);
          alpha = this.a0[i] * k * k;
          break;
      }
      this.par[p4] = size;
      this.par[p4 + 1] = alpha > 0 ? alpha : 0;

      if (lo < 0) lo = i;
      hi = i;
    }

    this.alive = alive;
    if (lo >= 0) this._dirty(lo, hi);
    this._flush();
    this.geometry.setDrawRange(0, this.used);
  }

  /** Upload only the slice that actually changed. Ranges are in elements. */
  _flush() {
    if (this._hi < 0) return;
    const lo = this._lo, count = this._hi - this._lo + 1;
    const a = this.aPos, b = this.aCol, c = this.aPar;
    a.clearUpdateRanges(); a.addUpdateRange(lo * 3, count * 3); a.needsUpdate = true;
    b.clearUpdateRanges(); b.addUpdateRange(lo * 3, count * 3); b.needsUpdate = true;
    c.clearUpdateRanges(); c.addUpdateRange(lo * 4, count * 4); c.needsUpdate = true;
    this._lo = 0;
    this._hi = -1;
  }

  clear() {
    if (this.used > 0) {
      this.life.fill(0);
      for (let i = 0; i < this.used; i++) { this.par[i * 4] = 0; this.par[i * 4 + 1] = 0; }
      this._dirty(0, this.used - 1);
      this._flush();
    }
    this.alive = 0;
    this.head = 0;
    this.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ===================================================================== *
 * SilkStrand — the rescue thread
 * ===================================================================== */

const SILK_SEGMENTS = 26;

// Fraction of the rescue spent spinning the thread out. Short on purpose: the
// beetle is already moving under it, so a slow reach would show the grip
// arriving late.
const REACH = 0.16;

/**
 * A quadratic-bezier thread from a fixed anchor in the tree to a moving tip.
 * The ribbon is rebuilt in world space each frame and turned to face the camera,
 * so it holds a constant apparent width from any angle — a line material cannot
 * do width portably, and a tube cannot bend this much this cheaply.
 *
 * The tip must end up wherever the beetle is, and the beetle is animated by
 * `game/director.js`, which never hands us its path. So the strand reproduces
 * that path instead: the same eased carry from the catch point to the beetle's
 * home, the same parabolic lift, the same decaying pendulum. A caller that
 * knows better should call `setTip` every frame and the reproduction is
 * bypassed entirely.
 */
class SilkStrand {
  constructor(rng) {
    const seg = SILK_SEGMENTS;
    const verts = (seg + 1) * 2;
    this.seg = seg;
    this.pos = new Float32Array(verts * 3);
    const uvs = new Float32Array(verts * 2);
    const idx = new Uint16Array(seg * 6);
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      uvs[i * 4] = u; uvs[i * 4 + 1] = -1;
      uvs[i * 4 + 2] = u; uvs[i * 4 + 3] = 1;
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 2, o = i * 6;
      idx[o] = a; idx[o + 1] = a + 1; idx[o + 2] = a + 2;
      idx[o + 3] = a + 1; idx[o + 4] = a + 3; idx[o + 5] = a + 2;
    }

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aUV', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = {
      uColor: { value: new THREE.Color(WORLD.silk) },
      uAlpha: { value: 0 },
      uHead: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT_SILK,
      fragmentShader: FRAG_SILK,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    this.mesh.visible = false;

    this.rng = rng;
    this.anchor = new THREE.Vector3();
    this.ctrl = new THREE.Vector3();
    this.tip = new THREE.Vector3();
    this.catchAt = new THREE.Vector3();
    this.home = new THREE.Vector3();
    this.active = false;
    this.caught = false;
    this.driven = false;
    this.t = 0;
    this.dur = 1.5;
    this.width = 0.024;
    this.wobble = 0;
    this.arc = 0.6;
    this.sway = 0;
  }

  /**
   * @param {object} anchor  world point in the tree the thread hangs from
   * @param {object} target  world position of the beetle at the moment of the catch
   * @param {number} dur     seconds; must match the caller's carry animation
   * @param {object} [home]  world point the beetle is being carried to
   */
  begin(anchor, target, dur, home, color) {
    this.anchor.set(anchor.x || 0, anchor.y || 0, anchor.z || 0);
    this.catchAt.set(target.x || 0, target.y || 0, target.z || 0);
    this.dur = Math.max(0.35, dur || 1.5);
    this.t = 0;
    this.active = true;
    this.caught = false;
    this.driven = false;
    this.mesh.visible = true;
    toColor(color == null ? WORLD.silk : color, this.uniforms.uColor.value);

    if (home) {
      this.home.set(home.x || 0, home.y || 0, home.z || 0);
    } else {
      // No destination given, so infer one from the only thing we were told.
      // The anchor is spun from a point above and inboard of the fall, so its
      // horizontal position is a fair stand-in for somewhere back on the leaf —
      // and the beetle was falling when the silk found it, so home is a little
      // *above* the catch, not level with it. Rough, but the direction and the
      // sense of the rise are both right, which is what the eye checks. Pass
      // `home` (or drive `setTip`) and none of this guessing happens.
      this.home.set(this.anchor.x, this.catchAt.y + 0.6, this.anchor.z);
    }

    const flat = Math.hypot(this.home.x - this.catchAt.x, this.home.z - this.catchAt.z);
    this.arc = 0.55 + Math.min(1.1, flat * 0.18);
    this.sway = (this.catchAt.x - this.home.x) * 0.06;
    this.wobble = this.rng() * TAU;
    this.width = 0.020 + this.rng() * 0.008;
    this.tip.copy(this.catchAt);
    this.uniforms.uHead.value = 0;
    this.uniforms.uAlpha.value = 0;
    return this;
  }

  /** Drive the tip by hand for this frame — overrides the reproduced path. */
  setTip(x, y, z) {
    if (!this.active) return this;
    this.driven = true;
    this.tip.set(x, y, z);
    return this;
  }

  /** @returns true on the single frame the thread first grips the beetle. */
  update(dt, elapsed, camPos) {
    if (!this.active) return false;
    this.t += dt / this.dur;
    if (this.t >= 1) {
      this.t = 1;
      this.stop();
      return false;
    }

    const t = this.t;
    let justCaught = false;

    // The head — the visible bead of fresh silk — races out along a thread
    // whose far end is *already* on the beetle. That is what sells the throw:
    // pinning the end and dragging it there instead reads as a grappling hook,
    // and leaves the beetle visibly untethered while it starts to move.
    const head = easeOutCubic(clamp01(t / REACH));
    if (t >= REACH && !this.caught) { this.caught = true; justCaught = true; }

    if (!this.driven) {
      // The carry, reproduced. Horizontal easing, vertical overshoot and the
      // parabolic lift all match director.js's rescue arc, so the grip stays on
      // the beetle rather than near it.
      const e = easeInOutCubic(t);
      const swing = Math.sin(t * 7.5) * this.sway * (1 - t) * (1 - t);
      this.tip.set(
        this.catchAt.x + (this.home.x - this.catchAt.x) * e + swing,
        this.catchAt.y + (this.home.y - this.catchAt.y) * easeOutBack(t, 0.9)
          + 4 * t * (1 - t) * this.arc,
        this.catchAt.z + (this.home.z - this.catchAt.z) * e + swing * 0.4,
      );
    }
    this.driven = false;

    const alpha = Math.min(clamp01(t / 0.05), clamp01((1 - t) / 0.12));
    this.uniforms.uHead.value = head;
    this.uniforms.uAlpha.value = alpha * 0.95;

    // The thread sags under its own length and drifts a little — that is what
    // stops it reading as a stretched wire.
    const sag = this.anchor.distanceTo(this.tip) * 0.22;
    this.ctrl.addVectors(this.anchor, this.tip).multiplyScalar(0.5);
    this.ctrl.y -= sag;
    this.ctrl.x += Math.sin(elapsed * 1.9 + this.wobble) * sag * 0.18;
    this.ctrl.z += Math.cos(elapsed * 1.6 + this.wobble) * sag * 0.18;

    this._build(camPos);
    return justCaught;
  }

  _build(camPos) {
    const seg = this.seg;
    const pos = this.pos;
    const a = this.anchor, c = this.ctrl, b = this.tip;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const iu = 1 - u;
      const w0 = iu * iu, w1 = 2 * iu * u, w2 = u * u;
      _pt.set(
        a.x * w0 + c.x * w1 + b.x * w2,
        a.y * w0 + c.y * w1 + b.y * w2,
        a.z * w0 + c.z * w1 + b.z * w2,
      );
      _tan.set(
        2 * (iu * (c.x - a.x) + u * (b.x - c.x)),
        2 * (iu * (c.y - a.y) + u * (b.y - c.y)),
        2 * (iu * (c.z - a.z) + u * (b.z - c.z)),
      );
      if (_tan.lengthSq() < 1e-10) _tan.copy(_up);
      _view.subVectors(_pt, camPos);
      _side.crossVectors(_tan, _view);
      if (_side.lengthSq() < 1e-12) _side.crossVectors(_tan, _up);
      if (_side.lengthSq() < 1e-12) _side.set(1, 0, 0);
      _side.normalize();

      // Tapers toward the tip, with a small bead where the silk grips.
      const bead = (u - 1) * 6;
      const w = this.width * (1.05 - 0.45 * u) + this.width * 1.6 * Math.exp(-bead * bead);
      const o = i * 6;
      pos[o] = _pt.x - _side.x * w;
      pos[o + 1] = _pt.y - _side.y * w;
      pos[o + 2] = _pt.z - _side.z * w;
      pos[o + 3] = _pt.x + _side.x * w;
      pos[o + 4] = _pt.y + _side.y * w;
      pos[o + 5] = _pt.z + _side.z * w;
    }
    this.aPos.needsUpdate = true;
  }

  stop() {
    this.active = false;
    this.caught = false;
    this.mesh.visible = false;
    this.uniforms.uAlpha.value = 0;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ===================================================================== *
 * Effects
 * ===================================================================== */

const TRAIL_SLOTS = 12;
const TRAIL_SPACING = 0.075;

export class Effects {
  /**
   * @param {THREE.Scene} scene
   * @param {object|string} quality a QUALITY tier, a tier name, or 'auto'
   */
  constructor(scene, quality) {
    this.scene = scene || null;
    this.quality = resolveQuality(quality);
    this.ok = false;
    this.enabled = true;

    this.group = new THREE.Group();
    this.group.name = 'fx';
    this.group.frustumCulled = false;

    this._rng = makeRng(0x5eed1eaf);
    this._time = 0;
    this._lastElapsed = -1;
    this._zone = 0;
    this._zoneGlow = 0xffe9a8;
    this._zoneMote = 0xfff0b8;
    this._board = null;
    this._intensity = 1;

    // Shared uniform *objects*: three reads material.uniforms.x.value per
    // material, so writing one of these updates every system at once.
    this._shared = {
      uScale: { value: 400 },
      uFog: { value: new THREE.Vector3(1e4, 1e5, 0) },
      uCam: { value: new THREE.Vector3() },
    };

    try {
      const q = this.quality;
      const budget = Math.max(120, q.particles | 0);

      this.pools = {
        dust: new ParticlePool(Math.round(budget * 0.20), { renderOrder: 19 }, this._shared),
        sparkle: new ParticlePool(Math.round(budget * 0.30), { renderOrder: 21 }, this._shared),
        burst: new ParticlePool(Math.round(budget * 0.22), { renderOrder: 21 }, this._shared),
        trail: new ParticlePool(Math.round(budget * 0.28), { alphaMul: 0.85, renderOrder: 20 }, this._shared),
      };
      this._poolList = [this.pools.dust, this.pools.sparkle, this.pools.burst, this.pools.trail];
      for (let i = 0; i < this._poolList.length; i++) this.group.add(this._poolList[i].points);

      const motes = Math.max(0, q.motes | 0);
      this.motes = new MoteField(motes, 20, 15, 20, this._shared, this._rng);
      // Fireflies get a smaller, sparser cell of their own so they read as
      // lanterns in the middle distance rather than as dust on the lens.
      this.flies = new MoteField(Math.round(motes * 0.16), 14, 9, 14, this._shared, this._rng);
      if (this.motes.ok) this.group.add(this.motes.points);
      if (this.flies.ok) {
        this.flies.setKind('firefly', true);
        this.group.add(this.flies.points);
      }

      this.silks = [];
      const nSilk = Math.max(1, q.silkStrands | 0);
      for (let i = 0; i < nSilk; i++) {
        const s = new SilkStrand(this._rng);
        this.silks.push(s);
        this.group.add(s.mesh);
      }

      // Trail bookkeeping in parallel arrays: a linear scan over a dozen slots
      // beats a Map here, and more to the point it allocates nothing.
      this._trailIds = new Array(TRAIL_SLOTS).fill(null);
      this._trailAcc = new Float32Array(TRAIL_SLOTS);
      this._trailX = new Float32Array(TRAIL_SLOTS);
      this._trailY = new Float32Array(TRAIL_SLOTS);
      this._trailZ = new Float32Array(TRAIL_SLOTS);
      this._trailHas = new Uint8Array(TRAIL_SLOTS);
      this._trailNext = 0;

      this._onResize = () => this._measure();
      this._measure();
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', this._onResize, { passive: true });
      }

      if (this.scene) this.scene.add(this.group);
      this.ok = true;
      this.setZone(0, true);
    } catch (err) {
      console.error('[fx] particles failed to initialise; running without them:', err);
      this.ok = false;
      this.enabled = false;
    }
  }

  /* ---------------------------------------------------------------- *
   * Configuration
   * ---------------------------------------------------------------- */

  /**
   * Board-space beetle coordinates are transformed through this object's world
   * matrix in `trail()`. Pass the director's tilting board group. Leave it
   * unset and beetle coordinates are treated as already being in world space.
   */
  setBoard(object3D) { this._board = object3D || null; }

  /** Global multiplier — the pause screen and reduced-motion use it. */
  setIntensity(v) { this._intensity = clamp01(v); }

  /** Cross-fade every family to a depth zone's palette. */
  setZone(index, immediate) {
    if (!this.ok) return;
    const z = (index && typeof index === 'object') ? index : zoneFor(index);
    this._zone = z.id | 0;
    this._zoneGlow = z.glow;
    this._zoneMote = z.moteColor;

    toColor(z.rim, _cB);
    toColor(z.moteColor, _cA);
    this.motes.setColors(_cA, _cB, immediate);
    this.motes.setKind(z.motes || 'pollen', immediate);

    toColor(z.glow, _cA);
    this.flies.setColors(_cA, _cB, immediate);
  }

  /** Turn the ambient field on and point it at a zone. */
  pollen(zone) {
    if (!this.ok) return;
    this.setZone(zone == null ? this._zone : zone, false);
    if (this.motes.ok) this.motes.points.visible = true;
  }

  /** The extra lantern layer for the deep zones. */
  fireflies(on) {
    if (!this.ok || !this.flies.ok) return;
    this.flies.points.visible = !!on;
  }

  /* ---------------------------------------------------------------- *
   * Events — all coordinates are world space
   * ---------------------------------------------------------------- */

  /** Leaf dust kicked up at a contact point. Warm, soft, slow. */
  dust(x, y, z, n) {
    if (!this.ok || !this.enabled) return;
    const pool = this.pools.dust;
    const rng = this._rng;
    const count = clamp(n == null ? 5 : n | 0, 1, 24);
    toColor(this._zoneMote, _cA).multiplyScalar(0.55);
    for (let i = 0; i < count; i++) {
      const a = rng() * TAU;
      const sp = 0.25 + rng() * 0.75;
      pool.spawn(
        x + (rng() - 0.5) * 0.08, y + rng() * 0.05, z + (rng() - 0.5) * 0.08,
        Math.cos(a) * sp, 0.25 + rng() * 0.5, Math.sin(a) * sp,
        _cA.r, _cA.g, _cA.b,
        0.055 + rng() * 0.075,        // size, metres
        0.18 + rng() * 0.16,          // alpha
        0.45 + rng() * 0.40,          // life, seconds
        1.5,                          // softness: a haze
        3.4, -0.5, C_PUFF, (rng() - 0.5) * 2,
      );
    }
  }

  /** Bright chips of light — capture, hole rim, celebration. */
  sparkle(x, y, z, color, n) {
    if (!this.ok || !this.enabled) return;
    const pool = this.pools.sparkle;
    const rng = this._rng;
    const count = clamp(n == null ? 10 : n | 0, 1, 48);
    toColor(color == null ? this._zoneGlow : color, _cA);
    const r = _cA.r * 1.25, g = _cA.g * 1.25, b = _cA.b * 1.25;
    for (let i = 0; i < count; i++) {
      const a = rng() * TAU;
      const up = 0.5 + rng() * 0.5;
      const sp = 0.7 + rng() * 1.9;
      const flat = Math.sqrt(1 - up * up * 0.6);
      pool.spawn(
        x, y + 0.02, z,
        Math.cos(a) * sp * flat, up * sp * 1.15, Math.sin(a) * sp * flat,
        r, g, b,
        0.020 + rng() * 0.030,
        0.75 + rng() * 0.50,
        0.45 + rng() * 0.55,
        6.0,                          // softness: a hard spark
        1.6, -2.4, C_SPARK, 1 + rng() * 3,
      );
    }
  }

  /** The capture beat: a clean ring of colour plus a few slow soft glows. */
  burst(x, y, z, color) {
    if (!this.ok || !this.enabled) return;
    const pool = this.pools.burst;
    const rng = this._rng;
    toColor(color, _cA);
    const r = _cA.r, g = _cA.g, b = _cA.b;
    const ring = Math.max(8, Math.round(pool.cap * 0.34));
    for (let i = 0; i < ring; i++) {
      // Even angular spacing with a little jitter. The eye reads a ring as
      // "that went in"; it reads a random cloud as noise.
      const a = (i / ring) * TAU + rng() * 0.22;
      const sp = 1.9 + rng() * 1.5;
      pool.spawn(
        x, y + 0.04, z,
        Math.cos(a) * sp, 0.55 + rng() * 0.85, Math.sin(a) * sp,
        r * 1.4, g * 1.4, b * 1.4,
        0.035 + rng() * 0.035,
        0.85,
        0.50 + rng() * 0.30,
        4.2,
        2.6, -2.0, C_BURST, (rng() - 0.5) * 5,
      );
    }
    const glows = Math.max(3, Math.round(ring * 0.22));
    for (let i = 0; i < glows; i++) {
      const a = rng() * TAU;
      pool.spawn(
        x, y + 0.05, z,
        Math.cos(a) * 0.35, 0.4 + rng() * 0.4, Math.sin(a) * 0.35,
        r, g, b,
        0.16 + rng() * 0.14,
        0.50,
        0.55 + rng() * 0.35,
        1.4,
        2.2, -0.4, C_BURST, (rng() - 0.5) * 1.5,
      );
    }
    this.sparkle(x, y, z, color, 12);
  }

  /**
   * Speed-driven trail behind one beetle. Safe to call every frame for every
   * bug: emission is rate-limited per bug and does nothing below a walking
   * pace, so a resting beetle costs one comparison.
   *
   * `bug` is a BugState in board space; pass `worldPos` — or call `setBoard`
   * once — if the board is tilted away from world space.
   */
  trail(bug, worldPos) {
    if (!this.ok || !this.enabled || !bug || !this.quality.trails) return;
    const speed = bug.speed != null ? bug.speed : Math.hypot(bug.vx || 0, bug.vz || 0);
    if (!(speed > 1.1)) return;

    let wx, wy, wz;
    if (worldPos) {
      wx = worldPos.x; wy = worldPos.y; wz = worldPos.z;
    } else if (this._board) {
      _wp.set(bug.x || 0, bug.y || 0, bug.z || 0).applyMatrix4(this._board.matrixWorld);
      wx = _wp.x; wy = _wp.y; wz = _wp.z;
    } else {
      wx = bug.x || 0; wy = bug.y || 0; wz = bug.z || 0;
    }

    const s = this._trailSlot(bug.id);
    // Emit per metre travelled, not per second: the streak then has a constant
    // density in space, so a fast beetle leaves a longer trail rather than a
    // denser one — which is what "fast" actually looks like.
    if (this._trailHas[s]) {
      const dx = wx - this._trailX[s], dy = wy - this._trailY[s], dz = wz - this._trailZ[s];
      this._trailAcc[s] += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    this._trailX[s] = wx; this._trailY[s] = wy; this._trailZ[s] = wz;
    this._trailHas[s] = 1;
    if (this._trailAcc[s] < TRAIL_SPACING) return;

    let emit = Math.min(4, Math.floor(this._trailAcc[s] / TRAIL_SPACING));
    this._trailAcc[s] -= emit * TRAIL_SPACING;

    const rng = this._rng;
    toColor(bug.color, _cA);
    const heat = clamp01((speed - 1.1) / 4.5);
    const r = bug.r || 0.30;
    const pool = this.pools.trail;
    while (emit-- > 0) {
      pool.spawn(
        wx + (rng() - 0.5) * r * 0.5,
        wy - r * 0.35 + rng() * 0.04,
        wz + (rng() - 0.5) * r * 0.5,
        (rng() - 0.5) * 0.25, 0.1 + rng() * 0.25, (rng() - 0.5) * 0.25,
        _cA.r, _cA.g, _cA.b,
        r * (0.16 + 0.22 * heat),
        0.12 + 0.34 * heat,
        0.22 + 0.30 * heat,
        2.4,
        4.5, -0.3, C_TRAIL, (rng() - 0.5) * 2,
      );
    }
  }

  _trailSlot(id) {
    const ids = this._trailIds;
    for (let i = 0; i < TRAIL_SLOTS; i++) if (ids[i] === id) return i;
    const s = this._trailNext;
    this._trailNext = (s + 1) % TRAIL_SLOTS;
    ids[s] = id;
    this._trailAcc[s] = 0;
    this._trailHas[s] = 0;
    return s;
  }

  /**
   * Spin a thread of silk out to a falling beetle and swing it home.
   *
   * `from` is the world point in the tree the thread hangs from; `to` is where
   * the beetle is *now*, at the moment of the catch; `dur` is seconds and must
   * match the caller's own carry animation. `home`, if given, is where the
   * beetle is being carried to — without it the strand assumes straight down
   * from the anchor, which is close enough for the swing to read but not exact.
   *
   * Returns the live strand. A caller that animates the beetle itself should
   * call `strand.setTip(x, y, z)` each frame with the beetle's world position;
   * the strand then tracks it exactly instead of reproducing the arc. The
   * strand is pooled — use it, do not keep it past `dur`.
   */
  rescueSilk(from, to, dur, home, color) {
    if (!this.ok || !this.enabled || !from || !to) return null;
    let strand = null;
    for (let i = 0; i < this.silks.length; i++) {
      if (!this.silks[i].active) { strand = this.silks[i]; break; }
    }
    if (!strand) {
      // All busy: steal whichever is furthest through its animation.
      let best = -1;
      for (let i = 0; i < this.silks.length; i++) {
        if (this.silks[i].t > best) { best = this.silks[i].t; strand = this.silks[i]; }
      }
    }
    if (!strand) return null;
    return strand.begin(from, to, dur, home, color == null ? WORLD.silk : color);
  }

  /** Kill every live particle — level change, restart, results screen. */
  clear() {
    if (!this.ok) return;
    for (let i = 0; i < this._poolList.length; i++) this._poolList[i].clear();
    for (let i = 0; i < this.silks.length; i++) this.silks[i].stop();
    this._trailIds.fill(null);
    this._trailHas.fill(0);
    this._trailAcc.fill(0);
  }

  /* ---------------------------------------------------------------- *
   * Frame
   * ---------------------------------------------------------------- */

  update(dt, elapsed, camPos) {
    if (!this.ok || !this.enabled) return;

    // We are reachable twice in one frame — main.js drives us, and so does the
    // director it drove a moment earlier — and both hand us the same `elapsed`.
    // A repeated clock reading is exactly the signature of a repeated frame, so
    // the second call is dropped rather than integrating the whole field at
    // double rate. The loop freezes `elapsed` while paused, so this also parks
    // the ambient drift behind the pause screen, which is what a pause should
    // do. A caller with no clock at all is never suppressed.
    if (Number.isFinite(elapsed)) {
      if (elapsed === this._lastElapsed) return;
      this._lastElapsed = elapsed;
    }

    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;      // a tab restore must not fast-forward the field
    this._time += dt;
    // Keep the shader's time argument small enough that sin() stays precise.
    if (this._time > 1e4) this._time -= 1e4;

    const cam = this._shared.uCam.value;
    if (camPos) cam.set(camPos.x || 0, camPos.y || 0, camPos.z || 0);
    else cam.copy(_camDefault);

    // Mirror the scene fog by hand: three's fog blends toward the fog colour,
    // which for an additive sprite *adds* light instead of removing it.
    const fog = this.scene && this.scene.fog;
    const fv = this._shared.uFog.value;
    if (fog) {
      if (fog.isFogExp2) fv.set(0, 1, fog.density);
      else fv.set(fog.near, fog.far, 0);
    } else {
      fv.set(1e4, 1e5, 0);
    }

    this.motes.intensity = this._intensity;
    this.flies.intensity = 1.15 * this._intensity;
    this.motes.update(dt, this._time);
    this.flies.update(dt, this._time);

    for (let i = 0; i < this._poolList.length; i++) this._poolList[i].update(dt);

    const t = elapsed != null ? elapsed : this._time;
    for (let i = 0; i < this.silks.length; i++) {
      const s = this.silks[i];
      if (!s.active) continue;
      if (s.update(dt, t, cam)) {
        // The moment the thread grips is the moment worth a flash of light,
        // and it belongs at the beetle, not back at the anchor.
        this.sparkle(s.tip.x, s.tip.y, s.tip.z, s.uniforms.uColor.value, 9);
      }
    }
  }

  /** Drawing-buffer height drives point size; recompute it on resize. */
  _measure() {
    if (typeof window === 'undefined') return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio || 2);
    this._shared.uScale.value = Math.max(1, (window.innerHeight || 720) * dpr * 0.5);
  }

  /** Override the automatic measurement (offscreen canvases, split views). */
  setViewportHeight(pixels) {
    if (pixels > 0) this._shared.uScale.value = pixels * 0.5;
  }

  dispose() {
    try {
      if (typeof window !== 'undefined' && this._onResize) {
        window.removeEventListener('resize', this._onResize);
      }
      if (this._poolList) {
        for (let i = 0; i < this._poolList.length; i++) this._poolList[i].dispose();
      }
      if (this.motes) this.motes.dispose();
      if (this.flies) this.flies.dispose();
      if (this.silks) {
        for (let i = 0; i < this.silks.length; i++) this.silks[i].dispose();
      }
      if (this.group.parent) this.group.parent.remove(this.group);
      this.group.clear();
    } catch (err) {
      // Disposal must never be the thing that breaks a level reload.
    }
    this.ok = false;
    this.enabled = false;
  }
}

export default Effects;
