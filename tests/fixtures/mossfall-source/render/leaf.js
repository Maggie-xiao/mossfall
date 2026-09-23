/**
 * MOSSFALL — the leaf platform.
 *
 * The hero object. It is built from the *same* `Field` the solver reads, through
 * `buildFieldMesh`, so the silhouette, the bowl, the veins and the rim curl the
 * player sees are literally the surface the beetles roll on — there is no second
 * description of the leaf anywhere, and therefore nothing that can drift.
 *
 * On top of that honest geometry sits one job: make a game board read as a living
 * blade. That is almost entirely the material —
 *
 *   · the border thins to light (`aEdge`), which is the single cue that says
 *     "leaf" and doubles as the boundary warning the player needs;
 *   · light appears to pass *through* the blade (wrapped diffuse + a back-lit
 *     bleed in the zone's `leafBack`), so the leaf is never a flat green disc;
 *   · veins darken and go slightly waxy (`aVein`);
 *   · a low-contrast cell network keeps the surface from feeling like plastic,
 *     and is deliberately quietened around the beetles and the burrows, because
 *     that is where the player is looking;
 *   · the blade *flexes*: it bows with the tilt (leading edge down, tip lagging
 *     most), sags under resting beetles, and breathes when left alone.
 *
 * THE FLEX IS A LIE, AND IT IS KEPT SMALL ENOUGH TO STAY AN HONEST ONE. Collision
 * uses the rigid field; the shader never moves a vertex more than about 4 cm, so
 * it can flatter the physics but never contradict it. `flexAt(x, z)` mirrors the
 * shader in JS for anything that must sit *on* the deformed surface.
 *
 * Everything the material does is bolted onto `MeshStandardMaterial` through
 * `onBeforeCompile`, so we keep three's real lighting, shadows and tone mapping.
 * Every chunk replacement is checked before it is made: a silently missing token
 * would leave a shader that compiles and does nothing, which is the worst
 * possible failure. If any of them is missing we abandon the whole patch and fall
 * back to a plain standard material — a duller leaf, but a leaf.
 */

import * as THREE from 'three';
import { buildFieldMesh } from '../sim/field.js';
import { clamp, clamp01, damp, lerp, sstep, easeOutCubic, makeRng, TAU } from '../core/math.js';
import { zoneFor, INSECTS, WORLD } from '../data/palette.js';
import { BoardProps } from './props.js';

/* Uniform array sizes. Fixed, because GLSL ES 1.00 wants constant loop bounds
 * and because a level with more than eight live beetles is not a level. */
const MAX_BUGS = 8;
const MAX_HOLES = 8;
const MAX_PULSES = 4;

/** Parking spot for unused array slots: far enough that every falloff is zero. */
const FAR = 9999;

/** Peak amplitudes, metres. The sum of these is the whole lie the flex tells. */
const FLEX_BOW = 0.100;    // × tilt (rad) — ≈ 2.6 cm at the 0.26 rad ceiling
const FLEX_SAG = 0.009;    // per resting beetle
const FLEX_BREATH = 0.008; // idle only, damped away the moment the player moves
const FLEX_BEND = 0.055;   // the win beat, after play has stopped
const FLEX_RELEASE = 6;    // 1/s — a body the blade stops carrying sheds its lift in ~0.3 s
const PULSE_SPEED = 2.6;   // m/s — a ripple crosses a 7 m blade in ~1.4 s
const PULSE_LIFE = 1.45;

const TIERS = {
  low: { name: 'low', res: 64, cells: 0, ring: 20, cross: 6, tufts: 0, lightCone: false, flexNormal: false },
  medium: { name: 'medium', res: 96, cells: 1, ring: 32, cross: 8, tufts: 4, lightCone: true, flexNormal: true },
  high: { name: 'high', res: 128, cells: 2, ring: 48, cross: 10, tufts: 7, lightCone: true, flexNormal: true },
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
    return TIERS.high;
  }
  return TIERS.medium;
}

/* ===================================================================== *
 * GLSL
 * ===================================================================== */

/**
 * The flex, shared verbatim by the blade, the burrow furniture and the glow
 * shells so all three deform together. `flexAt()` below is the JS twin — if you
 * touch one, touch the other.
 */
const FLEX_PARS = /* glsl */ `
uniform float uTime;
uniform vec2  uTilt;
uniform float uFlex;
uniform float uCalm;
uniform float uBend;
uniform vec2  uCenter;
uniform float uExtent;
uniform vec4  uBugs[${MAX_BUGS}];   // xy = board pos, z = weight, w = footprint
uniform vec4  uPulse[${MAX_PULSES}]; // xy = origin, z = age, w = strength

float leafFlex(vec2 p) {
  vec2 d = p - uCenter;
  float r = clamp(length(d) / uExtent, 0.0, 1.35);

  // Downhill direction of the board under the current tilt: positive roll dips
  // +x, positive pitch dips -z (CONTRACTS §1). The blade drops ahead of a
  // rolling beetle and lifts behind it, and the tip — largest r — moves most.
  vec2 g = vec2(uTilt.y, -uTilt.x);
  float bow = -dot(d, g) / uExtent * uFlex * (0.30 + 0.70 * r * r);

  // Resting weight. No branch on the slot count: unused slots carry zero weight.
  float sag = 0.0;
  for (int i = 0; i < ${MAX_BUGS}; i++) {
    vec2 q = p - uBugs[i].xy;
    float w = max(uBugs[i].w, 0.05);
    sag -= uBugs[i].z * exp(-dot(q, q) / (w * w));
  }

  // Idle breath — two slow, incommensurable waves so it never visibly loops.
  float breath = sin(uTime * 0.61 + r * 2.4 + d.x * 0.28) * 0.6
               + sin(uTime * 0.37 - d.y * 0.33 + 1.7) * 0.4;
  breath *= (0.16 + 0.84 * r * r) * uCalm * ${FLEX_BREATH.toFixed(4)};

  // Success ripples: a travelling ring, fading as it goes.
  float ripple = 0.0;
  for (int i = 0; i < ${MAX_PULSES}; i++) {
    float band = length(p - uPulse[i].xy) - uPulse[i].z * ${PULSE_SPEED.toFixed(2)};
    ripple += uPulse[i].w * exp(-band * band * 7.0) * 0.012;
  }

  float bend = -uBend * ${FLEX_BEND.toFixed(4)} * (0.15 + 0.85 * r * r);
  return bow + sag + breath + ripple + bend;
}
`;

const LEAF_VERT_PARS = /* glsl */ `
attribute float aEdge;
attribute float aVein;
attribute float aSide;
varying float vEdge;
varying float vVein;
varying float vSide;
varying vec2  vBoard;
varying vec3  vWPos;
varying vec3  vWNrm;
float lfY;
${FLEX_PARS}
`;

const LEAF_FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform vec4  uHoles[${MAX_HOLES}];     // xy = pos, z = radius, w = glows?
uniform vec3  uHoleTint[${MAX_HOLES}];
uniform float uHoleGlow[${MAX_HOLES}];
uniform vec4  uBugs[${MAX_BUGS}];
uniform vec4  uPulse[${MAX_PULSES}];
uniform vec3  uPulseTint[${MAX_PULSES}];
uniform vec3  uRimCol;
uniform vec3  uBackCol;
uniform vec3  uUnderCol;
uniform vec3  uSunDir;
uniform vec3  uSunCol;
uniform float uSss;
uniform float uCellAmt;
varying float vEdge;
varying float vVein;
varying float vSide;
varying vec2  vBoard;
varying vec3  vWPos;
varying vec3  vWNrm;

