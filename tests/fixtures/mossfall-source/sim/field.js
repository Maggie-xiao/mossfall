/**
 * MOSSFALL — the leaf field.
 *
 * A leaf is two analytic functions over the board plane:
 *
 *   sdf(x,z)     signed distance to the blade outline — negative inside
 *   height(x,z)  the surface the beetles roll on: bowl, veins, rim curl, ripple
 *
 * Everything else derives from those two. The collision solver reads them, the
 * renderer *samples the same functions* to build the mesh, and the contact
 * shadow reuses the outline. There is no second description of the leaf anywhere
 * in the codebase, so the shape you see is provably the shape you roll on — the
 * usual source of "it looked like it should have gone in" is designed out.
 *
 * Shapes are combined with a polynomial smooth-min, which is what makes a blade
 * assembled from three ellipses read as one grown thing instead of a boolean.
 * Rim curl is derived *from the sdf itself*, so any outline — oval, heart,
 * insect-bitten — gets a lip that lifts in exactly the right place for free.
 * That lip is the game's wall: beetles are turned by geometry, not by an
 * invisible barrier, so the platform stays honest.
 */

import { clamp, clamp01, smin, smax, lerp, valueNoise2, segDist } from '../core/math.js';

/** Central-difference step. Small enough to be accurate, large enough that the
 *  ripple feature cannot alias into the gradient and buzz a resting beetle. */
const EPS = 0.014;
const INV_2EPS = 1 / (2 * EPS);

/** Hard ceiling on the slope organic surface noise may contribute. Must stay
 *  well under `PHYSICS_TUNING.restSlope` or resting beetles will drift. */
const RIPPLE_MAX_SLOPE = 0.027;

/* ===================================================================== *
 * Shape primitives — each returns a signed distance in board metres.
 * ===================================================================== */

function sdDisc(x, z, s) {
  return Math.hypot(x - s.x, z - s.z) - s.r;
}

function sdEllipse(x, z, s) {
  const dx = x - s.x, dz = z - s.z;
  const c = s._cos, sn = s._sin;
  const lx = dx * c + dz * sn;
  const lz = -dx * sn + dz * c;
  const q = lx / s.rx, w = lz / s.rz;
  const k = Math.hypot(q, w);
  // First-order distance estimate: (k-1) / |∇k|. Exact on the boundary, smooth
  // everywhere, and floored so the centre cannot divide by zero.
  const g = Math.max(Math.hypot(q / s.rx, w / s.rz), 1 / Math.max(s.rx, s.rz));
  return (k - 1) / g;
}

function sdCapsule(x, z, s) {
  return segDist(x, z, s.ax, s.az, s.bx, s.bz) - s.r;
}

/** Capsule with a different radius at each end — the pointed half of a leaf. */
function sdRoundCone(x, z, ax, az, bx, bz, ra, rb) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-12) return Math.hypot(x - ax, z - az) - Math.max(ra, rb);
  const t = clamp01(((x - ax) * dx + (z - az) * dz) / l2);
  const cx = ax + dx * t, cz = az + dz * t;
  return Math.hypot(x - cx, z - cz) - lerp(ra, rb, t);
}

/**
 * Heart-shaped blade: two lobes smooth-unioned with a tapering spine that runs
 * to the tip. `s` is the overall length; the notch between the lobes appears on
 * its own from the gap the smooth-min leaves.
 */
function sdHeart(x, z, s) {
  const dx = x - s.x, dz = z - s.z;
  const c = s._cos, sn = s._sin;
  const lx = (dx * c + dz * sn) / s.s;
  const lz = (-dx * sn + dz * c) / s.s;
  // The notch is the whole point of a heart, and it is easy to lose: the two
  // lobes have to overlap enough to be one blade, the spine has to reach up far
  // enough to carry weight, and each smin() rounds the crease a little more.
  // Previously the spine's wide end sat *above* where the lobes met, so the
  // centre was the highest part of the outline and the silhouette read as a
  // funnel. Now the lobes meet at lz = −0.30 and the spine stops at −0.24,
  // below them, with a tight blend so the dip survives into the rim curl.
  const lobe = 0.32;
  const a = Math.hypot(lx + 0.32, lz + 0.30) - lobe;
  const b = Math.hypot(lx - 0.32, lz + 0.30) - lobe;
  const spine = sdRoundCone(lx, lz, 0, 0.02, 0, 0.66, 0.26, 0.02);
  return smin(smin(a, b, 0.05), spine, 0.10) * s.s;
}

