/**
 * TABLE TILT — snail obstacles (final art, 2026-08-17 spec).
 *
 * A05 ("Four-Blocker Leaf") stands four blockers on the leaf. They were
 * mushrooms, then stumps, then a first pass at snails; this is the signed-off
 * art: `snail-final-art-spec.md`. A snail a beetle bounces off ought to feel the
 * bounce, so each one still squashes, tips away from the impact and pulls its
 * eye stalks in before settling — none of that changed.
 *
 * WHAT THE SPEC CHANGED, AND WHY IT IS WORTH THE REWRITE
 *
 *   · **Ember**, not green. The body used to be a hand-mixed yellow-green that
 *     had to fight every zone's `leafTop` to stay visible. Ember is warm brown,
 *     so the silhouette separates from the blade by hue instead of by a
 *     lightness margin that the deep zones ate. §7: "软体不能与绿色叶面融在一起".
 *   · **Soft Suede**, not the ladybug's clearcoat. Roughness 0.98 with a broad
 *     sheen: the beetles keep the only glossy finish in the game and the snails
 *     read as matte pottery beside them. §3: no wet specular, no wax.
 *   · **One continuous body**, not a pile of spheres. §7 calls this out by name
 *     ("身体应为连续软体曲面，不使用多个相交球体拼接") and it is the reason
 *     `bodyGeometry()` below is a loft: a closed ring swept along a spine, so
 *     tail → foot → mantle → neck → head is one unbroken surface with no
 *     intersection creases to read as segmentation on the face.
 *   · **The spiral is a texture**, not a tube. It used to be two swept tubes
 *     that cost geometry, could not be thinned without going black, and pushed
 *     the shell's widest point around. §3: "壳保留一张螺线纹理。纹理只承担深浅
 *     细节，不改变壳的珊瑚红主色" — so it is a multiply map over a plain
 *     coral-red lens, planar-projected onto the two faces.
 *   · **Four builds, not one rotated four times.** §4 gives each blocker its own
 *     shell proportions, shell centre, body length/width, eye-stalk length and
 *     spread, and its own yaw. See PROFILES.
 *
 * WHERE THE NUMBERS COME FROM
 *
 * Not from here. `snail-final-art-preview.html` is the signed-off asset, and the
 * shapes below are a port of the builder inside it, not a second interpretation
 * of the spec's prose: the spline tables in BODY_SPLINES, the 24-over-12 section
 * ring, the mantle ellipsoid, the stalk curve and taper, the spiral canvas and
 * the `y <= 0.60` fit rule are all lifted from that file, and the four PROFILES
 * are its `2a`–`2d` records. Three things are deliberately *not* ported:
 *
 *   · the preview's alternative palettes (`1a`–`1e`, `2b`–`2d` colours). Its own
 *     caption says the swatches are for comparison only and the first Ember set
 *     is final, so all four blockers take `2a`'s colours and differ by shape.
 *   · the toon/outline branch, which the preview reaches only for variants
 *     "02"/"05"/"08" — those are its own catalogue ids, unrelated to A05.
 *   · the moss, which the preview merges into the *shell* accumulator. The moss
 *     blobs keep a sphere's own equirect UVs, so on the shell's material they
 *     would each pull the whole spiral across themselves. The preview only ever
 *     renders fresh, so it never showed. Here the moss goes in the body slot,
 *     same colours, no map to smear — and, unavoidably, *not* the same
 *     placement: the preview aims its two blobs at fixed fractions of `r` and
 *     `h`, which is only a surface on the swept tube those fractions were tuned
 *     against. Under the lens above they land inside the shell. See `_moss`.
 *
 * WHY THIS LIVES HERE AND NOT IN src/mossfall/render/props.js
 *
 * `src/mossfall` is a read-only vendored upstream (see patches/README.md and
 * src/mossfall/upstream-sha256.json — tests/leaf-platform-adapter.test.mjs
 * checksums every file in it). props.js has no `snail` case, so an obstacle
 * with `kind: 'snail'` falls through its `_buildObstacles` switch to the
 * `default:` arm and gets a throwaway pebble. This module lets that happen,
 * then takes the seat group over: the pebble mesh is disposed and replaced by
 * a snail built here. It is the same move as scene.js's `removeGodrays()` —
 * let upstream build, then edit the result.
 *
 * WHAT UPSTREAM KEEPS DOING FOR US
 *
 *   · The seat group stays registered in `props._statics`, so props.js's own
 *     `update()` keeps writing `group.position.y = base + flex(x, z)` every
 *     frame. The leaf's bow is free, and the wobble below never fights it
 *     because every animated transform hangs off a *child* node.
 *   · Geometries and materials built here are pushed into `props._geos` /
 *     `props._mats`, so `props.dispose()` releases them with everything else
 *     and scene.js's three teardown paths need no new code.
 *
 * Reaching into those private fields is deliberate and has precedent — see the
 * note above `blink()` in insect-presentation.js.
 *
 * THE SILHOUETTE AND THE COLLIDER
 *
 * physics.js flattens the obstacle to a disc of radius `r`, and props.js's
 * first rule is that the paint must be drawn to that disc. Spec §5 states the
 * same rule from the art side and adds the one exemption —
 *
 *   · nothing below y = 0.60 may overhang. The whole snail is authored in
 *     nominal proportions and then *measured* and fitted so its widest point in
 *     plan lands on `r` exactly. That widest point is the back of the shell, at
 *     the height of the shell's centre — i.e. inside the contact band, which is
 *     where it has to be true.
 *   · above y = 0.60 the shell crown and the eye stalks may flare. That is over
 *     the beetle's shoulder and cannot lie about a contact, and it is what buys
 *     the four silhouettes their 50–70 px of read (§7).
 *   · across the flanks the shell is a lens, and a lens cannot fill a circle.
 *     The spec caps that gap at 0.14 m; the fattened shell (0.68–0.82 r thick,
 *     up from 0.52) brings it in to about 0.10.
 *
 * `tests/board-snails.test.mjs` measures that gap against a real beetle profile
 * rather than trusting this note, so thinning the shell again goes red.
 *
 * Nothing about the collision itself changed — restitution and the rebound
 * clamp are exactly what the stumps had.
 */

import * as THREE from "three";
import { TAU, clamp, clamp01, lerp, sstep } from "../mossfall/core/math.js";

/* ===================================================================== *
 * Ember — spec §2
 *
 * The relationships matter more than the hexes: the body has to read warmer and
 * browner than any zone's leaf, and the shell has to stay coral-red rather than
 * cooking down to sauce-brown under ACES.
 * ===================================================================== */

const EMBER = {
  body: 0xb78b62,
  bodyLight: 0xd7b98d,
  bodyDark: 0x76543d,
  sole: 0x493326,
  shell: 0xd9694f,
  shellDark: 0x843829,
  eye: 0x2a1c12,
  pupil: 0x120c07,
  mossLight: 0x8fbc5f,
  mossDark: 0x4a6b2c,
};

/* Aged (spec §6): −28% saturation, −8% lightness, applied to the *same* palette
 * so C and D still read as Ember rather than as a second colour scheme. */
const AGED_SAT = 0.72;
const AGED_LIGHT = 0.92;

/* Soft Suede — spec §3. Sheen is what carries the whole finish: at roughness
 * 0.98 the base lobe is nearly flat, so the broad, weak sheen retro-reflection
 * is the only thing shaping the form. Body and shell get different sheen
 * colours (warm gray vs warm tan), which is why there are two materials. */
