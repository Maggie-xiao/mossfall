/**
 * MOSSFALL — board props.
 *
 * Everything that stands *on* the leaf but is not the leaf and not a beetle:
 * the static obstacles the solver already bounces off (mushrooms, twigs, buds,
 * pebbles), the gentle movers (dew drops, a caterpillar), and the purely
 * decorative dressing the level data asks for (moss tufts, flowers, ferns, seed
 * pods, silk strands, glow caps, shelf fungus).
 *
 * Until this module existed the obstacles were fully simulated and completely
 * invisible — a beetle would swerve around nothing. So the first rule here is
 * that the *silhouette must match the collider*. `src/sim/physics.js` flattens
 * every obstacle to a disc or a capsule of radius `r`; the geometry built below
 * is therefore always drawn to that same `r` at the height the beetle actually
 * strikes it. A mushroom cap may overhang, because the cap is above the beetle's
 * shoulder and cannot lie about the contact — but nothing narrows below it.
 *
 * TWO KINDS OF OBJECT, TWO UPDATE COSTS
 *
 *   · Static props are baked once. Each one is a small merged geometry sitting
 *     in its own Group, so per frame it costs a single `position.y` write to
 *     follow the blade's flex (`flexAt`) and nothing else. Ten-ish groups per
 *     level, two shared materials, so the whole board's dressing is around a
 *     dozen draw calls with no state changes between them.
 *   · Movers are read from the live solver bodies every frame, interpolated
 *     between the two most recent fixed steps by the render alpha the director
 *     hands down. They are the only things in here that allocate a Mesh each.
 *
 * The static bake ignores the shader's idle breathing (≈8 mm) on purpose; it
 * follows the tilt bow and the win bend, which are the parts big enough to see.
 * Chasing the breath would mean a per-vertex flex in yet another shader for a
 * sub-pixel gain at the gameplay camera's distance.
 *
 * Nothing in here may draw attention. The readability order is beetles, then
 * burrows, then the blade edge, then obstacles, and dressing last — so props are
 * kept low, desaturated against the insects, and pushed toward the rim by the
 * level data. Anything that glows here glows softly and only in the deep zones,
 * where it is doing the job of pointing at the burrow.
 */

import * as THREE from 'three';
import { clamp, clamp01, lerp, makeRng, TAU } from '../core/math.js';
import { zoneFor, WORLD } from '../data/palette.js';

/* Segment counts by tier. Props are small on screen — the difference between 8
 * and 16 radial segments on a 30 cm mushroom is invisible and doubles the bake. */
const TIERS = {
  low: { radial: 6, cap: 4, dress: 0.5, spots: false, silk: false, detail: 0 },
  medium: { radial: 10, cap: 6, dress: 1.0, spots: true, silk: true, detail: 1 },
  high: { radial: 14, cap: 8, dress: 1.0, spots: true, silk: true, detail: 2 },
};

/** Accepts 'high', a QUALITY entry from core/settings.js, or nothing at all. */
function tierOf(q) {
  if (!q) return TIERS.medium;
  if (typeof q === 'string') return TIERS[q] || TIERS.medium;
  const name = q.name || q.tier || q.quality;
  if (typeof name === 'string' && TIERS[name]) return TIERS[name];
  if (typeof q.leafRes === 'number') {
    if (q.leafRes <= 72) return TIERS.low;
    if (q.leafRes <= 104) return TIERS.medium;
  }
  return TIERS.high;
}

/** How far a prop leans toward the surface normal. Fully upright reads as a
 *  sticker on a slope; fully normal-aligned falls over on the rim curl. */
const LEAN = 0.55;
const MAX_LEAN = 0.42;   // rad — past this a mushroom looks knocked down

/* Module scratch. Nothing below this line allocates per frame. */
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

/* ===================================================================== *
 * Geometry accumulator
 *
 * The same trick render/world.js uses: three's BufferGeometryUtils lives in
 * examples/, which we do not vendor, so a prop's dozen little primitives are
 * merged into one indexed buffer with the colour baked per vertex.
 * ===================================================================== */

class Acc {
  constructor() {
    this.p = []; this.n = []; this.u = []; this.c = []; this.i = [];
    this._sp = new THREE.Vector3();
    this._sn = new THREE.Vector3();
    this._sc = new THREE.Color();
    this._sk = new THREE.Color();
    this._nm = new THREE.Matrix3();
  }
  get empty() { return this.p.length === 0; }

  /**
   * @param geo   source geometry — always disposed, this is a bake
   * @param m     Matrix4 placement
   * @param color THREE.Color, hex, or fn(lx, ly, lz, out)
   */
  add(geo, m, color) {
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const uvA = geo.attributes.uv;
    const idx = geo.index;
    const base = this.p.length / 3;
    const P = this._sp, N = this._sn, C = this._sc, K = this._sk, NM = this._nm;
    NM.getNormalMatrix(m);
    const isFn = typeof color === 'function';
    if (!isFn) K.set(color);

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
    }
    if (idx) for (let k = 0; k < idx.count; k++) this.i.push(base + idx.getX(k));
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
    geo.dispose();
    return this;
  }

  build() {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    const n = this.p.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(n > 65535
      ? new THREE.Uint32BufferAttribute(this.i, 1)
      : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Place a primitive: scale, then rotate (Euler XYZ), then translate. */
function put(sx, sy, sz, rx, ry, rz, tx, ty, tz) {
  _e.set(rx || 0, ry || 0, rz || 0, 'XYZ');
  _q.setFromEuler(_e);
  _v.set(tx || 0, ty || 0, tz || 0);
  _n.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
  return _m.compose(_v, _q, _n);
}

/** Slightly vary a hex colour so ten mushrooms are not ten clones. */
function jitterColor(hex, rng, amt) {
  _c.set(hex);
  const k = 1 + (rng() - 0.5) * (amt || 0.18);
  _c.setRGB(clamp01(_c.r * k), clamp01(_c.g * k), clamp01(_c.b * k));
  return _c.getHex();
}

/* ===================================================================== *
 * Primitive builders
 *
 * All of them return geometry centred on the origin with +y up and the base at
 * y = 0, so a prop's parts compose without every builder re-deriving its own
 * offset convention.
 * ===================================================================== */

/** Cap dome: a hemisphere squashed to `h`, with a rolled-under rim. */
function domeGeometry(r, h, radial, rings) {
  return new THREE.SphereGeometry(1, radial, rings, 0, TAU, 0, Math.PI * 0.56)
    .scale(r, h, r);
}

/** A stem that swells at the foot the way a real stipe does. */
function stemGeometry(rTop, rBot, h, radial) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, radial, 2, true);
  g.translate(0, h * 0.5, 0);
  return g;
}

