/**
 * MOSSFALL — the Lantern Tree.
 *
 * One job: make the player believe they are two centimetres tall inside
 * something enormous, old, and busy living its own life. Every decision here
 * serves scale and depth, in that order.
 *
 * The stage is fixed. A fourteen-metre trunk stands behind the play leaf and
 * runs out of sight in both directions; the camera sits in front of it looking
 * slightly down. Everything else hangs off that trunk in trunk-polar
 * coordinates — an angle from the leaf direction and a radius from the axis.
 * That single convention buys the most important guarantee in the file: no
 * set-dressing is ever placed within `PLACE_MIN_A` of the leaf direction, which
 * (see the note on that constant) puts every prop at least ten metres from the
 * board and outside the camera's cone. The brief is explicit that nothing may
 * obscure the play surface, and this makes that a property of the coordinate
 * system rather than something to remember while placing things.
 *
 * The descent column is built once and recycled. Five thirty-metre bands
 * treadmill around the camera; when one passes overhead it drops to the bottom
 * and is re-dressed — mirrored, spun a little, given a different leaf count.
 * Falling four hundred metres therefore costs exactly what standing still costs.
 *
 * Wind is a single coherent field in a shared uniform, applied in the vertex
 * shader after the instance matrix. Vines, leaves, flowers and grass all lean
 * to the same low-frequency gust, and that agreement — not the amplitude — is
 * what makes it read as air moving through a tree.
 */

import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, sstep, valueNoise2, easeInOutCubic, TAU } from '../core/math.js';
import { WORLD as PAL, zoneFor } from '../data/palette.js';

/* ===================================================================== *
 * Stage constants
 * ===================================================================== */

const ZERO3 = Object.freeze({ x: 0, y: 0, z: 0 });  // fallback level origin

const TRUNK_Z = -13;      // the trunk axis sits behind the board
const TRUNK_R = 7;        // ~14 m across
const TRUNK_H = 160;      // one tile; all trunk noise is periodic over this
const BANDS = 5;
const BAND_H = 30;
const COLUMN_H = BANDS * BAND_H;

/**
 * The canopy shells and the waterfall stay centred on the camera and carry
 * their parallax in their texture offset instead of in their Y, so these are
 * the world-metre periods that conversion needs: one canopy tile is
 * `SHELL_TILE` metres of shell height (that is where the `H[i] / 34` repeat
 * comes from), and the fall's map repeats exactly once over its `WATER_H` plane.
 * `WATER_PARA` is the share of the camera's descent the fall keeps.
 */
const SHELL_TILE = 34;
const WATER_H = 130;
const WATER_PARA = 0.45;

/** Where the fall's plane stands. `_buildWaterfall` argues for these three. */
const WATER_X = -21;
const WATER_Z = TRUNK_Z - 22;
const WATER_ROT = 0.5;

/**
 * The perpendicular gap between the trunk axis and the plane the fall lies in —
 * 29.37 m for the three numbers above. Anything closer to the axis than this is
 * on the camera's side of the fall whatever its azimuth and whatever its height,
 * and a radius is the only test cheap enough to apply at build time: the bands
 * mirror and spin every time they wrap, so over a long enough descent every band
 * presents every one of its boughs at the fall's azimuth, and the fall is 130 m
 * of plane riding the camera, so there is no height at which they miss either.
 */
const WATER_AXIS_GAP = Math.abs(
  Math.sin(WATER_ROT) * WATER_X + Math.cos(WATER_ROT) * (WATER_Z - TRUNK_Z));

/**
 * How far a bough may reach. `WATER_AXIS_GAP` less the tube's own radius where
 * it is thinnest — the taper leaves 0.22 of `rad`, so at most 0.36 m — and the
 * rest is slack for the curve bulging between its control points. The slack
 * also has to cover what rides the bough: the leaf clumps hang off points on
 * the same curve and are scaled outward from them, and the furthest one any
 * seed and any wrap produces lands at 29.3 m, still inside the gap.
 */
const BOUGH_MAX_R = WATER_AXIS_GAP - 1;

/**
 * Half-angle, measured from the leaf direction (+z), inside which nothing is
 * ever placed. At 1.25 rad the nearest possible prop is 10.5 m from the board
 * origin and behind the leaf's far rim, with 6 m of clearance on a 4.5 m blade.
 * Bands may spin by up to `BAND_SPIN`, so the effective guarantee is 0.97 rad —
 * still 10.4 m. Do not lower either number without redoing that arithmetic.
 */
const PLACE_MIN_A = 1.25;

/**
 * Half the trunk lathe's arc. `_buildTrunk` builds 3.9 rad centred on the leaf
 * direction, so past ±1.95 there is no trunk surface at all — anything anchored
 * *to* the trunk beyond it hangs in the void just outside the silhouette, which
 * is exactly what a bracket fungus floating beside the trunk is.
 */
const TRUNK_ARC = 1.95;

/**
 * The hollows carved into each trunk tile. Hoisted out of `_buildTrunk` so
 * set-dressing can avoid them; deterministic, so both sides agree without
 * sharing any state.
 */
let _hollowCache = null;
function trunkHollows() {
  if (_hollowCache) return _hollowCache;
  _hollowCache = [];
  for (let i = 0; i < 4; i++) {
    _hollowCache.push({
      // Kept well inside PLACE_MIN_A: a hollow reaches `r / TRUNK_R` (up to
      // 0.5 rad) either side of its centre, and if they were free to sit out
      // at ±1.7 a pair of them could swallow the whole band of angles that
      // trunk dressing is allowed to use, leaving `trunkAzimuth` nowhere to go.
      th: (hash01(i * 91 + 3) - 0.5) * 1.4,
      y: (hash01(i * 91 + 11) - 0.5) * (TRUNK_H - 22),
      r: 1.6 + hash01(i * 91 + 19) * 1.9,
      d: 0.7 + hash01(i * 91 + 23) * 0.7,
    });
  }
  return _hollowCache;
}

/**
 * An azimuth for something that sits **on** the trunk: inside the lathe's arc,
 * and clear of every hollow.
 *
 * A band is baked once and then re-dressed to a new `yOff` on every wrap, so at
 * bake time a prop cannot know what height it will end up at — which is why
 * this cannot test the hollows in y. It does not need to: azimuth is fixed for
 * the life of the prop, so an angle that misses every hollow misses them at
 * every height.
 *
 * @param {number} sign    -1 or 1, which flank
 * @param {number} u       0..1 from the caller's hash
 * @param {number} margin  the prop's own angular half-width, in radians
 */
function trunkAzimuth(sign, u, margin) {
  const lo = PLACE_MIN_A;
  const hi = Math.max(lo + 0.02, TRUNK_ARC - margin);
  const span = hi - lo;
  const holes = trunkHollows();
  for (let k = 0; k < 12; k++) {
    const a = sign * (lo + ((u + k / 12) % 1) * span);
    let clear = true;
    for (let i = 0; i < holes.length; i++) {
      if (Math.abs(a - holes[i].th) < holes[i].r / TRUNK_R + margin) {
        clear = false;
        break;
      }
    }
    if (clear) return a;
  }
  return sign * (lo + u * span);   // fully blocked: take the nominal angle
}
const BAND_SPIN = 0.28;

const TIERS = { low: 0, medium: 1, high: 2 };
function tierOf(q) {
  if (typeof q === 'string') return TIERS[q] != null ? TIERS[q] : 2;
  if (q && typeof q === 'object') {
    if (typeof q.tier === 'number') return clamp(q.tier | 0, 0, 2);
    const n = q.name || q.level || q.id;
    if (typeof n === 'string' && TIERS[n] != null) return TIERS[n];
  }
  return 2;
}