/** Radially modulated disc — soft scalloped outlines for older, weathered leaves. */
function sdLobe(x, z, s) {
  const dx = x - s.x, dz = z - s.z;
  const r = Math.hypot(dx, dz);
  if (r < 1e-5) return -s.r;
  const th = Math.atan2(dz, dx) + s.rot;
  const mod = 1 - s.depth * (0.5 + 0.5 * Math.cos(s.lobes * th));
  // The angular term breaks the Lipschitz bound; 0.75 keeps the estimate
  // conservative so Newton projection during meshing still converges.
  return (r - s.r * mod) * 0.75;
}

function shapeSdf(x, z, s) {
  switch (s.kind) {
    case 'disc': return sdDisc(x, z, s);
    case 'ellipse': return sdEllipse(x, z, s);
    case 'capsule': return sdCapsule(x, z, s);
    case 'heart': return sdHeart(x, z, s);
    case 'lobe': return sdLobe(x, z, s);
    default: return 1e6;
  }
}

function shapeAabb(s, out) {
  switch (s.kind) {
    case 'disc': out.minX = s.x - s.r; out.maxX = s.x + s.r; out.minZ = s.z - s.r; out.maxZ = s.z + s.r; break;
    case 'ellipse': {
      const m = Math.max(s.rx, s.rz);
      out.minX = s.x - m; out.maxX = s.x + m; out.minZ = s.z - m; out.maxZ = s.z + m; break;
    }
    case 'capsule':
      out.minX = Math.min(s.ax, s.bx) - s.r; out.maxX = Math.max(s.ax, s.bx) + s.r;
      out.minZ = Math.min(s.az, s.bz) - s.r; out.maxZ = Math.max(s.az, s.bz) + s.r; break;
    case 'heart':
      out.minX = s.x - s.s * 0.75; out.maxX = s.x + s.s * 0.75;
      out.minZ = s.z - s.s * 0.75; out.maxZ = s.z + s.s * 0.75; break;
    case 'lobe':
      out.minX = s.x - s.r * 1.06; out.maxX = s.x + s.r * 1.06;
      out.minZ = s.z - s.r * 1.06; out.maxZ = s.z + s.r * 1.06; break;
    default:
      out.minX = out.maxX = out.minZ = out.maxZ = 0;
  }
  return out;
}

/* ===================================================================== *
 * Height features
 * ===================================================================== */

/** Compact cosine window — C1, and exactly zero outside `r`, so a bump can
 *  never nudge a beetle resting on the far side of the leaf. */
function window1(d, r) {
  if (d >= r) return 0;
  return 0.5 + 0.5 * Math.cos((Math.PI * d) / r);
}

/** Distance from a point to a polyline, plus how far along it we are (0..1). */
function polyDist(x, z, pts, out) {
  let best = Infinity, bestU = 0;
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    let t = l2 > 1e-12 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0;
    t = clamp01(t);
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    if (d < best) { best = d; bestU = (i + t) / n; }
  }
  out.d = best; out.u = bestU;
  return out;
}

const _pd = { d: 0, u: 0 };

/* ===================================================================== *
 * Field
 * ===================================================================== */

