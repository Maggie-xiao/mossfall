/**
 * MOSSFALL — light and air.
 *
 * One job: make eight palette rows read as eight real depths. Three lights only
 * — a key that carries the shape of the leaf, a hemisphere that fills the shadow
 * side with sky, and a single warm point inside the burrow the player is aiming
 * for, so the target is the brightest thing on the board without any UI marker.
 *
 * Fog does most of the work. It is linear rather than exponential on purpose:
 * `fogNear`/`fogFar` are authored per zone in the palette, and a linear ramp
 * lets the crown stay crisp out to 130 m while the root garden closes in to 68 m
 * — the world literally gets smaller around you as you fall.
 *
 * The key light is the ONLY shadow caster in the game. Its frustum is kept tight
 * around the current leaf (see `focusOn`) so a 2048 map spends every texel on the
 * seven metres that matter.
 */

import * as THREE from 'three';
import { clamp, clamp01, easeInOutCubic } from '../core/math.js';
import { ZONES, zoneFor } from '../data/palette.js';

const TIERS = { low: 0, medium: 1, high: 2 };

/** Accepts 'high', a QUALITY tier object, or nothing. Never throws. */
function tierOf(q) {
  if (typeof q === 'string') return TIERS[q] != null ? TIERS[q] : 2;
  if (q && typeof q === 'object') {
    if (typeof q.tier === 'number') return clamp(q.tier | 0, 0, 2);
    const n = q.name || q.level || q.id;
    if (typeof n === 'string' && TIERS[n] != null) return TIERS[n];
    if (typeof q.shadowMap === 'number') return q.shadowMap >= 2048 ? 2 : q.shadowMap >= 1024 ? 1 : 0;
  }
  return 2;
}

/** The sun's direction, in leaf-relative metres. Up, left and *behind* the leaf:
 *  back-lighting is what makes the blade's translucency shader pay off. */
const KEY_DIR = new THREE.Vector3(-0.34, 0.82, -0.46).normalize();
const KEY_DIST = 26;

/** Fill: from over the camera's right shoulder, casting nothing.
 *
 *  The key deliberately sits *behind* the stage, which is right for the leaf and
 *  wrong for everything vertical behind it — the trunk is a fourteen-metre wall
 *  whose entire camera-facing side is a shadow terminator, and a hemisphere
 *  light alone leaves it reading as a black hole punched through the canopy. A
 *  hemisphere can't fix that either: raise it enough to lift the trunk and the
 *  leaf goes flat, because it lifts the lit side by exactly as much. A fill from
 *  the front lifts only what faces us. Offset from the lens so the trunk still
 *  turns rather than flattening into a cardboard cutout. */
const FILL_DIR = new THREE.Vector3(0.42, 0.30, 0.86).normalize();
const FILL_DIST = 30;
/** Multiple of the hemisphere's intensity. Bark is a dark albedo sitting against
 *  a bright canopy, so this has to be generous or the tree reads as a hole. */
const FILL_SCALE = 3.0;
/** ...but never this much brighter than the sun. The lower zones are supposed
 *  to get darker and stranger; without the cap their rising ambient would drag
 *  the fill up with it and light the deep exactly as brightly as the crown. */
const FILL_CEIL = 1.15;

/** Counter-fill: the same idea mirrored to the camera's left, at a fraction of
 *  the strength.
 *
 *  One frontal fill lifts only what leans toward it, so with the key behind and
 *  the fill off to the right, anything on the left of frame — a branch crossing
 *  the top-left corner, a background leaf angled away — has no light source at
 *  all and renders as a black shard. It is not enough to widen the main fill:
 *  moving it toward the lens flattens the trunk, which is the thing it exists to
 *  round. A second, weaker source from the opposite side keeps the modelling and
 *  removes the dead zone. Deliberately dimmer than the fill so the frame still
 *  has a light side and a dark side. */