/** Deterministic, allocation-free stand-in for an RNG when re-dressing bands. */
function hash01(n) {
  let t = Math.imul(n | 0, 2654435761) ^ 0x9e3779b9;
  t = Math.imul(t ^ (t >>> 15), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/* --- module scratch ---------------------------------------------------- */
const _m4 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _sc = new THREE.Vector3(1, 1, 1);
const _col = new THREE.Color();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

/** Trunk-polar → world. `a` is the angle away from the leaf direction. */
function polar(a, r, y, out) {
  return out.set(Math.sin(a) * r, y, Math.cos(a) * r);
}

/* ===================================================================== *
 * Geometry accumulator
 *
 * three's BufferGeometryUtils lives in examples/, which we do not vendor, so
 * static dressing is baked into one buffer here at build time. Everything a
 * band contains collapses to three draw calls this way.
 * ===================================================================== */

class GeoAcc {
  constructor(opts) {
    const o = opts || {};
    this.hasSway = !!o.sway;
    this.hasAlpha = !!o.alpha;
    this.p = []; this.n = []; this.u = []; this.c = []; this.s = []; this.i = [];
    // Private scratch, not the module's: callers hold live values in `_v`/`_m4`
    // across an add(), and clobbering those from in here caused real bugs.
    this._sp = new THREE.Vector3();
    this._sn = new THREE.Vector3();
    this._sc = new THREE.Color();
    this._sk = new THREE.Color();
    this._sm = new THREE.Matrix3();
  }
  get empty() { return this.p.length === 0; }

  /**
   * @param geo   source geometry (disposed unless `keep`)
   * @param m     Matrix4 placement
   * @param color THREE.Color, hex, or fn(lx,ly,lz,out)
   * @param o     { sway, alpha, keep } — each a number or fn(lx,ly,lz)
   */
  add(geo, m, color, o) {
    const opt = o || {};
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const uvA = geo.attributes.uv;
    const idx = geo.index;
    const base = this.p.length / 3;
    const P = this._sp, N = this._sn, C = this._sc, K = this._sk, NM = this._sm;
    NM.getNormalMatrix(m);
    const isFn = typeof color === 'function';
    if (!isFn) K.set(color);
    const swayFn = typeof opt.sway === 'function' ? opt.sway : null;
    const swayK = swayFn ? 0 : (opt.sway || 0);
    const alphaFn = typeof opt.alpha === 'function' ? opt.alpha : null;
    const alphaK = alphaFn ? 0 : (opt.alpha != null ? opt.alpha : 1);

    for (let vi = 0; vi < pos.count; vi++) {
      const lx = pos.getX(vi), ly = pos.getY(vi), lz = pos.getZ(vi);
      P.set(lx, ly, lz).applyMatrix4(m);
      this.p.push(P.x, P.y, P.z);
      if (nrm) {
        N.set(nrm.getX(vi), nrm.getY(vi), nrm.getZ(vi)).applyMatrix3(NM).normalize();
        this.n.push(N.x, N.y, N.z);
      } else this.n.push(0, 1, 0);
      this.u.push(uvA ? uvA.getX(vi) : 0, uvA ? uvA.getY(vi) : 0);
      if (isFn) color(lx, ly, lz, C); else C.copy(K);
      this.c.push(C.r, C.g, C.b);
      if (this.hasAlpha) this.c.push(alphaFn ? alphaFn(lx, ly, lz) : alphaK);
      if (this.hasSway) this.s.push(swayFn ? swayFn(lx, ly, lz) : swayK);
    }
    if (idx) for (let k = 0; k < idx.count; k++) this.i.push(base + idx.getX(k));
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
    if (!opt.keep) geo.dispose();
    return this;
  }

  build() {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    const n = this.p.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, this.hasAlpha ? 4 : 3));
    if (this.hasSway) g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.s, 1));
    g.setIndex(n > 65535
      ? new THREE.Uint32BufferAttribute(this.i, 1)
      : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/* ===================================================================== *
 * Primitive builders
 * ===================================================================== */

/** Tube along a curve with a per-u radius — three's TubeGeometry cannot taper,
 *  and an untapered branch is the fastest way to make a tree look fake. */
function tubeGeometry(curve, segs, radial, radiusAt) {
  const P = [], N = [], UV = [], IDX = [];
  const frames = curve.computeFrenetFrames(segs, false);
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, p);
    const nn = frames.normals[i], bb = frames.binormals[i];
    const r = Math.max(1e-3, radiusAt(u));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = ca * nn.x + sa * bb.x;
      const ny = ca * nn.y + sa * bb.y;
      const nz = ca * nn.z + sa * bb.z;
      P.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
      N.push(nx, ny, nz);
      UV.push(u, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      IDX.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(IDX);
  return g;
}

/** A hanging line with real sag, sampled for a CatmullRom. */
function catenaryCurve(ax, ay, az, bx, by, bz, sag, drift) {
  const pts = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    const s = 4 * t * (1 - t);
    pts.push(new THREE.Vector3(
      lerp(ax, bx, t) + Math.sin(t * 3.1 + drift) * drift * 0.9,
      lerp(ay, by, t) - sag * s,
      lerp(az, bz, t) + Math.cos(t * 2.3 + drift) * drift * 0.9,
    ));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
}

/** A background leaf. Stem at the origin, tip at +z, gutter along the midrib. */
function bladeGeometry(len, wid) {
  const rows = 3, cols = 3;
  const P = [], N = [], UV = [], SW = [], C = [], IDX = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const u = 0.05 + t * 0.95;
    const hw = Math.pow(Math.sin(u * Math.PI), 0.6) * wid * 0.5;
    for (let j = 0; j <= cols; j++) {
      const v = (j / cols) * 2 - 1;
      P.push(v * hw, -v * v * wid * 0.16 - t * t * len * 0.11, t * len);
      N.push(0, 1, 0);
      UV.push(j / cols, t);
      SW.push(Math.pow(t, 1.4));
      // The tip catches more light than the shaded base. Also: the material is
      // vertexColors, so this attribute must exist or every leaf renders black.
      const k = 0.78 + t * 0.28 - Math.abs(v) * 0.1;
      C.push(k, k, k);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + cols + 1;
      IDX.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(SW, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(IDX);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Bracket fungus: a flattened quarter-dome. Merged with a dark gill disc. */
function shelfGeometry() {
  const g = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI, 0, Math.PI * 0.55);
  g.scale(1, 0.34, 0.78);
  return g;
}
function gillGeometry() {
  const g = new THREE.CircleGeometry(0.95, 10, 0, Math.PI);
  g.rotateX(Math.PI * 0.5);
  g.scale(1, 1, 0.78);
  return g;
}

/** A single petal — a squashed half-dome, so flowers have volume from below. */
function petalGeometry() {
  const g = new THREE.SphereGeometry(1, 6, 4, 0, TAU, 0, Math.PI * 0.5);
  g.scale(0.34, 0.1, 0.62);
  g.translate(0, 0, 0.58);
  return g;
}

/** Three crossed tapered blades — moss tufts and grass at prop scale. */
function tuftBladeGeometry() {
  const g = new THREE.PlaneGeometry(0.16, 1, 1, 3);
  const pos = g.attributes.position;
  for (let v = 0; v < pos.count; v++) {
    const y = pos.getY(v) + 0.5;               // 0 at root, 1 at tip
    pos.setX(v, pos.getX(v) * (1 - y * 0.85));
    pos.setY(v, y);
    pos.setZ(v, y * y * 0.22);                 // curl over
  }
  g.computeVertexNormals();
  return g;
}

/* ===================================================================== *
 * Procedural textures — the only "assets" in the file, drawn at boot.
 * ===================================================================== */

function canopyTexture(seed) {
  if (typeof document === 'undefined') return null;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return null;
  let st = seed >>> 0;
  const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };

  const blob = (x, y, r, sx, sy, rot) => {
    // Draw nine copies so the sheet tiles in both directions — a visible seam
    // on a canopy shell is the one thing that would break the parallax.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        g.save();
        g.translate(x + dx * S, y + dy * S);
        g.rotate(rot);
        g.scale(sx, sy);
        g.beginPath();
        g.moveTo(0, -r);
        g.quadraticCurveTo(r * 0.95, -r * 0.2, 0, r);
        g.quadraticCurveTo(-r * 0.95, -r * 0.2, 0, -r);
        g.fill();
        g.restore();
      }
    }
  };

  g.clearRect(0, 0, S, S);
  g.globalAlpha = 1;

  // Clumps, not confetti. Scattering leaves uniformly over the sheet gives an
  // even grey once it is a hundred metres away, which reads as drifting debris
  // rather than as a canopy; foliage clusters at the ends of twigs and leaves
  // real gaps between clusters, and it is the *gaps* that sell the depth.
  //
  // Value varies per leaf rather than alpha: the material alpha-tests, so a
  // half-transparent leaf is simply a missing one, whereas a darker leaf
  // survives the cut and becomes shading. That single change is the difference
  // between a flat cutout sheet and something with layers inside it.
  const CLUMPS = 15;
  for (let c = 0; c < CLUMPS; c++) {
    const cx = rnd() * S, cy = rnd() * S;
    const spread = 16 + rnd() * 22;
    const lean = rnd() * Math.PI;               // the clump's twig direction
    const shade = 0.42 + rnd() * 0.45;          // clumps sit at different depths
    const n = 5 + (rnd() * 6) | 0;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      const d = spread * Math.sqrt(rnd());
      // Leaves closer to the clump's centre are the ones behind, so they darken.
      const v = clamp01(shade + (d / spread) * 0.34 + (rnd() - 0.5) * 0.16);
      const q = Math.round(v * 255);
      g.fillStyle = `rgb(${q},${q},${q})`;
      blob(
        cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.78,
        7 + rnd() * 17, 1, 0.6 + rnd() * 0.5,
        // Scatter around the clump's lean rather than fully at random: leaves on
        // one twig broadly agree with each other, and that agreement is legible.
        lean + (rnd() - 0.5) * 1.5
      );
    }
  }

  // Punch gaps so light can come through the layer.
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 1;
  for (let i = 0; i < 20; i++) blob(rnd() * S, rnd() * S, 12 + rnd() * 26, 1, 1, rnd() * Math.PI);
  g.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