export class Field {
  /**
   * @param {object} spec  `level.board` — { shapes, smooth, features, holes }
   */
  constructor(spec) {
    this.spec = spec || {};
    this.smooth = this.spec.smooth != null ? this.spec.smooth : 0.3;

    // Pre-bake per-shape trig and split additive from subtractive.
    this.add = [];
    this.sub = [];
    const shapes = this.spec.shapes || [];
    for (let i = 0; i < shapes.length; i++) {
      const s = Object.assign({}, shapes[i]);
      const rot = s.rot || 0;
      s._cos = Math.cos(rot); s._sin = Math.sin(rot);
      s.rot = rot;
      if (s.kind === 'lobe') { s.lobes = s.lobes || 5; s.depth = s.depth || 0.15; }
      (s.sub ? this.sub : this.add).push(s);
    }
    if (!this.add.length) this.add.push({ kind: 'disc', x: 0, z: 0, r: 3, _cos: 1, _sin: 0 });

    this.features = (this.spec.features || []).map((f) => {
      const g = Object.assign({}, f);
      if (g.pts && g.pts.length < 2) g.pts = null;
      if (g.kind === 'ripple') {
        // Value noise peaks at slope 3·amp·|scale|: the smoothstep fade tops out
        // at 1.5 and the [0,1]→[−1,1] remap doubles it. Left to a level author
        // that quietly climbs above the solver's static-friction threshold and
        // every "resting" beetle starts creeping. Clamp it here so no level file
        // can ever break the one behaviour the whole game depends on.
        //
        // Which only holds if the clamp reads `scale` the way `height()` does,
        // one screen down. A negative scale is a legal number that merely walks
        // the noise lattice backwards — the surface is just as steep — so it is
        // the magnitude that has to go into the budget. Fold the sign away
        // first, then apply the 0.4 floor, which is there so that a very flat
        // ripple cannot claim an amplitude large enough to swamp everything
        // else the height field is trying to say.
        const s = Math.max(Math.abs(g.scale || 1.5), 0.4);
        g.amp = Math.sign(g.amp || 0) * Math.min(Math.abs(g.amp || 0), (RIPPLE_MAX_SLOPE / 3) / s);
      }
      return g;
    });
    this.holes = (this.spec.holes || []).map((h, i) =>
      Object.assign({ id: `hole${i}`, r: 0.55, target: true, style: 'burrow', glow: 1 }, h));

    /* --- bounds --------------------------------------------------------- */
    const bb = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.add.length; i++) {
      shapeAabb(this.add[i], bb);
      if (bb.minX < minX) minX = bb.minX;
      if (bb.maxX > maxX) maxX = bb.maxX;
      if (bb.minZ < minZ) minZ = bb.minZ;
      if (bb.maxZ > maxZ) maxZ = bb.maxZ;
    }
    const pad = 0.25 + this.smooth;
    this.bounds = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
    this.size = Math.max(this.bounds.maxX - this.bounds.minX, this.bounds.maxZ - this.bounds.minZ);
    this.center = { x: (minX + maxX) * 0.5, z: (minZ + maxZ) * 0.5 };