const FILL2_DIR = new THREE.Vector3(-0.74, 0.26, 0.62).normalize();
const FILL2_SCALE = 0.42;

const _c = new THREE.Color();

export class Lighting {
  constructor(scene, quality) {
    this.scene = scene;
    this.tier = tierOf(quality);
    this.ok = false;
    this.renderer = null;   // optional; see setRenderer

    this.group = new THREE.Group();
    this.group.name = 'lighting';

    this.key = null;
    this.hemi = null;
    this.burrow = null;
    this.fog = null;

    /* Zone cross-fade state. `_t` runs 0→1 over `_dur`; every colour below is
     * re-evaluated from `_from`/`_to` while it does. */
    this._from = zoneFor(0);
    this._to = zoneFor(0);
    this._t = 1;
    this._dur = 0;

    this._focus = new THREE.Vector3(0, 0, 0);
    this._radius = 6.5;
    this._burrowBase = 2.6;
    this._burrowPulse = 0;
    this._shadowsOn = true;

    try {
      this._build();
      this.ok = true;
      this.setZone(0, 0);
    } catch (err) {
      console.error('[lighting] build failed, degrading to no-op:', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * Build
   * ------------------------------------------------------------------ */

  _build() {
    const size = [512, 1024, 2048][this.tier];

    const key = new THREE.DirectionalLight(0xfff2c8, 3.1);
    key.castShadow = true;
    key.shadow.mapSize.set(size, size);
    // Ortho frustum, sized by focusOn(). Near/far bracket the leaf plus the
    // branch beneath it — nothing else is allowed to cast, so this can be tight.
    const sc = key.shadow.camera;
    sc.near = 1;
    sc.far = KEY_DIST + 14;
    // A smooth curved surface acnes badly under a plain constant bias; on the
    // leaf's dome it is normalBias that actually clears it.
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.028;
    key.shadow.radius = this.tier >= 2 ? 2.2 : 1.4;
    key.target.position.set(0, 0, 0);
    this.group.add(key, key.target);
    this.key = key;

    const hemi = new THREE.HemisphereLight(0xa8d2ff, 0x35521f, 0.85);
    hemi.position.set(0, 30, 0);
    this.group.add(hemi);
    this.hemi = hemi;

    const fill = new THREE.DirectionalLight(0xcfe4ff, 0.7);
    fill.castShadow = false;
    fill.target.position.set(0, 0, 0);
    this.group.add(fill, fill.target);
    this.fill = fill;

    const fill2 = new THREE.DirectionalLight(0xcfe4ff, 0.3);
    fill2.castShadow = false;
    fill2.target.position.set(0, 0, 0);
    this.group.add(fill2, fill2.target);
    this.fill2 = fill2;

    // The target burrow. Short range so it never leaks onto the world behind —
    // it is a glow *inside* a hole, not a lamp on a stand.
    const pt = new THREE.PointLight(0xffe9a8, 2.6, 7.5, 1.8);
    pt.castShadow = false;
    pt.position.set(0, -0.35, 0);
    this.group.add(pt);
    this.burrow = pt;

    this.fog = new THREE.Fog(0xbfe6a8, 26, 132);
    this.scene.fog = this.fog;
    // Whoever owns the fog wins; world.js checks this flag and stands down.
    if (!this.scene.userData) this.scene.userData = {};
    this.scene.userData.mossfallFogOwner = 'lighting';

    this.scene.add(this.group);
    this.focusOn(0, 0, 0, 6.5);
  }

  /* ------------------------------------------------------------------ *
   * Zones
   * ------------------------------------------------------------------ */

  /**
   * Cross-fade every light and the fog to a zone.
   * @param {number|object} zone  ZONES index, or a ZONES entry
   * @param {number} t            seconds; 0 (or omitted for the first call) snaps
   */
  setZone(zone, t = 1.2) {
    if (!this.ok) return;
    const next = typeof zone === 'object' && zone ? zone : zoneFor(zone | 0);
    // Freeze the *current interpolated* look as the new start, so interrupting a
    // fade half way never pops back to the previous zone.
    this._from = this._t < 1 ? this._snapshot() : this._to;
    this._to = next;
    this._dur = Math.max(0, t || 0);
    this._t = this._dur > 0 ? 0 : 1;
    this._apply();
  }

  /** The look right now, as a zone-shaped plain object. */
  _snapshot() {
    const a = this._from, b = this._to, k = easeInOutCubic(clamp01(this._t));
    const mixHex = (ha, hb) => _c.setHex(ha).lerp(_ctmp.setHex(hb), k).getHex();
    return {
      id: a.id + (b.id - a.id) * k,
      fog: mixHex(a.fog, b.fog),
      fogNear: a.fogNear + (b.fogNear - a.fogNear) * k,
      fogFar: a.fogFar + (b.fogFar - a.fogFar) * k,
      sun: mixHex(a.sun, b.sun),
      sunInt: a.sunInt + (b.sunInt - a.sunInt) * k,
      ambient: mixHex(a.ambient, b.ambient),
      ambientInt: a.ambientInt + (b.ambientInt - a.ambientInt) * k,
      hazeBot: mixHex(a.hazeBot, b.hazeBot),
      glow: mixHex(a.glow, b.glow),
      rim: mixHex(a.rim, b.rim),
    };
  }

  _apply() {
    const a = this._from, b = this._to, k = easeInOutCubic(clamp01(this._t));

    this.key.color.setHex(a.sun).lerp(_ctmp.setHex(b.sun), k);
    this.key.intensity = a.sunInt + (b.sunInt - a.sunInt) * k;

    this.hemi.color.setHex(a.ambient).lerp(_ctmp.setHex(b.ambient), k);
    this.hemi.groundColor.setHex(a.hazeBot).lerp(_ctmp.setHex(b.hazeBot), k);
    this.hemi.intensity = a.ambientInt + (b.ambientInt - a.ambientInt) * k;

    // Sky bounce, so it takes the zone's ambient hue — but pulled well toward
    // the sun, because a pure sky blue at this strength turns every trunk in the
    // upper canopy grey.
    this.fill.color.setHex(a.ambient).lerp(_ctmp.setHex(b.ambient), k)
      .lerp(_c.setHex(a.sun).lerp(_ctmp.setHex(b.sun), k), 0.55);
    this.fill.intensity = Math.min(this.hemi.intensity * FILL_SCALE, this.key.intensity * FILL_CEIL);

    // Cooler than the main fill — it stands in for skylight wrapping round the
    // shadow side, and that side of a forest is never sun-coloured.
    this.fill2.color.setHex(a.ambient).lerp(_ctmp.setHex(b.ambient), k)
      .lerp(_c.setHex(a.sun).lerp(_ctmp.setHex(b.sun), k), 0.22);
    this.fill2.intensity = this.fill.intensity * FILL2_SCALE;

    if (this._burrowTint == null) {
      this.burrow.color.setHex(a.glow).lerp(_ctmp.setHex(b.glow), k);
    }

    if (this.scene.fog === this.fog) {
      this.fog.color.setHex(a.fog).lerp(_ctmp.setHex(b.fog), k);
      this.fog.near = a.fogNear + (b.fogNear - a.fogNear) * k;
      this.fog.far = a.fogFar + (b.fogFar - a.fogFar) * k;

      // Whatever the fog dissolves into has to be the same colour the frame is
      // cleared to, or the far plane is a visible edge — and a clear colour
      // fixed at boot means every zone below the crown is a teal tree standing
      // against a bright green sky.
      if (this.renderer) this.renderer.setClearColor(this.fog.color, 1);
    }
  }

  /**
   * Hand over the renderer so the clear colour can track the fog. Optional —
   * everything else works without it, so a headless build can skip it.
   */
  setRenderer(renderer) {
    this.renderer = renderer || null;
    if (this.ok && this.renderer && this.scene.fog === this.fog) {
      this.renderer.setClearColor(this.fog.color, 1);
    }
  }

  /* ------------------------------------------------------------------ *
   * Focus
   * ------------------------------------------------------------------ */

  /**
   * Point the key at a leaf and shrink-wrap the shadow frustum around it.
   * `camera.js` calls this whenever it frames a level; the director calls it
   * once per load. Idempotent and allocation-free.
   */
  focusOn(x, y, z, radius) {
    if (!this.ok) return;
    const r = Math.max(2, radius || this._radius);
    this._focus.set(x || 0, y || 0, z || 0);
    this._radius = r;

    this.key.target.position.copy(this._focus);
    this.key.target.updateMatrixWorld();
    this.key.position.copy(this._focus).addScaledVector(KEY_DIR, KEY_DIST);

    this.fill.target.position.copy(this._focus);
    this.fill.target.updateMatrixWorld();
    this.fill.position.copy(this._focus).addScaledVector(FILL_DIR, FILL_DIST);

    this.fill2.target.position.copy(this._focus);
    this.fill2.target.updateMatrixWorld();
    this.fill2.position.copy(this._focus).addScaledVector(FILL2_DIR, FILL_DIST);

    const sc = this.key.shadow.camera;
    const pad = r * 1.25 + 1.2;
    if (sc.right !== pad) {
      sc.left = -pad; sc.right = pad; sc.top = pad; sc.bottom = -pad;
      sc.updateProjectionMatrix();
    }
  }

  /** Put the warm point light inside the level's target burrow. */
  setBurrow(x, y, z, colorHex, intensity) {
    if (!this.ok) return;
    this.burrow.position.set(x || 0, (y != null ? y : 0) - 0.28, z || 0);
    if (colorHex != null) {
      this._burrowTint = colorHex;
      this.burrow.color.setHex(colorHex);
    } else {
      this._burrowTint = null;
    }
    this._burrowBase = intensity != null ? intensity : 2.6;
  }

  /** A one-shot brightening — the director calls this on a capture. */
  flashBurrow(strength = 1) {
    this._burrowPulse = Math.min(2.5, this._burrowPulse + strength);
  }

  setShadows(on) {
    if (!this.ok) return;
    this._shadowsOn = !!on;
    this.key.castShadow = this._shadowsOn;
  }

  /* ------------------------------------------------------------------ *
   * Frame
   * ------------------------------------------------------------------ */

  update(dt, elapsed) {
    if (!this.ok) return;
    if (this._t < 1) {
      this._t = this._dur > 0 ? Math.min(1, this._t + dt / this._dur) : 1;
      this._apply();
    }
    // The burrow breathes. Slow enough to read as "alive", shallow enough that
    // it never competes with the beetles for attention.
    const breathe = 0.86 + 0.14 * Math.sin(elapsed * 1.35);
    if (this._burrowPulse > 0) this._burrowPulse *= Math.exp(-4.5 * dt);
    this.burrow.intensity = this._burrowBase * breathe + this._burrowPulse * 3.2;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.key) {
      if (this.key.shadow && this.key.shadow.map) this.key.shadow.map.dispose();
      this.key.dispose();
    }
    if (this.hemi) this.hemi.dispose();
    if (this.fill) this.fill.dispose();
    if (this.fill2) this.fill2.dispose();
    if (this.burrow) this.burrow.dispose();
    if (this.scene.fog === this.fog) {
      this.scene.fog = null;
      if (this.scene.userData) this.scene.userData.mossfallFogOwner = null;
    }
    this.ok = false;
  }
}

/** Scratch for the colour lerps above — hoisted so `_apply` never allocates. */
const _ctmp = new THREE.Color();

export function createLighting(scene, quality) {
  return new Lighting(scene, quality);
}

export default Lighting;