const SUEDE = {
  roughness: 0.98,
  metalness: 0.0,
  sheen: 1.0,
  sheenRoughness: 0.96,
  sheenBody: 0xc6b9a6,
  sheenShell: 0xe4b47b,
};

/* ===================================================================== *
 * The four builds — spec §4, and the preview's `2a`–`2d` records
 *
 * `shell`: half-extents sx/sz in units of the collider radius, sy in units of
 * the collider height, with the lens centre at cy/cz in the same units.
 * `body`: `long` stretches the spine in z, `fat` the half-widths, `head` the
 * front third only (§4 lists the first two; `head` is the preview's own extra
 * dial and is what keeps B's and D's faces slim while C's stays full).
 * `stalk`: `baseY`/`baseZ` plant it on the head, `len` is the rise in h,
 * `spread` the lateral opening in r, `rad` the root thickness, `eyeR` the ball.
 * `yaw`: degrees about +y. Part of the level's composition (§4) — not jitter,
 * and it must not be averaged away.
 * ===================================================================== */

const PROFILES = {
  BLOCK_01: {
    shell: { sx: 0.76, sy: 0.54, sz: 0.86, cy: 0.63, cz: -0.29 },
    body: { long: 1.08, fat: 0.98 },
    stalk: { baseY: 0.48, baseZ: 0.75, len: 0.66, spread: 0.25, rad: 0.062, eyeR: 0.12 },
    yaw: -64.2,
  },
  BLOCK_02: {
    shell: { sx: 0.70, sy: 0.62, sz: 0.82, cy: 0.69, cz: -0.31 },
    body: { long: 1.12, fat: 0.90, head: 0.96 },
    stalk: { baseY: 0.49, baseZ: 0.77, len: 0.75, spread: 0.23, rad: 0.055, eyeR: 0.115 },
    yaw: -115.7,
  },
  BLOCK_03: {
    shell: { sx: 0.82, sy: 0.50, sz: 0.94, cy: 0.60, cz: -0.34 },
    body: { long: 1.04, fat: 1.04, head: 1.02 },
    stalk: { baseY: 0.47, baseZ: 0.72, len: 0.62, spread: 0.28, rad: 0.064, eyeR: 0.125 },
    yaw: -81.9,
  },
  BLOCK_04: {
    shell: { sx: 0.68, sy: 0.56, sz: 0.80, cy: 0.64, cz: -0.27 },
    body: { long: 1.14, fat: 0.86, head: 0.94 },
    stalk: { baseY: 0.50, baseZ: 0.80, len: 0.70, spread: 0.21, rad: 0.052, eyeR: 0.11 },
    yaw: -102.0,
  },
};
const PROFILE_ORDER = ["BLOCK_01", "BLOCK_02", "BLOCK_03", "BLOCK_04"];

/**
 * The height the fit is measured under — spec §5's contact band top.
 *
 * The beetle is a 0.30 m ball with its centre at y = 0.30, so nothing it can
 * touch lives above y = 0.60; paint above that line cannot misreport a contact
 * and is the room §5 grants the shell crown and the eye stalks. The preview
 * passes this same 0.6 into its own `maxRadius`, which is why its stalks are
 * free to open as wide as they do without shrinking the shell.
 */
const FIT_Y = 0.6;

/* Damped spring: omega 16 rad/s at zeta 0.35 decays as e^(-5.6t), so a hit is
 * down to ~6% of its peak half a second later — a bounce you read, not a
 * wobble that outstays the collision. */
const OMEGA = 16;
const ZETA = 0.35;
const SUB_STEP = 1 / 120;     // fixed, so a long frame cannot destabilise it
const MAX_SUB_STEPS = 8;

/* Impulse -> peak is v0 * 0.0623 here: the undamped v0/OMEGA, times the 0.59
 * the envelope has already eaten by the time the first overshoot arrives. */
const SQUASH_KICK = 9.5;      // -> ~0.34 peak compression at full intensity
const LEAN_KICK = 5.4;        // -> ~0.20 rad peak tip
const FULL_HIT = 2.2;         // m/s that saturates the kick — measured, see hit()
const MAX_SQUASH = 0.42;      // props.js clamps its movers at the same value
const REST_X = 1.5e-3;        // below this the wobble is sub-pixel — see update()
const REST_V = 1.5e-2;

/* Module scratch. Nothing below allocates per frame. */
const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _n3 = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);
const _col = new THREE.Color();
/* Kept apart from `_col`: the colour callbacks run *inside* Acc.add, which is
 * already using `_col` for the flat-colour path. */
const _ca = new THREE.Color();
const _cb = new THREE.Color();

/* ===================================================================== *
 * Geometry accumulator
 *
 * props.js has one of these (`Acc`) but keeps it module-private, and three's
 * BufferGeometryUtils lives in examples/, which this project does not vendor.
 * So: the same trick, locally — a snail's parts merge into one indexed buffer
 * with the colour baked per vertex. Two material groups (body, shell) because
 * the spec gives the two surfaces different sheen colours and only the shell
 * carries the spiral map; everything else about them is identical.
 * ===================================================================== */

class Acc {
  constructor() {
    this.p = []; this.n = []; this.c = []; this.t = []; this.i = [];
    this.groups = [];
    this._mat = 0;
    this._start = 0;
  }

  get empty() { return this.p.length === 0; }

  /** Everything added from here on draws with material slot `index`. */
  use(index) {
    if (index === this._mat) return this;
    this._close();
    this._mat = index;
    return this;
  }

  _close() {
    const count = this.i.length - this._start;
    if (count > 0) this.groups.push({ start: this._start, count, mat: this._mat });
    this._start = this.i.length;
  }

  /**
   * @param geo    source geometry — always disposed, this is a bake. Its own uv
   *               attribute rides along if it has one; the shell sets that
   *               attribute itself, to planar-project the spiral onto its faces.
   * @param m      placement matrix
   * @param color  a hex/THREE.Color, or `(position, normal) => THREE.Color`
   */
  add(geo, m, color) {
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const idx = geo.index;
    const base = this.p.length / 3;
    const nm = _nm.getNormalMatrix(m);
    const shaded = typeof color === "function";
    if (!shaded) _col.set(color);
    for (let vi = 0; vi < pos.count; vi++) {
      _v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(m);
      this.p.push(_v.x, _v.y, _v.z);
      if (nrm) {
        _n3.set(nrm.getX(vi), nrm.getY(vi), nrm.getZ(vi))
          .applyMatrix3(nm).normalize();
      } else _n3.set(0, 1, 0);
      this.n.push(_n3.x, _n3.y, _n3.z);
      const c = shaded ? color(_v, _n3) : _col;
      this.c.push(c.r, c.g, c.b);
      this.t.push(uv ? uv.getX(vi) : 0.5, uv ? uv.getY(vi) : 0.5);
    }
    if (idx) for (let k = 0; k < idx.count; k++) this.i.push(base + idx.getX(k));
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
    geo.dispose();
    return this;
  }

  /**
   * Widest point in plan — the solver flattens this obstacle to a disc.
   *
   * `maxY` drops everything above the contact band before measuring, which is
   * the whole of spec §5 in one line: a shell crown or a pair of eye stalks
   * over the beetle's shoulder cannot lie about a contact, so they must not be
   * allowed to shrink the part of the snail that can. `dz` lets a sub-assembly
   * built in its own frame be measured where it will actually hang.
   */
  maxRadius(maxY = Infinity, dx = 0, dz = 0) {
    let m = 0;
    for (let i = 0; i < this.p.length; i += 3) {
      if (this.p[i + 1] > maxY) continue;
      const d = Math.hypot(this.p[i] + dx, this.p[i + 2] + dz);
      if (d > m) m = d;
    }
    return m;
  }