    /* --- scratch (this class must never allocate in a hot path) --------- */
    this._grad = { hx: 0, hz: 0 };
    this._s = { sdf: 0, h: 0, hx: 0, hz: 0 };
  }

  /* ------------------------------------------------------------------ *
   * Outline
   * ------------------------------------------------------------------ */

  /** Signed distance to the blade outline. Negative inside. Holes excluded. */
  sdf(x, z) {
    const k = this.smooth;
    let d = shapeSdf(x, z, this.add[0]);
    for (let i = 1; i < this.add.length; i++) d = smin(d, shapeSdf(x, z, this.add[i]), k);
    for (let i = 0; i < this.sub.length; i++) d = smax(d, -shapeSdf(x, z, this.sub[i]), k * 0.8);
    return d;
  }

  /** Outline *with* the burrows punched out — what the mesh builder wants. */
  visualSdf(x, z) {
    let d = this.sdf(x, z);
    const hs = this.holes;
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      const hd = Math.hypot(x - h.x, z - h.z) - h.r;
      d = smax(d, -hd, 0.05);
    }
    return d;
  }

  /* ------------------------------------------------------------------ *
   * Surface
   * ------------------------------------------------------------------ */

  /** Surface height at a board point. */
  height(x, z) {
    let h = 0;
    const fs = this.features;
    let sd = null;   // sdf is only evaluated if a feature actually needs it
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      switch (f.kind) {
        case 'dish': {
          const d = Math.hypot(x - (f.x || 0), z - (f.z || 0));
          const t = clamp01(d / (f.r || 3));
          h += (f.amp || 0) * (1 - t * t);
          break;
        }
        case 'curl': {
          if (sd === null) sd = this.sdf(x, z);
          const w = f.width || 0.8;
          // 0 at `w` inside the rim, 1 at the rim. Squared, so the lip steepens
          // as it climbs — the beetle feels the wall arrive rather than hit it.
          const t = clamp01((sd + w) / w);
          h += (f.amp || 0) * t * t;
          break;
        }
        case 'vein': {
          if (!f.pts) break;
          polyDist(x, z, f.pts, _pd);
          const w = f.width || 0.3;
          if (_pd.d >= w) break;
          const taper = f.taper != null ? f.taper : 0.3;
          h += (f.amp || 0) * window1(_pd.d, w) * lerp(1, 1 - taper, _pd.u);
          break;
        }
        case 'ridge': {
          if (!f.pts) break;
          polyDist(x, z, f.pts, _pd);
          const w = f.width || 0.22;
          if (_pd.d >= w) break;
          // Flat-topped: a ridge you can rest on, with steep shoulders.
          const t = _pd.d / w;
          h += (f.amp || 0) * window1(t * t * w, w);
          break;
        }
        case 'bump': {
          const d = Math.hypot(x - (f.x || 0), z - (f.z || 0));
          h += (f.amp || 0) * window1(d, f.r || 0.5);
          break;
        }
        case 'slope':
          h += (f.ax || 0) * x + (f.az || 0) * z;
          break;
        case 'ripple': {
          const s = f.scale || 1.5;
          h += (f.amp || 0) * valueNoise2(x * s + 13.7, z * s + 4.1);
          break;
        }
        default: break;
      }
    }
    return h;
  }

  /** Just the vein/ridge contribution, normalised — the leaf shader's `aVein`. */
  veinAmount(x, z) {
    let v = 0;
    const fs = this.features;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if ((f.kind !== 'vein' && f.kind !== 'ridge') || !f.pts) continue;
      polyDist(x, z, f.pts, _pd);
      const w = (f.width || 0.3) * 1.35;
      if (_pd.d < w) v = Math.max(v, window1(_pd.d, w));
    }
    return v;
  }

  /** Central-difference slope of the surface. Writes into `out`. */
  gradient(x, z, out) {
    out = out || this._grad;
    out.hx = (this.height(x + EPS, z) - this.height(x - EPS, z)) * INV_2EPS;
    out.hz = (this.height(x, z + EPS) - this.height(x, z - EPS)) * INV_2EPS;
    return out;
  }

  /** Unit surface normal in board space. `outVec3` is any {x,y,z} holder. */
  normal(x, z, outVec3) {
    const g = this.gradient(x, z, this._grad);
    const inv = 1 / Math.sqrt(g.hx * g.hx + g.hz * g.hz + 1);
    outVec3.x = -g.hx * inv;
    outVec3.y = inv;
    outVec3.z = -g.hz * inv;
    return outVec3;
  }

  /** sdf + height + slope in one pass. The solver's inner loop calls only this. */
  sample(x, z, out) {
    out = out || this._s;
    const hc = this.height(x, z);
    out.sdf = this.sdf(x, z);
    out.h = hc;
    out.hx = (this.height(x + EPS, z) - this.height(x - EPS, z)) * INV_2EPS;
    out.hz = (this.height(x, z + EPS) - this.height(x, z - EPS)) * INV_2EPS;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Holes & queries
   * ------------------------------------------------------------------ */

  /** The burrow whose mouth contains this point, or null. */
  holeAt(x, z) {
    const hs = this.holes;
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      const dx = x - h.x, dz = z - h.z;
      if (dx * dx + dz * dz < h.r * h.r) return h;
    }
    return null;
  }

  holeById(id) {
    for (let i = 0; i < this.holes.length; i++) if (this.holes[i].id === id) return this.holes[i];
    return null;
  }

  /** Solid ground: inside the blade and not over an opening. */
  inside(x, z) {
    return this.sdf(x, z) < 0 && this.holeAt(x, z) === null;
  }

  /**
   * Nearest point with at least `margin` of solid ground around it. Used to put
   * a rescued beetle back somewhere it will not immediately roll off again.
   * Spiral search — deterministic, and it never fails because the level's own
   * start position is the fallback.
   */
  nearestSafe(x, z, margin = 0.45, fallback = null) {
    if (this._safeAt(x, z, margin)) return { x, z };
    for (let ring = 1; ring <= 14; ring++) {
      const rad = ring * 0.22;
      const steps = 6 + ring * 3;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2 + ring * 0.7;
        const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
        if (this._safeAt(px, pz, margin)) return { x: px, z: pz };
      }
    }
    return fallback || { x: this.center.x, z: this.center.z };
  }

  _safeAt(x, z, margin) {
    if (this.sdf(x, z) > -margin) return false;
    const hs = this.holes;
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      if (Math.hypot(x - h.x, z - h.z) < h.r + margin) return false;
    }
    return true;
  }

  /** Project a point onto the sdf=0 isoline. Two Newton steps is plenty. */
  projectToEdge(x, z, useVisual, out) {
    const f = useVisual ? this.visualSdf.bind(this) : this.sdf.bind(this);
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) {
      const d = f(px, pz);
      if (Math.abs(d) < 1e-4) break;
      const gx = (f(px + EPS, pz) - f(px - EPS, pz)) * INV_2EPS;
      const gz = (f(px, pz + EPS) - f(px, pz - EPS)) * INV_2EPS;
      const gl = Math.hypot(gx, gz);
      if (gl < 1e-5) break;
      px -= (d * gx) / (gl * gl);
      pz -= (d * gz) / (gl * gl);
    }
    out.x = px; out.z = pz;
    return out;
  }
}

