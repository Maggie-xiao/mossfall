/**
 * MOSSFALL — the beetles.
 *
 * One job: turn a `BugState` into a small creature you want to help.
 *
 * The whole design turns on a single split. The **shell** is a true sphere that
 * takes `bug.spin` verbatim, so what you see rolling is exactly what the solver
 * says is rolling. Everything that makes it alive — the underbody, head, eyes,
 * antennae, legs — hangs off a sibling node that counter-rotates back to board
 * space, so the creature never tumbles inside its own carapace.
 *
 * That is also why the shell is a whole sphere rather than the squashed dome the
 * silhouette suggests: a non-spherical body wobbles as it rolls, and the wobble
 * reads as broken physics. The dome comes from an *upright* underbody — a surface
 * of revolution about the same vertical axis — that hides the lower third of the
 * ball behind a hard rim standing a few percent proud of it. Because both are
 * revolutions about one axis and the rim never touches the ball, the shell can
 * spin to any orientation without ever surfacing through its own underside. You
 * get a domed, high-shouldered beetle that still rolls honestly.
 *
 * Geometry, materials and pattern textures are cached at module scope and shared
 * between every instance of the same species/colour/quality; an instance owns only
 * its transform state and the one shell material it flashes on capture.
 */

import * as THREE from 'three';
import {
  TAU, clamp, clamp01, lerp, damp, sstep, wrapPi,
  easeOutCubic, makeRng, randRange, Spring2,
} from '../core/math.js';
import { insect as insectPalette } from '../data/palette.js';

/* ===================================================================== *
 * Quality tiers
 *
 * Triangle budget is spent almost entirely on the shell, because the shell is
 * the silhouette. Everything else is deliberately chunky — at play distance a
 * beetle is roughly sixty pixels across and only the outline survives.
 * ===================================================================== */

const TIERS = {
  low: {
    key: 'low',
    shell: [10, 5], skirt: [8, 2], head: [6, 4], eye: [5, 3],
    tex: [128, 64], eyeTex: [32, 16],
    legs: false, brows: false, collar: false, foot: false, club: false,
    stubAntennae: true, physical: false, shadow: false,
  },
  medium: {
    key: 'medium',
    shell: [12, 6], skirt: [10, 3], head: [7, 4], eye: [6, 3],
    tex: [192, 96], eyeTex: [48, 24],
    legs: true, brows: false, collar: true, foot: false, club: true,
    stubAntennae: false, physical: false, shadow: true,
  },
  high: {
    key: 'high',
    shell: [14, 8], skirt: [12, 3], head: [8, 5], eye: [6, 4],
    tex: [256, 128], eyeTex: [64, 32],
    legs: true, brows: true, collar: true, foot: true, club: true,
    stubAntennae: false, physical: true, shadow: true,
  },
};

/** Accepts a tier name or anything the settings module hands out. */
function tierOf(quality) {
  let n = quality;
  if (n && typeof n === 'object') {
    n = n.insect || n.tier || n.name || n.id || n.level || n.quality;
  }
  if (typeof n !== 'string') return TIERS.medium;
  return TIERS[n.toLowerCase()] || TIERS.medium;
}

/* ===================================================================== *
 * Species — proportions in *unit ball* space: the shell is a sphere of
 * radius 1 centred on the origin, so the ground is always y = -1 and the
 * whole rig scales by `bug.r` at the root.
 *
 * `skirtY - skirtRy === -1` for every species: the underbody must close exactly
 * on the ball's contact point or the beetle floats. `skirtY` alone decides how
 * much dome shows — that is where the ladybug's high shoulders and the scarab's
 * broad low back come from, without either of them deforming the rolling ball.
 * ===================================================================== */

const SPECIES = {
  ladybug: {
    skirtY: -0.55, skirtRy: 0.45,
    headR: 0.30, headZ: 0.90, headY: -0.10,
    eyeR: 0.105, eyeX: 0.155, eyeY: 0.085, eyeZ: 0.225,
    antLen: 0.46, antPitch: 0.48, antRoll: 0.36,
    legLen: 0.55, legThick: 1.0,
    extra: 'none',
    mat: { rough: 0.26, metal: 0.03, cc: 1.0, ccRough: 0.07, opacity: 1, emissive: 0 },
  },
  beetle: {
    skirtY: -0.48, skirtRy: 0.52,
    headR: 0.29, headZ: 0.92, headY: -0.10,
    eyeR: 0.100, eyeX: 0.150, eyeY: 0.080, eyeZ: 0.225,
    antLen: 0.52, antPitch: 0.54, antRoll: 0.32,
    legLen: 0.58, legThick: 0.95,
    extra: 'none',
    mat: { rough: 0.17, metal: 0.45, cc: 1.0, ccRough: 0.04, opacity: 1, emissive: 0.04 },
  },
  scarab: {
    skirtY: -0.34, skirtRy: 0.66,
    headR: 0.32, headZ: 0.88, headY: -0.12,
    eyeR: 0.095, eyeX: 0.165, eyeY: 0.075, eyeZ: 0.235,
    antLen: 0.34, antPitch: 0.40, antRoll: 0.44,
    legLen: 0.60, legThick: 1.2,
    extra: 'horn',
    mat: { rough: 0.74, metal: 0.06, cc: 0.0, ccRough: 0.6, opacity: 1, emissive: 0 },
  },
  roly: {
    skirtY: -0.62, skirtRy: 0.38,
    headR: 0.27, headZ: 0.93, headY: -0.08,
    eyeR: 0.100, eyeX: 0.145, eyeY: 0.080, eyeZ: 0.215,
    antLen: 0.30, antPitch: 0.62, antRoll: 0.30,
    legLen: 0.46, legThick: 0.9,
    extra: 'none',
    mat: { rough: 0.40, metal: 0.12, cc: 0.6, ccRough: 0.18, opacity: 1, emissive: 0 },
  },
  firefly: {
    skirtY: -0.50, skirtRy: 0.50,
    headR: 0.28, headZ: 0.91, headY: -0.09,
    eyeR: 0.105, eyeX: 0.150, eyeY: 0.085, eyeZ: 0.220,
    antLen: 0.56, antPitch: 0.50, antRoll: 0.30,
    legLen: 0.52, legThick: 0.85,
    extra: 'lantern',
    mat: { rough: 0.30, metal: 0.0, cc: 0.8, ccRough: 0.10, opacity: 0.88, emissive: 0.18 },
  },
  weevil: {
    skirtY: -0.44, skirtRy: 0.56,
    headR: 0.26, headZ: 0.90, headY: -0.11,
    eyeR: 0.095, eyeX: 0.135, eyeY: 0.085, eyeZ: 0.200,
    antLen: 0.40, antPitch: 0.44, antRoll: 0.40,
    legLen: 0.50, legThick: 0.9,
    extra: 'snout',
    mat: { rough: 0.56, metal: 0.02, cc: 0.3, ccRough: 0.3, opacity: 1, emissive: 0 },
  },
};

const speciesOf = (k) => SPECIES[k] || SPECIES.ladybug;

/* --- expressions ------------------------------------------------------ *
 * Eye shape does nearly all the work. The head is near-black and the eyes are
 * cream, so shrinking an eye in y *is* an eyelid — no separate lid geometry,
 * and it still reads at sixty pixels. Brows are pale stitched strokes (a dark
 * brow on a dark head is invisible) and only exist at high quality.
 */
const EXPR = {
  calm:  { open: 1.00, wide: 1.00, pitch: 0.00, size: 1.00, spin: 0, browY: 0.115, browTilt: 0.05 },
  zoom:  { open: 0.44, wide: 1.14, pitch: 0.12, size: 0.96, spin: 0, browY: 0.075, browTilt: 0.42 },
  dizzy: { open: 1.06, wide: 1.06, pitch: 0.00, size: 1.06, spin: 1, browY: 0.170, browTilt: -0.34 },
  happy: { open: 0.32, wide: 1.16, pitch: -0.34, size: 1.02, spin: 0, browY: 0.160, browTilt: -0.30 },
};