  /** Shift every vertex. Used once: to drop the stalks, which are authored in
   *  the snail's frame so their shading can read absolute heights, into the
   *  node that scales them about their own roots. */
  translate(dx, dy, dz) {
    for (let i = 0; i < this.p.length; i += 3) {
      this.p[i] += dx; this.p[i + 1] += dy; this.p[i + 2] += dz;
    }
    return this;
  }

  /**
   * Squash x and z by `k`. This is how the silhouette is held to the collider:
   * the parts below are authored in comfortable proportions and the finished
   * snail is then fitted, rather than every radius and offset having to be
   * budgeted by hand against `r`. Normals get the inverse-transpose so the
   * sheen band does not slide off the shell.
   */
  scaleHorizontal(k) {
    if (!(k > 0) || Math.abs(k - 1) < 1e-6) return this;
    const inv = 1 / k;
    for (let i = 0; i < this.p.length; i += 3) {
      this.p[i] *= k; this.p[i + 2] *= k;
      const nx = this.n[i] * inv, ny = this.n[i + 1], nz = this.n[i + 2] * inv;
      const len = Math.hypot(nx, ny, nz) || 1;
      this.n[i] = nx / len; this.n[i + 1] = ny / len; this.n[i + 2] = nz / len;
    }
    return this;
  }

  build() {
    if (this.empty) return null;
    this._close();
    const g = new THREE.BufferGeometry();
    const n = this.p.length / 3;
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.t, 2));
    g.setIndex(n > 65535
      ? new THREE.Uint32BufferAttribute(this.i, 1)
      : new THREE.Uint16BufferAttribute(this.i, 1));
    // Only split the draw when there is really more than one material on it.
    const mats = new Set(this.groups.map((gr) => gr.mat));
    if (mats.size > 1) {
      for (const gr of this.groups) g.addGroup(gr.start, gr.count, gr.mat);
    }
    g.computeBoundingSphere();
    return g;
  }
}

/** Place a primitive: scale, then rotate (Euler XYZ), then translate. */
function put(sx, sy, sz, rx, ry, rz, tx, ty, tz) {
  _e.set(rx || 0, ry || 0, rz || 0, "XYZ");
  _q.setFromEuler(_e);
  _v.set(tx || 0, ty || 0, tz || 0);
  _axis.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
  return _m.compose(_v, _q, _axis);
}

/** Place a primitive with its local +z aimed down `dir`. Moss patches need
 *  this: a blob pressed onto a curved shell has to lie along the normal. */
function putDir(sx, sy, dir, tx, ty, tz) {
  _v.copy(dir).normalize();
  _q.setFromUnitVectors(_fwd, _v);
  _v.set(tx, ty, tz);
  _axis.set(sx, sy, 1);
  return _m.compose(_v, _q, _axis);
}

/**
 * Place a primitive that has to keep an ellipsoid's shape: rotate first, then
 * scale by the semi-axes, then translate — `T·S·R`, where `put` gives `T·R·S`.
 *
 * The difference is the whole reason this exists. A spherical cap composed the
 * usual way is squashed in its *own* frame and then swung into place, so it
 * meets the ellipsoid along one ring and lifts away everywhere else. Scaling
 * after the rotation squashes the cap and the surface it is sitting on by the
 * same numbers, and the two stay in contact.
 */
function putOn(sx, sy, sz, quat, tx, ty, tz) {
  _m.makeRotationFromQuaternion(quat);
  _m.premultiply(_m2.makeScale(sx, sy, sz));
  _v.set(tx, ty, tz);
  return _m.setPosition(_v);
}

/**
 * A ragged cap of the unit sphere, for pressing onto a shell.
 *
 * `cap` is its angular radius; `lobes` sets the slowest rate at which the
 * outline wanders in and out around it. A circle reads as a decal, so the rim
 * is pushed around — but *what* it is pushed around by decides what the thing
 * is a picture of, and two earlier versions got that wrong in two directions.
 * Three bites nearly half the radius deep is not a crust, it is a maple leaf.
 * Then seven and nine shallow ones, evenly spaced and all the same depth, is
 * not a crust either — evenly spaced points of equal length around a smooth
 * middle is the definition of a star, and that is exactly what it drew.
 *
 * What a crumbling edge actually has is *no* period the eye can lock onto: a
 * couple of slow terms that make the patch an irregular blob rather than a
 * disc, and faster ones an order of magnitude weaker riding on top for grit.
 * Hence the four terms below, at frequencies that share no common factor with
 * each other and amplitudes that fall off as they speed up. The fastest is
 * `lobes + 10`, so 56 segments around keeps even that one at four samples a
 * cycle — see the swell note for what happens when a term goes under three.
 *
 * The wobble is faded out toward the pole, and that is not a nicety. At full
 * strength it runs all the way in, so every ring is a scaled copy of the same
 * lobed outline — a set of ridges converging on the centre, i.e. a star, and a
 * star with a few soft points on it is read by the eye as a leaf every time. A
 * patch of moss is solid in the middle and only ragged where it is spreading.
 * The fade also keeps the pole honest: a sphere's pole is one point held by a
 * whole row of vertices, and displacing them each by their own azimuth would
 * split it open.
 *
 * The radius swells toward the middle, so that once the cap is scaled onto a
 * shell it stands proud there and comes back down to just short of the surface
 * at the rim: no lip to catch the light, and no coplanar ring to fight over the
 * depth buffer. That swell is a plain dome with nothing azimuthal in it. An
 * earlier version rippled it around as well, at twice `lobes` — which at 32
 * segments is under three samples a cycle, so it aliased into precisely the
 * radial creases the fade above exists to prevent, and undid it.
 */
function crustGeometry(cap, lobes, phase, swell) {
  const g = new THREE.SphereGeometry(1, 56, 8, 0, TAU, 0, cap);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const azimuth = Math.atan2(v.z, v.x);
    const base = Math.acos(clamp(v.y, -1, 1));
    const out = clamp01(base / cap);
    const polar = base * (1 + out * out
      * (0.110 * Math.sin(lobes * azimuth + phase)
       + 0.075 * Math.sin((lobes + 2) * azimuth - phase * 1.7)
       + 0.050 * Math.sin((lobes + 5) * azimuth + phase * 2.3)
       + 0.032 * Math.sin((lobes + 10) * azimuth - phase * 0.6)));
    const t = clamp01(polar / cap);
    const rise = 1 + swell * (1 - 0.85 * t * t);
    const ring = Math.sin(polar) * rise;
    pos.setXYZ(i, ring * Math.cos(azimuth), Math.cos(polar) * rise, ring * Math.sin(azimuth));
  }
  g.computeVertexNormals();
  return g;
}

/** Aged: same palette, walked down in HSL so the hue survives (spec §6). */
function ageHex(hex) {
  _col.set(hex);
  const hsl = _col.getHSL({ h: 0, s: 0, l: 0 });
  _col.setHSL(hsl.h, hsl.s * AGED_SAT, hsl.l * AGED_LIGHT);
  return _col.getHex();
}