/* ===================================================================== *
 * Mesh
 * ===================================================================== */

/**
 * Grid-sample the field, keep the cells that are inside the blade, snap the rim
 * vertices onto the sdf = 0 isoline, and extrude a thin underside so the leaf
 * reads as a physical object from the low camera.
 *
 * Because the vertices come from `field.height` and the normals from
 * `field.gradient`, the rendered surface *is* the collision surface — there is
 * no skinning, no baked mesh, nothing that can drift out of sync.
 *
 * Returns a plain description that `render/leaf.js` turns into a BufferGeometry,
 * so this file stays free of any three.js import and can be unit-tested in node.
 */
export function buildFieldMesh(field, opts = {}) {
  const res = Math.max(24, Math.min(220, opts.res || 96));
  const thickness = opts.thickness != null ? opts.thickness : 0.055;
  const edgeFade = opts.edgeFade != null ? opts.edgeFade : 0.75;
  const skirt = opts.skirt !== false;

  const b = field.bounds;
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const cell = Math.max(w, d) / res;
  const nx = Math.max(2, Math.ceil(w / cell)) + 1;
  const nz = Math.max(2, Math.ceil(d / cell)) + 1;

  // --- 1. sample the grid ------------------------------------------------
  const N = nx * nz;
  const gx = new Float32Array(N), gz = new Float32Array(N), gd = new Float32Array(N);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = b.minX + i * cell, z = b.minZ + j * cell;
      gx[k] = x; gz[k] = z; gd[k] = field.visualSdf(x, z);
    }
  }

  // --- 2. snap boundary-adjacent outside nodes onto the isoline ----------
  // A node that sits just outside but has an inside neighbour becomes a rim
  // vertex, which is what gives the silhouette its clean analytic curve
  // instead of a staircase.
  const _p = { x: 0, z: 0 };
  const snapped = new Uint8Array(N);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (gd[k] <= 0) continue;
      let touches = false;
      for (let dj = -1; dj <= 1 && !touches; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          if (gd[jj * nx + ii] <= 0) { touches = true; break; }
        }
      }
      if (!touches) continue;
      field.projectToEdge(gx[k], gz[k], true, _p);
      gx[k] = _p.x; gz[k] = _p.z; snapped[k] = 1;
    }
  }

  // --- 3. emit vertices for every used node ------------------------------
  const index = new Int32Array(N).fill(-1);
  const pos = [], nrm = [], uv = [], edge = [], vein = [];
  const nrmTmp = { x: 0, y: 0, z: 0 };

  const used = (k) => gd[k] <= 0 || snapped[k] === 1;

  for (let k = 0; k < N; k++) {
    if (!used(k)) continue;
    const x = gx[k], z = gz[k];
    const y = field.height(x, z);
    field.normal(x, z, nrmTmp);
    index[k] = pos.length / 3;
    pos.push(x, y, z);
    nrm.push(nrmTmp.x, nrmTmp.y, nrmTmp.z);
    uv.push((x - b.minX) / w, (z - b.minZ) / d);
    edge.push(clamp01(-field.sdf(x, z) / edgeFade));
    vein.push(field.veinAmount(x, z));
  }
  const topCount = pos.length / 3;

  // --- 4. triangles ------------------------------------------------------
  // A cell is emitted when at least three of its corners are usable; the two
  // diagonals are chosen to keep the shorter edge, which stops long slivers
  // forming along the rim.
  const tris = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, bb = a + 1, c = a + nx, e = c + 1;
      const ia = index[a], ib = index[bb], ic = index[c], ie = index[e];
      const n = (ia >= 0) + (ib >= 0) + (ic >= 0) + (ie >= 0);
      if (n < 3) continue;
      // Skip cells made entirely of snapped rim nodes — they are degenerate
      // slivers hugging the outline and add nothing but z-fighting.
      if (snapped[a] && snapped[bb] && snapped[c] && snapped[e]) continue;
      if (n === 4) {
        const d1 = Math.hypot(pos[ia * 3] - pos[ie * 3], pos[ia * 3 + 2] - pos[ie * 3 + 2]);
        const d2 = Math.hypot(pos[ib * 3] - pos[ic * 3], pos[ib * 3 + 2] - pos[ic * 3 + 2]);
        if (d1 <= d2) { tris.push(ia, ic, ie, ia, ie, ib); }
        else { tris.push(ia, ic, ib, ib, ic, ie); }
      } else {
        if (ia < 0) tris.push(ib, ic, ie);
        else if (ib < 0) tris.push(ia, ic, ie);
        else if (ic < 0) tris.push(ia, ie, ib);
        else tris.push(ia, ic, ib);
      }
    }
  }

  if (!skirt) {
    return {
      position: new Float32Array(pos), normal: new Float32Array(nrm),
      uv: new Float32Array(uv), aEdge: new Float32Array(edge),
      aVein: new Float32Array(vein), index: toIndex(tris, pos.length / 3),
      topCount, bounds: b, cell,
    };
  }

  // --- 5. underside + rim ------------------------------------------------
  // Mirror the top down by `thickness` with flipped winding, then stitch the
  // boundary edges (those belonging to exactly one triangle) into a rim band.
  for (let v = 0; v < topCount; v++) {
    pos.push(pos[v * 3], pos[v * 3 + 1] - thickness, pos[v * 3 + 2]);
    nrm.push(-nrm[v * 3], -nrm[v * 3 + 1], -nrm[v * 3 + 2]);
    uv.push(uv[v * 2], uv[v * 2 + 1]);
    edge.push(edge[v]);
    vein.push(vein[v] * 0.35);      // veins read as faint ribs from below
  }
  const bottomOf = (v) => v + topCount;

  const triCount = tris.length / 3;
  for (let t = 0; t < triCount; t++) {
    const a = tris[t * 3], bq = tris[t * 3 + 1], c = tris[t * 3 + 2];
    tris.push(bottomOf(a), bottomOf(c), bottomOf(bq));
  }

  const edgeMap = new Map();
  for (let t = 0; t < triCount; t++) {
    const v = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
    for (let e = 0; e < 3; e++) {
      const a = v[e], bq = v[(e + 1) % 3];
      const key = a < bq ? a * 1e7 + bq : bq * 1e7 + a;
      const rec = edgeMap.get(key);
      if (rec) rec.n++;
      else edgeMap.set(key, { a, b: bq, n: 1 });
    }
  }
  for (const rec of edgeMap.values()) {
    if (rec.n !== 1) continue;
    const a = rec.a, bq = rec.b, a2 = bottomOf(a), b2 = bottomOf(bq);
    tris.push(a, bq, b2, a, b2, a2);
  }

  return {
    position: new Float32Array(pos), normal: new Float32Array(nrm),
    uv: new Float32Array(uv), aEdge: new Float32Array(edge),
    aVein: new Float32Array(vein), index: toIndex(tris, pos.length / 3),
    topCount, bounds: b, cell,
  };
}

function toIndex(tris, vertexCount) {
  const A = vertexCount > 65535 ? Uint32Array : Uint16Array;
  return A.from(tris);
}

/** Ordered outline points, for the contact shadow and the hole rim decals. */
export function outlinePoints(field, steps = 128, useVisual = false) {
  const out = [];
  const c = field.center;
  const maxR = field.size;
  const _p = { x: 0, z: 0 };
  const f = useVisual ? (x, z) => field.visualSdf(x, z) : (x, z) => field.sdf(x, z);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    // March out until we leave the blade, then let Newton land us on the rim.
    let r = maxR;
    for (let s = 1; s <= 40; s++) {
      const t = (s / 40) * maxR;
      if (f(c.x + dx * t, c.z + dz * t) > 0) { r = t; break; }
    }
    field.projectToEdge(c.x + dx * r, c.z + dz * r, useVisual, _p);
    out.push(_p.x, _p.z);
  }
  return out;
}