/** Lumpy ball — pebbles, seed pods, anything that should not read as a sphere. */
function lumpGeometry(r, detail, rng, squash) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.82 + rng() * 0.30;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * (squash || 1), p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** One petal: a rounded blade lying in the xz plane, rooted at the origin. */
function petalGeometry(len, wide, curl) {
  const seg = 5;
  const P = [], N = [], UV = [], I = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = Math.sin(t * Math.PI) * wide * (1 - t * 0.25);
    const y = Math.sin(t * Math.PI) * curl;
    for (let s = -1; s <= 1; s += 2) {
      P.push(s * w, y, t * len);
      N.push(0, 1, 0);
      UV.push((s + 1) * 0.5, t);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/** A blade of moss/grass: a tapered strip that bends over as it rises. */
function bladeGeometry(h, wide, bend) {
  const seg = 4;
  const P = [], UV = [], I = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = wide * (1 - t) * (1 - t * 0.35);
    P.push(-w, t * h, bend * t * t, w, t * h, bend * t * t);
    UV.push(0, t, 1, t);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/* ===================================================================== *
 * BoardProps
 * ===================================================================== */

export class BoardProps {
  /**
   * @param {import('../sim/field.js').Field} field  the collision field
   * @param {object} level                            level record
   * @param {string|object} quality                   'low'|'medium'|'high'|QUALITY entry
   */
  constructor(field, level, quality) {
    this.group = new THREE.Group();
    this.group.name = 'boardProps';

    this.field = field || null;
    this.level = level || {};
    this.zone = zoneFor(this.level.zone || 0);
    this.tier = tierOf(quality);

    this._disposed = false;
    this._geos = [];
    this._mats = [];
    this._statics = [];   // { group, x, z, base } — flex followers
    this._movers = [];    // { group, mesh, kind, r, undulate }
    this._flexFn = null;
    this._elapsed = 0;

    // Seeded off the level id so the same leaf grows the same moss every run.
    const id = String(this.level.id || 'l0');
    let seed = 2166136261;
    for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
    this._rng = makeRng(seed >>> 0);

    this._buildMaterials();
    try {
      this._buildObstacles();
      this._buildDressing();
      this._buildMovers();
    } catch (err) {
      console.warn('[props] build failed, board dressing degraded:', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * Materials — three of them, shared by every prop on the board
   * ------------------------------------------------------------------ */

  _buildMaterials() {
    const track = (m) => { this._mats.push(m); return m; };

    // Everything opaque. Vertex colours carry the whole palette, so a level's
    // dressing is one material and the GPU never changes state between props.
    //
    // DoubleSide, deliberately: petals, moss blades and fern leaflets are flat
    // strips with no thickness, and a culled back face leaves a hole you can see
    // straight through. The alternative — duplicating every strip with flipped
    // normals — costs more memory than the culling saves on a few thousand
    // triangles, and three flips the normal for us on a back face anyway.
    this.matSolid = track(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.86, metalness: 0.0, side: THREE.DoubleSide,
    }));

    // Glow caps and lantern fungus. Emissive is uniform across the mesh, so
    // only geometry that should actually light goes in here.
    this.matGlow = track(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.45, metalness: 0.0, side: THREE.DoubleSide,
      emissive: new THREE.Color(this.zone.glow),
      // Deep zones need the lantern to read; the sunlit crown does not, and a
      // bright cap up there would out-shout the beetles. The deep end is capped
      // well below 1: a teal cap lit by a warm emissive clips to white once tone
      // mapping is applied, and white beats every shell colour in the hierarchy.
      // The obstacle mushrooms share this material with the little lantern
      // clusters, and their caps are ten times the area — whatever reads as a
      // pinprick on a `glowCap` reads as a floodlight on a 0.4 m dome. Tuned
      // against the big one.
      emissiveIntensity: lerp(0.22, 0.45, clamp01((this.level.zone || 0) / 7)),
    }));

    this.matSilk = track(new THREE.MeshBasicMaterial({
      color: new THREE.Color(WORLD.silk), transparent: true, opacity: 0.22,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
    }));

    // Contact shade under the big obstacles. Unlit and translucent: an opaque
    // lit "shadow" pad changes colour with every zone's light rig and reads as
    // a plinth; a 20% black wash reads as shade on any leaf in any zone.
    this.matShade = track(new THREE.MeshBasicMaterial({
      color: 0x10230a, transparent: true, opacity: 0.20,
      depthWrite: false, toneMapped: true,
    }));

    // A dew drop is convex and drawn front-face only, so it can keep writing
    // depth — which is what stops two drops from fighting over sort order.
    this.matDew = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(WORLD.water), transparent: true, opacity: 0.62,
      roughness: 0.06, metalness: 0.02,
      emissive: new THREE.Color(this.zone.glow), emissiveIntensity: 0.12,
    }));

    this.matSpark = track(new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
  }

  /* ------------------------------------------------------------------ *
   * Static build
   * ------------------------------------------------------------------ */

  /**
   * Seat a prop on the surface and register it as a flex follower.
   *
   * `align` scales how far it tips toward the local slope; `yaw` spins it about
   * its own axis. Both go in here rather than being set afterwards, because
   * writing `group.rotation.y` would rebuild the quaternion from Euler angles
   * and silently throw the lean away.
   */
  _seat(x, z, align, yaw) {
    const g = new THREE.Group();
    const f = this.field;
    const base = f ? f.height(x, z) : 0;
    g.position.set(x, base, z);

    if (yaw) g.quaternion.setFromAxisAngle(_up, yaw);

    if (f && align !== 0) {
      f.normal(x, z, _n);
      // The shortest rotation from straight up to the surface normal, taken
      // only part of the way and hard-capped: a mushroom on the rim curl should
      // lean into the slope, not lie down on it.
      const ang = Math.acos(clamp(_n.dot(_up), -1, 1)) * (align == null ? LEAN : align);
      if (ang > 0.004) {
        _v.crossVectors(_up, _n);
        if (_v.lengthSq() > 1e-8) {
          _v.normalize();
          // Lean is a world-space tip, so it premultiplies the local spin.
          _q.setFromAxisAngle(_v, Math.min(ang, MAX_LEAN));
          g.quaternion.premultiply(_q);
        }
      }
    }
    // Props are dressing: they receive the leaf's shadow but do not cast one.
    // Eight extra shadow casters per board buys nothing and costs a pass.
    this.group.add(g);
    this._statics.push({ group: g, x, z, base });
    return g;
  }

  /** Turn a finished accumulator into a mesh under `parent`. */
  _emit(acc, parent, mat) {
    if (!acc || acc.empty) return null;
    const geo = acc.build();
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, mat || this.matSolid);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    parent.add(mesh);
    this._geos.push(geo);
    return mesh;
  }

  _buildObstacles() {
    const list = (this.level.board && this.level.board.obstacles) || [];
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o) continue;
      switch (o.kind) {
        case 'mushroom': this._mushroom(o); break;
        case 'stump': this._stump(o); break;
        case 'twig': this._twig(o); break;
        case 'bud': this._bud(o); break;
        case 'pebble': this._pebble(o); break;
        default: this._pebble(o); break;   // unknown collider still gets a body
      }
    }
  }

  /**
   * Mushroom: a storybook toadstool — wide parasol cap with a rolled lip and
   * cream plaque spots over a stout, gently waisted stipe.
   *
   * The stipe is drawn at the collider's full radius `r` for its whole height so
   * the beetle never appears to bounce off thin air; the cap is wider but starts
   * above beetle height, where it cannot mislead — at `capR = 1.85 r` the beetle
   * (r 0.3) can never slip under the rim in plan, because stem-radius + beetle
   * already outreaches it.
   */
  _mushroom(o) {
    if (o.cap === 'orange') { this._mushroomOrange(o); return; }
    if (o.cap === 'stack') { this._mushroomStack(o); return; }
    if (o.cap === 'mint') { this._mushroomMint(o); return; }
    const rng = this._rng;
    const T = this.tier;
    const r = o.r || 0.28;
    const h = o.h || 0.48;
    const glow = o.cap === 'glow';
    const cream = o.cap === 'cream';
    const g = this._seat(o.x || 0, o.z || 0);

    const stemTop = h * 0.72;
    const capR = r * (glow ? 1.35 : 1.85);
    const capH = h * (glow ? 0.42 : 0.50);
    const capBase = stemTop + h * 0.05;
    const solid = new Acc();

    // Stem: rounded foot, gentle waist, never below 0.88 r (silhouette rule).
    // The faint chevron banding is the reference art's woven stipe, done in
    // vertex colour — soft at this vertex density, which is the point.
    const stemPts = [];
    const SP = [[1.02, 0], [1.065, 0.05], [1.00, 0.16],
      [0.93, 0.45], [0.895, 0.68], [0.92, 0.88], [0.88, 1.0]];
    for (let i = 0; i < SP.length; i++) {
      stemPts.push(new THREE.Vector2(r * SP[i][0], stemTop * SP[i][1]));
    }
    const stemLight = jitterColor(0xe4cb9a, rng, 0.06);
    const stemDark = 0xbd975f;
    const stemFn = (x, y, z, C) => {
      const zig = Math.abs(((Math.atan2(x, z) * (3 / Math.PI) + y * 7) % 2 + 2) % 2 - 1);
      C.setHex(stemLight).lerp(_c2.setHex(stemDark), zig * 0.6);
    };
    solid.add(new THREE.LatheGeometry(stemPts, T.radial + 2),
      put(1, 1, 1, 0, rng() * TAU, 0, 0, 0, 0), stemFn);

    // A skirt of gills under the cap. Reads as a mushroom from the three-quarter
    // gameplay view, which is the only view that exists.
    // Shaded, not cream: gills sit in the cap's own shadow, and a bright ring
    // right under the silhouette is the second-brightest thing on the board
    // after the beetle it is meant to stay behind.
    solid.add(new THREE.CylinderGeometry(capR * 0.78, r * 0.80, h * 0.10, T.radial + 2, 1, true),
      put(1, 1, 1, 0, 0, 0, 0, stemTop, 0), jitterColor(0xc9ad84, rng, 0.08));

    // Cap: lathe profile — rolled lip, near-conic flank, rounded apex. `yOf`
    // is shared with the spot placement below so plaques sit on the surface.
    const capCol = glow ? WORLD.mushroomGlowCap
      : cream ? 0xf6e8c9 : jitterColor(0xf05a41, rng, 0.07);
    const capRim = glow ? WORLD.mushroomGlowCap
      : cream ? 0xdcc198 : 0xbc3628;
    const capAcc = glow ? new Acc() : solid;
    const yOf = (t) => capH * (1 - Math.pow(t, 1.65));
    const capPts = [
      new THREE.Vector2(capR * 0.84, -capH * 0.10),
      new THREE.Vector2(capR * 1.005, -capH * 0.035),
      new THREE.Vector2(capR, capH * 0.02),
    ];
    const RIM = [0.92, 0.80, 0.65, 0.48, 0.30, 0.14, 0.0001];
    for (let i = 0; i < RIM.length; i++) {
      capPts.push(new THREE.Vector2(capR * RIM[i], yOf(RIM[i])));
    }
    const capFn = (x, y, z, C) => {
      const t = clamp01(Math.hypot(x, z) / capR);
      C.setHex(capCol).lerp(_c2.setHex(capRim), 0.10 + 0.80 * Math.pow(t, 1.5));
      if (y < 0) C.multiplyScalar(0.82);   // rolled under-lip sits in its own shade
    };
    capAcc.add(new THREE.LatheGeometry(capPts, T.radial + 6),
      put(1, 1, 1, 0, 0, 0, 0, capBase, 0), glow ? capCol : capFn);
    // Seal the cap's underside so a low camera never sees inside the dome.
    capAcc.add(new THREE.CircleGeometry(capR * 0.845, T.radial + 4).rotateX(Math.PI * 0.5),
      put(1, 1, 1, 0, 0, 0, 0, capBase - capH * 0.10 + 0.002, 0),
      glow ? capCol : jitterColor(0xe6d2a6, rng, 0.08));

    if (T.spots && !glow && !cream) {
      // Cream plaques, half-sunk pancakes tilted to the cap's slope — raised the
      // way the reference art paints them, and allowed near the rim, where the
      // rolled lip (not the spots) still owns the silhouette.
      const n = 4 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const a = rng() * TAU;
        const t = 0.22 + rng() * 0.58;
        const sr = capR * (0.13 + rng() * 0.10);
        const beta = Math.atan2(capH * 1.65 * Math.pow(t, 0.65), capR);
        solid.add(new THREE.SphereGeometry(1, 8, 5),
          put(sr, sr * 0.34, sr, 0, -a, -beta,
            Math.cos(a) * capR * t, capBase + yOf(t), Math.sin(a) * capR * t),
          jitterColor(0xf7ecd8, rng, 0.04));
      }
    }

    this._emit(solid, g, this.matSolid);
    if (glow) this._emit(capAcc, g, this.matGlow);
    this._contactShade(g, r * 1.24, r * 1.24);
  }

  /**
   * The orange variant: a tall, glossy, jaunty toadstool — deep drooping cap,
   * a few big clean-white plaques, and a caramel stipe with a gentle lean.
   *
   * The lean is drawn, not simulated. The stipe holds the collider's full
   * radius, dead centre, through the whole band the beetle can touch; only
   * above `bendFrom` does it ease sideways, and the cap follows. The far rim
   * never leaves stem-radius + beetle-radius in plan (0.22 r drift + 1.65 r
   * cap + ~0.1 r of tilt < 2 r), so the overhang cannot shadow a contact the
   * solver would not deliver.
   */
  _mushroomOrange(o) {
    const rng = this._rng;
    const T = this.tier;
    const r = o.r || 0.28;
    const h = o.h || 0.48;
    const g = this._seat(o.x || 0, o.z || 0);

    const stemTop = h * 0.92;
    const capR = r * 1.80;
    const capH = h * 0.78;
    const capBase = stemTop + capH * 0.02;
    const drift = r * 0.10;
    const da = rng() * TAU;              // which way the whole thing leans
    const tilt = 0.08;
    const solid = new Acc();

    // Stipe: straight lathe, then the upper half is eased toward +x in the
    // geometry and the whole thing yawed so the bend points along `da`.
    const SP = [[1.03, 0], [1.07, 0.05], [1.00, 0.18], [0.93, 0.45],
      [0.88, 0.70], [0.87, 0.88], [0.90, 1.0]];
    const stemPts = [];
    for (let i = 0; i < SP.length; i++) {
      stemPts.push(new THREE.Vector2(r * SP[i][0], stemTop * SP[i][1]));
    }
    const stem = new THREE.LatheGeometry(stemPts, T.radial + 2);
    const bendFrom = stemTop * 0.42;
    const sPos = stem.attributes.position;
    for (let i = 0; i < sPos.count; i++) {
      const k = clamp01((sPos.getY(i) - bendFrom) / (stemTop - bendFrom));
      sPos.setX(i, sPos.getX(i) + drift * k * k);
    }
    stem.computeVertexNormals();
    const stemBot = jitterColor(0xc48c3a, rng, 0.06);
    const stemTopCol = 0xe9bc6d;
    const stemFn = (x, y, z, C) => {
      C.setHex(stemBot).lerp(_c2.setHex(stemTopCol), clamp01(y / stemTop) * 0.8);
    };
    solid.add(stem, put(1, 1, 1, 0, -da, 0, 0, 0, 0), stemFn);

    // Cap: a deep bell that wraps the neck and droops well below its own
    // underside — the reference cap is most of the mushroom. The rim still
    // bottoms out above the beetle's centre height, so it cannot shadow a
    // contact the solver would not deliver.
    const yOf = (t) => capH * (1 - Math.pow(t, 2.3) * 1.28);
    const capPts = [
      new THREE.Vector2(capR * 0.60, -capH * 0.06),
      new THREE.Vector2(capR * 0.97, -capH * 0.30),
      new THREE.Vector2(capR, yOf(1)),
    ];
    const RIM = [0.9, 0.75, 0.58, 0.40, 0.22, 0.0001];
    for (let i = 0; i < RIM.length; i++) {
      capPts.push(new THREE.Vector2(capR * RIM[i], yOf(RIM[i])));
    }
    const capTop = jitterColor(0xf59a3c, rng, 0.05);
    const capRim = 0xd8741c;
    const capFn = (x, y, z, C) => {
      const t = clamp01(Math.hypot(x, z) / capR);
      C.setHex(capTop).lerp(_c2.setHex(capRim), 0.08 + 0.72 * Math.pow(t, 1.6));
      if (y < 0) C.multiplyScalar(0.80);
    };
    const dx = Math.cos(da) * drift, dz = Math.sin(da) * drift;
    const capM = put(1, 1, 1, 0, -da, -tilt, dx, capBase, dz).clone();
    solid.add(new THREE.LatheGeometry(capPts, T.radial + 6), capM, capFn);

    // Seal the opening so a low camera never sees inside the bell.
    const seal = new THREE.CircleGeometry(capR * 0.61, T.radial + 4)
      .rotateX(Math.PI * 0.5).translate(0, -capH * 0.065, 0);
    solid.add(seal, capM, jitterColor(0xb97a30, rng, 0.08));

    if (T.spots) {
      // Two or three big stark-white plaques riding the cap in its own frame,
      // so they follow the tilt. High on the shoulder, and laid flatter than
      // the true surface slope: plaques that face the sky catch the warm key
      // light and stay white, the way the reference paints them.
      const n = 2 + Math.floor(rng() * 2);
      const a0 = rng() * TAU;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * TAU + (rng() - 0.5) * 0.8;
        const t = 0.30 + rng() * 0.30;
        const sr = capR * (0.21 + rng() * 0.11);
        const beta = Math.atan2(capH * 2.05 * Math.pow(t, 0.6), capR) * 0.65;
        const sM = put(sr, sr * 0.30, sr, 0, -a, -beta,
          Math.cos(a) * capR * t, yOf(t), Math.sin(a) * capR * t).clone();
        sM.premultiply(capM);
        solid.add(new THREE.SphereGeometry(1, 9, 6), sM, jitterColor(0xfefcf4, rng, 0.02));
      }
    }

    this._emit(solid, g, this.matSolid);
    this._contactShade(g, r * 1.24, r * 1.24);
  }

  /** Flat translucent contact wash under a prop — see matShade for why. */
  _contactShade(g, sx, sz) {
    const pad = new Acc();
    pad.add(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI * 0.5),
      put(sx, 1, sz, 0, 0, 0, 0, 0.006, 0), 0xffffff);
    const mesh = this._emit(pad, g, this.matShade);
    if (mesh) mesh.renderOrder = 1;
  }

  /** Shared by the two low-poly mushrooms: a lathe left faceted on purpose —
   *  non-indexed with per-face normals, ten sides, like the reference art. */
  _facetedLathe(pts, r, h, seg) {
    const geo = new THREE.LatheGeometry(
      pts.map((p) => new THREE.Vector2(r * p[0], h * p[1])), seg).toNonIndexed();
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * The two low-poly mushrooms share one form — a faceted dome over a fat
   * hooped stem — and differ only in paint. The stem holds the collider radius
   * its whole height; the cap rim overhangs only above the beetle's centre
   * line, same rule the parasol and the bell obey.
   *
   * @param pal {hoops: hex[4] bottom→top, capMain, capRim, capSeal}
   */
  _facetedShroom(o, pal) {
    const rng = this._rng;
    const r = o.r || 0.27;
    const h = o.h || 0.5;
    const g = this._seat(o.x || 0, o.z || 0);
    const acc = new Acc();
    const seg = 10;

    const hoops = pal.hoops.map((hex) => jitterColor(hex, rng, 0.05));
    const stemFn = (x, y, z, C) => {
      C.setHex(hoops[clamp(Math.floor((y / (h * 0.64)) * 4), 0, 3)]);
    };
    acc.add(this._facetedLathe(
      [[0.60, 0], [1.05, 0.02], [1.00, 0.14], [0.97, 0.38], [1.00, 0.56], [0.90, 0.64]], r, h, seg),
      put(1, 1, 1, 0, rng() * TAU, 0, 0, 0, 0), stemFn);

    const capMain = jitterColor(pal.capMain, rng, 0.04);
    const capRim = jitterColor(pal.capRim, rng, 0.05);
    const capFn = (x, y, z, C) => {
      C.setHex(Math.hypot(x, z) > r * 1.19 ? capRim : capMain);
    };
    acc.add(this._facetedLathe(
      [[0.86, 0.63], [1.45, 0.66], [1.36, 0.78], [0.88, 0.93], [0.02, 1.02]], r, h, seg),
      put(1, 1, 1, 0, rng() * TAU, 0, 0, 0, 0), capFn);
    // Seal the cap's underside so a low camera never sees inside the dome.
    acc.add(new THREE.CircleGeometry(r * 1.43, seg).rotateX(Math.PI * 0.5),
      put(1, 1, 1, 0, 0, 0, 0, h * 0.655, 0), jitterColor(pal.capSeal, rng, 0.05));

    this._emit(acc, g, this.matSolid);
    this._contactShade(g, r * 1.30, r * 1.30);
  }

  /** Cream cushion mushroom ('stack'): the macaron palette on the shared
   *  faceted form — cream dome with a blush under-rim, pink-hooped stem. */
  _mushroomStack(o) {
    this._facetedShroom(o, {
      hoops: [0xcfe0bb, 0xf5ead2, 0xf0b2a9, 0xf5ead2],
      capMain: 0xf7f0dc,
      capRim: 0xefc9b8,
      capSeal: 0xe4b5a5,
    });
  }

  /** Mint-cap mushroom ('mint'): faceted green dome, cream-and-pink stem. */
  _mushroomMint(o) {
    this._facetedShroom(o, {
      hoops: [0xf6e9cd, 0xf2b3aa, 0xf6e9cd, 0xeb9f92],
      capMain: 0x8fce77,
      capRim: 0x6db058,
      capSeal: 0x5f9a4c,
    });
  }

  /**
   * Stump — a standing cut of the twig below: the same bark family, the same
   * pale sawn end-grain with a swirl of growth rings, the same snapped-off
   * stubs, turned upright. It replaces A05's mushrooms without touching their
   * collider: the flank holds the disc's full radius `r` through the whole
   * band the beetle can touch, the root flare stays inside the ball's own
   * curve, and the stubs start above beetle height (the cap-overhang rule).
   *
   * `cut: 'aged'` marks the soft-rebound pair — duller bark, darker grain,
   * moss creeping over the crown — so the two bounce behaviours keep two
   * readable silhouettes, the way the red/orange vs stack/mint caps did.
   */
  _stump(o) {
    const rng = this._rng;
    const T = this.tier;
    const r = o.r || 0.28;
    const h = o.h || 0.48;
    const aged = o.cut === 'aged';
    const g = this._seat(o.x || 0, o.z || 0, undefined, rng() * TAU);

    const bark = jitterColor(aged ? 0x8a5732 : 0x9a5f31, rng, 0.10);
    const barkDk = jitterColor(aged ? 0x5c391d : 0x6f421f, rng, 0.12);
    const barkLt = jitterColor(aged ? 0xa87c4b : 0xc08549, rng, 0.10);
    const wood = jitterColor(aged ? 0xc99c60 : 0xdfa963, rng, 0.08);
    const grain = jitterColor(aged ? 0x855628 : 0x9c6631, rng, 0.10);

    const acc = new Acc();

    // Trunk: a lathe, like the twig's — root flare only in the bottom tenth
    // (inside the beetle ball's curve), full radius through the contact band,
    // the faintest settle toward the crown. Never above `r` past the flare.
    const P = [[1.14, 0], [1.05, 0.05], [1.0, 0.12], [0.985, 0.36],
      [0.995, 0.62], [0.975, 0.84], [0.955, 1.0]];
    const prof = [];
    for (let i = 0; i < P.length; i++) {
      prof.push(new THREE.Vector2(r * P[i][0], h * P[i][1]));
    }
    const streaks = T.radial >= 12 ? 5 : 4;
    const barkFn = (x, y, z, C) => {
      // Vertical bark striations — the stump's answer to the stipe's chevrons.
      const a = Math.atan2(x, z);
      const s = Math.abs(((a * streaks / Math.PI + Math.sin(y * 9 + a) * 0.22)
        % 2 + 2) % 2 - 1);
      C.setHex(bark).lerp(_c2.setHex(barkDk), 0.12 + s * 0.55);
      if (y < h * 0.10) C.lerp(_c2.setHex(barkDk), 0.30);   // rooted in shade
      else if (y > h * 0.93) C.lerp(_c2.setHex(barkLt), 0.45); // cut lip light
    };
    acc.add(new THREE.LatheGeometry(prof, T.radial + 4),
      put(1, 1, 1, 0, 0, 0, 0, 0, 0), barkFn);

    // Sawn crown: pale end-grain just inside the bark lip…
    acc.add(new THREE.CircleGeometry(r * 0.93, T.radial + 4).rotateX(-Math.PI * 0.5),
      put(1, 1, 1, 0, 0, 0, 0, h + 0.003, 0), wood);
    // …and the twig's growth-ring swirl — the tell that reads "cut wood".
    if (T.detail > 0) {
      const pts = [];
      for (let i = 0; i <= 22; i++) {
        const t = i / 22;
        const sa = t * 2.6 * TAU;   // ~2.6 turns of grain
        const rad = r * (0.06 + 0.58 * t);
        pts.push(new THREE.Vector3(Math.cos(sa) * rad, 0, Math.sin(sa) * rad));
      }
      acc.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 44, r * 0.032, 4, false),
        put(1, 1, 1, 0, 0, 0, 0, h + 0.007, 0), grain);
    }

    // Snapped-off stub branches, angled up and away — the twig's own gesture.
    // Both sit high on the flank, well above the beetle's contact band, and
    // reach less in plan than the mushroom caps they replaced ever did.
    const stub = (y0, rx2, rz2, sl, col) => {
      const cone = new THREE.CylinderGeometry(r * 0.12, r * 0.30, sl, 7, 1, false);
      cone.translate(0, sl * 0.5, 0);
      const p0 = [-Math.sin(rz2) * r * 0.72, y0, Math.sin(rx2) * r * 0.72];
      acc.add(cone, put(1, 1, 1, rx2, 0, rz2, ...p0), col);
      const dy = Math.cos(rz2) * Math.cos(rx2), dz = Math.cos(rz2) * Math.sin(rx2);
      acc.add(new THREE.SphereGeometry(r * 0.12, 7, 5),
        put(1, 1, 1, 0, 0, 0,
          p0[0] - Math.sin(rz2) * sl, p0[1] + dy * sl, p0[2] + dz * sl), col);
    };
    stub(h * 0.64, 0.95, 0, r * 1.45, bark);
    if (T.detail > 0) {
      stub(h * 0.46, -0.30, 0.85, r * 1.05, jitterColor(0x84512a, rng, 0.10));
    }

    // Age shows on the crown: moss pads creeping in from the rim.
    if (aged && T.spots) {
      const n = 3 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const a = rng() * TAU;
        const mr = r * (0.15 + rng() * 0.12);
        const d = r * (0.52 + rng() * 0.32);
        acc.add(new THREE.SphereGeometry(1, 7, 5),
          put(mr, mr * 0.36, mr, 0, rng() * TAU, 0,
            Math.cos(a) * d, h + 0.004, Math.sin(a) * d),
          jitterColor(0x6f9a45, rng, 0.12));
      }
    }

    this._emit(acc, g, this.matSolid);
    this._contactShade(g, r * 1.2, r * 1.2);
  }

  /**
   * Twig — drawn as a found log: a swelling bark trunk resting *on* the blade
   * (not sunk into it), a sawn end with a growth-ring swirl, snapped-off stub
   * branches, and one fresh leaf sprouting at the tip. The leaf and stubs are
   * decoration; the capsule the beetle feels is still (ax,az)→(bx,bz) at `r`,
   * and the trunk silhouette holds that radius for its whole length.
   */
  _twig(o) {
    const rng = this._rng;
    const T = this.tier;
    const ax = o.ax || 0, az = o.az || 0;
    const bx = o.bx || 0, bz = o.bz || 0;
    const r = o.r || 0.13;
    const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az);

    // Seated flat: a twig lying across a vein should follow the vein, and the
    // pitch below already does that more accurately than a normal-align would.
    const g = this._seat(mx, mz, 0, yaw);
    const f = this.field;
    const ya = f ? f.height(ax, az) : 0;
    const yb = f ? f.height(bx, bz) : 0;
    const pitch = len > 1e-3 ? Math.atan2(yb - ya, len) : 0;

    // Local log frame: A runs along the capsule toward b, U is the pitched up.
    // `at(s, u, x)` places a part s along the axis, u above it, x across it —
    // every part below shares it, so the pitch math lives in exactly one place.
    const half = len * 0.5;
    const cy = r * 1.03;   // resting tangent to the blade, not embedded
    const Ay = Math.sin(pitch), Az = Math.cos(pitch);
    const at = (s, u, x) => [x || 0, cy + s * Ay + (u || 0) * Az, s * Az - (u || 0) * Ay];
    const axisRx = Math.PI * 0.5 - pitch;   // maps a lathe/cylinder +y onto A
    const faceRx = -pitch;                  // maps a disc/tube +z onto A

    const acc = new Acc();
    const bark = jitterColor(0x9a5f31, rng, 0.10);
    const barkDk = jitterColor(0x6f421f, rng, 0.12);
    const barkLt = jitterColor(0xc08549, rng, 0.10);
    const wood = jitterColor(0xdfa963, rng, 0.08);

    // Trunk: a lathe, so the body can swell and settle like a grown thing
    // instead of a dowel. Never above `r` — silhouette rule.
    const P = [0.92, 0.98, 1.0, 0.985, 1.0, 0.97, 0.95];
    const prof = [];
    for (let i = 0; i < P.length; i++) {
      prof.push(new THREE.Vector2(r * P[i], -half + (i / (P.length - 1)) * len));
    }
    acc.add(new THREE.LatheGeometry(prof, T.radial + 2),
      put(1, 1, 1, axisRx, 0, 0, ...at(0, 0)), bark);

    // The b end is sawn: pale end-grain and, above the low tier, a swirl of
    // growth rings — the thing that makes it read as a log and not a stick.
    acc.add(new THREE.CircleGeometry(r * 0.95, T.radial + 2),
      put(1, 1, 1, faceRx, 0, 0, ...at(half + 0.004, 0)), wood);
    if (T.detail > 0) {
      const pts = [];
      for (let i = 0; i <= 22; i++) {
        const t = i / 22;
        const sa = t * 2.6 * TAU;   // ~2.6 turns of grain
        const rad = r * (0.06 + 0.60 * t);
        pts.push(new THREE.Vector3(Math.cos(sa) * rad, Math.sin(sa) * rad, 0));
      }
      acc.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 44, r * 0.034, 4, false),
        put(1, 1, 1, faceRx, 0, 0, ...at(half + 0.008, 0)),
        jitterColor(0x9c6631, rng, 0.10));
    }

    // The a end broke off: a bark knuckle, slightly darker, slightly blunt.
    acc.add(new THREE.SphereGeometry(1, T.radial, 6),
      put(r * 0.90, r * 0.90, r * 0.52, faceRx, 0, 0, ...at(-half + r * 0.05, 0)), barkDk);

    // Snapped-off stub branches, angled up and away — never into the beetle's
    // lane. Geometry pre-shifted so the cone's base is the pivot; a small ball
    // on the tip keeps them chunky instead of papery.
    const stub = (s, u, rx2, rz2, sl, col) => {
      const cone = new THREE.CylinderGeometry(r * 0.13, r * 0.33, sl, 7, 1, false);
      cone.translate(0, sl * 0.5, 0);
      const p0 = at(s, u);
      acc.add(cone, put(1, 1, 1, rx2, 0, rz2, ...p0), col);
      const dy = Math.cos(rz2) * Math.cos(rx2), dz = Math.cos(rz2) * Math.sin(rx2);
      acc.add(new THREE.SphereGeometry(r * 0.13, 7, 5),
        put(1, 1, 1, 0, 0, 0,
          p0[0] - Math.sin(rz2) * sl, p0[1] + dy * sl, p0[2] + dz * sl), col);
    };
    stub(len * 0.18, r * 0.55, -0.35, 0.55, r * 1.9, bark);
    if (T.detail > 0) stub(-len * 0.30, r * 0.50, 0.25, -0.60, r * 1.55, jitterColor(0x84512a, rng, 0.10));

    // Bark smears on the flanks — the reference art's long smooth streaks, at
    // prop scale. Dark only, and never on the crown: from the top-down gameplay
    // camera a bright crown patch reads as a knothole, not a highlight.
    if (T.detail > 0) {
      const n = 1 + T.detail;
      for (let i = 0; i < n; i++) {
        const phi = (0.7 + rng() * 1.2) * (i % 2 ? 1 : -1);
        const s = (rng() - 0.5) * len * 0.7;
        acc.add(new THREE.SphereGeometry(1, 8, 5),
          put(r * 0.26, r * 0.07, len * (0.11 + rng() * 0.08), faceRx, 0, 0,
            ...at(s, Math.cos(phi) * r * 0.94, Math.sin(phi) * r * 0.94)),
          jitterColor(0x7c4a22, rng, 0.12));
      }
    }

    // One fresh leaf at the tip, on a little stalk off the sawn end's shoulder.
    // Purely decorative: the capsule ends at the cut face, and the leaf climbs
    // fast enough that a beetle passing the end reads as brushing under it.
    const stalkL = r * 1.15;
    const rz0 = 0.18, rx0 = 0.80;
    const stalk = new THREE.CylinderGeometry(r * 0.045, r * 0.065, stalkL, 5, 1, false);
    stalk.translate(0, stalkL * 0.5, 0);
    const base = at(half - r * 0.18, r * 0.62);
    acc.add(stalk, put(1, 1, 1, rx0, 0, rz0, ...base), jitterColor(0x5d7a2e, rng, 0.12));

    const leafLen = r * 2.9, leafWide = r * 1.05;
    const tipX = base[0] - Math.sin(rz0) * stalkL;
    const tipY = base[1] + Math.cos(rz0) * Math.cos(rx0) * stalkL;
    const tipZ = base[2] + Math.cos(rz0) * Math.sin(rx0) * stalkL;
    const leafBody = jitterColor(0x5b9c39, rng, 0.08);
    const leafRib = jitterColor(0x44712c, rng, 0.08);
    const leafTip = jitterColor(0x82bb52, rng, 0.08);
    const leafFn = (x, y, z, C) => {
      C.setHex(Math.abs(x) < leafWide * 0.16 ? leafRib : leafBody);
      if (z > leafLen * 0.72) C.lerp(_c2.setHex(leafTip), 0.3);
    };
    acc.add(petalGeometry(leafLen, leafWide, r * 0.35),
      put(1, 1, 1, -0.35, -rz0, 0.12, tipX, tipY, tipZ), leafFn);

    this._emit(acc, g, this.matSolid);

    // Soft contact shade under the trunk — the difference between a log resting
    // on the blade and a log extruded from it.
    this._contactShade(g, r * 1.35, len * 0.52);
  }

  /** Flower bud: an egg on a short stem, with sepals hugging it. */
  _bud(o) {
    const rng = this._rng;
    const T = this.tier;
    const r = o.r || 0.24;
    const h = o.h || 0.38;
    const g = this._seat(o.x || 0, o.z || 0);
    const acc = new Acc();

    const stemH = h * 0.34;
    acc.add(stemGeometry(r * 0.34, r * 0.5, stemH, Math.max(5, T.radial - 3)),
      put(1, 1, 1, 0, 0, 0, 0, 0, 0), jitterColor(WORLD.stem, rng, 0.16));

    const budH = h - stemH;
    const petal = this.level.zone >= 5 ? WORLD.flowerAlt : WORLD.flower;
    acc.add(new THREE.SphereGeometry(r, T.radial, T.cap + 2).scale(1, budH / r * 0.62, 1),
      put(1, 1, 1, 0, 0, 0, 0, stemH + budH * 0.38, 0), jitterColor(petal, rng, 0.12));
    // The tip pinches closed — that pinch is the whole difference between a bud
    // and a berry.
    acc.add(new THREE.ConeGeometry(r * 0.55, budH * 0.5, T.radial, 1),
      put(1, 1, 1, 0, 0, 0, 0, stemH + budH * 0.78, 0), jitterColor(petal, rng, 0.1));

    const sepals = 4;
    for (let i = 0; i < sepals; i++) {
      const a = (i / sepals) * TAU + rng() * 0.2;
      acc.add(petalGeometry(budH * 0.62, r * 0.34, budH * 0.1),
        put(1, 1, 1, -0.95, a, 0, Math.cos(a) * r * 0.4, stemH + budH * 0.1, Math.sin(a) * r * 0.4),
        jitterColor(WORLD.mossDark, rng, 0.2));
    }
    this._emit(acc, g, this.matSolid);
  }

  /** Pebble: a lump, flattened to the collider height so it reads as low. */
  _pebble(o) {
    const rng = this._rng;
    const r = o.r || 0.2;
    const h = o.h || r * 0.85;
    const g = this._seat(o.x || 0, o.z || 0, 0.85);
    const acc = new Acc();
    const grey = jitterColor(0x9a9384, rng, 0.24);
    acc.add(lumpGeometry(r, this.tier.detail > 0 ? 1 : 0, rng, (h / r) * 0.9),
      put(1, 1, 1, 0, rng() * TAU, 0, 0, h * 0.5, 0), grey);
    if (this.tier.detail > 0) {
      acc.add(lumpGeometry(r * 0.42, 0, rng, 0.5),
        put(1, 1, 1, 0, rng() * TAU, 0, r * 0.3, h * 0.62, -r * 0.25),
        jitterColor(WORLD.mossLight, rng, 0.2));
    }
    this._emit(acc, g, this.matSolid);
  }

  /* ------------------------------------------------------------------ *
   * Decorative dressing — `level.props`, no collider, no consequence
   * ------------------------------------------------------------------ */

  _buildDressing() {
    const list = this.level.props || [];
    // `instances.props` is the world's dressing budget; a board never gets near
    // it, but honouring it keeps the low tier honest on weak hardware.
    const cap = Math.max(2, Math.round((this.tier.dress) * list.length));
    for (let i = 0; i < list.length && i < cap; i++) {
      const p = list[i];
      if (!p) continue;
      switch (p.kind) {
        case 'mossTuft': this._mossTuft(p); break;
        case 'flower': this._flower(p); break;
        case 'fern': this._fern(p); break;
        case 'seedPod': this._seedPod(p); break;
        case 'glowCap': this._glowCap(p); break;
        case 'mushroomShelf': this._shelf(p); break;
        case 'silkStrand': if (this.tier.silk) this._silk(p); break;
        default: break;
      }
    }
  }

  _mossTuft(p) {
    const rng = this._rng;
    const s = p.scale || 1;
    const g = this._seat(p.x || 0, p.z || 0, 0.8, p.rot || 0);
    const acc = new Acc();
    const n = 7 + Math.floor(rng() * 6 * this.tier.dress);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU;
      const rad = rng() * 0.16 * s;
      const h = (0.09 + rng() * 0.13) * s;
      acc.add(bladeGeometry(h, 0.018 * s, (rng() - 0.5) * h * 0.7),
        put(1, 1, 1, (rng() - 0.5) * 0.5, a, (rng() - 0.5) * 0.4,
          Math.cos(a) * rad, 0, Math.sin(a) * rad),
        rng() < 0.35 ? jitterColor(WORLD.mossLight, rng, 0.2) : jitterColor(WORLD.moss, rng, 0.22));
    }
    // A low mat under the blades so the tuft has a body, not just spikes.
    acc.add(new THREE.SphereGeometry(0.15 * s, 9, 5).scale(1, 0.28, 1),
      put(1, 1, 1, 0, 0, 0, 0, 0.012 * s, 0), jitterColor(WORLD.mossDark, rng, 0.16));
    this._emit(acc, g, this.matSolid);
  }

  _flower(p) {
    const rng = this._rng;
    const s = p.scale || 1;
    const g = this._seat(p.x || 0, p.z || 0, 0.6, p.rot || rng() * TAU);
    const acc = new Acc();

    const stemH = (0.22 + rng() * 0.1) * s;
    acc.add(stemGeometry(0.014 * s, 0.022 * s, stemH, 5),
      put(1, 1, 1, 0, 0, 0, 0, 0, 0), jitterColor(WORLD.stem, rng, 0.18));
    // One leaf halfway up the stalk. Cheap, and it kills the lollipop read.
    acc.add(petalGeometry(0.11 * s, 0.05 * s, 0.02 * s),
      put(1, 1, 1, -0.5, rng() * TAU, 0, 0, stemH * 0.45, 0),
      jitterColor(WORLD.stem, rng, 0.2));

    const petals = 5 + Math.floor(rng() * 2);
    const col = rng() < 0.5 ? WORLD.flower : WORLD.flowerAlt;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU;
      acc.add(petalGeometry(0.1 * s, 0.045 * s, 0.018 * s),
        put(1, 1, 1, -0.42, a, 0, 0, stemH, 0), jitterColor(col, rng, 0.1));
    }
    acc.add(new THREE.SphereGeometry(0.032 * s, 8, 5).scale(1, 0.7, 1),
      put(1, 1, 1, 0, 0, 0, 0, stemH + 0.012 * s, 0), WORLD.flowerAlt);
    this._emit(acc, g, this.matSolid);
  }

  _fern(p) {
    const rng = this._rng;
    const s = p.scale || 1;
    const g = this._seat(p.x || 0, p.z || 0, 0.6, p.rot || 0);
    const acc = new Acc();

    const fronds = 3;
    for (let k = 0; k < fronds; k++) {
      const fa = (k / fronds) * TAU + rng() * 0.4;
      const len = (0.3 + rng() * 0.12) * s;
      const rise = (0.16 + rng() * 0.06) * s;
      // The stalk arcs over; leaflets hang off it in shrinking pairs.
      const segs = 5 + this.tier.detail;
      for (let i = 0; i < segs; i++) {
        const t = i / (segs - 1);
        const px = Math.cos(fa) * len * t;
        const pz = Math.sin(fa) * len * t;
        const py = Math.sin(t * Math.PI * 0.62) * rise;
        const w = (1 - t * 0.8);
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          acc.add(petalGeometry(0.075 * s * w, 0.022 * s * w, 0.008 * s),
            put(1, 1, 1, -0.25, fa + sgn * 1.35, 0, px, py, pz),
            jitterColor(sgn > 0 ? WORLD.moss : WORLD.vine, rng, 0.18));
        }
      }
      acc.add(stemGeometry(0.008 * s, 0.014 * s, rise * 0.9, 4),
        put(1, 1, 1, 0, 0, 0, 0, 0, 0), jitterColor(WORLD.stem, rng, 0.15));
    }
    this._emit(acc, g, this.matSolid);
  }

  _seedPod(p) {
    const rng = this._rng;
    const s = p.scale || 1;
    const g = this._seat(p.x || 0, p.z || 0, 0.85, p.rot || 0);
    const acc = new Acc();
    const r = 0.075 * s;
    acc.add(lumpGeometry(r, 1, rng, 1.5),
      put(1, 1, 1, 0.2, rng() * TAU, 0.15, 0, r * 1.1, 0), jitterColor(WORLD.seed, rng, 0.14));
    // The pappus: a few pale hairs, the reason a seed pod reads as *drifting*.
    if (this.tier.detail > 0) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        acc.add(bladeGeometry(0.09 * s, 0.006 * s, 0.02 * s),
          put(1, 1, 1, -0.6, a, 0, 0, r * 2.0, 0), 0xf6f1dd);
      }
    }
    acc.add(stemGeometry(0.006 * s, 0.01 * s, r * 1.1, 4),
      put(1, 1, 1, 0, 0, 0, 0, 0, 0), jitterColor(WORLD.stem, rng, 0.15));
    this._emit(acc, g, this.matSolid);
  }

  /** A little cluster of lantern mushrooms — the deep zones' only light source
   *  that is not the burrow, so it stays small and stays near the rim. */
  _glowCap(p) {
    const rng = this._rng;
    const s = p.scale || 1;
    const g = this._seat(p.x || 0, p.z || 0, 0.7, p.rot || 0);
    const solid = new Acc();
    const glow = new Acc();
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU;
      const rad = rng() * 0.09 * s;
      const r = (0.035 + rng() * 0.03) * s;
      const h = (0.09 + rng() * 0.07) * s;
      const ox = Math.cos(a) * rad, oz = Math.sin(a) * rad;
      solid.add(stemGeometry(r * 0.4, r * 0.55, h, 6),
        put(1, 1, 1, 0, 0, 0, ox, 0, oz), jitterColor(WORLD.mushroomStem, rng, 0.1));
      glow.add(domeGeometry(r, r * 0.85, 9, 5),
        put(1, 1, 1, 0, 0, 0, ox, h, oz), jitterColor(WORLD.mushroomGlowCap, rng, 0.1));
    }
    this._emit(solid, g, this.matSolid);
    this._emit(glow, g, this.matGlow);
  }

  /** Bracket fungus: stacked half-discs off a stub, hugging the rim. */
  _shelf(p) {
    const rng = this._rng;
    const s = p.scale || 1;
    const g = this._seat(p.x || 0, p.z || 0, 0.9, p.rot || 0);
    const acc = new Acc();
    const n = 3;
    for (let i = 0; i < n; i++) {
      const r = (0.13 - i * 0.026) * s;
      const y = (0.02 + i * 0.045) * s;
      acc.add(new THREE.CylinderGeometry(r, r * 0.72, 0.022 * s, 12, 1, false, -0.8, 2.4),
        put(1, 1, 1, 0.14, i * 0.5, 0, 0, y, 0),
        i % 2 ? jitterColor(0xe8d6b2, rng, 0.1) : jitterColor(WORLD.mushroomCap, rng, 0.18));
    }
    this._emit(acc, g, this.matSolid);
  }

  /** A strand of spider silk, arcing just above the blade. Faint on purpose:
   *  it is atmosphere, and the player must be able to see straight through it. */
  _silk(p) {
    const s = p.scale || 1;
    const rot = p.rot || 0;
    const g = this._seat(p.x || 0, p.z || 0, 0, rot);

    const acc = new Acc();
    const len = 0.9 * s;
    const rise = 0.22 * s;
    const segs = 8;
    const P = [], UV = [], I = [];
    const w = 0.006 * s;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const z = (t - 0.5) * len;
      const y = Math.sin(t * Math.PI) * rise + 0.02;
      P.push(-w, y, z, w, y, z);
      UV.push(0, t, 1, t);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const strand = new THREE.BufferGeometry();
    strand.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    strand.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    strand.setIndex(I);
    strand.computeVertexNormals();
    acc.add(strand, put(1, 1, 1, 0, 0, 0, 0, 0, 0), WORLD.silk);

    // Two beads of caught dew. They are what makes a silk strand legible at all
    // against a green blade.
    for (let k = 0; k < 2; k++) {
      const t = 0.32 + k * 0.34;
      acc.add(new THREE.SphereGeometry(0.016 * s, 7, 5),
        put(1, 1, 1, 0, 0, 0, 0, Math.sin(t * Math.PI) * rise + 0.012, (t - 0.5) * len),
        WORLD.silk);
    }
    const mesh = this._emit(acc, g, this.matSilk);
    if (mesh) mesh.renderOrder = 2;   // after the blade, before the beetles
  }

  /* ------------------------------------------------------------------ *
   * Movers
   * ------------------------------------------------------------------ */

  _buildMovers() {
    const list = (this.level.board && this.level.board.movers) || [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m) continue;
      const rec = m.kind === 'caterpillar' ? this._caterpillar(m, i) : this._dew(m, i);
      if (rec) this._movers.push(rec);
    }
  }

  /**
   * A dew drop. It never spins: water has no features to spin, and the baked
   * highlight would swing around the light if it did — which reads as a glass
   * marble, not a drop.
   */
  _dew(m, i) {
    const r = m.r != null ? m.r : 0.38;
    const g = new THREE.Group();
    g.name = `mover${i}`;
    const T = this.tier;

    const body = new THREE.SphereGeometry(r, T.radial + 6, T.cap + 4);
    // Drops sit, they do not float: flatten the bottom slightly and let the
    // squash in update() do the rest.
    const pos = body.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      if (y < 0) pos.setY(v, y * (0.82 + 0.18 * (1 + y / r)));
    }
    body.computeVertexNormals();
    const mesh = new THREE.Mesh(body, this.matDew);
    mesh.renderOrder = 3;
    g.add(mesh);
    this._geos.push(body);

    // A fixed specular bead near the sun side. Cheaper and far more readable
    // than asking the standard material for a sharp highlight at this size.
    const spark = new THREE.SphereGeometry(r * 0.24, 7, 5);
    const sp = new THREE.Mesh(spark, this.matSpark);
    sp.position.set(-r * 0.36, r * 0.58, -r * 0.30);
    sp.renderOrder = 4;
    g.add(sp);
    this._geos.push(spark);

    this.group.add(g);
    return { group: g, kind: 'dew', r, spin: false, undulate: 0, seg: null };
  }

  /** A caterpillar: beaded body, undulating, facing the way it walks. */
  _caterpillar(m, i) {
    const rng = this._rng;
    const r = m.r != null ? m.r : 0.3;
    const g = new THREE.Group();
    g.name = `mover${i}`;
    const T = this.tier;
    const seg = [];
    const n = 6;
    const bodyCol = this.level.zone >= 5 ? 0x9fd8b0 : 0xcfe36a;

    for (let s = 0; s < n; s++) {
      const t = s / (n - 1);
      const rr = r * (1 - t * 0.42) * (s === 0 ? 1.08 : 1);
      const acc = new Acc();
      acc.add(new THREE.SphereGeometry(rr, T.radial, T.cap + 1),
        put(1, 0.9, 1, 0, 0, 0, 0, 0, 0),
        s === 0 ? jitterColor(0xf2c65a, rng, 0.08) : jitterColor(bodyCol, rng, 0.1));
      if (s === 0) {
        // Eyes and stubby antennae — the whole personality budget for a body
        // that is on screen for one level.
        for (let e = -1; e <= 1; e += 2) {
          acc.add(new THREE.SphereGeometry(rr * 0.17, 7, 5),
            put(1, 1, 1, 0, 0, 0, e * rr * 0.38, rr * 0.22, rr * 0.82), 0x1c1a16);
          acc.add(new THREE.CylinderGeometry(rr * 0.05, rr * 0.07, rr * 0.7, 5),
            put(1, 1, 1, -0.5, 0, e * 0.4, e * rr * 0.3, rr * 0.85, rr * 0.3),
            jitterColor(0x8c6a3a, rng, 0.1));
        }
      } else if (s < n - 1) {
        for (let e = -1; e <= 1; e += 2) {
          acc.add(new THREE.SphereGeometry(rr * 0.16, 6, 4).scale(1, 0.8, 1.3),
            put(1, 1, 1, 0, 0, 0, e * rr * 0.78, -rr * 0.5, 0), 0x6d8a3a);
        }
      }
      const mesh = this._emit(acc, g, this.matSolid);
      if (mesh) {
        mesh.matrixAutoUpdate = true;
        mesh.position.set(0, 0, -t * r * 1.55);
        seg.push({ mesh, t });
      }
    }

    this.group.add(g);
    return { group: g, kind: 'caterpillar', r, spin: false, undulate: 1, seg };
  }

  /* ------------------------------------------------------------------ *
   * Runtime
   * ------------------------------------------------------------------ */

  /** The platform hands down its `flexAt` so props ride the blade's bow. */
  setFlexFn(fn) {
    this._flexFn = typeof fn === 'function' ? fn : null;
  }

  /** Static props only follow the flex; everything else about them is baked. */
  update(dt, elapsed) {
    if (this._disposed) return;
    this._elapsed = elapsed || (this._elapsed + (dt > 0 ? dt : 0));
    const flex = this._flexFn;
    if (!flex) return;
    const list = this._statics;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      s.group.position.y = s.base + flex(s.x, s.z);
    }
  }

  /**
   * Drive the movers from the live solver bodies.
   * @param {Array} movers  LeafSim.movers
   * @param {number} alpha  render interpolation between the last two fixed steps
   */
  updateMovers(movers, alpha) {
    if (this._disposed || !this._movers.length) return;
    const a = typeof alpha === 'number' && isFinite(alpha) ? clamp01(alpha) : 1;
    const flex = this._flexFn;
    const t = this._elapsed;

    for (let i = 0; i < this._movers.length; i++) {
      const rec = this._movers[i];
      const b = movers && movers[i];
      if (!b) { rec.group.visible = false; continue; }
      if (b.state === 'captured' || b.state === 'rescued') { rec.group.visible = false; continue; }
      rec.group.visible = true;

      const x = lerp(b.px, b.x, a);
      const y = lerp(b.py, b.y, a);
      const z = lerp(b.pz, b.z, a);
      rec.group.position.set(x, y + (flex ? flex(x, z) : 0), z);

      // Impact squash, conserving volume so the drop does not change size.
      const sq = clamp(b.squash || 0, 0, 0.42);
      rec.group.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);

      if (rec.kind === 'caterpillar') {
        // Face the way it is going, and only re-aim when it is actually moving:
        // atan2 on a stationary body is pure jitter.
        const dx = b.x - b.px, dz = b.z - b.pz;
        if (dx * dx + dz * dz > 1e-8) rec.group.rotation.y = Math.atan2(dx, dz);
        const seg = rec.seg;
        if (seg) {
          const amp = Math.min(0.055, 0.012 + (b.speed || 0) * 0.05);
          for (let s = 0; s < seg.length; s++) {
            const o = seg[s];
            // A travelling wave down the body — the crawl, in one line.
            o.mesh.position.y = Math.sin(t * 6.5 - o.t * 4.2) * amp * (0.3 + o.t * 0.7);
            o.mesh.position.x = Math.sin(t * 3.1 - o.t * 2.6) * amp * 0.5 * o.t;
          }
        }
      }
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (let i = 0; i < this._geos.length; i++) this._geos[i].dispose();
    for (let i = 0; i < this._mats.length; i++) this._mats[i].dispose();
    this._geos.length = 0;
    this._mats.length = 0;
    this._statics.length = 0;
    this._movers.length = 0;
    this._flexFn = null;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
  }
}

export default BoardProps;