/* ===================================================================== *
 * The body — one continuous lofted surface
 *
 * Spec §7 forbids building it out of intersecting spheres, and it is right to:
 * every intersection is a crease, and on the face those creases read exactly
 * like the "tooth-like segmented seams" the same clause bans. So the body is a
 * closed ring swept along a spine from the tail tip, over the flat of the foot,
 * up through the neck and out to the nose — one surface, no unions.
 *
 * The section is not swept blindly, either: a `grip` curve says how much of it
 * is pressed flat against the leaf. Through the middle of the foot it is 1 and
 * the underside collapses onto the sole — the animal is bearing weight. At the
 * tail tip and the nose it falls to 0 and the section closes round, which is
 * what caps the two ends without a separate primitive to crease against.
 *
 * The head rears. That is a play decision as much as an art one: the beetle is
 * a 0.30 sphere rolling with its centre at y = 0.30, so the height it actually
 * arrives at is the middle of the collider — and dead ahead of the snail, the
 * shell has already fallen away by then. A head lying flat left the beetle
 * stopping 0.15 m short of any paint on the approach it takes most often. It
 * reads better too: a snail with its head up is a snail paying attention.
 * ===================================================================== */

/**
 * A Catmull-Rom through a table of `[t, value]` knots, clamped at both ends.
 *
 * Every dimension of the body is one of these, which is what makes the four
 * builds four *shapes* rather than four scalings: `long`, `fat` and `head`
 * multiply individual knots, so B's face can slim without its tail moving.
 */
function spline(knots) {
  return (t) => {
    if (t <= knots[0][0]) return knots[0][1];
    const n = knots.length;
    if (t >= knots[n - 1][0]) return knots[n - 1][1];
    let i = 0;
    while (i < n - 2 && knots[i + 1][0] < t) i++;
    const p1 = knots[i];
    const p2 = knots[i + 1];
    const p0 = knots[i - 1] || p1;
    const p3 = knots[i + 2] || p2;
    const u = (t - p1[0]) / (p2[0] - p1[0]);
    const u2 = u * u;
    const u3 = u2 * u;
    return 0.5 * (
      2 * p1[1] +
      (-p0[1] + p2[1]) * u +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3
    );
  };
}

/**
 * The body, as six curves along one parameter v (0 = tail tip, 1 = nose).
 *
 *   z      where the station sits along the snail, in collider radii
 *   w      half-width there, in radii
 *   dome   height of the section above the sole, in collider heights
 *   sole   height of the sole itself — zero under the foot, rising at the head
 *   grip   how much of the section is flat on the leaf: 1 through the middle of
 *          the foot, falling to 0 at the tail tip and the nose, which is what
 *          rounds those two ends off without a separate cap primitive
 *   exp    superellipse exponent — under 1 the section is boxier than an
 *          ellipse, a soft loaf rather than a tube, so the foot bears weight
 */
const BODY_SPLINES = ({ long = 1, fat = 1, head = 1 }) => ({
  z: spline([[0, -0.94 * long], [0.16, -0.76 * long], [0.36, -0.4 * long], [0.54, 0],
             [0.72, 0.4 * long], [0.86, 0.72 * long], [0.95, 0.94 * long], [1, 1.04 * long]]),
  w: spline([[0, 0.05], [0.16, 0.4 * fat], [0.36, 0.7 * fat], [0.54, 0.8 * fat],
             [0.72, 0.72 * fat], [0.86, 0.56 * fat * head], [0.95, 0.36 * head], [1, 0.05]]),
  dome: spline([[0, 0.05], [0.16, 0.18], [0.36, 0.3], [0.54, 0.34],
                [0.72, 0.35], [0.86, 0.38 * head], [0.95, 0.31 * head], [1, 0.13]]),
  sole: spline([[0, 0.02], [0.36, 0], [0.66, 0], [0.8, 0.04], [0.92, 0.08], [1, 0.09]]),
  grip: spline([[0, 0.7], [0.22, 1], [0.66, 1], [0.82, 0.55], [0.94, 0.15], [1, 0]]),
  exp: spline([[0, 0.8], [0.4, 0.74], [0.72, 0.82], [0.9, 0.94], [1, 0.95]]),
});

/* 24 vertices over the dome and 12 under the sole. The split is not decorative:
 * the top is the whole read of the animal and the underside is a shadow, so the
 * ring spends its budget where anyone looks. */
const RING_TOP = 24;
const RING_BOT = 12;
const RING = RING_TOP + RING_BOT;
const STATIONS = 48;