/* Leg azimuths, measured from the nose (+Z) toward the right (+X). */
const LEG_AZ = [0.62, 1.57, 2.52, -0.62, -1.57, -2.52];
/* Alternating tripod: RF + LM + RB step together, LF + RM + LB oppose. */
const LEG_PHASE = [0, Math.PI, 0, Math.PI, 0, Math.PI];
const HIP_R = 0.62;
const HIP_Y = -0.62;

const BLINK_DUR = 0.15;
const POP_DUR = 0.72;

/* ===================================================================== *
 * Shared caches
 * ===================================================================== */

const geoCache = new Map();
const texCache = new Map();
const matCache = new Map();

function cached(map, key, make) {
  let v = map.get(key);
  if (v === undefined) { v = make(); map.set(key, v); }
  return v;
}

/**
 * Release every shared geometry, texture and material. Call it only once every
 * live InsectView has been disposed — the caches are shared by design, so this
 * is a teardown, not a per-level sweep.
 */
export function disposeInsectCache() {
  geoCache.forEach((g) => { if (g && g.dispose) g.dispose(); });
  texCache.forEach((t) => { if (t && t.dispose) t.dispose(); });
  matCache.forEach((m) => { if (m && m.dispose) m.dispose(); });
  geoCache.clear();
  texCache.clear();
  matCache.clear();
}

/* ===================================================================== *
 * Geometry helpers
 * ===================================================================== */

const _identity = new THREE.Matrix4();

/**
 * Merge a handful of small parts into one buffer. Only position/normal/uv, which
 * is all any of these primitives carry — the point is draw calls, not features.
 * Source geometries are consumed (disposed) by the caller.
 */
function mergeParts(parts) {
  let vTot = 0, iTot = 0;
  for (let i = 0; i < parts.length; i++) {
    const g = parts[i].geo;
    vTot += g.attributes.position.count;
    iTot += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vTot * 3);
  const nrm = new Float32Array(vTot * 3);
  const uv = new Float32Array(vTot * 2);
  const idx = vTot > 65535 ? new Uint32Array(iTot) : new Uint16Array(iTot);

  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  let vo = 0, io = 0;

  for (let i = 0; i < parts.length; i++) {
    const g = parts[i].geo;
    const m = parts[i].matrix || _identity;
    nm.getNormalMatrix(m);
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const t = g.attributes.uv;
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k).applyMatrix4(m);
      pos[(vo + k) * 3] = v.x; pos[(vo + k) * 3 + 1] = v.y; pos[(vo + k) * 3 + 2] = v.z;
      if (n) {
        v.fromBufferAttribute(n, k).applyMatrix3(nm).normalize();
        nrm[(vo + k) * 3] = v.x; nrm[(vo + k) * 3 + 1] = v.y; nrm[(vo + k) * 3 + 2] = v.z;
      }
      if (t) { uv[(vo + k) * 2] = t.getX(k); uv[(vo + k) * 2 + 1] = t.getY(k); }
    }
    const gi = g.index;
    const count = gi ? gi.count : p.count;
    for (let k = 0; k < count; k++) idx[io + k] = (gi ? gi.getX(k) : k) + vo;
    vo += p.count;
    io += count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

function shellGeo(tier) {
  return cached(geoCache, `shell:${tier.key}`, () =>
    new THREE.SphereGeometry(1, tier.shell[0], tier.shell[1]));
}

function headGeo(tier) {
  return cached(geoCache, `head:${tier.key}`, () =>
    new THREE.SphereGeometry(1, tier.head[0], tier.head[1]));
}

function eyeGeo(tier) {
  return cached(geoCache, `eye:${tier.key}`, () =>
    new THREE.SphereGeometry(1, tier.eye[0], tier.eye[1]));
}

function browGeo() {
  return cached(geoCache, 'brow', () => new THREE.BoxGeometry(1, 1, 1));
}

/** How far the elytral rim stands proud of the ball it hides. */
const RIM_FLARE = 1.07;

/**
 * Underbody: the lower half of an ellipsoid of revolution that closes exactly on
 * the ball's contact point, capped by a flat shelf where it meets the shell, plus
 * (above low) a pronotum plate at the front-top. The plate is the one piece that
 * tells you which way the creature faces while the shell behind it spins freely.
 *
 * Half an ellipsoid rather than a whole one because two *tangent* tessellated
 * domes always interpenetrate somewhere near the tangency — facets of a rolling
 * shell would strobe through the waist. A hard rim standing 7% proud of the ball
 * has no tangency to go wrong, and it is what a real elytral margin looks like.
 */
function bodyGeo(tier, sp, speciesKey) {
  return cached(geoCache, `body:${tier.key}:${speciesKey}`, () => {
    const parts = [];
    const ballAtRim = Math.sqrt(Math.max(0, 1 - sp.skirtY * sp.skirtY));
    const rimR = ballAtRim * RIM_FLARE;

    const skirt = new THREE.SphereGeometry(
      1, tier.skirt[0], tier.skirt[1], 0, TAU, Math.PI * 0.5, Math.PI * 0.5);
    parts.push({
      geo: skirt,
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(0, sp.skirtY, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(rimR, sp.skirtRy, rimR)),
    });

    // The shelf's inner edge is deliberately buried inside the faceted sphere, so
    // no parked orientation of the shell can open a seam between the two.
    const shelf = new THREE.RingGeometry(ballAtRim * 0.94, rimR, tier.skirt[0], 1);
    parts.push({
      geo: shelf,
      matrix: new THREE.Matrix4().makeTranslation(0, sp.skirtY, 0)
        .multiply(new THREE.Matrix4().makeRotationX(-Math.PI * 0.5)),
    });

    let collar = null;
    if (tier.collar) {
      collar = new THREE.SphereGeometry(1, 6, 3);
      const a = 0.84;                        // radians from straight up
      const dir = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      parts.push({
        geo: collar,
        matrix: new THREE.Matrix4().compose(
          dir.clone().multiplyScalar(0.97), q, new THREE.Vector3(0.44, 0.11, 0.36)),
      });
    }

    // At low quality the antennae lose their own draw call and become static
    // stubs on the chassis — the silhouette survives, the animation does not.
    const stubs = [];
    if (tier.stubAntennae) {
      for (let s = -1; s <= 1; s += 2) {
        const g = new THREE.CylinderGeometry(0.03, 0.055, sp.antLen, 3, 1, true);
        stubs.push(g);
        const e = new THREE.Euler(sp.antPitch, 0, -s * sp.antRoll, 'ZXY');
        const q = new THREE.Quaternion().setFromEuler(e);
        const off = new THREE.Vector3(0, sp.antLen * 0.5, 0).applyQuaternion(q);
        parts.push({
          geo: g,
          matrix: new THREE.Matrix4().compose(
            new THREE.Vector3(s * 0.135 + off.x, 0.05 + off.y, 1.0 + off.z),
            q, new THREE.Vector3(1, 1, 1)),
        });
      }
    }

    const merged = mergeParts(parts);
    skirt.dispose();
    shelf.dispose();
    if (collar) collar.dispose();
    for (let i = 0; i < stubs.length; i++) stubs[i].dispose();
    return merged;
  });
}

/** A limb lying along +X from the hip at the origin, unit length, with a foot. */
function legGeo(tier) {
  return cached(geoCache, `leg:${tier.key}`, () => {
    const shaft = new THREE.CylinderGeometry(0.035, 0.085, 1, 3, 1, true);
    const toX = new THREE.Matrix4().makeRotationZ(-Math.PI / 2)
      .multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0));
    const parts = [{ geo: shaft, matrix: toX }];
    let foot = null;
    if (tier.foot) {
      foot = new THREE.SphereGeometry(0.055, 4, 2);
      parts.push({ geo: foot, matrix: new THREE.Matrix4().makeTranslation(1, 0, 0) });
    }
    const merged = mergeParts(parts);
    shaft.dispose();
    if (foot) foot.dispose();
    return merged;
  });
}