function waterTexture() {
  if (typeof document === 'undefined') return null;
  const W = 64, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return null;
  let st = 20260804;
  const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  // The streaks are the water; everything between them is the tree behind it.
  // Flooding the sheet with an opaque backing colour first would leave the alpha
  // channel at 255 in every texel, and then `transparent` + `opacity` stops
  // meaning "a veil of spray" and starts meaning "a rectangle of that backing
  // colour at 55%". Two things follow from that and neither is recoverable
  // downstream: the mesh's silhouette becomes its quad rather than its water,
  // and the material's `color` — which `_applyZone` deliberately pulls 60% of
  // the way to `PAL.water`, a pale cyan — multiplies into a near-black texel and
  // can only ever subtract. Carry the marks in alpha, the way `canopyTexture`
  // carries its leaves, and both of those come back.
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const h = 14 + rnd() * 70;
    g.globalAlpha = 0.06 + rnd() * 0.4;
    g.lineWidth = 0.7 + rnd() * 2.4;
    g.beginPath();
    // Wrap the streak vertically so the scroll never shows a joint.
    g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 3, y + h);
    g.moveTo(x, y - H); g.lineTo(x + (rnd() - 0.5) * 3, y - H + h);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ===================================================================== *
 * Shader patches
 * ===================================================================== */

/** Replaces `<project_vertex>`: the offset must land *after* instanceMatrix, or
 *  every instanced leaf would blow in its own local direction. */