/** Loft the body: one closed ring swept along the splines above. */
function bodyGeometry(curves, r, h) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= STATIONS; i++) {
    const v = i / STATIONS;
    const z = curves.z(v) * r;
    const hw = curves.w(v) * r;
    const dome = curves.dome(v) * h;
    const soleY = curves.sole(v) * h;
    const grip = clamp01(curves.grip(v));
    const e = curves.exp(v);
    // Where the section's waist sits, how wide the underside is relative to the
    // top, and how far it hangs below. At grip = 1 the underside is dead flat
    // at `soleY` (F = 0) — the foot. At grip = 0 it is a full round end.
    const lift = dome * 0.11 * grip;
    const under = lerp(0.3, 0.88, grip);
    const drop = (1 - grip) * dome * 0.52;
    for (let j = 0; j < RING; j++) {
      let x;
      let y;
      if (j < RING_TOP) {
        const a = (j / (RING_TOP - 1)) * Math.PI;
        const c = Math.cos(a);
        const s = Math.sin(a);
        x = hw * Math.sign(c) * Math.abs(c) ** e;
        y = soleY + lift + dome * Math.abs(s) ** e;
      } else {
        const a = Math.PI + ((j - RING_TOP + 1) / (RING_BOT + 1)) * Math.PI;
        const c = Math.cos(a);
        const s = Math.sin(a);
        x = hw * under * Math.sign(c) * Math.abs(c) ** e;
        y = soleY - drop * Math.abs(s) ** e;
      }
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < STATIONS; i++) {
    for (let j = 0; j < RING; j++) {
      const a = i * RING + j;
      const b = i * RING + ((j + 1) % RING);
      idx.push(a, b, a + RING, b, b + RING, a + RING);
    }
  }
  // Close the two ends onto a centre vertex, so the tail and the nose are shut.
  const cap = (station, flip) => {
    const z = pos[station * RING * 3 + 2];
    let y = 0;
    for (let j = 0; j < RING; j++) y += pos[(station * RING + j) * 3 + 1];
    y /= RING;
    const c = pos.length / 3;
    pos.push(0, y, z);
    for (let j = 0; j < RING; j++) {
      const a = station * RING + j;
      const b = station * RING + ((j + 1) % RING);
      if (flip) idx.push(c, b, a); else idx.push(c, a, b);
    }
  };
  cap(0, true);
  cap(STATIONS, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Sweep a tapering tube down a path — the eye stalks, so they thin from a fat
 * root into a slender neck instead of looking welded to the head.
 *
 * The frame is parallel-transported (each ring's normal is the previous one
 * rotated by the turn between tangents) rather than Frenet. A Frenet frame
 * flips its normal wherever the curve's curvature passes through zero, and the
 * stalk's gentle S is exactly such a curve: the twist would show as a crease
 * running up a 3 cm stick.
 */
function tubeGeometry(pointAt, radiusAt, SEG, SIDES) {
  const pts = [];
  for (let i = 0; i <= SEG; i++) pts.push(pointAt(i / SEG));
  const tan = [];
  for (let i = 0; i <= SEG; i++) {
    tan.push(new THREE.Vector3()
      .subVectors(pts[Math.min(SEG, i + 1)], pts[Math.max(0, i - 1)])
      .normalize());
  }
  const nrm = new THREE.Vector3(1, 0, 0);
  if (Math.abs(nrm.dot(tan[0])) > 0.9) nrm.set(0, 1, 0);
  nrm.crossVectors(tan[0], nrm).normalize();
  const bin = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const pos = [];
  const idx = [];
  for (let i = 0; i <= SEG; i++) {
    if (i > 0) {
      turn.setFromUnitVectors(tan[i - 1], tan[i]);
      nrm.applyQuaternion(turn).normalize();
    }
    bin.crossVectors(tan[i], nrm).normalize();
    const rad = radiusAt(i / SEG);
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * TAU;
      p.copy(pts[i])
        .addScaledVector(nrm, Math.cos(a) * rad)
        .addScaledVector(bin, Math.sin(a) * rad);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * SIDES + j;
      const b = i * SIDES + ((j + 1) % SIDES);
      idx.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
    }
  }
  const cap = (ring, flip) => {
    const c = pos.length / 3;
    let x = 0; let y = 0; let z = 0;
    for (let j = 0; j < SIDES; j++) {
      x += pos[(ring * SIDES + j) * 3];
      y += pos[(ring * SIDES + j) * 3 + 1];
      z += pos[(ring * SIDES + j) * 3 + 2];
    }
    pos.push(x / SIDES, y / SIDES, z / SIDES);
    for (let j = 0; j < SIDES; j++) {
      const a = ring * SIDES + j;
      const b = ring * SIDES + ((j + 1) % SIDES);
      if (flip) idx.push(c, b, a); else idx.push(c, a, b);
    }
  };
  cap(0, true);
  cap(SEG, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The spiral, as a multiply map (spec §3).
 *
 * It carries depth only: a brown suture with a pale lit lip laid over it, on a
 * white field, and then a radial gradient multiplied on top so the rim of the
 * lens darkens the way a thick shell edge does. The shell's coral stays in the
 * vertex colour, so the map can never shift the hue no matter how the zone
 * lights it — §3, "纹理只承担深浅细节，不改变壳的珊瑚红主色".
 *
 * Built once and shared by all four (and cached, because the four snails and
 * every rebuilt level ask for it). Returns null with no DOM — the test suite
 * runs headless — and the shell then draws as a plain lens, which is correct,
 * just undecorated.
 */
let _spiral = null;
function spiralTexture() {
  if (_spiral) return _spiral;
  if (typeof document === "undefined") return null;
  const S = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const cx = S * 0.5;
  const cy = S * 0.5;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, S, S);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  /* A logarithmic spiral, 2.7 turns from the rim in to the eye. Sampled dense
   * (900 steps) because each step also carries its own line width: the groove
   * has to thin as it winds in, or the eye of the shell fills with ink. */
  const R0 = 0.95;
  const R1 = 0.085;
  const TURNS = 2.7;
  const decay = Math.log(R0 / R1) / (TURNS * TAU);
  const path = [];
  for (let i = 0; i <= 900; i++) {
    const a = (i / 900) * TURNS * TAU;
    const rho = R0 * Math.exp(-decay * a);
    const th = Math.PI + a;
    path.push([cx + rho * Math.cos(th) * cx, cy - rho * Math.sin(th) * cy, rho]);
  }
  const stroke = (width, style, alpha) => {
    ctx.strokeStyle = style;
    ctx.globalAlpha = alpha;
    for (let i = 1; i < path.length; i++) {
      ctx.lineWidth = Math.max(1.2, width * path[i][2] * S);
      ctx.beginPath();
      ctx.moveTo(path[i - 1][0], path[i - 1][1]);
      ctx.lineTo(path[i][0], path[i][1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  stroke(0.02, "#b0794c", 0.85);   // the suture
  stroke(0.007, "#fff2e2", 0.55);  // the lit lip inside it

  const rim = ctx.createRadialGradient(cx, cy, cx * 0.88, cx, cy, cx);
  rim.addColorStop(0, "rgba(255,255,255,1)");
  rim.addColorStop(0.65, "rgba(226,196,166,1)");
  rim.addColorStop(1, "rgba(168,120,80,1)");
  ctx.fillStyle = rim;
  ctx.globalCompositeOperation = "multiply";
  ctx.beginPath();
  ctx.arc(cx, cy, cx, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  _spiral = new THREE.CanvasTexture(canvas);
  _spiral.colorSpace = THREE.SRGBColorSpace;
  _spiral.anisotropy = 4;
  _spiral.wrapS = THREE.ClampToEdgeWrapping;
  _spiral.wrapT = THREE.ClampToEdgeWrapping;
  _spiral.needsUpdate = true;
  return _spiral;
}

/* ===================================================================== *
 * BoardSnails
 * ===================================================================== */

export class BoardSnails {
  /**
   * @param {object} leafPlatform  a built LeafPlatform (its `.props` may be null)
   * @param {object} level         the runtime level record
   */
  constructor(leafPlatform, level) {
    this.snails = [];
    this.byId = new Map();

    const props = leafPlatform?.props || null;
    const obstacles = level?.board?.obstacles || [];
    if (!props || !obstacles.length) return;

    /* No rng. props.js seeds its own props off the level id, and the first pass
     * here did the same for the moss — but the signed-off art has no random in
     * it at all: §4 fixes every proportion and every yaw, §7 asks for the four
     * to be told apart by silhouette rather than by colour, and the two moss
     * patches are placed by hand. Four builds, four fixed shapes. */
    this._materials(props);

    const taken = new Set();
    let nth = 0;
    for (const o of obstacles) {
      if (!o || o.kind !== "snail") continue;
      const seat = this._claimSeat(props, o, taken);
      const profile = PROFILES[String(o.id)] || PROFILES[PROFILE_ORDER[nth % 4]];
      nth++;
      if (!seat) continue;
      try {
        this.snails.push(this._build(props, seat, o, profile));
      } catch (err) {
        console.warn("[snails] build failed for", o.id, err);
      }
    }
    for (const s of this.snails) this.byId.set(s.id, s);
  }

  get count() { return this.snails.length; }

  /* ------------------------------------------------------------------ *
   * Take over the seat props.js already built
   * ------------------------------------------------------------------ */

  /**
   * Find the `_statics` record props.js made for this obstacle and strip the
   * fallback pebble out of it. Matching on position rather than on index keeps
   * this honest if upstream ever reorders its build.
   */
  _claimSeat(props, o, taken) {
    const statics = props._statics || [];
    const ox = Number(o.x || 0);
    const oz = Number(o.z || 0);
    for (let i = 0; i < statics.length; i++) {
      const rec = statics[i];
      if (taken.has(i)) continue;
      if (Math.abs(rec.x - ox) > 1e-6 || Math.abs(rec.z - oz) > 1e-6) continue;
      taken.add(i);
      this._stripGroup(props, rec.group);
      return rec;
    }
    return null;
  }

  /** Drop every mesh upstream hung on the seat, and forget its geometry so
   *  `props.dispose()` does not walk a buffer nobody can see any more. */
  _stripGroup(props, group) {
    for (const child of [...group.children]) {
      if (child.isMesh && child.geometry) {
        const at = props._geos.indexOf(child.geometry);
        if (at >= 0) props._geos.splice(at, 1);
        child.geometry.dispose();
      }
      group.remove(child);
    }
  }

  /* ------------------------------------------------------------------ *
   * Materials — two, shared by all four snails
   *
   * Spec §1 says the four share one palette and one material; the only reason
   * this is two and not one is the sheen colour, which §3 splits between body
   * (`#C6B9A6`) and shell (`#E4B47B`), plus the spiral map that belongs to the
   * shell alone. Fresh and aged do *not* get their own materials — §6 puts that
   * difference in the colour, and it rides the vertex colours.
   * ------------------------------------------------------------------ */

  _materials(props) {
    const track = (m) => { props._mats.push(m); return m; };

    this.matBody = track(new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: SUEDE.roughness,
      metalness: SUEDE.metalness,
    }));
    this.matBody.sheen = SUEDE.sheen;
    this.matBody.sheenRoughness = SUEDE.sheenRoughness;
    this.matBody.sheenColor = new THREE.Color(SUEDE.sheenBody);

    this.spiral = spiralTexture();
    this.matShell = track(new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: SUEDE.roughness,
      metalness: SUEDE.metalness,
      map: this.spiral || null,
    }));
    this.matShell.sheen = SUEDE.sheen;
    this.matShell.sheenRoughness = SUEDE.sheenRoughness;
    this.matShell.sheenColor = new THREE.Color(SUEDE.sheenShell);
  }

  /* ------------------------------------------------------------------ *
   * Build one snail
   * ------------------------------------------------------------------ */

  _build(props, seat, o, profile) {
    const r = Number(o.r) || 0.28;
    const h = Number(o.h) || 0.5;
    const aged = o.shell === "aged";
    const tint = (hex) => (aged ? ageHex(hex) : hex);

    const ink = {
      body: tint(EMBER.body),
      light: tint(EMBER.bodyLight),
      dark: tint(EMBER.bodyDark),
      /* The sole stays put. It is already the darkest thing on the animal and
       * it is only ever seen in contact shadow, so ageing it just muddies the
       * one edge that tells the body from the leaf. */
      sole: EMBER.sole,
      shell: tint(EMBER.shell),
      shellDark: tint(EMBER.shellDark),
    };

    const wobble = new THREE.Group();
    wobble.name = `snail:${o.id || "?"}`;
    seat.group.add(wobble);

    // Spec §4 fixes the yaw per blocker: the four angles are part of the
    // level's composition, so they are read from the table rather than derived
    // from where the seat happens to sit.
    const orient = new THREE.Group();
    orient.quaternion.setFromAxisAngle(_up, (profile.yaw * Math.PI) / 180);
    wobble.add(orient);

    const curves = BODY_SPLINES(profile.body);

    const acc = new Acc();
    acc.use(0);
    this._body(acc, curves, r, h, profile, ink);
    this._mantle(acc, r, h, profile, ink);
    if (aged) this._moss(acc, r, h, profile);
    acc.use(1);
    this._shell(acc, r, h, profile, ink);

    // The eye stalks are measured with the body but drawn on their own node, so
    // the retract on impact can scale them about the head. They are authored in
    // the snail's own frame — their shading reads absolute heights — and only
    // moved into that node afterwards, hence the `-anchor` translate below.
    const anchor = this._eyeAnchor(r, h, profile);
    const ant = new Acc();
    this._eyes(ant, r, h, profile, ink, anchor);

    /* Nothing below the contact band may overhang. Fitting the *measured*
     * maximum under FIT_Y to `r` puts the widest point of the silhouette
     * exactly where the solver puts the wall — that point is the back of the
     * shell, at the height of the shell's centre, which is inside the band and
     * so is where the promise has to hold. Everything above the line rides the
     * same scale but never drives it (§5). */
    const reach = Math.max(acc.maxRadius(FIT_Y), ant.maxRadius(FIT_Y));
    const fit = reach > 1e-6 ? r / reach : 1;
    acc.scaleHorizontal(fit);
    ant.scaleHorizontal(fit);

    const bodyMesh = this._emit(props, acc, orient, [this.matBody, this.matShell]);

    const antennae = new THREE.Group();
    antennae.position.set(0, anchor.y, anchor.z * fit);
    orient.add(antennae);
    ant.translate(0, -anchor.y, -anchor.z * fit);
    this._emit(props, ant, antennae, this.matBody);

    // Flat translucent wash under the prop, the way props.js seats its big
    // obstacles. It hangs off the seat, not the wobble: shade stays on the
    // leaf while the snail above it squashes.
    const shade = new Acc();
    shade.add(
      new THREE.CircleGeometry(1, 20).rotateX(-Math.PI * 0.5),
      put(r * 1.15, 1, r * 1.15, 0, 0, 0, 0, 0.006, 0),
      0xffffff
    );
    const shadeMesh = this._emit(props, shade, seat.group, props.matShade);
    if (shadeMesh) shadeMesh.renderOrder = 1;

    return {
      id: String(o.id || ""),
      r,
      wobble,
      antennae,
      mesh: bodyMesh,
      squash: 0, squashV: 0,
      lean: 0, leanV: 0,
      dirX: 0, dirZ: 1,
      active: false,
    };
  }

  /** Bake an accumulator into a mesh under `parent`, registered for teardown. */
  _emit(props, acc, parent, mat) {
    if (acc.empty) return null;
    const geo = acc.build();
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    parent.add(mesh);
    props._geos.push(geo);
    return mesh;
  }

  /* ------------------------------------------------------------------ *
   * Parts
   *
   * Local frame: +y up with the base at y = 0, +z forward (the head end).
   * Horizontal sizes are multiples of the collider radius so the 0.30 and the
   * 0.27 pair scale together; vertical sizes follow `h`.
   * ------------------------------------------------------------------ */

  /**
   * The soft body: one lofted surface, shaded rather than assembled.
   *
   * Where a pile of spheres used a separate primitive for the sole, the pale
   * snout and the mouth, this has a single skin and paints them on. Four of the
   * five terms go by normal — up-facing lifts toward the light tone, down-facing
   * falls into the dark — but the two that make the face read go by *position*:
   * the sole is everything within 0.10 h of the leaf, and the mouth is a short
   * dark band across the front of the head at a fixed height. Painting the mouth
   * instead of modelling it is the whole point of §7's ban on seams: a modelled
   * crease at this scale is two pixels of shadow that read as a tooth.
   */
  _body(acc, curves, r, h, profile, ink) {
    // The nose, in world z — the front-lit falloff and the mouth are both
    // measured against it so they follow `long` instead of being re-guessed.
    const nose = 1.04 * (profile.body.long || 1) * r;
    const shade = (p, n) => {
      _cb.set(ink.body);
      _cb.lerp(_ca.set(ink.light), clamp01(n.y) ** 1.6 * 0.42);
      _cb.lerp(_ca.set(ink.dark), clamp01(-n.y) * 0.55);
      _cb.lerp(_ca.set(ink.sole), sstep(0.1 * h, 0.012 * h, p.y));
      // The head catches the light: everything past 55% of the way forward,
      // and only on surfaces not turned away from above.
      _cb.lerp(_ca.set(ink.light),
        sstep(0.55 * nose, 0.97 * nose, p.z) * 0.5 * clamp01(n.y + 0.4));
      // The mouth. Front-facing, near the nose, in a band 0.06 h tall.
      const mouth = sstep(0.86 * nose, 0.99 * nose, p.z)
        * (1 - sstep(0.055 * h, 0.115 * h, Math.abs(p.y - 0.135 * h)))
        * clamp01(n.z);
      return _cb.lerp(_ca.set(ink.dark), mouth * 0.55);
    };
    acc.add(bodyGeometry(curves, r, h), put(1, 1, 1, 0, 0, 0, 0, 0, 0), shade);
  }

  /**
   * The mantle: a body-coloured ellipsoid tucked under the shell's leading edge.
   *
   * A real snail's shell does not sit on its back like a hat — the mantle swells
   * up out of the body to meet it, and the two share a rim. Without it the shell
   * is a lens balanced on a loaf and there is a visible slot between them.
   *
   * It also does structural work: it fills the forward diagonal, the one
   * direction where a lens standing on edge is at its thinnest and the flank
   * gap of §5 opens widest. It is sized from the shell's own record, so it
   * tracks whichever build it belongs to.
   */
  _mantle(acc, r, h, profile, ink) {
    const { sx, sy, sz, cy, cz } = profile.shell;
    const K = 0.98;
    const shade = (p, n) => {
      _cb.set(ink.body);
      _cb.lerp(_ca.set(ink.light), clamp01(n.y) ** 1.6 * 0.3);
      _cb.lerp(_ca.set(ink.dark), clamp01(-n.y) * 0.55);
      return _cb.lerp(_ca.set(ink.sole), sstep(0.14 * h, 0.02 * h, p.y));
    };
    acc.add(
      new THREE.SphereGeometry(1, 24, 16),
      put(sx * r * K, sy * h * 0.6, sz * r * 0.84, 0, 0, 0,
        0, cy * h - sy * h * 0.58, cz * r + sz * r * 0.12),
      shade
    );
  }

  /**
   * The shell: a plain coral lens standing on edge, with the spiral in a map.
   *
   * UVs are taken off the *unit* sphere, before it is scaled and moved — so the
   * spiral is planar-projected down ±x in the lens's own frame and lands
   * centred on both faces regardless of how flat or how far back this build's
   * shell sits. Doing it after the transform would need the inverse of that
   * transform to undo, which is the same thing written twice.
   *
   * Rim shading rides the vertex colour rather than the map: the projection
   * compresses hard near the edge, where a painted rim would smear and a vertex
   * gradient cannot. The map's own radial multiply handles the rest.
   *
   * The thickness (spec §4, 0.68–0.82 r) is what closes the flank gap the
   * earlier 0.52 r disc left open — see the note at the top of this file.
   */
  _shell(acc, r, h, profile, ink) {
    const { sx, sy, sz, cy, cz } = profile.shell;
    const shade = (p, n) => {
      _cb.set(ink.shell);
      _cb.lerp(_ca.set(ink.light), clamp01(n.y) ** 1.4 * 0.24);
      return _cb.lerp(_ca.set(ink.shellDark), clamp01(-n.y) * 0.28);
    };

    const lens = new THREE.SphereGeometry(1, 34, 22);
    const pos = lens.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = 0.5 + pos.getZ(i) * 0.5;
      uv[i * 2 + 1] = 0.5 + pos.getY(i) * 0.5;
    }
    lens.setAttribute("uv", new THREE.BufferAttribute(uv, 2));

    acc.add(
      lens,
      put(sx * r, sy * h, sz * r, 0, 0, 0, 0, cy * h, cz * r),
      shade
    );
  }

  /**
   * Moss on an aged shell (spec §6, "壳顶部增加少量不规则苔痕"): a little, and
   * irregular.
   *
   * Aimed by *direction on the shell*, not by a fraction of `h`. The preview
   * parks its two blobs at y = 0.84 h and 0.90 h, which sits on the outside of
   * the swept tube it draws; the lens `_shell` draws instead carries its crown
   * at (cy + sy)·h — 1.10 h on C, 1.31 h on B — so those same numbers put both
   * blobs a finger's width *under* the surface. Buried moss renders as nothing
   * at all, which is what shipped until it was measured. Sampling the ellipsoid
   * along a unit direction lands on the surface whatever the build, and it
   * tracks the four profiles instead of needing four hand-tuned heights.
   *
   * Both sit high and behind, where a shell actually collects it and where
   * neither can push the silhouette out inside the contact band.
   *
   * Each is a cap of the shell's own surface rather than a blob laid against
   * it, so it curves with the shell instead of cutting into it: `crustGeometry`
   * makes the ragged outline, `putOn` scales it onto the lens. On top of that,
   * the colour does the work a decal cannot — a three-axis sine beat to break
   * up the green, and a falloff to the rim, because moss that reads as growth
   * is thin and dark where it is still taking hold and only full in the middle.
   *
   * They go in the *body's* material slot on purpose — see the header note.
   */
  _moss(acc, r, h, profile) {
    const { sx, sy, sz, cy, cz } = profile.shell;
    /* `d` is the direction on the unit sphere the lens was made from — where on
     * the shell this patch grows. `cap` is its angular radius there, so a patch
     * covers the same share of every build instead of the same metres. */
    const patches = [
      { d: [0.44, 0.78, -0.42], cap: 0.30, lobes: 3, phase: 0.7, swell: 0.05 },
      { d: [-0.26, 0.95, -0.16], cap: 0.22, lobes: 4, phase: 2.4, swell: 0.045 },
    ];
    /* Own vectors, not the module scratch: `Acc.add` hands the callback `_v`
     * and `_n3` themselves, so anything here that touched those would corrupt
     * the vertex it was being asked about. */
    const centre = new THREE.Vector3(0, cy * h, cz * r);
    const inv = new THREE.Vector3(1 / (sx * r), 1 / (sy * h), 1 / (sz * r));
    const probe = new THREE.Vector3();
    for (const b of patches) {
      const dir = new THREE.Vector3(b.d[0], b.d[1], b.d[2]).normalize();
      /* Aim the cap's pole down `dir` in the *unit sphere's* frame; `putOn`
       * scales it onto the ellipsoid after, which is what holds it in contact. */
      const quat = new THREE.Quaternion().setFromUnitVectors(_up, dir);
      const shade = (p, n) => {
        const beat = 0.5 + Math.sin(p.x * 140) * Math.sin(p.y * 155) * Math.sin(p.z * 131) * 0.5;
        _cb.set(EMBER.mossDark).lerp(_ca.set(EMBER.mossLight), 0.08 + beat * 0.44);
        /* How far out on the patch this vertex sits, as a fraction of its
         * angular radius. Measured from the position, undoing the ellipsoid's
         * scale to get back to the sphere the cap was authored on — not from
         * the normal, because `crustGeometry` deliberately makes the surface
         * lumpy and its normals wander enough to mottle the falloff. */
        probe.subVectors(p, centre).multiply(inv).normalize();
        const off = clamp01(Math.acos(clamp(probe.dot(dir), -1, 1)) / b.cap);
        _cb.lerp(_ca.set(EMBER.mossDark), off ** 1.4 * 0.62);
        return _cb.lerp(_ca.set(EMBER.mossDark), clamp01(-n.y) * 0.4);
      };
      acc.add(
        crustGeometry(b.cap, b.lobes, b.phase, b.swell),
        putOn(sx * r, sy * h, sz * r, quat, 0, cy * h, cz * r),
        shade
      );
    }
  }

  /**
   * Where the stalks leave the head — straight off the profile, in world units.
   *
   * They are rooted behind the nose, and that is deliberate: the head end
   * already fills the front of the disc, so stalks planted further forward would
   * be the first thing a beetle met while the shell behind them still had slack.
   * Above the contact band they no longer *have* to earn their place in the fit
   * (FIT_Y drops them from the measurement), but the anchor still decides where
   * the retract pivots, which is a shape question, not a collision one.
   */
  _eyeAnchor(r, h, profile) {
    return { y: profile.stalk.baseY * h, z: profile.stalk.baseZ * r };
  }

  /**
   * Two eye stalks, each a tapering swept tube with a dark eye on the end.
   *
   * Spec §2 makes the eyeball itself near-black (`#2A1C12`) with a blacker
   * pupil, which is the change that gives the face a direction — the old cream
   * balls read as blank. The curve leans out and slightly forward on a
   * smoothstep, so the pair opens into a V that is wide at the eyes and tight at
   * the roots; a linear lean gives two straight sticks in plan.
   *
   * Authored in the snail's own frame — the darkening at the root is measured
   * against absolute height, which is only meaningful here — and translated into
   * the `antennae` node afterwards, so the retract on impact is one uniform
   * scale about the roots and the eyes ride it.
   */
  _eyes(acc, r, h, profile, ink, anchor) {
    const { len, spread, rad, eyeR } = profile.stalk;
    const LEAN = 0.1;                 // forward drift over the stalk's length
    const rise = len * h;
    const ball = eyeR * r;
    const root = anchor.y;

    for (const side of [1, -1]) {
      const x0 = side * 0.14 * r;
      const out = spread * r;
      const at = (d) => {
        const u = d * d * (3 - 2 * d);
        return new THREE.Vector3(
          x0 + side * out * u,
          root + rise * d,
          anchor.z + LEAN * r * u
        );
      };
      acc.add(
        tubeGeometry(at, (d) => rad * r * lerp(1.28, 0.7, d), 12, 8),
        put(1, 1, 1, 0, 0, 0, 0, 0, 0),
        (p, n) => {
          // Shade off the side the stalk faces, so the pair reads as two round
          // sticks rather than one flat fork.
          _cb.set(ink.body);
          _cb.lerp(_ca.set(ink.dark), clamp01(-n.y * 0.5 - n.x * side * 0.5) * 0.5);
          // Darker where it leaves the head, so it does not look welded on.
          return _cb.lerp(_ca.set(ink.dark), 1 - sstep(root, root + rise * 0.35, p.y));
        }
      );

      const tip = at(1);
      acc.add(
        new THREE.SphereGeometry(ball, 16, 12),
        put(1, 1, 1, 0, 0, 0, tip.x, tip.y, tip.z),
        (p, n) => _cb.set(EMBER.eye).lerp(_ca.set(ink.dark), clamp01(-n.y) * 0.3)
      );
      // Pupil: a small cap set into the eye's outward-forward face, aimed a
      // little downward — the beetle arrives below the eyes, and a snail that
      // is looking at it is worth the one extra disc.
      _n3.set(side * 0.22, 0.06, 0.97).normalize();
      acc.add(
        new THREE.CircleGeometry(ball * 0.46, 12),
        putDir(1, 1, _n3,
          tip.x + _n3.x * ball * 0.92,
          tip.y + _n3.y * ball * 0.92,
          tip.z + _n3.z * ball * 0.92),
        EMBER.pupil
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * Bounce
   * ------------------------------------------------------------------ */

  /**
   * A beetle struck this snail.
   *
   * @param id      obstacle id, as re-stamped by TableTiltLeafSim._bake
   * @param speed   closing normal speed from the solver's `hit` event
   * @param nx,nz   unit normal from the obstacle's centre toward the beetle;
   *                the snail is pushed, tips and recoils along its opposite
   */
  hit(id, speed = 0, nx = 0, nz = 0) {
    const s = this.byId.get(String(id));
    if (!s) return false;
    // Normalised against what A05 actually delivers, not against a round
    // number: sweeping the board through eight tilt directions produced 32
    // beetle-on-snail impacts spanning 0.28 to 2.74 m/s with a 1.17 median.
    // FULL_HIT sits just above that median's double, so a typical shove lands
    // near half strength and only the hardest runs saturate. The floor is what
    // a grazing tap is worth — small, but never nothing.
    const intensity = clamp(speed / FULL_HIT, 0.18, 1);
    const len = Math.hypot(nx, nz);
    if (len > 1e-6) { s.dirX = -nx / len; s.dirZ = -nz / len; }
    s.squashV += SQUASH_KICK * intensity;
    s.leanV += LEAN_KICK * intensity;
    s.active = true;
    return true;
  }

  update(dt) {
    if (!(dt > 0) || !this.snails.length) return;
    const steps = Math.min(MAX_SUB_STEPS, Math.max(1, Math.ceil(dt / SUB_STEP)));
    const sdt = dt / steps;
    const k = OMEGA * OMEGA;
    const c = 2 * ZETA * OMEGA;

    for (const s of this.snails) {
      if (!s.active) continue;
      for (let i = 0; i < steps; i++) {
        s.squashV += (-k * s.squash - c * s.squashV) * sdt;
        s.squash += s.squashV * sdt;
        s.leanV += (-k * s.lean - c * s.leanV) * sdt;
        s.lean += s.leanV * sdt;
      }
      // Rest is a real state, not an asymptote: once the spring is this small
      // the node is snapped back to identity and skipped until the next hit.
      // The cut-off is where the wobble stops being visible rather than where
      // the float stops changing — 0.15% of scale and 0.09 degrees of tip, on
      // a prop 30 cm across. Chasing it to zero would keep four matrices dirty
      // for another second of arithmetic nobody can see.
      if (Math.abs(s.squash) < REST_X && Math.abs(s.squashV) < REST_V &&
          Math.abs(s.lean) < REST_X && Math.abs(s.leanV) < REST_V) {
        s.squash = 0; s.squashV = 0; s.lean = 0; s.leanV = 0;
        s.active = false;
        s.wobble.scale.set(1, 1, 1);
        s.wobble.position.set(0, 0, 0);
        s.wobble.quaternion.identity();
        s.antennae.scale.setScalar(1);
        continue;
      }
      this._apply(s);
    }
  }

  /** Write one snail's spring state onto its nodes. */
  _apply(s) {
    // Volume-conserving squash, the same shape props.js gives a struck mover.
    const q = clamp(s.squash, -MAX_SQUASH, MAX_SQUASH);
    s.wobble.scale.set(1 + q * 0.42, 1 - q * 0.72, 1 + q * 0.42);

    // Tip away from the impact. Rotating +y toward d needs the axis (dz,0,-dx)
    // — the horizontal perpendicular, right-hand rule.
    const lean = clamp(s.lean, -0.5, 0.5);
    if (Math.abs(lean) > 1e-5) {
      _axis.set(s.dirZ, 0, -s.dirX).normalize();
      s.wobble.quaternion.setFromAxisAngle(_axis, lean);
    } else {
      s.wobble.quaternion.identity();
    }

    // A little shove in the same direction, so the tip does not read as a
    // pivot in place.
    const push = lean * s.r * 0.30;
    s.wobble.position.set(s.dirX * push, 0, s.dirZ * push);

    // Eye stalks pull in and come back out. The wobble's own squash is already
    // on them, so this only has to carry the rest of the flinch.
    s.antennae.scale.setScalar(1 - 0.35 * clamp(q, 0, MAX_SQUASH));
  }

  /** Read-only view for tests and the stats overlay. */
  snapshot() {
    return this.snails.map((s) => ({
      id: s.id,
      squash: s.squash,
      lean: s.lean,
      active: s.active,
      antennaScale: s.antennae.scale.x,
    }));
  }
}

export default BoardSnails;