/** An antenna standing along +Y from its socket at the origin, unit length. */
function antennaGeo(tier) {
  return cached(geoCache, `ant:${tier.key}`, () => {
    const stalk = new THREE.CylinderGeometry(0.028, 0.05, 1, 4, 1, true);
    const parts = [{ geo: stalk, matrix: new THREE.Matrix4().makeTranslation(0, 0.5, 0) }];
    let club = null;
    if (tier.club) {
      club = new THREE.SphereGeometry(0.075, 4, 3);
      parts.push({ geo: club, matrix: new THREE.Matrix4().makeTranslation(0, 1, 0) });
    }
    const merged = mergeParts(parts);
    stalk.dispose();
    if (club) club.dispose();
    return merged;
  });
}

function extraGeo(tier, kind) {
  if (kind === 'snout') {
    return cached(geoCache, 'extra:snout', () => new THREE.ConeGeometry(0.085, 0.22, 5, 1));
  }
  if (kind === 'horn') {
    return cached(geoCache, 'extra:horn', () => new THREE.ConeGeometry(0.10, 0.30, 5, 1));
  }
  if (kind === 'lantern') {
    return cached(geoCache, `extra:lantern:${tier.key}`, () =>
      new THREE.SphereGeometry(1, tier.eye[0] + 1, tier.eye[1] + 1));
  }
  return null;
}

/* ===================================================================== *
 * Pattern textures
 *
 * One small equirectangular canvas per (species, colour, size), drawn once and
 * shared by every beetle that wants it. Longitude is u, colatitude is v with
 * v = 0 at the top pole, which is exactly how SphereGeometry lays out its UVs,
 * so a spot placed at (lon, lat) lands where you asked for it.
 * ===================================================================== */

const css = (hex) => '#' + ((hex >>> 0) & 0xffffff).toString(16).padStart(6, '0');

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function makeCanvas(w, h) {
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  } catch (err) { /* headless or hostile environment — fall through */ }
  return null;
}

/**
 * A disc of constant *angular* radius on the sphere. Near the poles a parallel
 * covers far less arc per pixel, so the ellipse has to widen by 1/sin(lat) or the
 * spot pinches into a slit; the floor stops that blowing up at the pole itself.
 */