#ifdef LEAF_CELLS
vec2 lfHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

/** Worley F2−F1: zero exactly on a cell wall, so it draws the network for free. */
float lfCellEdge(vec2 p) {
  vec2 n = floor(p), f = p - n;
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + lfHash(n + g) - f;
      float d = dot(r, r);
      float m = step(d, d1);
      d2 = mix(min(d2, d), d1, m);
      d1 = mix(d1, d, m);
    }
  }
  return sqrt(d2) - sqrt(d1);
}

float lfCells(vec2 p) {
  float a = 1.0 - smoothstep(0.0, 0.11, lfCellEdge(p * 3.1));
  #if LEAF_CELLS > 1
    a = max(a, (1.0 - smoothstep(0.0, 0.17, lfCellEdge(p * 7.7 + 11.3))) * 0.5);
  #endif
  return a;
}

/**
 * Visual noise is only ever allowed where the player is *not* looking. This
 * fades the cell network out around every burrow mouth and every live beetle.
 */
float lfQuiet(vec2 p) {
  float q = 1.0;
  for (int i = 0; i < ${MAX_HOLES}; i++) {
    q = min(q, smoothstep(uHoles[i].z * 0.9, uHoles[i].z * 2.4 + 0.55, distance(p, uHoles[i].xy)));
  }
  for (int i = 0; i < ${MAX_BUGS}; i++) {
    q = min(q, smoothstep(0.28, 1.05, distance(p, uBugs[i].xy)));
  }
  return q;
}
#endif
`;

/* ===================================================================== *
 * Small geometry helpers (build time only — none of this runs per frame)
 * ===================================================================== */

const _sc = { x: 0, y: 0, z: 0 };

/** Quad corner offsets for the contact-shadow blobs. Hoisted: per-frame path. */
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];

/**
 * Indexed parametric grid. `f(u, v, out)` writes board-space metres.
 * `seamU` welds the u = 0 and u = 1 normals, which every ring here needs — an
 * unwelded seam puts a lit crease down one side of a burrow lip.
 */
function paramSurface(nu, nv, f, seamU = true) {
  const cols = nu + 1, rows = nv + 1;
  const pos = new Float32Array(cols * rows * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      f(i / nu, j / nv, _sc);
      const k = (j * cols + i) * 3;
      pos[k] = _sc.x; pos[k + 1] = _sc.y; pos[k + 2] = _sc.z;
    }
  }
  const idx = new Uint16Array(nu * nv * 6);
  let t = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();

  if (seamU) {
    const na = g.attributes.normal.array;
    for (let j = 0; j < rows; j++) {
      const a = (j * cols) * 3;
      const b = (j * cols + nu) * 3;
      const nx = na[a] + na[b], ny = na[a + 1] + na[b + 1], nz = na[a + 2] + na[b + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      na[a] = na[b] = nx / l;
      na[a + 1] = na[b + 1] = ny / l;
      na[a + 2] = na[b + 2] = nz / l;
    }
  }
  return g;
}

/**
 * Concatenate parts into one buffer, baking per-part constants (or per-vertex
 * functions of the transformed position) into extra attributes. This is how the
 * whole set of burrows stays a single draw call.
 */
function mergeParts(parts, extras) {
  let vTotal = 0, iTotal = 0;
  for (let i = 0; i < parts.length; i++) {
    const g = parts[i].geo;
    vTotal += g.attributes.position.count;
    iTotal += g.index ? g.index.count : g.attributes.position.count;
  }
  if (!vTotal) return null;

  const pos = new Float32Array(vTotal * 3);
  const nrm = new Float32Array(vTotal * 3);
  const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
  const ex = extras.map((e) => ({ name: e.name, size: e.size, arr: new Float32Array(vTotal * e.size) }));

  let vo = 0, io = 0;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    const g = part.geo;
    const pa = g.attributes.position;
    const na = g.attributes.normal;
    const n = pa.count;
    for (let i = 0; i < n; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      pos[(vo + i) * 3] = x; pos[(vo + i) * 3 + 1] = y; pos[(vo + i) * 3 + 2] = z;
      if (na) { nrm[(vo + i) * 3] = na.getX(i); nrm[(vo + i) * 3 + 1] = na.getY(i); nrm[(vo + i) * 3 + 2] = na.getZ(i); }
      else { nrm[(vo + i) * 3 + 1] = 1; }
      for (let e = 0; e < ex.length; e++) {
        const spec = ex[e];
        const src = part.values[spec.name];
        const val = typeof src === 'function' ? src(x, y, z) : src;
        if (spec.size === 1) spec.arr[vo + i] = typeof val === 'number' ? val : val[0];
        else for (let k = 0; k < spec.size; k++) spec.arr[(vo + i) * spec.size + k] = val[k];
      }
    }
    const gi = g.index;
    if (gi) { for (let i = 0; i < gi.count; i++) idx[io + i] = vo + gi.getX(i); io += gi.count; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    vo += n;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  for (let e = 0; e < ex.length; e++) out.setAttribute(ex[e].name, new THREE.BufferAttribute(ex[e].arr, ex[e].size));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** Deterministic ragged radius. Used by the bite lip and the mossy burrow lip. */
function jag(theta, phase, amount) {
  return 1
    + amount * (0.55 * Math.sin(3 * theta + phase)
      + 0.30 * Math.sin(7 * theta + phase * 1.7 + 1.1)
      + 0.15 * Math.sin(13 * theta + phase * 2.3 + 2.4));
}

/* ===================================================================== *
 * LeafPlatform
 * ===================================================================== */

export class LeafPlatform {
  /**
   * @param {import('../sim/field.js').Field} field  the collision field itself
   * @param {object} level                            level record (zone, board, colorMatch)
   * @param {string|object} quality                   'low' | 'medium' | 'high' | QUALITY entry
   */
  constructor(field, level, quality) {
    this.group = new THREE.Group();
    this.group.name = 'leafPlatform';

    this.field = field || null;
    this.level = level || {};
    this.zone = zoneFor(this.level.zone || 0);
    this.tier = tierOf(quality);
    this.holes = (this.field && this.field.holes) ||
      (this.level.board && this.level.board.holes) || [];

    this._shaderOk = true;
    this._disposed = false;

    /* --- state, all pre-allocated ------------------------------------- */
    this._pitch = 0; this._roll = 0;         // authored tilt
    this._lagP = 0; this._lagR = 0;          // what the blade has caught up to
    this._prevP = 0; this._prevR = 0;
    this._activity = 0;                      // |dTilt/dt|, smoothed
    this._pulseIdx = 0;
    this._elapsed = 0;

    this._holeBase = new Float32Array(MAX_HOLES);
    this._holePhase = new Float32Array(MAX_HOLES);
    this._holeSpike = new Float32Array(MAX_HOLES);
    this._pulseAge = new Float32Array(MAX_PULSES);
    this._pulseAmp = new Float32Array(MAX_PULSES);

    this._samp = { sdf: 0, h: 0, hx: 0, hz: 0 };
    this._geos = [];
    this._mats = [];

    const c = (this.field && this.field.center) || { x: 0, z: 0 };
    const extent = Math.max(((this.field && this.field.size) || 7) * 0.5, 1);

    this._colors = this._deriveColors();

    /* --- uniforms shared by every material in the platform ------------ */
    const bugs = []; for (let i = 0; i < MAX_BUGS; i++) bugs.push(new THREE.Vector4(FAR, FAR, 0, 0.7));
    const holes = []; for (let i = 0; i < MAX_HOLES; i++) holes.push(new THREE.Vector4(FAR, FAR, 0.5, 0));
    const tints = []; for (let i = 0; i < MAX_HOLES; i++) tints.push(new THREE.Color(0, 0, 0));
    const pulses = []; for (let i = 0; i < MAX_PULSES; i++) pulses.push(new THREE.Vector4(FAR, FAR, 0, 0));
    const ptints = []; for (let i = 0; i < MAX_PULSES; i++) ptints.push(new THREE.Color(0, 0, 0));

    this.u = {
      uTime: { value: 0 },
      uTilt: { value: new THREE.Vector2(0, 0) },
      uFlex: { value: FLEX_BOW },
      uCalm: { value: 1 },
      uBend: { value: 0 },
      uCenter: { value: new THREE.Vector2(c.x, c.z) },
      uExtent: { value: extent },
      uBugs: { value: bugs },
      uHoles: { value: holes },
      uHoleTint: { value: tints },
      uHoleGlow: { value: new Float32Array(MAX_HOLES) },
      uPulse: { value: pulses },
      uPulseTint: { value: ptints },
      uRimCol: { value: this._colors.rim },
      uBackCol: { value: this._colors.back },
      uUnderCol: { value: this._colors.under },
      uSunDir: { value: new THREE.Vector3(-0.34, 0.82, -0.46).normalize() },
      uSunCol: { value: this._colors.sun },
      uSss: { value: 1 },
      uCellAmt: { value: 0.085 },
    };

    // Bound once. Props ask for the flex every frame, and a fresh closure per
    // frame is exactly the kind of quiet allocation that shows up as GC sawtooth
    // an hour into a play session.
    this._flexFn = (fx, fz) => this.flexAt(fx, fz);

    try {
      this._buildMaterials();
      this._buildBlade();
      this._buildHoles();
      this._buildShadows();
    } catch (err) {
      console.warn('[leaf] build failed, platform degraded:', err);
    }

    // Separate try: the dressing is the least important thing on the board, and
    // a mushroom that fails to build must never cost us the blade.
    try {
      this.props = new BoardProps(this.field, this.level, quality);
      this.props.setFlexFn(this._flexFn);
      this.group.add(this.props.group);
    } catch (err) {
      console.warn('[leaf] props build failed, board undressed:', err);
      this.props = null;
    }
  }

  /* ================================================================== *
   * Colour
   * ================================================================== */

  _deriveColors() {
    const z = this.zone;
    const top = new THREE.Color(z.leafTop);
    const back = new THREE.Color(z.leafBack);

    // The underside is the same blade seen from the shadow side: darker, and
    // *more* saturated, which is what stops it reading as grey card.
    const under = top.clone().lerp(back, 0.25);
    under.offsetHSL(-0.012, 0.20, -0.13);

    const throat = new THREE.Color(WORLD.soil).lerp(new THREE.Color(0x000000), 0.72);
    const dried = new THREE.Color(WORLD.bark).lerp(top, 0.28);
    dried.offsetHSL(0, -0.18, -0.04);

    const shadow = top.clone().multiplyScalar(0.34).lerp(new THREE.Color(z.fog).multiplyScalar(0.30), 0.45);

    return {
      top, back, under, throat, dried, shadow,
      rim: new THREE.Color(z.rim),
      sun: new THREE.Color(z.sun),
      glow: new THREE.Color(z.glow || z.rim),
      moss: new THREE.Color(WORLD.moss),
      mossLight: new THREE.Color(WORLD.mossLight),
      bark: new THREE.Color(WORLD.bark),
      barkLight: new THREE.Color(WORLD.barkLight),
      petal: new THREE.Color(WORLD.petal),
      flower: new THREE.Color(WORLD.flower),
    };
  }

  /** Target burrows glow; decoys never do. Colour-matched levels use the bug hue. */
  _holeTint(h) {
    if (!h.target || h.style === 'bite') return null;
    if (this.level.colorMatch && h.color && INSECTS[h.color]) return new THREE.Color(INSECTS[h.color].glow);
    return this._colors.glow.clone();
  }

  /* ================================================================== *
   * Materials
   * ================================================================== */

  _buildMaterials() {
    const tier = this.tier;

    /* --- the blade ---------------------------------------------------- */
    const blade = new THREE.MeshStandardMaterial({
      color: this._colors.top,
      roughness: 0.74,
      metalness: 0.0,
      side: THREE.FrontSide,
      flatShading: false,
    });
    blade.name = 'leafBlade';
    if (tier.cells > 0) blade.defines = Object.assign({}, blade.defines, { LEAF_CELLS: tier.cells });
    if (tier.flexNormal) blade.defines = Object.assign({}, blade.defines, { LEAF_FLEXNORMAL: 1 });

    blade.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.u);
      try {
        shader.vertexShader = this._patchLeafVertex(shader.vertexShader);
        shader.fragmentShader = this._patchLeafFragment(shader.fragmentShader);
        blade.userData.shader = shader;
      } catch (err) {
        // A missing chunk means three changed under us. Better a plain green
        // leaf than a leaf that silently lost its rim and its subsurface.
        console.warn('[leaf] shader patch abandoned, falling back to plain standard material:', err.message);
        this._shaderOk = false;
      }
    };
    this.bladeMaterial = blade;
    this._mats.push(blade);

    /* --- burrow furniture: one opaque draw call for every hole -------- */
    const furn = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.0,
      side: THREE.DoubleSide,   // throats and petals are single-sheet surfaces
    });
    furn.name = 'leafFurniture';
    furn.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.u);
      try {
        // Furniture rides the blade: same flex, or the burrow floats when the
        // leaf bows and the illusion dies instantly.
        shader.vertexShader = guardedReplace(shader.vertexShader, '#include <common>',
          `#include <common>\n${FLEX_PARS}`, 'furniture pars');
        shader.vertexShader = guardedReplace(shader.vertexShader, '#include <begin_vertex>',
          '#include <begin_vertex>\n\ttransformed.y += leafFlex(position.xz);', 'furniture flex');
        furn.userData.shader = shader;
      } catch (err) {
        console.warn('[leaf] furniture flex patch skipped:', err.message);
      }
    };
    this.furnitureMaterial = furn;
    this._mats.push(furn);

    /* --- additive glow shells ----------------------------------------- */
    const glow = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute vec3 aTint;
        attribute float aAlpha;
        attribute float aIdx;
        uniform float uHoleGlow[${MAX_HOLES}];
        ${FLEX_PARS}
        varying vec3 vTint;
        varying float vA;
        void main() {
          // Constant-index lookup: dynamic indexing of uniform arrays is not
          // portable to GLSL ES 1.00, and eight compares cost nothing.
          float g = 0.0;
          for (int i = 0; i < ${MAX_HOLES}; i++) {
            if (abs(float(i) - aIdx) < 0.5) g = uHoleGlow[i];
          }
          vec3 p = position;
          p.y += leafFlex(p.xz);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec3 n = normalize(normalMatrix * normal);
          float ndv = abs(dot(n, normalize(-mv.xyz)));
          vTint = aTint;
          vA = aAlpha * g * mix(0.75, 1.35, 1.0 - ndv);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        varying vec3 vTint;
        varying float vA;
        void main() {
          gl_FragColor = vec4(vTint * max(vA, 0.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    glow.name = 'leafGlow';
    this.glowMaterial = glow;
    this._mats.push(glow);

    /* --- contact shadows ---------------------------------------------- */
    const shadow = new THREE.ShaderMaterial({
      uniforms: { uTint: { value: this._colors.shadow } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying vec2 vQ;
        varying float vA;
        void main() {
          vQ = uv * 2.0 - 1.0;
          vA = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTint;
        varying vec2 vQ;
        varying float vA;
        void main() {
          float d = length(vQ);
          float a = (1.0 - smoothstep(0.30, 1.0, d));
          a *= a * vA;
          // Multiply blend: white is "no shadow", so the falloff must go to 1.
          gl_FragColor = vec4(mix(vec3(1.0), uTint, clamp(a, 0.0, 1.0)), 1.0);
        }
      `,
      transparent: true,
      blending: THREE.MultiplyBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    shadow.name = 'leafContactShadow';
    this.shadowMaterial = shadow;
    this._mats.push(shadow);
  }

  /* --- the two big chunk patches ------------------------------------- */

  _patchLeafVertex(src) {
    let s = guardedReplace(src, '#include <common>', `#include <common>\n${LEAF_VERT_PARS}`, 'leaf vert pars');

    s = guardedReplace(s, '#include <beginnormal_vertex>', /* glsl */ `
      #include <beginnormal_vertex>
      lfY = leafFlex(position.xz);
      #ifdef LEAF_FLEXNORMAL
      {
        // Tilt the normal with the bow, or the lighting keeps insisting the
        // blade is flat while the silhouette says otherwise.
        const float e = 0.24;
        float fx = leafFlex(position.xz + vec2(e, 0.0)) - lfY;
        float fz = leafFlex(position.xz + vec2(0.0, e)) - lfY;
        objectNormal = normalize(objectNormal + vec3(-fx / e, 0.0, -fz / e) * 0.7);
      }
      #endif
      vWNrm = normalize(mat3(modelMatrix) * objectNormal);
    `, 'leaf flex normal');

    s = guardedReplace(s, '#include <begin_vertex>', /* glsl */ `
      #include <begin_vertex>
      transformed.y += lfY;
      vEdge = aEdge;
      vVein = aVein;
      vSide = aSide;
      vBoard = position.xz;
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `, 'leaf flex position');

    return s;
  }

  _patchLeafFragment(src) {
    let s = guardedReplace(src, '#include <common>', `#include <common>\n${LEAF_FRAG_PARS}`, 'leaf frag pars');

    // Base colour: top blade vs saturated backing, vein darkening, the rim
    // thinning to light, and the calm cell network.
    s = guardedReplace(s, '#include <color_fragment>', /* glsl */ `
      #include <color_fragment>
      {
        // Narrow: the pale border has to say "thin membrane", not "the outer
        // third of the board is a different colour".
        float rimT = 1.0 - smoothstep(0.0, 0.40, vEdge);
        vec3 base = mix(uUnderCol, diffuseColor.rgb, vSide);
        // The vein ridge already casts its own shadow stripe; heavy tinting on
        // top of that turns it into a crack instead of a raised rib.
        base *= mix(1.0, 0.84, vVein * mix(0.5, 1.0, vSide));
        base = mix(base, uRimCol, rimT * rimT * 0.34 * mix(0.45, 1.0, vSide));
        #ifdef LEAF_CELLS
          base *= 1.0 - lfCells(vBoard) * uCellAmt * lfQuiet(vBoard) * vSide;
        #endif
        diffuseColor.rgb = base;
      }
    `, 'leaf base colour');

    // Veins are waxier than the blade around them — a quiet specular ridge that
    // does most of the work of making the surface look organic.
    s = guardedReplace(s, '#include <roughnessmap_fragment>', /* glsl */ `
      #include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor * (1.0 - 0.30 * vVein) - 0.08 * (1.0 - smoothstep(0.0, 0.45, vEdge)), 0.045, 1.0);
    `, 'leaf vein roughness');

    // Everything additive: subsurface, rim, burrow bleed, success ripple.
    s = guardedReplace(s, '#include <opaque_fragment>', /* glsl */ `
      {
        vec3 N = normalize(vWNrm) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 L = normalize(uSunDir);
        vec3 V = normalize(cameraPosition - vWPos);

        // The blade is thinnest at its border, so that is where light gets through.
        float thin = mix(0.18, 1.0, 1.0 - smoothstep(0.0, 0.55, vEdge));

        // Wrapped diffuse: light creeps past the terminator the way it does in
        // anything thin enough to see through.
        float wrap = clamp((dot(N, L) + 0.55) / 1.55, 0.0, 1.0);

        // Back-lit bleed: strongest looking along the sun, through the leaf.
        float trans = pow(clamp(dot(V, -L), 0.0, 1.0), 2.2) * clamp(0.6 - dot(N, L) * 0.5, 0.0, 1.0);

        outgoingLight += uBackCol * uSunCol * (trans * 0.80 + wrap * 0.07) * thin * uSss;

        float rimT = 1.0 - smoothstep(0.0, 0.34, vEdge);
        outgoingLight += uRimCol * rimT * rimT * (0.055 + 0.26 * trans) * uSss;

        for (int i = 0; i < ${MAX_HOLES}; i++) {
          float g = uHoleGlow[i] * uHoles[i].w;
          float d = max(distance(vBoard, uHoles[i].xy) - uHoles[i].z, 0.0);
          outgoingLight += uHoleTint[i] * (g * exp(-d * 5.5) * 0.26);
        }
        for (int i = 0; i < ${MAX_PULSES}; i++) {
          float band = distance(vBoard, uPulse[i].xy) - uPulse[i].z * ${PULSE_SPEED.toFixed(2)};
          outgoingLight += uPulseTint[i] * (uPulse[i].w * exp(-band * band * 6.0) * 0.55);
        }
      }
      #include <opaque_fragment>
    `, 'leaf subsurface');

    return s;
  }

  /* ================================================================== *
   * Blade
   * ================================================================== */

  _buildBlade() {
    if (!this.field) return;
    const m = buildFieldMesh(this.field, { res: this.tier.res, skirt: true, thickness: 0.055, edgeFade: 0.75 });

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
    g.setAttribute('aEdge', new THREE.BufferAttribute(m.aEdge, 1));
    g.setAttribute('aVein', new THREE.BufferAttribute(m.aVein, 1));

    // The mesh builder mirrors the top down to make the underside, so the first
    // `topCount` vertices are the blade face and everything after is backing.
    // The rim band reuses both, which makes the two colours cross-fade over the
    // edge for free instead of meeting in a hard line.
    const total = m.position.length / 3;
    const side = new Float32Array(total);
    for (let i = 0; i < total; i++) side[i] = i < m.topCount ? 1 : 0;
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));

    g.computeBoundingSphere();
    // The flex moves vertices the renderer does not know about; pad the sphere
    // so a bowing leaf can never be frustum-culled at the edge of the screen.
    if (g.boundingSphere) g.boundingSphere.radius += 0.2;

    const mesh = new THREE.Mesh(g, this.bladeMaterial);
    mesh.name = 'leafBlade';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.blade = mesh;
    this._geos.push(g);
    this.group.add(mesh);
  }

  /* ================================================================== *
   * Burrows
   * ================================================================== */

  _buildHoles() {
    const solid = [];
    const glow = [];
    const rng = makeRng(0x1eaf);

    const n = Math.min(this.holes.length, MAX_HOLES);
    for (let i = 0; i < n; i++) {
      const h = this.holes[i];
      const y = this.field ? this.field.height(h.x, h.z) : 0;
      const tint = this._holeTint(h);

      this.u.uHoles.value[i].set(h.x, h.z, h.r, tint ? 1 : 0);
      if (tint) this.u.uHoleTint.value[i].copy(tint);
      this._holeBase[i] = tint ? clamp(h.glow != null ? h.glow : 1, 0, 2) : 0;
      this._holePhase[i] = rng() * TAU;

      try {
        this._holeParts(h, i, y, tint, solid, glow, rng);
      } catch (err) {
        console.warn(`[leaf] burrow "${h.id}" skipped:`, err);
      }
    }

    const solidGeo = mergeParts(solid, [{ name: 'color', size: 3 }]);
    if (solidGeo) {
      const mesh = new THREE.Mesh(solidGeo, this.furnitureMaterial);
      mesh.name = 'leafBurrows';
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.furniture = mesh;
      this._geos.push(solidGeo);
      this.group.add(mesh);
    }

    const glowGeo = mergeParts(glow, [
      { name: 'aTint', size: 3 },
      { name: 'aAlpha', size: 1 },
      { name: 'aIdx', size: 1 },
    ]);
    if (glowGeo) {
      const mesh = new THREE.Mesh(glowGeo, this.glowMaterial);
      mesh.name = 'leafBurrowGlow';
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.glow = mesh;
      this._geos.push(glowGeo);
      this.group.add(mesh);
    }
  }

  /**
   * One burrow's worth of geometry. Every style shares a throat and a floor so a
   * beetle is genuinely swallowed; the lip is what tells the player which kind
   * of opening they are looking at.
   */
  _holeParts(h, idx, y, tint, solid, glow, rng) {
    const tier = this.tier;
    const r = h.r;
    const style = h.style || 'burrow';
    const seg = tier.ring;
    const C = this._colors;
    const phase = rng() * TAU;

    const place = (geo) => { geo.translate(h.x, y, h.z); return geo; };
    const rgb = (c) => [c.r, c.g, c.b];

    // A bite is a hole chewed clean through the blade: no throat, no floor, and
    // you can see the tree below through it. That see-through read is the whole
    // point — it is how the player learns to tell a burrow from a trap.
    if (style !== 'bite') {
      const depth = lerp(0.42, 0.62, clamp01(r / 0.8));
      const throat = paramSurface(seg, 4, (u, v, o) => {
        const a = u * TAU;
        const rr = lerp(r * 1.0, r * 0.34, v * v);
        o.x = Math.cos(a) * rr;
        o.y = 0.015 - v * depth;
        o.z = Math.sin(a) * rr;
      });
      solid.push({
        geo: place(throat),
        // Darkening downward sells the depth far more cheaply than more geometry.
        values: { color: (x, yy) => { const t = clamp01((y + 0.015 - yy) / depth); const k = 1 - 0.75 * t; return [C.throat.r * k + 0.012 * (1 - t), C.throat.g * k + 0.014 * (1 - t), C.throat.b * k + 0.010 * (1 - t)]; } },
      });

      const floor = new THREE.CircleGeometry(r * 0.36, Math.max(8, seg >> 1));
      floor.rotateX(-Math.PI / 2);
      floor.translate(0, -depth + 0.004, 0);
      solid.push({ geo: place(floor), values: { color: [C.throat.r * 0.2, C.throat.g * 0.2, C.throat.b * 0.2] } });
    }

    /* --- the lip ------------------------------------------------------ */
    if (style === 'flower') {
      const petals = 9;
      // Pale petal tinted well toward the hole colour: near-white shards read as
      // debris on a green blade, a blush reads as a flower.
      // Lead with a saturated body colour, not the near-white petal swatch:
      // under a 2.6-intensity key light anything close to white clips and the
      // petals read as broken shell. `tint` is a glow colour and so is already
      // pale, and it is null on decoys — where the petals must stay neutral so
      // they never imply a match. When the hole does earn its colour, borrow
      // the beetle's shell, which is the most saturated swatch we own.
      const body = (tint && h.color && INSECTS[h.color])
        ? new THREE.Color(INSECTS[h.color].shell)
        : C.flower;
      const pc = body.clone().lerp(C.petal, 0.30).multiplyScalar(0.86);
      for (let p = 0; p < petals; p++) {
        const ang = (p / petals) * TAU + phase * 0.3;
        const len = r * 0.80, wid = r * 0.42, lift = r * 0.24;
        const petal = paramSurface(5, 7, (u, v, o) => {
          // u across, v along. Width tapers at both ends; the petal arches and
          // then lays its tip back down, so the ring stays low and readable.
          const w = Math.pow(Math.sin(Math.PI * clamp(v * 0.92 + 0.08, 0, 1)), 0.75) * wid;
          const lx = (u * 2 - 1) * w;
          const lz = r * 0.82 + v * len;
          o.x = Math.cos(ang) * lz - Math.sin(ang) * lx;
          o.z = Math.sin(ang) * lz + Math.cos(ang) * lx;
          o.y = 0.02 + lift * Math.sin(Math.PI * v) - 0.30 * lift * (u * 2 - 1) * (u * 2 - 1) * v;
        }, false);   // u runs across the petal, not around a ring — do not weld
        solid.push({
          geo: place(petal),
          values: { color: (x, yy) => { const t = clamp01((yy - y) / (lift + 0.02)); return [lerp(pc.r, C.rim.r, t * 0.22), lerp(pc.g, C.rim.g, t * 0.22), lerp(pc.b, C.rim.b, t * 0.22)]; } },
        });
      }
      // A small collar hides the seam where the petals meet the blade.
      solid.push({
        geo: place(makeTorusish(r * 1.02, r * 0.10, seg, tier.cross, 0.02, 0.0, 0)),
        values: { color: rgb(C.mossLight.clone().lerp(pc, 0.4)) },
      });
    } else if (style === 'curl') {
      // A rolled leaf edge: the cross-section is itself a spiral, swept around
      // the mouth. It reads as a tunnel you could crawl into.
      const tube = r * 0.30, turns = 1.45;
      const roll = paramSurface(seg, Math.max(8, tier.cross * 2), (u, v, o) => {
        const th = u * TAU;
        const a = v * turns * TAU;
        const rho = tube * (1 - 0.55 * v);
        const dr = Math.cos(a) * rho - v * tube * 0.35;
        const dy = Math.sin(a) * rho + tube * 0.9;
        const R = r * 1.05 + tube * 0.6 + 0.05 * r * Math.sin(3 * th + phase) + dr;
        o.x = Math.cos(th) * R;
        o.y = 0.01 + dy;
        o.z = Math.sin(th) * R;
      });
      const cc = C.top.clone().lerp(C.back, 0.45);
      solid.push({
        geo: place(roll),
        values: { color: (x, yy) => { const t = clamp01((yy - y) / (tube * 2.2)); return [lerp(cc.r, C.rim.r, t * 0.45), lerp(cc.g, C.rim.g, t * 0.45), lerp(cc.b, C.rim.b, t * 0.45)]; } },
      });
    } else if (style === 'hollow') {
      // Old wood: a knotted, faceted ring, warm inside.
      const ring = paramSurface(seg, tier.cross, (u, v, o) => {
        const th = u * TAU;
        const k = jag(th, phase, 0.10);
        const a = v * Math.PI;                       // half a tube: a raised lip
        const tube = r * 0.24 * k;
        const R = r * 1.04 + tube * (1 - Math.cos(a)) * 0.5;
        o.x = Math.cos(th) * R;
        o.y = 0.005 + Math.sin(a) * tube * 0.9;
        o.z = Math.sin(th) * R;
      });
      solid.push({
        geo: place(ring),
        values: { color: (x, yy) => { const t = clamp01((yy - y) / (r * 0.24)); return [lerp(C.bark.r, C.barkLight.r, t), lerp(C.bark.g, C.barkLight.g, t), lerp(C.bark.b, C.barkLight.b, t)]; } },
      });
    } else if (style === 'bite') {
      // Torn and dried: the lip droops, browns and has no light in it at all.
      const flange = paramSurface(seg, 2, (u, v, o) => {
        const th = u * TAU;
        const k = jag(th, phase, 0.16);
        const R = r * k + v * r * 0.26 * (0.6 + 0.4 * Math.sin(5 * th + phase));
        o.x = Math.cos(th) * R;
        o.y = -0.018 * (1 - v) + 0.006 * v;
        o.z = Math.sin(th) * R;
      });
      solid.push({
        geo: place(flange),
        values: { color: (x, yy) => { const t = clamp01((y - yy) / 0.02); return [lerp(C.dried.r, C.dried.r * 0.45, t), lerp(C.dried.g, C.dried.g * 0.45, t), lerp(C.dried.b, C.dried.b * 0.42, t)]; } },
      });
    } else {
      // 'burrow': a soft mossy lip, slightly irregular, with a few tufts.
      solid.push({
        geo: place(makeTorusish(r * 1.06, r * 0.19, seg, tier.cross, 0.012, 0.11, phase)),
        values: { color: (x, yy) => { const t = clamp01((yy - y) / (r * 0.26)); return [lerp(C.moss.r, C.mossLight.r, t), lerp(C.moss.g, C.mossLight.g, t), lerp(C.moss.b, C.mossLight.b, t)]; } },
      });
      for (let t = 0; t < tier.tufts; t++) {
        const a = (t / Math.max(1, tier.tufts)) * TAU + rng() * 0.7;
        const rr = r * (1.06 + rng() * 0.18);
        const hgt = r * (0.16 + rng() * 0.16);
        const tuft = new THREE.ConeGeometry(r * 0.07, hgt, 5, 1, true);
        tuft.rotateZ((rng() - 0.5) * 0.7);
        tuft.translate(Math.cos(a) * rr, hgt * 0.45 + r * 0.06, Math.sin(a) * rr);
        solid.push({ geo: place(tuft), values: { color: rgb(C.mossLight) } });
      }
    }

    /* --- glow: targets only ------------------------------------------- */
    if (!tint) return;
    const t3 = [tint.r, tint.g, tint.b];

    // The lip halo. Alpha falls to zero at the outer edge so it has no border.
    const halo = paramSurface(seg, 3, (u, v, o) => {
      const a = u * TAU;
      const rr = lerp(r * 0.98, r * 1.7, v);
      o.x = Math.cos(a) * rr;
      o.y = 0.010 + v * 0.004;
      o.z = Math.sin(a) * rr;
    });
    glow.push({
      geo: place(halo),
      values: {
        aTint: t3, aIdx: idx,
        aAlpha: (x, yy, z) => {
          const d = Math.hypot(x - h.x, z - h.z);
          return 0.30 * (1 - clamp01((d - r * 0.98) / (r * 0.72)));
        },
      },
    });

    // Light coming *out* of the burrow, so the mouth is not a black disc.
    const mouth = new THREE.CircleGeometry(r * 0.92, Math.max(10, seg >> 1));
    mouth.rotateX(-Math.PI / 2);
    mouth.translate(0, -lerp(0.42, 0.62, clamp01(r / 0.8)) * 0.74, 0);
    glow.push({
      geo: place(mouth),
      values: {
        aTint: t3, aIdx: idx,
        // Dim and set deep: the eye should read a dark throat with light in it,
        // not a bright lid stretched across the opening.
        aAlpha: (x, yy, z) => 0.20 * (1 - 0.55 * clamp01(Math.hypot(x - h.x, z - h.z) / (r * 0.92))),
      },
    });

    // The god-ray cone. Cheap fake volume: a shell, additive, fading upward.
    if (this.tier.lightCone) {
      const cone = paramSurface(Math.max(12, seg >> 1), 5, (u, v, o) => {
        const a = u * TAU;
        const rr = r * lerp(0.94, 1.5, v);
        o.x = Math.cos(a) * rr;
        o.y = 0.02 + v * lerp(0.7, 1.05, clamp01(r));
        o.z = Math.sin(a) * rr;
      });
      glow.push({
        geo: place(cone),
        values: {
          aTint: t3, aIdx: idx,
          aAlpha: (x, yy) => {
            const v = clamp01((yy - y - 0.02) / 0.9);
            return 0.13 * Math.pow(1 - v, 1.7);
          },
        },
      });
    }
  }

  /* ================================================================== *
   * Contact shadows
   * ================================================================== */

  _buildShadows() {
    // One geometry holding MAX_BUGS quads. Positions are rewritten each frame in
    // place — grounded contact is what sells the physics, and it costs 32 vertex
    // writes to sell it.
    const quads = MAX_BUGS;
    const pos = new Float32Array(quads * 4 * 3);
    const uv = new Float32Array(quads * 4 * 2);
    const alpha = new Float32Array(quads * 4);
    const idx = new Uint16Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      uv[v * 2 + 0] = 0; uv[v * 2 + 1] = 0;
      uv[v * 2 + 2] = 1; uv[v * 2 + 3] = 0;
      uv[v * 2 + 4] = 1; uv[v * 2 + 5] = 1;
      uv[v * 2 + 6] = 0; uv[v * 2 + 7] = 1;
      idx[q * 6 + 0] = v; idx[q * 6 + 1] = v + 1; idx[q * 6 + 2] = v + 2;
      idx[q * 6 + 3] = v; idx[q * 6 + 4] = v + 2; idx[q * 6 + 5] = v + 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.attributes.position.setUsage(THREE.DynamicDrawUsage);
    g.attributes.aAlpha.setUsage(THREE.DynamicDrawUsage);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    const mesh = new THREE.Mesh(g, this.shadowMaterial);
    mesh.name = 'leafContactShadows';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.shadows = mesh;
    this._shadowPos = pos;
    this._shadowAlpha = alpha;
    this._geos.push(g);
    this.group.add(mesh);
  }

  /* ================================================================== *
   * Public API
   * ================================================================== */

  /** Director calls this every fixed step; it only drives the flex. */
  setTilt(pitch, roll) {
    this._pitch = pitch || 0;
    this._roll = roll || 0;
  }

  /**
   * The JS twin of `leafFlex` in the shader. Anything that has to sit *on* the
   * visible surface adds this to the field height: the contact shadows here, the
   * props and movers through `_flexFn`, and the beetle views through the `flexY`
   * that `update()` publishes on each body. Physics must not.
   */
  flexAt(x, z) {
    const u = this.u;
    const cx = u.uCenter.value.x, cz = u.uCenter.value.y;
    const dx = x - cx, dz = z - cz;
    const ext = u.uExtent.value;
    const r = Math.min(Math.hypot(dx, dz) / ext, 1.35);

    const gx = u.uTilt.value.y, gz = -u.uTilt.value.x;
    let f = -((dx * gx + dz * gz) / ext) * u.uFlex.value * (0.30 + 0.70 * r * r);

    const bugs = u.uBugs.value;
    for (let i = 0; i < MAX_BUGS; i++) {
      const b = bugs[i];
      if (b.z <= 0) continue;
      const qx = x - b.x, qz = z - b.y;
      const w = Math.max(b.w, 0.05);
      f -= b.z * Math.exp(-(qx * qx + qz * qz) / (w * w));
    }

    const t = u.uTime.value;
    let breath = Math.sin(t * 0.61 + r * 2.4 + dx * 0.28) * 0.6 + Math.sin(t * 0.37 - dz * 0.33 + 1.7) * 0.4;
    f += breath * (0.16 + 0.84 * r * r) * u.uCalm.value * FLEX_BREATH;

    const pulses = u.uPulse.value;
    for (let i = 0; i < MAX_PULSES; i++) {
      const p = pulses[i];
      if (p.w <= 0) continue;
      const band = Math.hypot(x - p.x, z - p.y) - p.z * PULSE_SPEED;
      f += p.w * Math.exp(-band * band * 7) * 0.012;
    }

    f -= u.uBend.value * FLEX_BEND * (0.15 + 0.85 * r * r);
    return f;
  }

  /**
   * @param {number} dt      render delta
   * @param {number} elapsed loop time, seconds
   * @param {Array}  bugs    live BugStates (read-only)
   */
  update(dt, elapsed, bugs) {
    if (this._disposed) return;
    const u = this.u;
    const step = dt > 0 && dt < 0.25 ? dt : 1 / 60;
    this._elapsed = elapsed || (this._elapsed + step);
    u.uTime.value = this._elapsed;

    /* --- tilt, lagged ------------------------------------------------- */
    // The blade catches up to the player rather than snapping: the bow is a
    // consequence of the tilt, so it must arrive slightly after it.
    this._lagP = damp(this._lagP, this._pitch, 8.5, step);
    this._lagR = damp(this._lagR, this._roll, 8.5, step);
    u.uTilt.value.set(this._lagP, this._lagR);

    // Breathing only exists to prove the leaf is alive while nobody touches it.
    // The instant the player moves, all motion must read as *theirs*.
    const rate = (Math.abs(this._pitch - this._prevP) + Math.abs(this._roll - this._prevR)) / step;
    this._prevP = this._pitch; this._prevR = this._roll;
    this._activity = rate > this._activity ? rate : damp(this._activity, rate, 2.6, step);
    u.uCalm.value = 1 - sstep(0.015, 0.16, this._activity);

    /* --- beetles: sag + contact shadows ------------------------------- */
    const bs = u.uBugs.value;
    const n = bugs ? Math.min(bugs.length, MAX_BUGS) : 0;
    for (let i = 0; i < MAX_BUGS; i++) {
      if (i >= n) { bs[i].set(FAR, FAR, 0, 0.7); this._hideShadow(i); continue; }
      const b = bugs[i];
      if (!b || b.state === 'captured' || b.state === 'falling' || b.state === 'rescued') {
        bs[i].set(FAR, FAR, 0, 0.7);
        this._hideShadow(i);
        // A body the blade has stopped carrying has to *let go* of its lift, not
        // drop it. At a playing tilt the flex under a beetle sitting on the rim
        // is one to two centimetres, so assigning zero on the frame it detaches
        // kicks it up by that much in the one moment the player is watching it
        // go over the edge. Where it eases *to* is the difference between the
        // two ways a body leaves: falling and rescued beetles are in the air,
        // and air holds nothing up, so they ease to nothing; a captured one is
        // still in the blade, sinking into a burrow mouth that goes on bowing
        // under the player's tilt, so it eases to the live flex there and stays
        // registered with the hole it is disappearing into — off-centre burrows
        // move over a centimetre between hard left and hard right, and a frozen
        // value would let the beetle slide out of the mouth on the way down.
        // Easing is also what makes tracking safe, because the beetle's own sag
        // dimple leaves `uBugs` on this very frame and swallowing that 9 mm step
        // whole would flick it up exactly as badly as zeroing would.
        // Only the way *off* is eased. A body the blade picks up again takes the
        // exact flex on its first frame back, because the shadow under it is laid
        // out from that same number and the two may not disagree for as long as
        // it is being carried.
        if (b) {
          const want = b.state === 'captured' ? this.flexAt(b.x, b.z) : 0;
          b.flexY = isFinite(b.flexY) ? damp(b.flexY, want, FLEX_RELEASE, step) : want;
        }
        continue;
      }
      const r = b.r || 0.3;
      const s = this.field ? this.field.sample(b.x, b.z, this._samp) : this._samp;
      // How far the beetle is off the surface. Airborne beetles neither press
      // on the blade nor drop a tight shadow.
      const gap = Math.max(0, (b.y != null ? b.y : s.h + r) - (s.h + r));
      const contact = 1 - clamp01(gap / 0.28);
      const settled = 0.55 + 0.45 * sstep(0, 0.6, b.restT || 0);
      const weight = FLEX_SAG * (b.mass || 1) * contact * settled;
      bs[i].set(b.x, b.z, weight, Math.max(0.55, r * 2.4));
      // A beetle view has no route back to the platform, so the flex under each
      // body travels on the body itself: the view lifts by `flexY` so the
      // creature rides the blade it appears to stand on rather than the rigid
      // field it collides with. Mind which way the frame runs — the director
      // updates the views and *then* the platform, so a view reads the number
      // this line wrote on the previous frame while the shadow below is laid out
      // with this one, and the feet therefore trail their own shadow by exactly
      // one frame. Measured at 60 Hz that disagreement is about a tenth of a
      // millimetre against a flex that swings well past a centimetre — far
      // under a pixel, and nothing worth reordering the director over. What
      // would show is the two of them being computed from different *positions*,
      // and evaluating once and handing the same number to both is what stops
      // that.
      const flex = this.flexAt(b.x, b.z);
      b.flexY = flex;
      this._writeShadow(i, b, s, gap, contact, flex);
    }

    /* --- burrow glow -------------------------------------------------- */
    const glowArr = u.uHoleGlow.value;
    for (let i = 0; i < MAX_HOLES; i++) {
      const base = this._holeBase[i];
      if (base <= 0) { glowArr[i] = 0; continue; }
      this._holeSpike[i] = damp(this._holeSpike[i], 0, 3.2, step);
      const shimmer = 0.88 + 0.12 * Math.sin(this._elapsed * 1.6 + this._holePhase[i]);
      glowArr[i] = base * shimmer + this._holeSpike[i] * 1.6;
    }

    /* --- ripples ------------------------------------------------------ */
    const pulses = u.uPulse.value;
    for (let i = 0; i < MAX_PULSES; i++) {
      if (this._pulseAmp[i] <= 0) continue;
      this._pulseAge[i] += step;
      const t = this._pulseAge[i] / PULSE_LIFE;
      if (t >= 1) {
        this._pulseAmp[i] = 0;
        pulses[i].set(FAR, FAR, 0, 0);
      } else {
        pulses[i].z = this._pulseAge[i];
        pulses[i].w = this._pulseAmp[i] * (1 - easeOutCubic(t));
      }
    }

    if (this.shadows) {
      this.shadows.geometry.attributes.position.needsUpdate = true;
      this.shadows.geometry.attributes.aAlpha.needsUpdate = true;
    }

    // Last, because the props ride the flex this pass just finished computing.
    if (this.props) this.props.update(step, this._elapsed);
  }

  /**
   * Dew drops and the caterpillar, straight off the solver bodies.
   * The director calls this right after `update()`, with the same render alpha
   * it uses for the beetles so nothing on the board is interpolated differently.
   */
  updateMovers(movers, alpha) {
    if (this._disposed || !this.props) return;
    this.props.updateMovers(movers, alpha);
  }

  _hideShadow(i) {
    if (!this._shadowAlpha) return;
    const v = i * 4;
    if (this._shadowAlpha[v] === 0) return;
    for (let k = 0; k < 4; k++) this._shadowAlpha[v + k] = 0;
  }

  /** Lay a quad on the deformed surface, oriented by the local slope. */
  _writeShadow(i, b, s, gap, contact, flex) {
    if (!this._shadowPos) return;
    const a = clamp01(contact) * 0.9;
    const v = i * 4;
    if (a <= 0.001) { this._hideShadow(i); return; }

    const r = (b.r || 0.3) * (1.75 + gap * 1.4);
    const y = s.h + flex + 0.012;

    // Tangents from the field gradient, so the blob shears with the vein it is
    // sitting on instead of hovering flat above it.
    const tx = 1, txy = s.hx;
    const tz = 1, tzy = s.hz;

    let k = v * 3;
    const px = b.x, pz = b.z;
    for (let q = 0; q < 4; q++) {
      const ox = CORNERS[q * 2] * r, oz = CORNERS[q * 2 + 1] * r;
      this._shadowPos[k] = px + ox * tx;
      this._shadowPos[k + 1] = y + ox * txy + oz * tzy;
      this._shadowPos[k + 2] = pz + oz * tz;
      this._shadowAlpha[v + q] = a;
      k += 3;
    }
  }

  /** Success: a ripple leaves the burrow and crosses the whole blade. */
  pulseHole(holeId) {
    let idx = -1;
    for (let i = 0; i < Math.min(this.holes.length, MAX_HOLES); i++) {
      if (this.holes[i].id === holeId) { idx = i; break; }
    }
    const h = idx >= 0 ? this.holes[idx] : null;
    if (!h) return;

    if (idx >= 0) this._holeSpike[idx] = 1;

    const slot = this._pulseIdx % MAX_PULSES;
    this._pulseIdx++;
    this._pulseAge[slot] = 0;
    this._pulseAmp[slot] = 1;
    this.u.uPulse.value[slot].set(h.x, h.z, 0, 1);
    const tint = this._holeTint(h) || this._colors.rim;
    this.u.uPulseTint.value[slot].copy(tint);
  }

  /** The "leaf bows gently under their weight" beat. t 0..1. */
  bendForWin(t) {
    this.u.uBend.value = clamp01(t);
  }

  /** Feed the real key-light direction (world space, surface → light). */
  setSun(x, y, z) {
    const v = this.u.uSunDir.value;
    if (x && typeof x === 'object') v.set(x.x, x.y, x.z);
    else v.set(x, y, z);
    if (v.lengthSq() < 1e-8) v.set(0, 1, 0);
    v.normalize();
  }

  /** Rebuild at a new tier. Cheap enough to do between levels, never in play. */
  setQuality(q) {
    const tier = tierOf(q);
    if (tier === this.tier || this._disposed) return;
    this.tier = tier;

    const m = this.bladeMaterial;
    if (m) {
      const defs = {};
      if (tier.cells > 0) defs.LEAF_CELLS = tier.cells;
      if (tier.flexNormal) defs.LEAF_FLEXNORMAL = 1;
      m.defines = defs;
      m.needsUpdate = true;
    }

    this._teardownMeshes();
    try {
      this._buildBlade();
      this._buildHoles();
      this._buildShadows();
    } catch (err) {
      console.warn('[leaf] rebuild failed:', err);
    }
  }

  _teardownMeshes() {
    const kill = (mesh) => {
      if (!mesh) return;
      this.group.remove(mesh);
      if (mesh.geometry) {
        const i = this._geos.indexOf(mesh.geometry);
        if (i >= 0) this._geos.splice(i, 1);
        mesh.geometry.dispose();
      }
    };
    kill(this.blade); kill(this.furniture); kill(this.glow); kill(this.shadows);
    this.blade = this.furniture = this.glow = this.shadows = null;
    this._shadowPos = null;
    this._shadowAlpha = null;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this.props) { this.props.dispose(); this.props = null; }
    this._teardownMeshes();
    for (let i = 0; i < this._geos.length; i++) this._geos[i].dispose();
    for (let i = 0; i < this._mats.length; i++) this._mats[i].dispose();
    this._geos.length = 0;
    this._mats.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
  }
}

/* ===================================================================== *
 * Bits used above
 * ===================================================================== */

/**
 * Replace a chunk include, loudly. A silent miss produces a shader that still
 * compiles and quietly does nothing, which would be almost impossible to spot
 * in a screenshot — so this throws instead, and the caller falls back.
 */
function guardedReplace(src, token, replacement, label) {
  if (src.indexOf(token) === -1) {
    console.warn(`[leaf] shader token "${token}" not found (${label}) — three.js changed under us.`);
    throw new Error(`missing chunk ${token} (${label})`);
  }
  return src.replace(token, replacement);
}

/**
 * A torus that is allowed to be imperfect: `wob` wobbles the ring radius so a
 * mossy lip never reads as machined.
 */
function makeTorusish(R, tube, seg, cross, lift, wob, phase) {
  const nv = Math.max(4, cross);
  return paramSurface(seg, nv, (u, v, o) => {
    const th = u * TAU;
    const a = v * TAU;
    const k = wob ? jag(th, phase, wob) : 1;
    const rr = R * k + Math.cos(a) * tube;
    o.x = Math.cos(th) * rr;
    o.y = lift + Math.sin(a) * tube;
    o.z = Math.sin(th) * rr;
  });
}

export default LeafPlatform;