const WIND_PROJECT = `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
{
  // One field, sampled in world space, so a vine and the leaf beside it agree.
  vec3 wp = ( modelMatrix * mvPosition ).xyz;
  float ph = dot( wp, vec3( 0.19, 0.06, 0.13 ) );
  float w = sin( uTime * uWind.w + ph ) * 0.62 + sin( uTime * uWind.w * 0.43 + ph * 1.9 ) * 0.38;
  float amt = aSway * ( w + 0.22 );
  mvPosition.xz += uWind.xy * amt;
  mvPosition.y -= aSway * uWind.z * abs( w );   // it swings, it does not stretch
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

function windPatch(mat, uni, key) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uni.uTime;
    shader.uniforms.uWind = uni.uWind;
    shader.vertexShader =
      'uniform float uTime;\nuniform vec4 uWind;\nattribute float aSway;\n' +
      shader.vertexShader.replace('#include <project_vertex>', WIND_PROJECT);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/**
 * Moss glows in the deep zones. There is no extra attribute for it: bark is
 * brown and moss is green, so "how much greener than anything else" is already
 * in the vertex colour and costs three instructions to recover.
 */
function mossPatch(mat, uni, key) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMossGlow = uni.uMossGlow;
    shader.uniforms.uMossTint = uni.uMossTint;
    shader.fragmentShader =
      'uniform float uMossGlow;\nuniform vec3 uMossTint;\n' +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' +
        'float mossAmt = clamp( ( vColor.g - max( vColor.r, vColor.b ) ) * 3.2, 0.0, 1.0 );\n' +
        'totalEmissiveRadiance += uMossTint * ( mossAmt * uMossGlow );');
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/* ===================================================================== *
 * World
 * ===================================================================== */

export class World {
  constructor(scene, quality) {
    this.scene = scene;
    this.tier = tierOf(quality);
    this.ok = false;

    this.group = new THREE.Group();
    this.group.name = 'lantern-tree';
    this.descentLayers = new THREE.Group();
    this.descentLayers.name = 'descent-layers';
    this.group.add(this.descentLayers);

    this.local = new THREE.Group();
    this.local.name = 'local-dressing';
    this.group.add(this.local);

    this.zone = 0;
    this._lighting = null;
    this._motion = 1;
    this._camY = 0;
    this._windT = 0;
    this._dressN = 0;

    this._uni = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector4(0.12, 0.03, 0.05, 1.1) },
      uMossGlow: { value: 0 },
      uMossTint: { value: new THREE.Vector3(0.5, 1, 0.7) },
    };

    // Zone cross-fade: `_zCur` is written in place every frame, never rebuilt.
    this._zFrom = zoneCopy(zoneFor(0), {});
    this._zTo = zoneFor(0);
    this._zCur = zoneCopy(zoneFor(0), {});
    this._zoneT = 1;
    this._zoneDur = 0;

    this._mats = [];
    this._geos = [];
    this._bands = [];
    this._shells = [];

    try {
      this._buildMaterials();
      this._buildTrunk();
      this._buildColumn();
      this._buildShells();
      this._buildGodrays();
      this._buildWaterfall();
      this._buildSilk();
      this.ok = true;
    } catch (err) {
      console.error('[world] build failed, degrading to a bare stage:', err);
    }

    scene.add(this.group);
    if (this.ok) this._applyZone();
  }

  /** Let the world drive the lighting rig's zone fades too. Optional. */
  attachLighting(lighting) {
    this._lighting = lighting || null;
    return this;
  }

  /** 'reduced' motion scales sway and drift without freezing the world. */
  setMotion(scale) {
    this._motion = clamp(scale == null ? 1 : scale, 0, 1);
  }

  /* ------------------------------------------------------------------ *
   * Materials — every one of them is registered for tinting and disposal.
   * ------------------------------------------------------------------ */

  _mat(m) { this._mats.push(m); return m; }

  _buildMaterials() {
    const u = this._uni;

    this.mBark = this._mat(mossPatch(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0, flatShading: false,
    }), u, 'mf-moss'));

    this.mSoft = this._mat(windPatch(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
    }), u, 'mf-wind-soft'));

    this.mLeaf = this._mat(windPatch(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide,
    }), u, 'mf-wind-leaf'));

    // Backdrop twins of the two above.
    //
    // The trunk and the branches dressing the board sit at the camera's own
    // depth; the parallax bands are twenty-plus metres further back, and at that
    // range through a hazy canopy a bark facet turned away from every light was
    // rendering as a near-black plank hanging in pale green sky. Fog alone can't
    // reach it — pull fog in far enough to matter here and the board itself goes
    // milky. So the far bark carries its own aerial perspective as a small
    // additive haze term, which is what scattering along a long sightline
    // actually does: it lifts the blacks and flattens contrast without touching
    // anything in front of it. Tinted in `_applyZone`.
    this.mBarkFar = this._mat(mossPatch(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0, flatShading: false,
    }), u, 'mf-moss'));

    this.mSoftFar = this._mat(windPatch(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
    }), u, 'mf-wind-soft'));

    this.mRay = this._mat(new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));

    this.mSilk = this._mat(new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, fog: true,
    }));
  }

  /* ------------------------------------------------------------------ *
   * The trunk
   * ------------------------------------------------------------------ */

  /** Multi-octave bark. High angular frequency, low vertical: that ratio is
   *  what produces ridges running up the tree instead of generic lumps. */
  static _bark(th, y) {
    const a = th * TRUNK_R;
    return 0.50 * valueNoise2(a * 0.17, y * 0.13)
      + 0.28 * valueNoise2(a * 0.54 + 31, y * 0.085)
      + 0.15 * valueNoise2(a * 1.55 + 7, y * 0.045)
      + 0.07 * valueNoise2(a * 4.10 + 63, y * 0.30);
  }

  static _moss(th, y) {
    const a = th * TRUNK_R;
    return 0.62 * valueNoise2(a * 0.24 + 101, y * 0.19)
      + 0.38 * valueNoise2(a * 0.80 + 17, y * 0.42);
  }

  /** Wrap a noise field so the tile is seamless when the trunk is recycled. */
  static _wrapped(fn, th, y) {
    const t = clamp01((y + TRUNK_H * 0.5) / TRUNK_H);
    return lerp(fn(th, y), fn(th, y - TRUNK_H), t);
  }

  _buildTrunk() {
    const t = this.tier;
    const radial = [22, 32, 44][t];
    const rows = [26, 40, 56][t];

    // A lathe rather than a cylinder: the profile swells and narrows, and it is
    // periodic over TRUNK_H so the swell survives being teleported by a tile.
    const prof = [];
    for (let i = 0; i <= rows; i++) {
      const y = -TRUNK_H * 0.5 + (i / rows) * TRUNK_H;
      const ph = (y / TRUNK_H) * TAU;
      const r = TRUNK_R + Math.sin(ph) * 0.42 + Math.sin(ph * 2 + 1.1) * 0.21;
      prof.push(new THREE.Vector2(r, y));
    }
    // 3.9 rad of arc, centred on the leaf direction: comfortably past the
    // tangent points from any camera we ever use, and half the triangles.
    const g = new THREE.LatheGeometry(prof, radial, -1.95, 3.9);

    // Four hollows per tile, kept clear of the seam so the wrap cannot smear one.
    // Shared with the set-dressing so props can steer around them.
    const holes = trunkHollows();

    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const mossC = new THREE.Color(PAL.moss);
    const mossL = new THREE.Color(PAL.mossLight);
    const mossD = new THREE.Color(PAL.mossDark);
    const bark = new THREE.Color(PAL.bark);
    const barkD = new THREE.Color(PAL.barkDark);
    const barkL = new THREE.Color(PAL.barkLight);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const r0 = Math.hypot(x, z);
      if (r0 < 1e-5) continue;
      const th = Math.atan2(x, z);

      let d = World._wrapped(World._bark, th, y) * 0.58;
      let hollow = 0;
      for (let h = 0; h < holes.length; h++) {
        const hh = holes[h];
        const dd = Math.hypot((th - hh.th) * TRUNK_R, (y - hh.y) * 0.75);
        if (dd < hh.r) {
          const k = 0.5 + 0.5 * Math.cos((Math.PI * dd) / hh.r);
          hollow = Math.max(hollow, k);
          d -= hh.d * k * k;
        }
      }

      const r = r0 + d;
      pos.setXYZ(i, Math.sin(th) * r, y, Math.cos(th) * r);

      // Moss sits in the ridge valleys and on the shaded flanks; the raised
      // ridges stay bare bark. That single rule does most of the surface read.
      const mn = World._wrapped(World._moss, th, y);
      const valley = clamp01(0.5 - d * 1.4);
      const m = clamp01(sstep(0.02, 0.5, mn) * (0.35 + valley * 0.9));
      _col.copy(bark).lerp(barkL, clamp01(d * 1.1 + 0.4)).lerp(barkD, hollow * 0.92);
      _c1.copy(mossC).lerp(mossL, clamp01(mn * 0.8 + 0.35)).lerp(mossD, valley * 0.5);
      _col.lerp(_c1, m * (1 - hollow * 0.85));
      colors[i * 3] = _col.r; colors[i * 3 + 1] = _col.g; colors[i * 3 + 2] = _col.b;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    fixOutward(g);
    g.computeBoundingSphere();
    this._geos.push(g);

    const mesh = new THREE.Mesh(g, this.mBark);
    mesh.name = 'trunk';
    mesh.position.z = TRUNK_Z;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    this.trunk = mesh;

    // Two tiles, not one. A single tile snapped to the nearest multiple of its
    // own height can end up 80 m away in either direction, and the camera looks
    // *down*: the frame's top edge is already 10° below horizontal, so the only
    // band that can ever be on screen is roughly 3 to 40 m beneath the eye. Snap
    // the tile upward and that band falls off its bottom end, leaving no tree on
    // screen at all — a quarter of every fall lands in that gap, and level 3's
    // camera height (-78.5 m, tile snapped to 0) sits squarely in it. The partner
    // tile sits on the far side of the boundary, so the pair always spans the
    // camera ± TRUNK_H whichever way the snap went.
    // It shares this geometry and material, so it costs one draw call and no
    // memory; `_geos` holds the buffer once and disposes it once.
    const mesh2 = new THREE.Mesh(g, this.mBark);
    mesh2.name = 'trunk-b';
    mesh2.position.z = TRUNK_Z;
    mesh2.castShadow = false;
    mesh2.receiveShadow = false;
    this.group.add(mesh2);
    this.trunkB = mesh2;
  }

  /* ------------------------------------------------------------------ *
   * The descent column
   * ------------------------------------------------------------------ */

  _buildColumn() {
    const protos = {
      shelf: shelfGeometry(),
      gill: gillGeometry(),
      petal: petalGeometry(),
      tuft: tuftBladeGeometry(),
      knot: new THREE.IcosahedronGeometry(1, 0),
      core: new THREE.SphereGeometry(1, 6, 4),
    };
    this._blade = bladeGeometry(1.0, 0.62);
    this._geos.push(this._blade);

    for (let i = 0; i < BANDS; i++) this._bands.push(this._buildBand(i, protos));

    for (const k in protos) protos[k].dispose();
  }

  _buildBand(slot, protos) {
    const t = this.tier;
    const band = new THREE.Group();
    band.name = `band${slot}`;
    band.position.set(0, 0, TRUNK_Z);
    band.userData = { slot, baseY: slot * BAND_H, yOff: 0, pass: 0 };

    const solid = new GeoAcc();
    const soft = new GeoAcc({ sway: true });

    const S = (n) => hash01(slot * 7919 + n);

    /* --- boughs: the silhouette the whole band hangs off --------------- */
    const boughs = [];
    for (let b = 0; b < 2; b++) {
      const s = b === 0 ? 1 : -1;
      const a0 = s * (PLACE_MIN_A + 0.16 + S(b * 31 + 1) * 0.5);
      const a1 = a0 + s * (0.30 + S(b * 31 + 2) * 0.5);
      const y0 = (S(b * 31 + 3) - 0.5) * BAND_H * 0.7;
      // A bough that reaches past `BOUGH_MAX_R` pushes a solid, lit tube out
      // through the waterfall's sheet. Three of the ten boughs this seed draws
      // do, the worst by 3.8 m of its 32 m span, and today it does not show only
      // because the fall does not write depth and draws first — one material
      // flag away from an intersection you can see. Capping the reach makes the
      // clearance a property of the geometry instead of the draw order.
      const rEnd = Math.min(20 + S(b * 31 + 4) * 14, BOUGH_MAX_R);
      const pts = [];
      for (let i = 0; i <= 4; i++) {
        const u = i / 4;
        const a = lerp(a0, a1, u * u);
        const r = lerp(TRUNK_R * 0.86, rEnd, u);
        // Boughs leave the trunk rising and settle under their own weight.
        const y = y0 + Math.sin(u * 1.5) * 2.2 - u * u * (2.5 + S(b * 31 + 5) * 4);
        pts.push(polar(a, r, y, new THREE.Vector3()));
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
      const rad = 1.15 + S(b * 31 + 6) * 0.5;
      const geo = tubeGeometry(curve, [8, 12, 16][t], [5, 6, 8][t], (u) => rad * (1 - u * 0.78));
      solid.add(geo, _m4.identity(), (lx, ly, lz, out) => {
        const n = valueNoise2(lx * 0.7 + lz * 0.3, ly * 0.9);
        out.set(PAL.bark).lerp(_c2.set(PAL.moss), clamp01(0.25 + n * 0.9) * 0.55);
      });
      boughs.push(curve);
    }

    /* --- shelf fungi and knots on the trunk face ----------------------- */
    for (let i = 0; i < [2, 3, 4][t]; i++) {
      const w = 0.9 + S(i * 53 + 4) * 1.5;
      const a = trunkAzimuth(S(i * 53 + 1) > 0.5 ? 1 : -1, S(i * 53 + 2), 0.22);
      const y = (S(i * 53 + 3) - 0.5) * BAND_H * 0.86;
      // Anchor below the lathe profile's *minimum*, not at the nominal radius.
      // The trunk swells and narrows by ±0.63 over TRUNK_H, and a band is baked
      // once but re-dressed to a new yOff on every wrap, so at bake time this
      // prop cannot know the trunk radius where it will end up. TRUNK_R - 0.3
      // hangs clear wherever the profile is thin; TRUNK_R - 0.8 is inside the
      // thinnest section, so the prop can only ever be buried, never airborne.
      polar(a, TRUNK_R - 0.8, y, _v);
      _q.setFromAxisAngle(UP, a);
      _sc.set(w, w, w);
      _m4.compose(_v, _q, _sc);
      solid.add(protos.shelf, _m4, PAL.mushroomCap, { keep: true });
      solid.add(protos.gill, _m4, PAL.mushroomStem, { keep: true });
    }
    for (let i = 0; i < 3; i++) {
      const a = trunkAzimuth(S(i * 71 + 1) > 0.5 ? 1 : -1, S(i * 71 + 2), 0.12);
      const y = (S(i * 71 + 3) - 0.5) * BAND_H * 0.9;
      polar(a, TRUNK_R - 0.75, y, _v);   // same reasoning as the shelf fungi
      _q.setFromEuler(new THREE.Euler(S(i * 71 + 4) * 3, a, S(i * 71 + 5) * 3));
      _sc.set(0.6 + S(i * 71 + 6) * 0.9, 0.5, 0.7 + S(i * 71 + 7) * 0.6);
      solid.add(protos.knot, _m4.compose(_v, _q, _sc), PAL.barkDark, { keep: true });
    }

    /* --- vines: catenaries off the boughs ------------------------------ */
    const nVine = [3, 4, 6][t];
    for (let i = 0; i < nVine; i++) {
      const c = boughs[i % boughs.length];
      const u = 0.35 + S(i * 97 + 1) * 0.55;
      c.getPointAt(u, _v);
      const ax = _v.x, ay = _v.y, az = _v.z;
      const drop = 8 + S(i * 97 + 2) * 16;
      const drift = 1.2 + S(i * 97 + 3) * 2.6;
      const cur = catenaryCurve(
        ax, ay, az,
        ax + (S(i * 97 + 4) - 0.5) * 5, ay - drop, az + (S(i * 97 + 5) - 0.5) * 5,
        drop * 0.16, drift);
      const geo = tubeGeometry(cur, [10, 14, 20][t], [4, 5, 6][t], (uu) => 0.10 * (1 - uu * 0.55));
      // Sway rises from nothing at the anchor to full at the tip.
      soft.add(geo, _m4.identity(), (lx, ly, lz, out) => {
        out.set(PAL.vine).lerp(_c2.set(PAL.moss), clamp01((ly - ay + drop) / drop) * 0.5);
      }, { sway: (lx, ly) => Math.pow(clamp01((ay - ly) / drop), 1.5) * 0.75 });
    }

    /* --- oversized flowers and tufts, hugging the trunk ---------------- */
    for (let i = 0; i < [3, 5, 7][t]; i++) {
      // These start at the bark and lean out, so the near ones are trunk-bound
      // and need the arc; the far ones are free-standing either way.
      const a = trunkAzimuth(S(i * 113 + 1) > 0.5 ? 1 : -1, S(i * 113 + 2), 0.15);
      const r = TRUNK_R + 0.1 + S(i * 113 + 3) * 3.5;
      const y = (S(i * 113 + 4) - 0.5) * BAND_H * 0.9;
      const sz = 0.55 + S(i * 113 + 5) * 0.7;
      const warm = S(i * 113 + 6) > 0.45;
      polar(a, r, y, _v);
      const petals = 5 + ((i * 3) % 3);
      for (let p = 0; p < petals; p++) {
        _q.setFromEuler(new THREE.Euler(-0.5, (p / petals) * TAU + a, 0, 'YXZ'));
        _sc.setScalar(sz);
        soft.add(protos.petal, _m4.compose(_v, _q, _sc), warm ? PAL.flower : PAL.flowerAlt,
          { keep: true, sway: 0.16 });
      }
      _sc.setScalar(sz * 0.26);
      soft.add(protos.core, _m4.compose(_v, _q.identity(), _sc), PAL.mushroomStem,
        { keep: true, sway: 0.16 });
    }
    for (let i = 0; i < [4, 7, 10][t]; i++) {
      const a = trunkAzimuth(S(i * 137 + 1) > 0.5 ? 1 : -1, S(i * 137 + 2), 0.12);
      const y = (S(i * 137 + 3) - 0.5) * BAND_H * 0.92;
      polar(a, TRUNK_R - 0.7, y, _v);    // tufts sit on the trunk, same rule
      for (let k = 0; k < 3; k++) {
        _q.setFromEuler(new THREE.Euler(1.15, a + k * 1.05, 0, 'YXZ'));
        _sc.set(1, 0.7 + S(i * 137 + 4 + k) * 0.9, 1);
        soft.add(protos.tuft, _m4.compose(_v, _q, _sc), PAL.mossLight,
          { keep: true, sway: (lx, ly) => ly * 0.5 });
      }
    }

    /* --- background leaves, instanced ---------------------------------- */
    const nLeaf = [50, 100, 160][t];
    const leaves = new THREE.InstancedMesh(this._blade, this.mLeaf, nLeaf);
    leaves.castShadow = false;
    leaves.receiveShadow = false;
    // Leaves grow in sprays off a twig, not one at a time in open air, and the
    // eye reads a spray as foliage where it reads the same blades spread evenly
    // as debris. So instances come in clumps of `PER_CLUMP` sharing one anchor
    // on a bough, with only a tight jitter around it. The handful that are not
    // on a bough stay close to the trunk and small — they are the far canopy
    // seen edge-on, not litter hanging in the sky.
    const PER_CLUMP = 4;
    for (let i = 0; i < nLeaf; i++) {
      const clump = (i / PER_CLUMP) | 0;
      const onBough = clump % 7 !== 6;
      if (onBough) {
        const c = boughs[clump % boughs.length];
        // Sample away from the trunk end so clumps sit out along the limb.
        c.getPointAt(0.28 + ((clump * 0.317) % 1) * 0.70, _v);
        _v.x += (hash01(slot * 31 + i * 5 + 1) - 0.5) * 2.2;
        _v.y += (hash01(slot * 31 + i * 5 + 2) - 0.5) * 1.5;
        _v.z += (hash01(slot * 31 + i * 5 + 3) - 0.5) * 2.2;
      } else {
        const a = (hash01(slot * 31 + clump * 5 + 4) > 0.5 ? 1 : -1) *
          (PLACE_MIN_A + hash01(slot * 31 + clump * 5 + 5) * 1.2);
        const r = TRUNK_R + 1.5 + hash01(slot * 31 + clump * 5 + 6) * 7;
        polar(a, r, (hash01(slot * 31 + clump * 5 + 7) - 0.5) * BAND_H, _v);
        _v.x += (hash01(slot * 31 + i * 5 + 1) - 0.5) * 2.0;
        _v.y += (hash01(slot * 31 + i * 5 + 2) - 0.5) * 1.4;
        _v.z += (hash01(slot * 31 + i * 5 + 3) - 0.5) * 2.0;
      }
      // Blades in one spray share a fan direction and differ only a little, so
      // the clump has a heading instead of looking like a shaken box.
      const fan = hash01(clump * 23 + slot + 2) * TAU;
      _q.setFromEuler(new THREE.Euler(
        (hash01(i * 17 + slot + 1) - 0.5) * 1.1,
        fan + (hash01(i * 17 + slot + 2) - 0.5) * 1.6,
        (hash01(i * 17 + slot + 3) - 0.5) * 0.9, 'YXZ'));
      const s = (onBough ? 1.05 : 0.8) + hash01(i * 17 + slot + 4) * 1.35;
      _sc.set(s, s, s);
      leaves.setMatrixAt(i, _m4.compose(_v, _q, _sc));
      _col.set(PAL.stem)
        .offsetHSL((hash01(i * 17 + slot + 5) - 0.5) * 0.08, 0, (hash01(i * 17 + slot + 6) - 0.5) * 0.22);
      leaves.setColorAt(i, _col);
    }
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    leaves.computeBoundingSphere();
    band.add(leaves);

    const gs = solid.build();
    if (gs) {
      this._geos.push(gs);
      const m = new THREE.Mesh(gs, this.mBarkFar);
      m.castShadow = false; m.receiveShadow = false;
      band.add(m);
      band.userData.solid = m;
    }
    const gf = soft.build();
    if (gf) {
      this._geos.push(gf);
      const m = new THREE.Mesh(gf, this.mSoftFar);
      m.castShadow = false; m.receiveShadow = false;
      band.add(m);
      band.userData.soft = m;
    }
    band.userData.leaves = leaves;
    band.userData.leafMax = nLeaf;

    this.descentLayers.add(band);
    this._dressBand(band);
    return band;
  }

  /**
   * Re-dress a band that has just wrapped. Mirroring and a small spin change
   * the silhouette completely for free; both preserve the clear wedge, because
   * the wedge is symmetric about the leaf axis and the spin is bounded.
   */
  _dressBand(band) {
    const ud = band.userData;
    const n = ud.slot * 131 + ud.pass * 977;
    band.rotation.y = (hash01(n + 1) - 0.5) * 2 * BAND_SPIN;
    band.scale.x = hash01(n + 2) > 0.5 ? 1 : -1;
    ud.yOff = (hash01(n + 3) - 0.5) * 9;
    if (ud.soft) ud.soft.visible = hash01(n + 4) > 0.15;
    if (ud.solid) ud.solid.visible = hash01(n + 5) > 0.08;
    ud.leaves.count = Math.max(4, Math.floor(ud.leafMax * (0.45 + hash01(n + 6) * 0.55)));
  }

  /* ------------------------------------------------------------------ *
   * Parallax canopy shells
   * ------------------------------------------------------------------ */

  _buildShells() {
    const texA = canopyTexture(7);
    const texB = canopyTexture(4211);
    if (!texA || !texB) return;
    this._tex = [texA, texB];

    const count = this.tier === 0 ? 3 : 4;
    const R = [34, 54, 80, 116];
    // Tall enough that the open cylinder's bottom rim never rises into frame.
    // The shells ride the camera, so the near shell's rim sat a fixed 39 m below
    // it at a radius of 34 — only 49° down. Pitch the camera into a descent and
    // that circle cuts across the picture as a long arc, canopy on one side and
    // bare fog on the other. Doubling the height puts every rim past 70° down,
    // outside any pose the director uses.
    const H = [170, 220, 300, 380];
    const REP = [5, 4, 3.2, 2.6];
    // How much of the camera's descent each shell inherits. Near shells keep
    // little and therefore stream past; far shells keep most and barely move.
    const PARA = [0.30, 0.55, 0.74, 0.88];

    for (let i = 0; i < count; i++) {
      // The camera stands *inside* these shells, so the half we keep is the far
      // half — theta = 0 is +z, and the wall we actually look at is at theta = pi.
      const g = new THREE.CylinderGeometry(R[i], R[i], H[i], [16, 22, 30][this.tier], 3, true,
        Math.PI - 1.9, 3.8);
      this._geos.push(g);
      const tex = (i % 2 ? texB : texA).clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(REP[i], H[i] / SHELL_TILE);
      tex.offset.set(i * 0.31, i * 0.17);
      const mat = this._mat(new THREE.MeshBasicMaterial({
        map: tex, transparent: true, alphaTest: 0.38, side: THREE.DoubleSide,
        fog: true, depthWrite: true,
      }));
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `canopy${i}`;
      mesh.position.z = TRUNK_Z;
      mesh.rotation.y = (i - 1.5) * 0.12;
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.renderOrder = -10 + i;
      this.group.add(mesh);
      this._shells.push({
        mesh, mat, para: PARA[i], depth: i / (count - 1),
        baseRot: mesh.rotation.y, baseOff: tex.offset.y,
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * God rays
   * ------------------------------------------------------------------ */

  _buildGodrays() {
    const acc = new GeoAcc({ alpha: true });
    const n = [3, 5, 7][this.tier];
    // A shaft is two crossed tapered sheets. Additive with the edges faded in
    // vertex alpha reads as volume from anywhere the camera ever stands, and
    // costs nothing next to a real cone.
    const sheet = new THREE.PlaneGeometry(1, 1, 2, 3);
    for (let i = 0; i < n; i++) {
      // Rays add light rather than block it, but a bright additive slab over the
      // board still competes with the beetles — so they keep to the same wedge.
      const a = (hash01(i * 61 + 1) > 0.5 ? 1 : -1) * (PLACE_MIN_A + hash01(i * 61 + 2) * 1.5);
      const r = TRUNK_R + 4 + hash01(i * 61 + 3) * 20;
      const y = (hash01(i * 61 + 4) - 0.5) * 52;
      const len = 22 + hash01(i * 61 + 5) * 26;
      const wid = 2.4 + hash01(i * 61 + 6) * 4.5;
      polar(a, r, y, _v);
      for (let k = 0; k < 2; k++) {
        _q.setFromEuler(new THREE.Euler(0, k * Math.PI * 0.5 + a, 0.10 + hash01(i * 61 + 7) * 0.22, 'YXZ'));
        _sc.set(wid, len, 1);
        acc.add(sheet, _m4.compose(_v, _q, _sc), 0xffffff, {
          keep: true,
          alpha: (lx, ly) => (1 - Math.abs(lx) * 2) * (0.72 - ly * 0.62) * 0.85,
        });
      }
    }
    sheet.dispose();
    const g = acc.build();
    if (!g) return;
    this._geos.push(g);
    const mesh = new THREE.Mesh(g, this.mRay);
    mesh.name = 'godrays';
    mesh.position.z = TRUNK_Z;
    mesh.renderOrder = 6;
    mesh.castShadow = false; mesh.receiveShadow = false;
    this.group.add(mesh);
    this.godrays = mesh;
  }

  /* ------------------------------------------------------------------ *
   * Waterfall + silk
   * ------------------------------------------------------------------ */

  _buildWaterfall() {
    const tex = waterTexture();
    if (!tex) return;
    this._waterTex = tex;
    this._waterScroll = 0;
    const g = new THREE.PlaneGeometry(15, WATER_H, 3, 6);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, -Math.abs(x) * 0.22);   // a shallow bow, so it is not a slab
    }
    g.computeVertexNormals();
    this._geos.push(g);
    const mat = this._mat(new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide, fog: true, color: PAL.water,
    }));
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'waterfall';
    // Thirty metres out from the trunk axis, past the trunk's left flank, which
    // puts it 48.6 m from the camera at the sanctuary. It used to stand at 56.6 m
    // and 75.4 m respectively, and that was too far to be a thing rather than a
    // colour: the fall only fades in from Dew Hollow down, and those are the
    // zones with the tightest fog — `fogFar` is 76 m in Lantern Deep and 68 m in
    // the Ancient Heart — so out there it was not distant, it was the fog itself.
    // Pulling it in swung its azimuth from -2.52 to -2.38 rad off the leaf
    // direction (+z). Both are far outside the `PLACE_MIN_A` keep-out (1.25 rad,
    // 0.97 once a band has spun), so the fall still stands well to the side of
    // the board and never hangs behind the play surface.
    //
    // The nearest canopy shell is a cylinder of R = 34 about the same axis, and
    // all but the outer metre of the fall's 15 m width is inside it: the far edge
    // crosses R = 34 at local x = -6.5 and its corner stands 0.63 m proud. Over
    // that last metre a leaf texel that survives the shell's `alphaTest` can bite
    // into the fall, because the shell writes depth and draws first; over the
    // other fourteen nothing foliage can depth-test in front of it. Band boughs
    // are kept off it by `BOUGH_MAX_R` rather than by luck.
    mesh.position.set(WATER_X, 0, WATER_Z);
    mesh.rotation.y = WATER_ROT;
    mesh.renderOrder = -2;
    mesh.castShadow = false; mesh.receiveShadow = false;
    this.group.add(mesh);
    this.waterfall = mesh;
    this._waterMat = mat;
  }

  _buildSilk() {
    const P = [], C = [];
    const push = (x, y, z, a) => { P.push(x, y, z); C.push(1, 1, 1, a); };
    for (let i = 0; i < 7; i++) {
      const a0 = (hash01(i * 181 + 1) > 0.5 ? 1 : -1) * (PLACE_MIN_A + hash01(i * 181 + 2) * 1.1);
      const r0 = TRUNK_R + hash01(i * 181 + 3) * 3;
      const y0 = (hash01(i * 181 + 4) - 0.5) * 34;
      const r1 = r0 + 5 + hash01(i * 181 + 5) * 12;
      const y1 = y0 - 3 - hash01(i * 181 + 6) * 9;
      const a1 = a0 + (hash01(i * 181 + 7) - 0.5) * 0.6;
      // Sag it in three spans so a strand reads as thread, not wire.
      let px = 0, py = 0, pz = 0;
      for (let k = 0; k <= 3; k++) {
        const t = k / 3;
        polar(lerp(a0, a1, t), lerp(r0, r1, t), lerp(y0, y1, t) - 4 * t * (1 - t) * 1.1, _v);
        if (k > 0) { push(px, py, pz, 0.65 - t * 0.35); push(_v.x, _v.y, _v.z, 0.65 - t * 0.35); }
        px = _v.x; py = _v.y; pz = _v.z;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
    g.computeBoundingSphere();
    this._geos.push(g);
    const lines = new THREE.LineSegments(g, this.mSilk);
    lines.name = 'silk';
    lines.position.z = TRUNK_Z;
    lines.renderOrder = 5;
    this.group.add(lines);
    this.silk = lines;
  }

  /* ------------------------------------------------------------------ *
   * Zones
   * ------------------------------------------------------------------ */

  setZone(zoneIndex, immediate) {
    const next = zoneFor(zoneIndex | 0);
    zoneCopy(this._zCur, this._zFrom);
    this._zTo = next;
    this.zone = next.id;
    this._zoneDur = immediate ? 0 : 1.2;
    this._zoneT = immediate ? 1 : 0;
    if (this._lighting && this._lighting.setZone) this._lighting.setZone(next, immediate ? 0 : 1.2);
    if (this.ok) this._applyZone();
  }

  _applyZone() {
    const k = easeInOutCubic(clamp01(this._zoneT));
    const z = mixZone(this._zFrom, this._zTo, k, this._zCur);
    const deep = clamp01(z.id / 7);

    _c1.setHex(z.hazeTop);
    this.mBark.color.copy(WHITE).lerp(_c1, 0.24 + deep * 0.30);
    this._uni.uMossGlow.value = deep * deep * 0.85;
    _c2.setHex(z.glow);
    this._uni.uMossTint.value.set(_c2.r, _c2.g, _c2.b);

    _c2.setHex(z.leafTop);
    this.mSoft.color.copy(WHITE).lerp(_c2, 0.42);
    this.mLeaf.color.copy(WHITE).lerp(_c2, 0.30).lerp(_c1.setHex(z.leafBack), 0.22);

    // Aerial perspective on the parallax bands. The haze is the fog colour added,
    // not mixed, so it lifts the shadow side much further than the lit side —
    // depth reads as loss of contrast rather than as a wash. Eased off as the
    // tree darkens, because the deep zones are supposed to keep their blacks.
    this.mBarkFar.color.copy(this.mBark.color);
    this.mSoftFar.color.copy(this.mSoft.color);
    const haze = lerp(0.20, 0.09, deep);
    _c1.setHex(z.fog);
    this.mBarkFar.emissive.copy(_c1);
    this.mBarkFar.emissiveIntensity = haze;
    this.mSoftFar.emissive.copy(_c1);
    this.mSoftFar.emissiveIntensity = haze * 0.8;

    for (let i = 0; i < this._shells.length; i++) {
      const s = this._shells[i];
      // Aerial perspective: near foliage is the deep saturated green, distance
      // washes it out. `depth` is 0 at the *nearest* shell, so the near end of
      // the ramp is hazeBot and the far end hazeTop — the other way round and
      // the closest layer is the palest thing on screen, which reads as haze
      // sitting in front of the tree.
      s.mat.color.setHex(z.hazeBot).lerp(_c2.setHex(z.hazeTop), s.depth * 0.9);
      // Far shells lift toward the fog colour so they dissolve rather than end.
      s.mat.color.lerp(_c1.setHex(z.fog), s.depth * 0.45);
    }

    this.mRay.color.setHex(z.glow);
    this.mRay.opacity = lerp(0.42, 0.26, deep) * this._motion;
    this.mSilk.color.setHex(z.rim);

    if (this._waterMat) {
      this._waterMat.color.setHex(z.rim).lerp(_c2.setHex(PAL.water), 0.6);
      // The waterfall is a thing you hear before you see; it only appears once
      // the tree turns wet, around Dew Hollow.
      this._waterOpacity = sstep(3.2, 5.6, z.id) * 0.55;
    }

    if (this.scene.fog !== undefined && this._ownsFog()) {
      if (!this.scene.fog) this.scene.fog = new THREE.Fog(z.fog, z.fogNear, z.fogFar);
      this.scene.fog.color.setHex(z.fog);
      if (this.scene.fog.near !== undefined) {
        this.scene.fog.near = z.fogNear;
        this.scene.fog.far = z.fogFar;
      }
    }
  }

  /** lighting.js is authoritative when it exists; otherwise the world drives it. */
  _ownsFog() {
    const ud = this.scene.userData;
    return !ud || ud.mossfallFogOwner !== 'lighting';
  }

  /* ------------------------------------------------------------------ *
   * Local set-dressing
   * ------------------------------------------------------------------ */

  /**
   * Anchor this leaf to the tree: the branch it grows from, the stem that joins
   * them, and a little life around the edges. Everything obeys the keep-out
   * rule at the top of the file — behind the far rim, or out past the side rims
   * and below the blade — so the play surface is never touched.
   */
  buildFor(level) {
    if (!this.ok || !level) return;
    try {
      this._clearLocal();
      const board = level.board || {};
      const R = boardRadius(board);

      // Every leaf hangs at its own height in the tree (`origin` in
      // src/data/levels.js — the same value director.js gives the board root
      // and camera.js frames against). The near dressing belongs to *this*
      // leaf, so it travels with it; the trunk behind does not, because it is
      // tiled around the camera and is the same trunk at every height.
      const org = level.origin || ZERO3;
      const ox = +org.x || 0, oy = +org.y || 0, oz = +org.z || 0;
      this.local.position.set(ox, oy, oz);
      const seed = ((level.index | 0) + 1) * 613;
      const S = (n) => hash01(seed + n);

      const solid = new GeoAcc();
      const soft = new GeoAcc({ sway: true });

      /* --- the branch this leaf grows from ---------------------------- */
      const tipZ = -(R + 0.45);
      const branch = new THREE.CatmullRomCurve3([
        new THREE.Vector3(1.6, -3.4, TRUNK_Z + TRUNK_R * 0.8),
        new THREE.Vector3(0.9, -2.3, -8.2),
        new THREE.Vector3(0.3, -1.35, -6.0),
        new THREE.Vector3(0.0, -0.82, tipZ),
      ], false, 'catmullrom', 0.4);
      const bg = tubeGeometry(branch, [10, 14, 18][this.tier], [6, 7, 9][this.tier],
        (u) => lerp(0.62, 0.24, u * u));
      solid.add(bg, _m4.identity(), (lx, ly, lz, out) => {
        const n = valueNoise2(lx * 1.4 + lz * 0.6, ly * 1.8);
        out.set(PAL.bark).lerp(_c2.set(PAL.moss), clamp01(0.3 + n) * 0.6);
      });

      /* --- the stem: branch tip to the blade's underside --------------- */
      const stem = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.82, tipZ),
        new THREE.Vector3(0, -0.46, tipZ + 0.35),
        new THREE.Vector3(0, -0.16, -(R - 0.55)),
      ], false, 'catmullrom', 0.4);
      const sg = tubeGeometry(stem, 8, 6, (u) => lerp(0.17, 0.09, u));
      solid.add(sg, _m4.identity(), PAL.stem);

      /* --- props resting on the branch, all behind the far rim --------- */
      const shelf = shelfGeometry(), gill = gillGeometry();
      const petal = petalGeometry(), tuft = tuftBladeGeometry();
      const core = new THREE.SphereGeometry(1, 6, 4);
      const rock = new THREE.IcosahedronGeometry(1, 0);

      for (let i = 0; i < 3; i++) {
        const u = 0.24 + S(i * 13 + 1) * 0.5;
        branch.getPointAt(u, _v);
        _v.y += 0.42;
        _v.x += (S(i * 13 + 2) - 0.5) * 0.9;
        const w = 0.3 + S(i * 13 + 3) * 0.28;
        _q.setFromAxisAngle(UP, S(i * 13 + 4) * TAU);
        _sc.set(w, w, w);
        _m4.compose(_v, _q, _sc);
        solid.add(shelf, _m4, PAL.mushroomCap, { keep: true });
        solid.add(gill, _m4, PAL.mushroomStem, { keep: true });
      }

      // Acorn cap and a pebble, tucked against the branch.
      branch.getPointAt(0.62, _v);
      _v.y += 0.34; _v.x -= 0.55;
      _sc.setScalar(0.2);
      solid.add(rock, _m4.compose(_v, _q.setFromAxisAngle(UP, 1.1), _sc), PAL.seed, { keep: true });
      branch.getPointAt(0.48, _v);
      _v.y += 0.26; _v.x += 0.72;
      _sc.set(0.16, 0.12, 0.18);
      solid.add(rock, _m4.compose(_v, _q.setFromAxisAngle(UP, 2.4), _sc), PAL.soil, { keep: true });

      /* --- flowers and grass, out past the side rims and below --------- */
      for (let i = 0; i < 4; i++) {
        const side = i % 2 ? 1 : -1;
        const x = side * (R + 1.1 + S(i * 29 + 1) * 1.7);
        const zz = -1.2 - S(i * 29 + 2) * 3.4;
        const y = -0.85 - S(i * 29 + 3) * 1.1;
        _v.set(x, y, zz);
        const sz = 0.30 + S(i * 29 + 4) * 0.2;
        const petals = 5;
        for (let p = 0; p < petals; p++) {
          _q.setFromEuler(new THREE.Euler(-0.55, (p / petals) * TAU + i, 0, 'YXZ'));
          _sc.setScalar(sz);
          soft.add(petal, _m4.compose(_v, _q, _sc),
            i % 2 ? PAL.flower : PAL.flowerAlt, { keep: true, sway: 0.09 });
        }
        _sc.setScalar(sz * 0.28);
        soft.add(core, _m4.compose(_v, _q.identity(), _sc), PAL.petal, { keep: true, sway: 0.09 });
      }
      for (let i = 0; i < 7; i++) {
        const side = i % 2 ? 1 : -1;
        _v.set(side * (R + 0.75 + S(i * 41 + 1) * 2.6), -1.0 - S(i * 41 + 2) * 0.9,
          -0.4 - S(i * 41 + 3) * 4.2);
        for (let k = 0; k < 3; k++) {
          _q.setFromEuler(new THREE.Euler(0.2, S(i * 41 + 4) * TAU + k * 1.05, 0, 'YXZ'));
          _sc.set(0.9, 0.55 + S(i * 41 + 5 + k) * 0.5, 0.9);
          soft.add(tuft, _m4.compose(_v, _q, _sc), PAL.mossLight,
            { keep: true, sway: (lx, ly) => ly * 0.45 });
        }
      }
      // A few leaves on the branch, behind the blade, for depth at the far rim.
      for (let i = 0; i < 5; i++) {
        branch.getPointAt(0.15 + S(i * 59 + 1) * 0.55, _v);
        _v.y += 0.2 + S(i * 59 + 2) * 0.5;
        _v.x += (S(i * 59 + 3) - 0.5) * 2.4;
        _v.z -= 0.3 + S(i * 59 + 4) * 1.4;
        _q.setFromEuler(new THREE.Euler(-0.5 - S(i * 59 + 5) * 0.5, S(i * 59 + 6) * TAU, 0, 'YXZ'));
        _sc.setScalar(0.7 + S(i * 59 + 7) * 0.5);
        soft.add(this._blade, _m4.compose(_v, _q, _sc), PAL.stem,
          { keep: true, sway: (lx, ly, lz) => clamp01(lz) * 0.5 });
      }

      shelf.dispose(); gill.dispose(); petal.dispose();
      tuft.dispose(); core.dispose(); rock.dispose();

      const gs = solid.build();
      if (gs) {
        const m = new THREE.Mesh(gs, this.mBark);
        m.castShadow = true;      // the nearest branch is allowed to cast
        m.receiveShadow = true;   // and to take the leaf's shadow
        this.local.add(m);
      }
      const gf = soft.build();
      if (gf) {
        const m = new THREE.Mesh(gf, this.mSoft);
        m.castShadow = false; m.receiveShadow = true;
        this.local.add(m);
      }

      // Put the burrow light where the level says the target burrow is.
      if (this._lighting && this._lighting.setBurrow) {
        const holes = (board.holes || []);
        let h = null;
        for (let i = 0; i < holes.length; i++) if (holes[i].target) { h = holes[i]; break; }
        if (h) {
          this._lighting.setBurrow((h.x || 0) + ox, oy, (h.z || 0) + oz,
            null, 2.2 + (h.glow || 1) * 0.8);
        }
      }
      if (this._lighting && this._lighting.focusOn) this._lighting.focusOn(ox, oy, oz, R + 0.8);
    } catch (err) {
      console.error('[world] buildFor failed, leaving the stage bare:', err);
    }
  }

  _clearLocal() {
    for (let i = this.local.children.length - 1; i >= 0; i--) {
      const c = this.local.children[i];
      if (c.geometry) c.geometry.dispose();
      this.local.remove(c);
    }
  }

  /* ------------------------------------------------------------------ *
   * Frame
   * ------------------------------------------------------------------ */

  update(dt, elapsed, camY) {
    if (!this.ok) return;
    const y = typeof camY === 'number' ? camY : (camY && camY.y) || 0;
    this._camY = y;
    const mo = this._motion;

    /* --- wind: two slow noise reads drive the whole plant kingdom ----- */
    this._windT += dt * mo;
    const wt = this._windT;
    const gust = 0.42 + 0.58 * clamp01(0.5 + 0.5 * valueNoise2(wt * 0.075, 3.3));
    const dir = valueNoise2(wt * 0.042, 9.1) * 1.0;
    const w = this._uni.uWind.value;
    w.set(Math.sin(dir) * 0.26 * gust * mo, Math.cos(dir) * 0.09 * gust * mo,
      0.09 * gust * mo, 0.85 + 0.55 * gust);
    this._uni.uTime.value = elapsed;

    /* --- zone cross-fade --------------------------------------------- */
    if (this._zoneT < 1) {
      this._zoneT = this._zoneDur > 0 ? Math.min(1, this._zoneT + dt / this._zoneDur) : 1;
      this._applyZone();
    }

    /* --- trunk tiles: teleport by a whole period, which is invisible --- */
    if (this.trunk) {
      const base = Math.round(y / TRUNK_H) * TRUNK_H;
      this.trunk.position.y = base;
      // The seam is genuinely invisible: `_wrapped` fades every noise field into
      // its own value one tile lower, so the field at the top of a tile equals
      // the field at the bottom, and the lathe profile is built from
      // sin((y / TRUNK_H) * TAU), which is periodic over exactly one tile. The
      // hollows are kept 11 m clear of both ends for the same reason.
      if (this.trunkB) this.trunkB.position.y = base + (y >= base ? TRUNK_H : -TRUNK_H);
    }

    /* --- band treadmill ---------------------------------------------- */
    const top = y + COLUMN_H * 0.34;
    for (let i = 0; i < this._bands.length; i++) {
      const b = this._bands[i];
      const ud = b.userData;
      let moved = false;
      while (ud.baseY > top) { ud.baseY -= COLUMN_H; ud.pass++; moved = true; }
      while (ud.baseY < top - COLUMN_H) { ud.baseY += COLUMN_H; ud.pass++; moved = true; }
      if (moved) this._dressBand(b);
      b.position.y = ud.baseY + ud.yOff;
    }

    /* --- parallax shells --------------------------------------------- */
    for (let i = 0; i < this._shells.length; i++) {
      const s = this._shells[i];
      // The shells ride the camera; the parallax lives in the map instead.
      // Standing them at a fixed fraction of the camera's Y only works near the
      // world origin — four hundred metres down, the nearest shell is placed a
      // hundred and fifty metres overhead and never comes back, and the frame
      // top is 10° below horizontal, so it is gone long before that. Sliding the
      // map by the residual (1 - para) of the descent reproduces the authored
      // rate exactly: a feature on the shell still rises (1 - para) metres past
      // the camera for every metre fallen. The map is RepeatWrapping in both
      // axes, so the offset can run for the whole game without a seam or a reset.
      s.mesh.position.y = y;
      if (s.mat.map) s.mat.map.offset.y = s.baseOff + (y * (1 - s.para)) / SHELL_TILE;
      // A whisper of rotation so the far canopy is never quite still. It has to
      // oscillate, not accumulate — an integrating drift would eventually swing
      // the open arc away from the camera and reveal the gap behind it.
      s.mesh.rotation.y = s.baseRot + Math.sin(elapsed * 0.031 + s.depth * 2.1) * 0.05 * (1 - s.depth) * mo;
    }

    /* --- god rays: drift, breathe, and treadmill on their own period -- */
    if (this.godrays) {
      this.godrays.position.y = Math.round(y / 60) * 60;
      this.godrays.rotation.y = Math.sin(elapsed * 0.037) * 0.06;
      this.mRay.opacity = (lerp(0.42, 0.26, clamp01(this.zone / 7)))
        * (0.78 + 0.22 * Math.sin(elapsed * 0.31)) * mo;
    }

    /* --- waterfall ---------------------------------------------------- */
    if (this.waterfall) {
      // Same treatment as the shells, and for the same reason: at 0.55 of the
      // camera's Y the fall climbed out of the top of frame around -115 m, while
      // `_waterOpacity` does not leave zero until Split Gallery at -189, so the
      // two windows never overlapped and this mesh had never been on screen.
      // Riding the camera and folding its 0.45 residual into the scroll keeps
      // the drift rate but makes it a permanent feature of the deep tree.
      this.waterfall.position.y = y;
      this._waterScroll -= dt * 0.42 * mo;
      if (this._waterScroll < -8) this._waterScroll += 8;
      this._waterTex.offset.y = this._waterScroll + (y * WATER_PARA) / WATER_H;
      const target = this._waterOpacity || 0;
      this._waterMat.opacity = damp(this._waterMat.opacity, target, 2.2, dt);
      this.waterfall.visible = this._waterMat.opacity > 0.01;
    }

    /* --- silk ---------------------------------------------------------- */
    if (this.silk) {
      this.silk.position.y = Math.round(y / 44) * 44;
      this.mSilk.opacity = 0.32 + 0.2 * Math.abs(Math.sin(elapsed * 0.23));
    }

    /* --- local dressing breathes with the same wind ------------------- */
    if (this.local.children.length) {
      this.local.rotation.z = Math.sin(elapsed * 0.34) * 0.004 * mo;
      this.local.rotation.x = Math.sin(elapsed * 0.27 + 1.1) * 0.003 * mo;
    }
  }

  /* ------------------------------------------------------------------ */

  dispose() {
    this._clearLocal();
    for (let i = 0; i < this._geos.length; i++) this._geos[i].dispose();
    for (let i = 0; i < this._mats.length; i++) {
      const m = this._mats[i];
      if (m.map) m.map.dispose();
      m.dispose();
    }
    if (this._tex) for (let i = 0; i < this._tex.length; i++) this._tex[i].dispose();
    if (this._waterTex) this._waterTex.dispose();
    for (let i = 0; i < this._bands.length; i++) {
      const b = this._bands[i];
      if (b.userData.leaves) b.userData.leaves.dispose();
    }
    this._geos.length = 0;
    this._mats.length = 0;
    this._bands.length = 0;
    this._shells.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.ok = false;
  }
}

/* ===================================================================== *
 * Helpers
 * ===================================================================== */

const UP = new THREE.Vector3(0, 1, 0);

const ZK_COLOR = ['fog', 'sun', 'ambient', 'rim', 'leafTop', 'leafBack', 'hazeTop', 'hazeBot', 'glow', 'moteColor'];
const ZK_NUM = ['id', 'fogNear', 'fogFar', 'sunInt', 'ambientInt', 'bloom'];

function zoneCopy(src, dst) {
  for (let i = 0; i < ZK_COLOR.length; i++) dst[ZK_COLOR[i]] = src[ZK_COLOR[i]];
  for (let i = 0; i < ZK_NUM.length; i++) dst[ZK_NUM[i]] = src[ZK_NUM[i]];
  return dst;
}

function mixZone(a, b, k, out) {
  for (let i = 0; i < ZK_COLOR.length; i++) {
    const key = ZK_COLOR[i];
    out[key] = _c1.setHex(a[key]).lerp(_c2.setHex(b[key]), k).getHex();
  }
  for (let i = 0; i < ZK_NUM.length; i++) {
    const key = ZK_NUM[i];
    out[key] = a[key] + (b[key] - a[key]) * k;
  }
  return out;
}

/**
 * LatheGeometry's winding depends on the profile's direction, and a trunk with
 * inward normals renders as a black hole. Rather than reason about it, check
 * one vertex against its own radial direction and flip if we guessed wrong.
 */
function fixOutward(g) {
  const pos = g.attributes.position, nrm = g.attributes.normal;
  let dot = 0;
  for (let i = 0; i < pos.count && i < 64; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const l = Math.hypot(x, z);
    if (l < 1e-4) continue;
    dot += (nrm.getX(i) * x + nrm.getZ(i) * z) / l;
  }
  if (dot >= 0) return;
  const idx = g.index;
  if (idx) {
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i]; arr[i] = arr[i + 2]; arr[i + 2] = t; }
    idx.needsUpdate = true;
  }
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  nrm.needsUpdate = true;
}

/** Conservative radius of a board, from the level spec alone — no Field needed. */
function boardRadius(board) {
  let R = 3.2;
  const shapes = (board && board.shapes) || [];
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    if (s.sub) continue;
    let d = 0;
    switch (s.kind) {
      case 'disc': d = Math.hypot(s.x || 0, s.z || 0) + (s.r || 1); break;
      case 'ellipse': d = Math.hypot(s.x || 0, s.z || 0) + Math.max(s.rx || 1, s.rz || 1); break;
      case 'capsule': d = Math.max(Math.hypot(s.ax || 0, s.az || 0), Math.hypot(s.bx || 0, s.bz || 0)) + (s.r || 0.5); break;
      case 'heart': d = Math.hypot(s.x || 0, s.z || 0) + (s.s || 3) * 0.75; break;
      case 'lobe': d = Math.hypot(s.x || 0, s.z || 0) + (s.r || 3) * 1.06; break;
      default: d = 0;
    }
    if (d > R) R = d;
  }
  return R + (board && board.smooth ? board.smooth : 0.3);
}

export default World;