function drawSpot(ctx, w, h, lon, lat, ang, fill) {
  const x = (((lon % TAU) + TAU) % TAU) / TAU * w;
  const y = (lat / Math.PI) * h;
  const rx = (ang / TAU) * w / Math.max(0.18, Math.sin(lat));
  const ry = (ang / Math.PI) * h;
  ctx.fillStyle = fill;
  for (let k = -1; k <= 1; k++) {
    ctx.beginPath();
    ctx.ellipse(x + k * w, y, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
}

/** A great-circle stripe through both poles — the elytra seam. */
function drawMeridian(ctx, w, h, lon, ang, fill) {
  const x0 = (((lon % TAU) + TAU) % TAU) / TAU * w;
  ctx.fillStyle = fill;
  for (let py = 0; py < h; py++) {
    const lat = ((py + 0.5) / h) * Math.PI;
    const hw = (ang * 0.5 / TAU) * w / Math.max(0.16, Math.sin(lat));
    for (let k = -1; k <= 1; k++) ctx.fillRect(x0 + k * w - hw, py, hw * 2, 1);
  }
}

function drawBand(ctx, w, h, lat0, lat1, fill) {
  ctx.fillStyle = fill;
  const y0 = (lat0 / Math.PI) * h;
  ctx.fillRect(-1, y0, w + 2, ((lat1 - lat0) / Math.PI) * h);
}

/** Longitude of the seam. Front of the shell is u = 0.25 in SphereGeometry UVs. */
const SEAM = Math.PI * 0.5;

/** Coccinella septempunctata, near enough for a toy: one scutellar spot on the
 *  seam and three per elytron. Only red ladybugs get it; the rest get a tidy six. */
const SEVEN_SPOT = [
  [0.00, 0.46, 0.150],
  [0.62, 0.78, 0.185],
  [1.06, 1.16, 0.200],
  [0.50, 1.44, 0.165],
];
const SIX_SPOT = [
  [0.55, 0.72, 0.180],
  [0.92, 1.14, 0.190],
  [0.45, 1.46, 0.155],
];

/* --- flat-illustration restyles ------------------------------------- *
 *
 * Five (species, colour) combos repainted after the art team's reference
 * sheets. Each painter owns its whole canvas — background included — so the
 * palette base fill and the species' procedural pattern never show through.
 * Every other combo keeps the procedural pattern in the switch below.
 *
 * The shell only revolves about its vertical axis, so patterns live in
 * colatitude 0..~2.3 (the skirt hides the rest) and must read at every
 * longitude — hence full rings of motifs, not a single "front" design.
 */

/** A meridian stripe that wanders in longitude as it descends — the scroll
 *  pattern's building block. */
function wavyMeridian(ctx, w, h, lon, ang, amp, freq, phase, fill, lat0, lat1) {
  ctx.fillStyle = fill;
  const py0 = Math.max(0, Math.floor((lat0 / Math.PI) * h));
  const py1 = Math.min(h, Math.ceil((lat1 / Math.PI) * h));
  for (let py = py0; py < py1; py++) {
    const lat = ((py + 0.5) / h) * Math.PI;
    const x0 = ((((lon + Math.sin(lat * freq + phase) * amp) % TAU) + TAU) % TAU) / TAU * w;
    const hw = (ang * 0.5 / TAU) * w / Math.max(0.16, Math.sin(lat));
    for (let k = -1; k <= 1; k++) ctx.fillRect(x0 + k * w - hw, py, hw * 2, 1);
  }
}

/** An organic ink blotch: a few overlapping angular discs. */
function drawBlob(ctx, w, h, lon, lat, size, rng, fill) {
  const n = 2 + Math.floor(rng() * 2);
  drawSpot(ctx, w, h, lon, lat, size, fill);
  for (let i = 0; i < n; i++) {
    drawSpot(ctx, w, h,
      lon + (rng() - 0.5) * size * 2.2,
      clamp(lat + (rng() - 0.5) * size * 1.8, 0.15, 2.6),
      size * (0.45 + rng() * 0.35), fill);
  }
}

/** 2# roly/orange — golden shell, bold ink dots (yellow-ladybug reference). */
function paintGoldDots(ctx, w, h) {
  ctx.fillStyle = '#f0a81f';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.28;
  drawBand(ctx, w, h, 2.0, Math.PI, '#b26f0c');
  ctx.globalAlpha = 1;
  const ink = '#161114';
  const SET = [
    [0.00, 0.40, 0.140],
    [0.62, 0.72, 0.165],
    [1.12, 1.10, 0.175],
    [0.54, 1.38, 0.150],
    [1.28, 1.66, 0.130],
    [2.05, 1.30, 0.150],   // the far flank keeps its dots as the shell spins
    [2.62, 0.78, 0.150],
  ];
  for (let i = 0; i < SET.length; i++) {
    const [d, lat, ang] = SET[i];
    if (d === 0) drawSpot(ctx, w, h, SEAM, lat, ang, ink);
    else {
      drawSpot(ctx, w, h, SEAM + d, lat, ang, ink);
      drawSpot(ctx, w, h, SEAM - d, lat, ang, ink);
    }
  }
  drawMeridian(ctx, w, h, SEAM, 0.048, ink);
}

/** 5# beetle/yellow — parchment shell, black scrollwork (Colorado-beetle
 *  reference): a forked centre seam, wandering stripes, hooks and dot trios. */
function paintScrollwork(ctx, w, h, rng) {
  ctx.fillStyle = '#d8c19e';
  ctx.fillRect(0, 0, w, h);
  const ink = '#17120f';
  // Forked seam: a stout centre with two shadows riding its shoulders.
  drawMeridian(ctx, w, h, SEAM, 0.075, ink);
  wavyMeridian(ctx, w, h, SEAM + 0.26, 0.048, 0.06, 2.4, 0.4, ink, 0.25, 1.45);
  wavyMeridian(ctx, w, h, SEAM - 0.26, 0.048, 0.06, 2.4, 2.8, ink, 0.25, 1.45);
  // Bold scroll stripes ring the whole shell — this pattern is mostly ink.
  // Stripes start below the crown: meridians that run all the way up converge
  // into a starburst at the pole, which the reference never shows.
  const STRIPES = [0.72, 1.30, 1.95, 2.60];
  for (let i = 0; i < STRIPES.length; i++) {
    const d = STRIPES[i];
    const amp = 0.16 + (i % 2) * 0.07;
    wavyMeridian(ctx, w, h, SEAM + d, 0.065, amp, 1.7, i * 1.7, ink, 0.55, 2.4);
    wavyMeridian(ctx, w, h, SEAM - d, 0.065, amp, 1.7, i * 1.7 + 0.9, ink, 0.55, 2.4);
  }
  // Hooks: fat commas hanging off the shoulder line.
  for (let s = -1; s <= 1; s += 2) {
    for (const [d, lat] of [[1.0, 0.55], [2.25, 0.62]]) {
      drawSpot(ctx, w, h, SEAM + s * d, lat, 0.105, ink);
      drawSpot(ctx, w, h, SEAM + s * (d + 0.22), lat + 0.22, 0.070, ink);
    }
  }
  // Dot clusters in the remaining fields.
  for (let i = 0; i < 8; i++) {
    const lon = randRange(rng, 0, TAU);
    const lat = randRange(rng, 1.3, 2.25);
    for (let k = 0; k < 3; k++) {
      drawSpot(ctx, w, h, lon + (rng() - 0.5) * 0.35, clamp(lat + (rng() - 0.5) * 0.3, 0.2, 2.5),
        randRange(rng, 0.035, 0.055), ink);
    }
  }
}

/** 3# beetle/green — gouache green, confetti of cream and butter dots. */
function paintDottedGreen(ctx, w, h, rng) {
  ctx.fillStyle = '#2f9e5f';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.25;
  drawBand(ctx, w, h, 2.1, Math.PI, '#1b6a3e');
  ctx.globalAlpha = 1;
  const INKS = ['#f2ecd2', '#f6df6e', '#e9d8a3'];
  for (let row = 0; row < 9; row++) {
    const lat = 0.30 + row * 0.26;
    const n = Math.max(4, Math.round(11 * Math.sin(lat)));
    const off = rng() * TAU;
    for (let i = 0; i < n; i++) {
      if (rng() < 0.1) continue;   // a few gaps keep it hand-placed
      drawSpot(ctx, w, h,
        off + (i / n) * TAU + (rng() - 0.5) * 0.3,
        clamp(lat + (rng() - 0.5) * 0.14, 0.18, 2.5),
        randRange(rng, 0.07, 0.115),
        INKS[Math.floor(rng() * INKS.length)]);
    }
  }
  drawMeridian(ctx, w, h, SEAM, 0.028, '#1d6f42');
}

/** 6# firefly/purple — blossom-pink shell under cow-hide ink patches. */
function paintPinkPatches(ctx, w, h, rng) {
  ctx.fillStyle = '#f0a3d8';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.30;
  drawBand(ctx, w, h, 2.05, Math.PI, '#c268a4');
  ctx.globalAlpha = 1;
  const ink = '#181116';
  // Patch ring per latitude band, jittered so no two headings look alike.
  const BANDS = [[0.60, 3], [1.25, 3], [1.85, 3]];
  for (const [lat, count] of BANDS) {
    const off = rng() * TAU;
    for (let i = 0; i < count; i++) {
      drawBlob(ctx, w, h,
        off + (i / count) * TAU + (rng() - 0.5) * 0.5,
        lat + (rng() - 0.5) * 0.22,
        randRange(rng, 0.22, 0.30), rng, ink);
    }
  }
  drawSpot(ctx, w, h, SEAM + 0.3, 0.26, 0.17, ink);   // crown patch, off-centre
  drawMeridian(ctx, w, h, SEAM, 0.030, '#331c2c');
}

/** 8# scarab/blue — night-blue shell, ember mottling, big cream ovals. */
function paintBlueOvals(ctx, w, h, rng) {
  ctx.fillStyle = '#2f6cd8';
  ctx.fillRect(0, 0, w, h);
  // Rust clouds bleeding through the blue, built from stacked soft passes.
  ctx.globalAlpha = 0.24;
  for (let i = 0; i < 11; i++) {
    const lon = randRange(rng, 0, TAU);
    const lat = randRange(rng, 0.5, 2.1);
    const s = randRange(rng, 0.30, 0.55);
    drawSpot(ctx, w, h, lon, lat, s, '#c23a24');
    drawSpot(ctx, w, h, lon + 0.1, lat + 0.05, s * 0.6, '#b93321');
  }
  ctx.globalAlpha = 1;
  // Cream ovals in staggered columns — tall, so two stacked discs each.
  const cream = '#f1e5c3';
  const COLS = [0.55, 1.15, 1.78, 2.45, 3.05];
  for (let s = -1; s <= 1; s += 2) {
    for (let ci = 0; ci < COLS.length; ci++) {
      const lats = ci % 2 ? [0.85, 1.55] : [0.55, 1.25, 1.9];
      for (const lat of lats) {
        const lon = SEAM + s * COLS[ci] + (rng() - 0.5) * 0.12;
        const la = lat + (rng() - 0.5) * 0.1;
        const ang = randRange(rng, 0.135, 0.165);
        drawSpot(ctx, w, h, lon, la, ang, cream);
        drawSpot(ctx, w, h, lon, la + ang * 0.7, ang * 0.88, cream);
      }
    }
  }
  drawMeridian(ctx, w, h, SEAM, 0.026, '#12224a');
}

const RESTYLED = {
  'roly:orange': paintGoldDots,        // 2#
  'beetle:yellow': paintScrollwork,    // 5#
  'beetle:green': paintDottedGreen,    // 3#
  'firefly:purple': paintPinkPatches,  // 6#
  'scarab:blue': paintBlueOvals,       // 8#
};

/** Matte the restyled shells down to the references' flat-paint finish; the
 *  species' own material params keep serving every other colour. */
const RESTYLED_MAT = {
  'roly:orange': { roughness: 0.34, metalness: 0.05 },
  'beetle:yellow': { roughness: 0.52, metalness: 0.05 },
  'beetle:green': { roughness: 0.52, metalness: 0.05 },
  'scarab:blue': { roughness: 0.68, metalness: 0.03 },
};

function paintShell(ctx, w, h, species, colorKey, c) {
  const rng = makeRng(hashStr(species + ':' + colorKey));
  const spot = css(c.spot);
  const dark = css(c.shellDark);

  const custom = RESTYLED[species + ':' + colorKey];
  if (custom) { custom(ctx, w, h, rng); return; }

  switch (species) {
    case 'ladybug': {
      const set = colorKey === 'red' ? SEVEN_SPOT : SIX_SPOT;
      for (let i = 0; i < set.length; i++) {
        const [d, lat, ang] = set[i];
        if (d === 0) drawSpot(ctx, w, h, SEAM, lat, ang, spot);
        else {
          drawSpot(ctx, w, h, SEAM + d, lat, ang, spot);
          drawSpot(ctx, w, h, SEAM - d, lat, ang, spot);
        }
      }
      drawMeridian(ctx, w, h, SEAM, 0.055, spot);
      break;
    }

    case 'beetle': {
      // Fake iridescence: soft hue bands that sweep as the shell rolls. Cheaper
      // and more legible at this size than any real thin-film term.
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0.00, css(c.shell));
      g.addColorStop(0.18, css(c.glow));
      g.addColorStop(0.36, css(c.shell));
      g.addColorStop(0.55, css(c.accent));
      g.addColorStop(0.72, css(c.shell));
      g.addColorStop(0.88, css(c.glow));
      g.addColorStop(1.00, css(c.shell));
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      drawMeridian(ctx, w, h, SEAM, 0.075, spot);
      drawMeridian(ctx, w, h, SEAM + 0.9, 0.028, dark);
      drawMeridian(ctx, w, h, SEAM - 0.9, 0.028, dark);
      break;
    }

    case 'scarab': {
      // Ridged and matte: longitudinal grooves, deliberately uneven.
      for (let i = 0; i < 12; i++) {
        const lon = (i / 12) * TAU + 0.13;
        drawMeridian(ctx, w, h, lon, 0.030 + (i % 3) * 0.008, dark);
      }
      ctx.globalAlpha = 0.5;
      drawBand(ctx, w, h, 1.42, 1.72, dark);
      ctx.globalAlpha = 1;
      break;
    }

    case 'roly': {
      // Armoured plates. Bands of constant colatitude need no distortion fix.
      const edges = [0.34, 0.62, 0.92, 1.24, 1.58, 1.92, 2.24, 2.54];
      for (let i = 0; i < edges.length; i++) {
        drawBand(ctx, w, h, edges[i] - 0.030, edges[i] + 0.030, dark);
        ctx.globalAlpha = 0.28;
        drawBand(ctx, w, h, edges[i] + 0.030, edges[i] + 0.105, spot);
        ctx.globalAlpha = 1;
      }
      break;
    }

    case 'firefly': {
      ctx.globalAlpha = 0.45;
      drawBand(ctx, w, h, 0.0, 0.55, css(c.accent));
      ctx.globalAlpha = 1;
      drawMeridian(ctx, w, h, SEAM, 0.045, dark);
      drawMeridian(ctx, w, h, SEAM + 0.75, 0.020, dark);
      drawMeridian(ctx, w, h, SEAM - 0.75, 0.020, dark);
      break;
    }

    case 'weevil':
    default: {
      for (let i = 0; i < 46; i++) {
        const lat = randRange(rng, 0.16, 2.95);
        const lon = randRange(rng, 0, TAU);
        drawSpot(ctx, w, h, lon, lat, randRange(rng, 0.035, 0.075), i % 4 ? spot : dark);
      }
      drawMeridian(ctx, w, h, SEAM, 0.040, dark);
      break;
    }
  }
}

function shellTexture(species, colorKey, tier) {
  const w = tier.tex[0], h = tier.tex[1];
  const key = `shell:${species}:${colorKey}:${w}`;
  return cached(texCache, key, () => {
    const c = insectPalette(colorKey);
    const cv = makeCanvas(w, h);
    if (!cv) return null;
    const ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = css(c.shell);
    ctx.fillRect(0, 0, w, h);
    paintShell(ctx, w, h, species, colorKey, c);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    return tex;
  });
}

/**
 * The eye is one textured sphere: cream sclera, a fat pupil at the front, a
 * baked highlight. Rotating the ball *is* looking, so both eyes cost a single
 * instanced draw call and dizzy spirals come for free.
 */
function eyeTexture(tier) {
  const w = tier.eyeTex[0], h = tier.eyeTex[1];
  return cached(texCache, `eye:${w}`, () => {
    const cv = makeCanvas(w, h);
    if (!cv) return null;
    const ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff3e2';
    ctx.fillRect(0, 0, w, h);
    const cx = w * 0.25, cy = h * 0.5;
    const pr = w * 0.135;
    ctx.fillStyle = '#160d10';
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.ellipse(cx + k * w, cy, pr, pr * (h / (w * 0.5)), 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx - pr * 0.34, cy - pr * 0.42, pr * 0.30, pr * 0.34, 0, 0, TAU);
    ctx.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

/* ===================================================================== *
 * Materials
 * ===================================================================== */

function shellMaterialTemplate(species, colorKey, tier) {
  return cached(matCache, `shell:${tier.key}:${species}:${colorKey}`, () => {
    const c = insectPalette(colorKey);
    const sp = speciesOf(species);
    const map = shellTexture(species, colorKey, tier);
    const params = {
      color: map ? 0xffffff : c.shell,
      map: map || null,
      roughness: sp.mat.rough,
      metalness: sp.mat.metal,
      emissive: new THREE.Color(c.glow),
      emissiveIntensity: sp.mat.emissive,
    };
    const tweak = RESTYLED_MAT[species + ':' + colorKey];
    if (tweak) Object.assign(params, tweak);
    if (sp.mat.opacity < 1) { params.transparent = true; params.opacity = sp.mat.opacity; }
    if (tier.physical && sp.mat.cc > 0) {
      const m = new THREE.MeshPhysicalMaterial(params);
      m.clearcoat = sp.mat.cc;
      m.clearcoatRoughness = sp.mat.ccRough;
      return m;
    }
    return new THREE.MeshStandardMaterial(params);
  });
}

function bodyMaterial(colorKey) {
  return cached(matCache, `body:${colorKey}`, () => {
    const c = insectPalette(colorKey);
    return new THREE.MeshStandardMaterial({ color: c.shellDark, roughness: 0.62, metalness: 0.04 });
  });
}

/** Head, legs and antennae all share the near-black chitin. */
function chitinMaterial(colorKey) {
  return cached(matCache, `chitin:${colorKey}`, () => {
    const c = insectPalette(colorKey);
    return new THREE.MeshStandardMaterial({ color: c.spot, roughness: 0.45, metalness: 0.08 });
  });
}

function browMaterial(colorKey) {
  return cached(matCache, `brow:${colorKey}`, () => {
    const c = insectPalette(colorKey);
    return new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.7, metalness: 0 });
  });
}

function eyeMaterial(tier) {
  return cached(matCache, `eye:${tier.key}`, () => {
    const map = eyeTexture(tier);
    return new THREE.MeshStandardMaterial({
      color: map ? 0xffffff : 0xfff3e2,
      map: map || null,
      roughness: 0.16,
      metalness: 0.0,
    });
  });
}

function lanternTemplate(colorKey) {
  return cached(matCache, `lantern:${colorKey}`, () => {
    const c = insectPalette(colorKey);
    return new THREE.MeshStandardMaterial({
      color: c.accent,
      emissive: new THREE.Color(c.glow),
      emissiveIntensity: 1.1,
      roughness: 0.35,
      metalness: 0,
    });
  });
}

/* ===================================================================== *
 * Frame scratch — module scope, because none of this may allocate per frame.
 * ===================================================================== */

const UP = new THREE.Vector3(0, 1, 0);
const _fx = new THREE.Vector3();
const _fy = new THREE.Vector3();
const _fz = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _eul = new THREE.Euler();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();

/* ===================================================================== *
 * InsectView
 * ===================================================================== */

class InsectView {
  constructor(spec, tier) {
    const speciesKey = SPECIES[spec.species] ? spec.species : 'ladybug';
    const colorKey = spec.color || 'red';
    const sp = speciesOf(speciesKey);

    this.id = spec.id || 'bug';
    this.species = speciesKey;
    this.color = colorKey;
    this.tier = tier;
    this.sp = sp;
    this.r = spec.r > 0 ? spec.r : 0.3;
    /** Set false if the director wants to own placement (e.g. interpolated). */
    this.ownsPosition = true;

    this._dead = false;
    this._disposed = false;
    this._ownMats = [];

    const rng = makeRng(hashStr(this.id + colorKey + speciesKey) || 7);
    this._rng = rng;
    this._phase = randRange(rng, 0, TAU);

    /* --- hierarchy ---------------------------------------------------- *
     * group → frame → deform → upright → { shell | rig }.
     * `frame` carries the contact-normal + heading basis and the root scale,
     * `deform` does squash/stretch inside that basis, and `upright` undoes the
     * basis rotation so the shell's spin and the rig's heading are plain
     * board-space values. */
    this.group = new THREE.Group();
    this.group.name = `insect:${this.id}`;
    this.frame = new THREE.Object3D();
    this.deform = new THREE.Object3D();
    this.upright = new THREE.Object3D();
    this.shellPivot = new THREE.Object3D();
    this.rig = new THREE.Object3D();
    this.head = new THREE.Object3D();

    this.group.add(this.frame);
    this.frame.add(this.deform);
    this.deform.add(this.upright);
    this.upright.add(this.shellPivot);
    this.upright.add(this.rig);
    this.rig.add(this.head);

    /* --- shell -------------------------------------------------------- */
    const shellMat = shellMaterialTemplate(speciesKey, colorKey, tier).clone();
    this._ownMats.push(shellMat);
    this.shellMat = shellMat;
    this._baseEmissive = sp.mat.emissive;
    this.shell = new THREE.Mesh(shellGeo(tier), shellMat);
    this.shell.castShadow = true;
    this.shell.receiveShadow = true;
    this.shell.frustumCulled = false;
    this.shellPivot.add(this.shell);

    /* --- underbody ---------------------------------------------------- */
    this.body = new THREE.Mesh(bodyGeo(tier, sp, speciesKey), bodyMaterial(colorKey));
    this.body.castShadow = tier.shadow;
    this.body.receiveShadow = true;
    this.body.frustumCulled = false;
    this.rig.add(this.body);

    /* --- head --------------------------------------------------------- */
    const chitin = chitinMaterial(colorKey);
    this.headMesh = new THREE.Mesh(headGeo(tier), chitin);
    this.headMesh.position.set(0, sp.headY, sp.headZ);
    this.headMesh.scale.set(sp.headR * 1.06, sp.headR * 0.92, sp.headR);
    this.headMesh.frustumCulled = false;
    this.head.add(this.headMesh);

    this.eyes = new THREE.InstancedMesh(eyeGeo(tier), eyeMaterial(tier), 2);
    this.eyes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.eyes.frustumCulled = false;
    this.head.add(this.eyes);

    this.brows = null;
    if (tier.brows) {
      this.brows = new THREE.InstancedMesh(browGeo(), browMaterial(colorKey), 2);
      this.brows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.brows.frustumCulled = false;
      this.head.add(this.brows);
    }

    this.antennae = null;
    if (!tier.stubAntennae) {
      this.antennae = new THREE.InstancedMesh(antennaGeo(tier), chitin, 2);
      this.antennae.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.antennae.frustumCulled = false;
      this.head.add(this.antennae);
    }

    /* --- legs --------------------------------------------------------- */
    this.legs = null;
    if (tier.legs) {
      this.legs = new THREE.InstancedMesh(legGeo(tier), chitin, 6);
      this.legs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.legs.frustumCulled = false;
      this.rig.add(this.legs);
    }

    /* --- species flourish --------------------------------------------- */
    this.lanternMat = null;
    this.extra = null;
    const eg = extraGeo(tier, sp.extra);
    if (eg) {
      if (sp.extra === 'lantern') {
        const lm = lanternTemplate(colorKey).clone();
        this._ownMats.push(lm);
        this.lanternMat = lm;
        this.extra = new THREE.Mesh(eg, lm);
        this.extra.scale.set(0.42, 0.34, 0.44);
        this.extra.position.set(0, -0.50, -0.62);
        this.rig.add(this.extra);
      } else if (sp.extra === 'snout') {
        this.extra = new THREE.Mesh(eg, chitin);
        this.extra.position.set(0, sp.headY - 0.03, sp.headZ + 0.30);
        this.extra.rotation.x = Math.PI * 0.5;
        this.head.add(this.extra);
      } else {
        this.extra = new THREE.Mesh(eg, chitin);           // scarab horn
        this.extra.position.set(0, sp.headY + 0.26, sp.headZ + 0.10);
        this.extra.rotation.x = 0.55;                      // +x tips the tip forward
        this.head.add(this.extra);
      }
      this.extra.frustumCulled = false;
    }

    /* --- animation state ---------------------------------------------- */
    // Droop that puts this species' foot exactly on the ground, so short-legged
    // rolies crouch and long-legged scarabs stand tall instead of every beetle
    // sharing one angle and half of them sinking into the leaf.
    this._droop0 = Math.asin(clamp((HIP_Y + 1) / sp.legLen, 0.1, 0.98));
    this._heading = 0;
    this._up = new THREE.Vector3(0, 1, 0);
    this._settle = new THREE.Quaternion();
    this._uprightBlend = 1;
    this._tumbleX = 0;
    this._tumbleZ = 0;
    this._gait = randRange(rng, 0, TAU);
    this._lookYaw = 0;
    this._lookTarget = 0;
    this._lookTimer = randRange(rng, 0.8, 3.0);
    this._blinkTimer = randRange(rng, 0.8, 4.0);
    this._blinking = 0;
    this._twitch = 0;
    this._glow = 0;
    this._popT = -1;
    this._dizzyT = 0;
    this._pSquash = 0;
    this._pvx = 0;
    this._pvz = 0;
    this._prevState = 'roll';
    this._dizPhase = 0;

    this._exprName = 'calm';
    this._exprHold = 0;
    this._ex = {
      open: 1, wide: 1, pitch: 0, size: 1, spin: 0,
      browY: EXPR.calm.browY, browTilt: EXPR.calm.browTilt,
    };

    // Slightly different rates per antenna so the pair never moves as one part.
    this._antSpring = new Spring2({ freq: 11.5, damping: 0.55 });
    this._antSpring2 = new Spring2({ freq: 13.0, damping: 0.6 });

    // Prime every instanced buffer so nothing renders at the identity matrix
    // for one frame before the first update lands.
    this._writeLegs(0, 0.80, 1, 0);
    this._writeAntennae(0, 0);
    this._writeFace(1, 0);
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  /** 'calm' | 'zoom' | 'dizzy' | 'happy', or 'auto' to hand control back. */
  setExpression(name) {
    if (this._dead) return;
    if (name === 'auto') { this._exprHold = 0; return; }
    if (!EXPR[name]) return;
    this._exprName = name;
    this._exprHold = 1.5;
  }

  /** A delighted jump-spin. Safe to call at any time; restarts if already popping. */
  pop() {
    if (this._dead) return;
    this._popT = 0;
    this.glow(0.85);
    this.setExpression('happy');
  }

  /** Emissive flash, `t` = strength 0..1. Decays on its own. */
  glow(t) {
    if (this._dead) return;
    const s = t == null ? 1 : clamp01(t);
    if (s > this._glow) this._glow = s;
  }

  update(dt, elapsed, bug) {
    if (this._dead || !bug) return;
    try {
      this._tick(clamp(dt || 0, 0, 0.06), elapsed || 0, bug);
    } catch (err) {
      // One failure disables the view rather than killing the frame.
      this._dead = true;
      this.group.visible = false;
      console.error('[insect] update failed, view disabled:', err);
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._dead = true;
    try {
      if (this.group && this.group.parent) this.group.parent.remove(this.group);
      for (let i = 0; i < this._ownMats.length; i++) this._ownMats[i].dispose();
      this._ownMats.length = 0;
      if (this.eyes) this.eyes.dispose();
      if (this.brows) this.brows.dispose();
      if (this.antennae) this.antennae.dispose();
      if (this.legs) this.legs.dispose();
    } catch (err) {
      console.error('[insect] dispose:', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * Per-frame
   * ------------------------------------------------------------------ */

  _tick(dt, elapsed, bug) {
    const r = bug.r > 0 ? bug.r : this.r;
    this.r = r;

    const state = bug.state || 'roll';
    const captureT = state === 'captured' ? clamp01(bug.captureT || 0) : 0;
    const vx = bug.vx || 0, vz = bug.vz || 0;
    const speed = bug.speed != null ? bug.speed : Math.hypot(vx, vz);
    const squash = clamp01(bug.squash || 0);
    const restT = bug.restT || 0;

    /* --- state transitions -------------------------------------------- */
    if (state !== this._prevState) {
      if (state === 'falling') this._dizzyT = 0.6;
      else if (this._prevState === 'falling' || this._prevState === 'rescued') this._dizzyT = 1.1;
      if (state === 'captured' && this._popT < 0) this.pop();
      this._prevState = state;
    }
    // A hard knock leaves them briefly seeing stars.
    if (squash > 0.55 && this._pSquash <= 0.55) this._dizzyT = 0.85;
    this._pSquash = squash;
    if (this._dizzyT > 0) this._dizzyT -= dt;

    const falling = state === 'falling';
    const loose = falling ? 1 : (state === 'rescued' ? 0.45 : 0);

    /* --- pop ----------------------------------------------------------- */
    let hop = 0, popSpin = 0, popScale = 1, popSquash = 0;
    if (this._popT >= 0) {
      this._popT += dt;
      const t = this._popT / POP_DUR;
      if (t >= 1) {
        this._popT = -1;
      } else {
        hop = Math.sin(Math.PI * t) * 0.9 * (1 - 0.22 * t);
        popSpin = TAU * easeOutCubic(t);
        popScale = 1 + 0.10 * Math.sin(Math.PI * t);
        if (t < 0.16) popSquash = 0.55 * (1 - t / 0.16);
        else if (t > 0.86) popSquash = 0.4 * ((t - 0.86) / 0.14);
      }
    }

    /* --- placement ------------------------------------------------------ */
    const sink = -0.8 * r * captureT * captureT;
    if (this.ownsPosition) this.group.position.set(bug.x || 0, (bug.y || 0) + sink, bug.z || 0);
    this.group.visible = captureT < 0.985;
    if (!this.group.visible) return;

    /* --- heading -------------------------------------------------------- */
    if (speed > 0.18) {
      const want = Math.atan2(vx, vz);
      this._heading += wrapPi(want - this._heading) * (1 - Math.exp(-9 * dt));
    }

    /* --- the frame: up = contact normal, forward = travel ---------------- */
    // Only leaning most of the way onto the surface normal: a beetle standing
    // exactly perpendicular to a curling rim looks drunk, not grounded.
    let nx = 0, ny = 1, nz = 0;
    const cn = bug.contactNormal;
    if (cn && isFinite(cn.y)) {
      const l = Math.hypot(cn.x, cn.y, cn.z);
      if (l > 1e-4) { nx = cn.x / l; ny = cn.y / l; nz = cn.z / l; }
    }
    const w = 0.7 * (1 - loose);
    _vt.set(nx * w, 1 + (ny - 1) * w, nz * w);
    if (_vt.lengthSq() < 1e-6) _vt.copy(UP);
    _vt.normalize();
    this._up.lerp(_vt, 1 - Math.exp(-10 * dt)).normalize();
    _fy.copy(this._up);

    _fz.set(Math.sin(this._heading), 0, Math.cos(this._heading));
    _fz.addScaledVector(_fy, -_fz.dot(_fy));
    if (_fz.lengthSq() < 1e-6) _fz.set(0, 0, 1);
    _fz.normalize();
    _fx.crossVectors(_fy, _fz).normalize();
    _mat.makeBasis(_fx, _fy, _fz);
    this.frame.quaternion.setFromRotationMatrix(_mat);

    if (loose > 0.001) {
      this._tumbleX += dt * 4.2 * loose;
      this._tumbleZ += dt * 2.7 * loose;
      _eul.set(this._tumbleX, 0, this._tumbleZ, 'XYZ');
      _qa.setFromEuler(_eul);
      this.frame.quaternion.multiply(_qa);
    } else {
      this._tumbleX = damp(this._tumbleX, 0, 6, dt);
      this._tumbleZ = damp(this._tumbleZ, 0, 6, dt);
    }

    // The solver stands the beetle on the *rigid* field, because collision must
    // never see the flex. `flexY` is the blade's visible displacement under this
    // body, published on the state by the platform each frame; adding it here —
    // on `frame`, which is plain board space — is what keeps the feet on the
    // surface the player can see and on the same plane as the contact shadow.
    // Undefined whenever there is no leaf under the creature, and then it is 0.
    this.frame.position.y = hop * r + (isFinite(bug.flexY) ? bug.flexY : 0);
    this.frame.scale.setScalar(r * popScale * (1 - 0.62 * captureT));

    // Counter-rotation. Blending it away is what lets a falling beetle tumble
    // for real while a rolling one always keeps its head up.
    this._uprightBlend = damp(this._uprightBlend, 1 - loose * 0.85, 6, dt);
    _qa.copy(this.frame.quaternion).invert();
    if (this._uprightBlend > 0.999) this.upright.quaternion.copy(_qa);
    else this.upright.quaternion.identity().slerp(_qa, this._uprightBlend);

    /* --- squash & stretch, inside the frame ------------------------------ */
    const idle = clamp01(restT * 1.4) * (1 - sstep(0.05, 0.45, speed));
    const breath = Math.sin(elapsed * 1.55 + this._phase) * idle;
    const sq = clamp01(squash + popSquash) * 0.40;
    const st = clamp01(speed / 6.5) * 0.18;
    this.deform.scale.set(
      (1 + sq * 0.55) * (1 - st * 0.45) * (1 - breath * 0.020),
      (1 - sq) * (1 - st * 0.30) * (1 + breath * 0.035),
      (1 + sq * 0.55) * (1 + st));

    /* --- the shell rolls -------------------------------------------------- */
    // `rspin` is the roll sampled at the render instant — the director slerps
    // the two fixed states into it immediately before this call. `spin` is the
    // raw end-of-step value and is only the fallback for the first frame and
    // for bodies that have never rolled. This is the one and only place the
    // roll is applied; the root group carries position, never orientation.
    const spin = bug.rspin && bug.rspin.isQuaternion
      ? bug.rspin
      : (bug.spin && bug.spin.isQuaternion ? bug.spin : null);
    if (spin) {
      // Parked beetles quietly right themselves so the pattern faces the player.
      // Only the tilt is removed, never the twist, so it reads as settling
      // rather than as the shell snapping to a pose.
      const settling = state === 'roll' && speed < 0.14 && restT > 0.35 && captureT === 0;
      if (settling) {
        _vt.copy(UP).applyQuaternion(spin);
        _qb.setFromUnitVectors(_vt, UP);
      } else {
        _qb.identity();
      }
      this._settle.slerp(_qb, 1 - Math.exp(-(settling ? 2.4 : 10) * dt));
      this.shellPivot.quaternion.copy(this._settle).multiply(spin);
    }
    if (popSpin !== 0) {
      _qc.setFromAxisAngle(UP, popSpin);
      this.shellPivot.quaternion.premultiply(_qc);
    }

    /* --- the creature stays upright --------------------------------------- */
    this.rig.rotation.y = this._heading + popSpin;
    this.rig.position.y = breath * 0.028;

    /* --- expression -------------------------------------------------------- */
    if (this._exprHold > 0) this._exprHold -= dt;
    let want = 'calm';
    if (falling) want = 'dizzy';
    else if (state === 'captured') want = 'happy';
    else if (this._dizzyT > 0) want = 'dizzy';
    else if (speed > 3.2) want = 'zoom';
    if (this._exprHold > 0) want = this._exprName;
    else this._exprName = want;

    const tgt = EXPR[want] || EXPR.calm;
    const ex = this._ex;
    const k = 1 - Math.exp(-11 * dt);
    ex.open += (tgt.open - ex.open) * k;
    ex.wide += (tgt.wide - ex.wide) * k;
    ex.pitch += (tgt.pitch - ex.pitch) * k;
    ex.size += (tgt.size - ex.size) * k;
    ex.spin += (tgt.spin - ex.spin) * k;
    ex.browY += (tgt.browY - ex.browY) * k;
    ex.browTilt += (tgt.browTilt - ex.browTilt) * k;

    /* --- blinks, looking around -------------------------------------------- */
    this._blinkTimer -= dt;
    if (this._blinkTimer <= 0) {
      this._blinking = BLINK_DUR;
      // Most blinks are lonely; a few come in pairs, which is the tell that
      // makes a cadence feel observed rather than scheduled.
      this._blinkTimer = this._rng() < 0.22 ? 0.19 : randRange(this._rng, 2.3, 5.6);
    }
    let blink = 1;
    if (this._blinking > 0) {
      this._blinking -= dt;
      const p = clamp01(1 - this._blinking / BLINK_DUR);
      blink = Math.max(0.07, 1 - Math.sin(p * Math.PI));
    }

    this._lookTimer -= dt;
    if (this._lookTimer <= 0) {
      if (idle > 0.45) {
        this._lookTarget = randRange(this._rng, -0.30, 0.30);
        this._twitch = randRange(this._rng, 0.25, 0.55) * (this._rng() < 0.5 ? -1 : 1);
      } else {
        this._lookTarget = 0;
      }
      this._lookTimer = randRange(this._rng, 1.5, 4.2);
    }
    this._lookYaw = damp(this._lookYaw, this._lookTarget * idle, 3.2, dt);
    this._twitch = damp(this._twitch, 0, 7, dt);

    this.head.rotation.y = this._lookYaw;
    this.head.rotation.x = ex.pitch * 0.35 - loose * 0.25;
    this.head.position.y = breath * 0.016;

    this._dizPhase += dt * 7.5;
    if (this._dizPhase > 1e5) this._dizPhase -= 1e5;
    this._writeFace(blink, ex.spin);

    /* --- antennae: they lag, then catch up --------------------------------- */
    const inv = dt > 1e-5 ? 1 / dt : 0;
    let ax = (vx - this._pvx) * inv;
    let az = (vz - this._pvz) * inv;
    this._pvx = vx; this._pvz = vz;
    const am = Math.hypot(ax, az);
    if (am > 60) { ax *= 60 / am; az *= 60 / am; }        // collisions spike; clamp
    const sh = Math.sin(this._heading), ch = Math.cos(this._heading);
    const driveF = -(ax * sh + az * ch) * 0.016;
    const driveS = -(ax * ch - az * sh) * 0.016 + this._twitch * 0.4;
    const a1 = this._antSpring.step(dt, driveF, driveS);
    const lagF = clamp(a1.x, -0.7, 0.7);
    const lagS = clamp(a1.y, -0.7, 0.7);
    const a2 = this._antSpring2.step(dt, driveF * 0.85, driveS * 0.85);
    this._writeAntennae(
      lagF + loose * Math.sin(elapsed * 9.1) * 0.5,
      lagS * 0.6 + clamp(a2.y, -0.7, 0.7) * 0.4 + loose * Math.sin(elapsed * 7.3) * 0.4);

    /* --- legs: scuttle, tuck, splay ----------------------------------------- */
    if (this.legs) {
      // Tucking is the whole reason the shell reads as a ball at speed: past
      // walking pace the legs vanish under the skirt and only the sphere is left.
      const tuck = sstep(2.4, 4.6, speed);
      const move = sstep(0.06, 0.9, speed) * (1 - tuck);
      this._gait += (speed / Math.max(r, 0.05)) * dt * 0.55 + move * dt * 2.2;
      if (this._gait > 1e5) this._gait -= 1e5;
      const droop = lerp(lerp(this._droop0 - 0.06, this._droop0 + 0.05, move), 1.34, tuck);
      const len = lerp(1, 0.30, tuck) * (1 + loose * 0.1);
      const flail = loose;
      this._writeLegs(move + flail * 0.9, droop, len, flail);
    }

    /* --- glow ----------------------------------------------------------------- */
    this._glow = damp(this._glow, 0, 4.2, dt);
    if (this._glow < 1e-3) this._glow = 0;
    this.shellMat.emissiveIntensity = this._baseEmissive + this._glow * 1.9;
    if (this.lanternMat) {
      // A firefly breathes light even when nothing has happened.
      const pulse = 0.55 + 0.45 * Math.sin(elapsed * 2.1 + this._phase);
      this.lanternMat.emissiveIntensity = 0.7 + pulse * 0.9 + this._glow * 2.2;
    }
  }

  /* ------------------------------------------------------------------ *
   * Instanced writers — all scratch, no allocation.
   * ------------------------------------------------------------------ */

  _writeFace(blink, spinAmt) {
    const sp = this.sp;
    const ex = this._ex;
    const eyeR = sp.eyeR * ex.size;
    const sx = Math.sin(this._dizPhase), cx = Math.cos(this._dizPhase);

    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      _pos.set(s * sp.eyeX, sp.headY + sp.eyeY, sp.headZ + sp.eyeZ);
      // Rotating the eyeball aims the baked pupil: a cone sweep is the spiral.
      _eul.set(
        ex.pitch + spinAmt * 0.34 * sx,
        s * 0.14 + spinAmt * 0.34 * cx,
        0, 'YXZ');
      _qa.setFromEuler(_eul);
      _scl.set(eyeR * ex.wide, eyeR * ex.open * blink, eyeR);
      _mat.compose(_pos, _qa, _scl);
      this.eyes.setMatrixAt(i, _mat);
    }
    this.eyes.instanceMatrix.needsUpdate = true;

    if (this.brows) {
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        _pos.set(s * sp.eyeX, sp.headY + sp.eyeY + ex.browY, sp.headZ + sp.eyeZ - 0.055);
        _eul.set(-0.30, 0, s * ex.browTilt, 'XYZ');
        _qa.setFromEuler(_eul);
        _scl.set(sp.eyeR * 2.0, sp.eyeR * 0.34, sp.eyeR * 0.5);
        _mat.compose(_pos, _qa, _scl);
        this.brows.setMatrixAt(i, _mat);
      }
      this.brows.instanceMatrix.needsUpdate = true;
    }
  }

  _writeAntennae(lagF, lagS) {
    if (!this.antennae) return;
    const sp = this.sp;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      _pos.set(s * 0.135, sp.headY + 0.15, sp.headZ + 0.12);
      _eul.set(sp.antPitch + lagF, 0, -s * sp.antRoll + lagS, 'ZXY');
      _qa.setFromEuler(_eul);
      _scl.set(1, sp.antLen, 1);
      _mat.compose(_pos, _qa, _scl);
      this.antennae.setMatrixAt(i, _mat);
    }
    this.antennae.instanceMatrix.needsUpdate = true;
  }

  _writeLegs(move, droop, lenScale, flail) {
    if (!this.legs) return;
    const sp = this.sp;
    const len = sp.legLen * lenScale;
    const th = sp.legThick;
    for (let i = 0; i < 6; i++) {
      const ph = this._gait + LEG_PHASE[i] + (flail > 0 ? i * 1.7 : 0);
      const swing = Math.sin(ph) * 0.42 * move;
      const lift = Math.max(0, Math.sin(ph + 1.2)) * 0.30 * move;
      const az = LEG_AZ[i] + swing;
      _pos.set(Math.sin(az) * HIP_R, HIP_Y, Math.cos(az) * HIP_R);
      // The limb geometry lies along +X, so yaw it by (az − 90°) to point out
      // along its azimuth, then drop it with a roll about Z.
      _eul.set(0, az - Math.PI * 0.5, -(droop - lift), 'YZX');
      _qa.setFromEuler(_eul);
      _scl.set(len, th, th);
      _mat.compose(_pos, _qa, _scl);
      this.legs.setMatrixAt(i, _mat);
    }
    this.legs.instanceMatrix.needsUpdate = true;
  }
}

/* ===================================================================== *
 * Factory
 * ===================================================================== */

function nullView() {
  let group;
  try { group = new THREE.Group(); } catch (err) { group = null; }
  return {
    group,
    update() {}, setExpression() {}, pop() {}, glow() {}, dispose() {},
  };
}

/**
 * Build one beetle view.
 *
 * @param {object} spec    a level `bugs[]` entry — { id, color, species, r }
 * @param {string|object} quality  'low' | 'medium' | 'high', or a QUALITY entry
 * @returns {{group:THREE.Group, update:Function, setExpression:Function,
 *            pop:Function, glow:Function, dispose:Function}}
 */
export function makeInsect(spec, quality) {
  try {
    return new InsectView(spec || {}, tierOf(quality));
  } catch (err) {
    console.error('[insect] build failed, using a no-op view:', err);
    return nullView();
  }
}

export default makeInsect;
