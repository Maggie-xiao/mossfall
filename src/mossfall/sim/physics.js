/**
 * MOSSFALL — the leaf solver.
 *
 * One job: move round beetles across an analytic leaf, exactly, every time.
 *
 * This is a bespoke sphere-on-height-field solver rather than a rigid-body
 * engine, and that is a deliberate choice. A general engine would represent the
 * leaf as a triangle mesh, and sphere-vs-trimesh gives you edge snagging, rest
 * jitter and the occasional impossible bounce — precisely the unpredictability
 * this game cannot afford. Here the surface is a function, so contact is exact
 * at every point and there are no edges to catch on.
 *
 * The second idea that makes it feel honest: the leaf's tilt never moves the
 * beetles' frame. Everything lives in board space and gravity is rotated *into*
 * it instead —
 *
 *     gB = R(pitch, roll)⁻¹ · (0, −g, 0)
 *
 * so a tilt is just a constant in-plane acceleration. Nothing is re-transformed
 * per frame, nothing accumulates drift, and a level leaf is *exactly* level: the
 * in-plane term is bit-for-bit zero, which is why a resting beetle can be held
 * perfectly still rather than "nearly" still.
 *
 * Beetles roll rather than slide, so the tangential term carries the solid
 * sphere's 5/7 factor. Below `restSpeed` and `restSlope` velocity is zeroed
 * outright and the position is not integrated at all — the single most important
 * behaviour in the game, and the reason nothing here is allowed to nudge a
 * sleeping beetle.
 */

import * as THREE from 'three';
import { clamp01, easeOutCubic, TAU } from '../core/math.js';
import { EventBus } from '../core/events.js';
import { Field } from './field.js';

/**
 * Every constant the feel depends on, in one editable object. Dev mode mutates
 * this live, so the solver reads through it each step instead of caching values.
 */
export const PHYSICS_TUNING = {
  gravity: 16.5,          // m/s² — heavier than earth so a 7 m leaf plays quickly
  rollFactor: 5 / 7,      // solid sphere rolling without slipping: a = 5/7·g·sinθ
  linearDamp: 0.80,       // viscous drag, 1/s. Sets terminal speed; see §rim below
  rollFriction: 1.00,     // rolling resistance in m/s² at full normal load
  restSpeed: 0.09,        // m/s — below this *and* restSlope, velocity is zeroed
  restSlope: 0.055,       // surface slope (sinθ) that still counts as flat
  restitution: 0.38,      // bounce off static obstacles
  ballRestitution: 0.32,  // beetle vs beetle
  maxSpeed: 9,            // hard clamp, m/s
  captureSpeed: 4.2,      // faster than this and a beetle skips over a burrow

  captureDur: 0.55,       // seconds of sink-and-settle once a burrow takes it
  captureLip: 0.30,       // capture needs dist < holeR − r·captureLip
  squashDecay: 7.0,       // 1/s — impact squash relaxes at this rate
  squashPerSpeed: 0.34,   // squash added per m/s of impact
  hitMinSpeed: 0.25,      // quieter than this and a contact is resolved silently

  moverDamp: 1.45,        // free dew drops are heavier and wetter than beetles
  moverFriction: 1.35,
  moverMass: 2.4,
  moverPush: 1.6,         // a dew drop shoves a beetle harder than momentum says
  moverRestitution: 0.30,

  subStep: 0.4,           // sub-step once a body would move more than 0.4·r
  maxSubSteps: 8,
  fallGrip: 0.16,         // outward nudge (m/s) when a beetle finally lets go
  fallFloor: -14,         // metres below the board where a fall is parked
  wrongPush: 0.55,        // m/s of soft rejection out of a mismatched burrow
};

/**
 * The width of the skin a contact is allowed to breathe inside before the
 * solver will admit the body has moved. A contact solver parks a body at
 * *exactly* touching distance, so the next step re-derives a separation that
 * differs only by float rounding and by whatever the drive re-closed in one
 * frame at a speed the rest gate has already called zero. Treating that as
 * motion is what kept a settled pile awake for ever. A micron is orders of
 * magnitude below anything the surface, the eye, or the renderer's sub-pixel
 * work resolves, and `_collideObstacles` arrived at the same number by the same
 * argument for its own re-contact test.
 */
const CONTACT_SKIN = 1e-6;

/* --- module-scope scratch. Nothing below may allocate per frame. --------- */
const _s = { sdf: 0, h: 0, hx: 0, hz: 0 };
const _axis = new THREE.Vector3(0, 1, 0);
const _dq = new THREE.Quaternion();
// `edge` separates the two voices the director has for a knock: the waxy rim
// curl against everything else. Only the solver can tell them apart, so it is
// carried on the payload rather than guessed at from speed downstream. Every
// emitter writes it, true or false, because this object is scratch that is
// reused for the life of the module and a flag left standing from the last hit
// would turn the next twig into a rim.
const _evHit = { bug: null, other: null, kind: '', x: 0, z: 0, speed: 0, edge: false };
const _evFall = { bug: null, x: 0, z: 0 };
const _evCap = { bug: null, hole: null, remaining: 0 };
const _evWrong = { bug: null, hole: null };
const _evRest = { bug: null };

/* ===================================================================== *
 * Bodies
 * ===================================================================== */

function makeBug(spec, i) {
  const r = spec && spec.r != null ? spec.r : 0.3;
  return {
    id: (spec && spec.id) || `b${i + 1}`,
    color: (spec && spec.color) || 'red',
    species: (spec && spec.species) || 'beetle',
    r,
    mass: spec && spec.mass != null ? spec.mass : 1,
    x: (spec && spec.x) || 0, y: 0, z: (spec && spec.z) || 0,
    px: 0, py: 0, pz: 0,
    vx: 0, vy: 0, vz: 0,
    spin: new THREE.Quaternion(),
    pspin: new THREE.Quaternion(),
    speed: 0,
    contactNormal: { x: 0, y: 1, z: 0 },
    state: 'roll',
    captureT: 0,
    squash: 0,
    restT: 0,
    hole: null,
    free: false,
    isMover: false,
    // home is where the rescue puts it back if the director asks for "wherever it started"
    home: { x: (spec && spec.x) || 0, z: (spec && spec.z) || 0 },
    // last rolling ω, kept so a falling beetle keeps tumbling in the air
    _wx: 0, _wy: 0, _wz: 0,
    _rejected: null,      // burrow we are currently being pushed out of
    _onRim: false,        // shell was overlapping the outline last frame
    _cx: 0, _cz: 0, _cy: 0,  // capture start pose
    // Last obstacle contact, written by `_collideObstacles` and read by the next
    // sub-step when it builds its drive. Its lifetime is the reason it can be
    // trusted: `_collideObstacles` wipes it on entry and rebuilds it from
    // nothing, and it runs at the foot of `_integrate`, past the rest gate's
    // early return. So for a body that is awake the record only ever describes
    // the spot it is standing on now, and it outlives a frame in exactly one
    // case — a body the gate sent home before that call, which by definition has
    // not moved. `_stepFall` and `_advanceCapture` write x/z without clearing it
    // and are still safe, but only because `state` leaves 'falling'/'captured'
    // in one place, `_place`, which clears it.
    //
    // What happens when something *other* than the body's own drive moves it is
    // worth saying out loud, because it is two rules and not one. A hole
    // rejection and a free mover's rim bounce are teleports of a size nobody
    // could call incidental, so both clear the record where they stand. The
    // contact sweep does not: `_resolvePair` and `_shove` nudge bodies about and
    // leave the question to `_wakeIfMoved`, which weighs the *net* travel over
    // the whole sweep and only clears past one frame of it at `restSpeed`. That
    // is deliberate rather than an oversight. A displacement under that bar is
    // not motion by this solver's own definition — the gate would put the body
    // straight back to sleep for claiming otherwise — and clearing on every
    // micron of give-and-take between two beetles leaning together is exactly
    // what used to hold a settled pair awake for ever.
    //
    // The price wants stating exactly, because it is not the tidy one it looks
    // like. `_wakeIfMoved` weighs one sweep, and a sleeping body never comes
    // back through `_collideObstacles` to have its record redrawn, so nudges
    // that each sit under the bar pile up against a record nothing resets.
    // Nothing bounds the total. Nine boards, piles of one to four, twelve drive
    // directions and four tilt schedules — a million sleeping contact frames —
    // put the worst accumulation at 51 mm, with a tenth of those frames past the
    // bar. Most of that is harmless, because the record only earns its keep when
    // it changes the gate's answer and the body is usually still touching the
    // twig regardless. On 0.8% of them it is not, and the worst of those holds a
    // beetle 22 mm — seven per cent of its own radius — off the twig it believes
    // it is leaning on. What that looks like is a beetle at rest beside a twig
    // rather than against it, which on a 7 m leaf nobody can call wrong.
    // Bounding it is easy enough — stamp where the record was drawn, drop it
    // once the body is further from that spot than the same bar — and it does
    // work, taking the worst hold-off-a-twig to under half a millimetre. It also
    // wakes ten per cent more bodies that had already settled, because every
    // drop is another chance for the gate to change its mind. Stillness is what
    // this solver sells, so the drift keeps its place.
    _cnx: 0, _cnz: 0, _held: false,
    // The same idea for a neighbouring body, kept apart because it runs on a
    // different clock. A twig stays where it was left; a beetle can walk away,
    // so this record is rebuilt from nothing every frame by `_collidePairs`
    // whether the body is awake or not, and never outlives the contact.
    _pnx: 0, _pnz: 0, _pHeld: false,
    // Where the body stood when the contact sweep began, so `_collidePairs` can
    // ask what the sweep did to it as a whole rather than one neighbour at a time.
    _sx: 0, _sz: 0,
    // The drive left after the scenery has taken its share, plus the friction it
    // is measured against. Cached so a neighbour can ask "are you about to slide
    // out from under me?" without re-sampling the field.
    _dx: 0, _dz: 0, _fric: 0,
  };
}

function makeMover(spec, i, field) {
  const r = spec && spec.r != null ? spec.r : 0.35;
  const path = (spec && spec.path) || 'orbit';
  const m = {
    id: (spec && spec.id) || `m${i + 1}`,
    kind: (spec && spec.kind) || 'dew',
    r,
    mass: PHYSICS_TUNING.moverMass,
    path,
    x: (spec && spec.x) || 0, y: 0, z: (spec && spec.z) || 0,
    px: 0, py: 0, pz: 0,
    vx: 0, vy: 0, vz: 0,
    spin: new THREE.Quaternion(),
    pspin: new THREE.Quaternion(),
    speed: 0,
    contactNormal: { x: 0, y: 1, z: 0 },
    state: 'roll',
    squash: 0,
    restT: 0,
    captureT: 0,
    hole: null,
    free: path === 'free',
    isMover: true,
    _wx: 0, _wy: 0, _wz: 0,
    _cnx: 0, _cnz: 0, _held: false,
    _pnx: 0, _pnz: 0, _pHeld: false,
    _sx: 0, _sz: 0,
    // The drive left after the scenery has taken its share, plus the friction it
    // is measured against. Cached so a neighbour can ask "are you about to slide
    // out from under me?" without re-sampling the field.
    _dx: 0, _dz: 0, _fric: 0,
    // path parameters, resolved once so the per-frame path is pure arithmetic
    cx: spec && spec.cx != null ? spec.cx : (spec && spec.x) || 0,
    cz: spec && spec.cz != null ? spec.cz : (spec && spec.z) || 0,
    rad: spec && spec.rad != null ? spec.rad : 1,
    ax: spec && spec.ax != null ? spec.ax : 0,
    az: spec && spec.az != null ? spec.az : 0,
    bx: spec && spec.bx != null ? spec.bx : 0,
    bz: spec && spec.bz != null ? spec.bz : 0,
    speedParam: spec && spec.speed != null ? spec.speed : 0.4,
    phase: spec && spec.phase != null ? spec.phase : i * 1.37,
    _len: 1, _w: 1,
  };
  if (path === 'line') {
    m._len = Math.max(1e-3, Math.hypot(m.bx - m.ax, m.bz - m.az));
    // ω chosen so the *mean* speed over a there-and-back cycle equals `speed`.
    m._w = (TAU * m.speedParam) / (2 * m._len);
  }
  if (path === 'wander') {
    m.cx = (spec && spec.x) || 0;
    m.cz = (spec && spec.z) || 0;
    m.rad = spec && spec.rad != null ? spec.rad : 0.9;
  }
  if (field && !m.free) {
    // Snap a path mover onto its curve immediately so frame 0 is not a jump.
    m.y = field.height(m.x, m.z) + r;
  }
  return m;
}

/* ===================================================================== *
 * LeafSim
 * ===================================================================== */

export class LeafSim {
  /**
   * @param {Field} field  the leaf this sim runs on
   * @param {object} spec  `level.board`; may carry a `tuning` override object
   */
  constructor(field, spec) {
    this.field = field || null;
    this.spec = spec || (field && field.spec) || {};
    this.events = new EventBus();

    // Prototype chain, not a copy: per-level overrides win, but everything else
    // still tracks live edits to PHYSICS_TUNING from dev mode.
    this.tuning = Object.create(PHYSICS_TUNING);
    if (this.spec && this.spec.tuning) Object.assign(this.tuning, this.spec.tuning);

    this.level = null;
    this.colorMatch = false;
    this.pitch = 0;
    this.roll = 0;
    this.tiltRate = 0;
    this.time = 0;

    this._bugs = [];
    this._movers = [];
    this._obstacles = [];
    this._holes = [];
    this._pPitch = 0;
    this._pRoll = 0;
    this._gx = 0; this._gy = -PHYSICS_TUNING.gravity; this._gz = 0;

    if (this.field) this._bake(this.spec);
    this._updateGravity();
  }

  get bugs() { return this._bugs; }
  get movers() { return this._movers; }
  get holes() { return this._holes; }
  get obstacles() { return this._obstacles; }

  get remaining() {
    let n = 0;
    for (let i = 0; i < this._bugs.length; i++) if (this._bugs[i].state !== 'captured') n++;
    return n;
  }

  get allCaptured() { return this._bugs.length > 0 && this.remaining === 0; }

  /* ------------------------------------------------------------------ *
   * Level setup
   * ------------------------------------------------------------------ */

  /**
   * (Re)seed everything for a level. `field` is optional: pass the Field the
   * renderer built so both agree bit-for-bit; otherwise one is built from
   * `level.board` when it differs from the field we were constructed with.
   */
  reset(level, field) {
    this.level = level || null;
    const board = (level && level.board) || this.spec;
    if (field) this.field = field;
    else if (board && (!this.field || board !== this.field.spec)) {
      try { this.field = new Field(board); } catch (err) { console.error('[physics] field build failed', err); }
    }
    if (!this.field) return;

    this.colorMatch = !!(level && level.colorMatch);
    this._holes = this.field.holes || [];
    this._bake(board);

    this._bugs.length = 0;
    const list = (level && level.bugs) || [];
    for (let i = 0; i < list.length; i++) {
      const b = makeBug(list[i], i);
      this._place(b, b.x, b.z);
      this._bugs.push(b);
    }

    this._movers.length = 0;
    const mv = (board && board.movers) || [];
    for (let i = 0; i < mv.length; i++) {
      const m = makeMover(mv[i], i, this.field);
      this._place(m, m.x, m.z);
      this._movers.push(m);
    }

    this.pitch = this.roll = this._pPitch = this._pRoll = 0;
    this.tiltRate = 0;
    this.time = 0;
    this._updateGravity();
  }

  /** Flatten the obstacle list into discs and capsules once, at load. */
  _bake(board) {
    const out = this._obstacles;
    out.length = 0;
    const list = (board && board.obstacles) || [];
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o) continue;
      const e = o.restitution != null ? o.restitution : -1;   // −1 → use the tuning default
      if (o.ax != null && o.bx != null) {
        out.push({ cap: true, ax: o.ax, az: o.az || 0, bx: o.bx, bz: o.bz || 0, r: o.r || 0.15, e, kind: o.kind || 'twig' });
      } else {
        out.push({ cap: false, x: o.x || 0, z: o.z || 0, r: o.r || 0.25, e, kind: o.kind || 'pebble' });
      }
    }
  }

  /** Drop a body onto the surface at rest. */
  _place(b, x, z) {
    b.x = x; b.z = z;
    b.px = x; b.pz = z;
    b.vx = b.vy = b.vz = 0;
    b.speed = 0;
    b.state = 'roll';
    b.captureT = 0;
    b.squash = 0;
    b.restT = 0;
    b.hole = null;
    b._rejected = null;
    b._held = false;
    b._pHeld = false;
    b._onRim = false;
    b._wx = b._wy = b._wz = 0;
    const f = this.field;
    b.y = (f ? f.height(x, z) : 0) + b.r;
    b.py = b.y;
    if (f) f.normal(x, z, b.contactNormal);
    b.spin.set(0, 0, 0, 1);
    b.pspin.set(0, 0, 0, 1);
  }

  /* ------------------------------------------------------------------ *
   * Tilt
   * ------------------------------------------------------------------ */

  setTilt(pitch, roll) {
    this.pitch = isFinite(pitch) ? pitch : 0;
    this.roll = isFinite(roll) ? roll : 0;
  }

  /**
   * Board-space gravity: the exact inverse of `group.rotation.set(pitch, 0, roll)`
   * with order 'ZXY', i.e. R = Rz(roll)·Rx(pitch). Deriving it in closed form
   * (rather than inverting a matrix) keeps a level leaf *exactly* level — sin(0)
   * is 0, so the in-plane term is identically zero and nothing can creep.
   */
  _updateGravity() {
    const g = this.tuning.gravity;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    this._gx = -g * sr;
    this._gy = -g * cr * cp;
    this._gz = g * cr * sp;
  }

  /* ------------------------------------------------------------------ *
   * The step
   * ------------------------------------------------------------------ */

  /** FIXED dt only — the loop guarantees 1/120. Never call this with a frame dt. */
  step(dt) {
    if (!this.field || !(dt > 0)) return;

    // Previous pose first, before anything moves, so the render pass can
    // interpolate with the loop's alpha no matter where it lands.
    const bugs = this._bugs, movers = this._movers;
    for (let i = 0; i < bugs.length; i++) {
      const b = bugs[i];
      b.px = b.x; b.py = b.y; b.pz = b.z; b.pspin.copy(b.spin);
    }
    for (let i = 0; i < movers.length; i++) {
      const m = movers[i];
      m.px = m.x; m.py = m.y; m.pz = m.z; m.pspin.copy(m.spin);
    }

    const dp = this.pitch - this._pPitch, dr = this.roll - this._pRoll;
    this.tiltRate = Math.hypot(dp, dr) / dt;
    this._pPitch = this.pitch;
    this._pRoll = this.roll;
    this._updateGravity();
    this.time += dt;

    for (let i = 0; i < movers.length; i++) this._stepMover(movers[i], dt);
    for (let i = 0; i < bugs.length; i++) this._stepBody(bugs[i], dt);

    this._collidePairs(dt);

    for (let i = 0; i < bugs.length; i++) this._settle(bugs[i], dt);
    for (let i = 0; i < movers.length; i++) if (movers[i].free) this._settle(movers[i], dt);
  }

  /* ------------------------------------------------------------------ *
   * Integration
   * ------------------------------------------------------------------ */

  /** Sub-stepped advance of one rolling body. */
  _stepBody(b, dt) {
    const T = this.tuning;
    if (b.state === 'captured') { this._advanceCapture(b, dt); return; }
    if (b.state === 'rescued') return;            // the director owns it mid-catch
    if (b.state === 'falling') { this._stepFall(b, dt); return; }

    const maxMove = T.subStep * b.r;
    const minH = dt / T.maxSubSteps;
    let left = dt;
    let guard = 0;
    while (left > 1e-7 && guard++ < T.maxSubSteps) {
      const spd = Math.hypot(b.vx, b.vz);
      let h = left;
      if (spd * h > maxMove) h = Math.max(maxMove / spd, minH);
      if (h > left) h = left;
      left -= h;
      this._integrate(b, h);
      if (b.state !== 'roll') break;              // fell, or dropped into a burrow
    }
  }

  /** One sub-step: surface, gravity, friction, move, static obstacles. */
  _integrate(b, h) {
    const T = this.tuning;
    const f = this.field;
    f.sample(b.x, b.z, _s);

    // Surface normal from the slope. |(-hx, 1, -hz)| normalised.
    const inv = 1 / Math.sqrt(_s.hx * _s.hx + _s.hz * _s.hz + 1);
    const nx = -_s.hx * inv, ny = inv, nz = -_s.hz * inv;

    const gx = this._gx, gy = this._gy, gz = this._gz;
    const gn = nx * gx + ny * gy + nz * gz;        // normal load (negative)
    const tx = gx - nx * gn, ty = gy - ny * gn, tz = gz - nz * gn;
    // Slope measure in units of g, so `restSlope` reads directly as sinθ.
    const slope = Math.sqrt(tx * tx + ty * ty + tz * tz) / T.gravity;

    // Rolling resistance. Normalised by g so the constant reads in m/s² at a
    // full normal load and drops off naturally as the leaf tilts.
    const load = Math.abs(gn) / T.gravity;
    const fric = (b.free ? T.moverFriction : T.rollFriction) * load;

    let ax = tx * T.rollFactor, az = tz * T.rollFactor;     // board-plane drive
    // A prop the body is already leaning on cancels whatever part of that drive
    // points into it — the same thing the contact solver does to the velocity a
    // moment later. Taking it out here instead is what keeps the drive and the
    // rest gate telling one story: friction is then spent on the part of the
    // drive that is genuinely trying to move the body, rather than being split
    // between that and a normal push the twig was always going to eat. Left in,
    // friction only ever scaled the whole vector, so a body pinned by a large
    // drive kept a slice of the along-the-twig term no matter how small it was,
    // and crept off a spot the gate had already called still.
    if (b._held) {
      const dn = ax * b._cnx + az * b._cnz;
      if (dn < 0) { ax -= b._cnx * dn; az -= b._cnz * dn; }
    }
    // What is left after the scenery has taken its share is the drive this body
    // would follow if every other beetle vanished. That is the honest measure of
    // whether it is about to slide out from under a neighbour, so it is the one
    // `_resolvePair` reads when deciding whether this body can serve as a prop.
    // Beetle contacts are deliberately not in it: a prop whose own support came
    // from the thing it is propping would let a sliding pair talk each other to
    // sleep, which is the one failure this must never allow.
    b._dx = ax; b._dz = az; b._fric = fric;

    // A neighbouring body props this one up in exactly the same way, and is
    // recorded in the same shape. Taking the two in turn rather than bisecting
    // them is what lets a body wedged into a corner be still: each contact eats
    // the part of the drive that points into it, and a beetle held between a
    // twig and a friend has nowhere left to go.
    if (b._pHeld) {
      const dn = ax * b._pnx + az * b._pnz;
      if (dn < 0) { ax -= b._pnx * dn; az -= b._pnz * dn; }
    }
    const aMag = Math.hypot(ax, az);

    const spd0 = Math.hypot(b.vx, b.vz);

    // Viscous drag for this sub-step, exponential so it is identical at any
    // sub-step size. It is worked out up here rather than down with the rest of
    // the integration because the rest gate needs it — see below.
    const visc = Math.exp(-(b.free ? T.moverDamp : T.linearDamp) * h);

    /* --- rest ---------------------------------------------------------
     * Two ways to be asleep, and both zero the velocity outright rather than
     * shrinking it: the leaf is flat enough to count as flat, or friction beats
     * what is left of the drive. Nothing integrates, so a resting beetle is not
     * "almost" still — its coordinates do not change at all.
     *
     * `visc` is in the friction test because the integration below is what the
     * test is really asking about. One sub-step from a standstill leaves
     * a·h·visc of speed, and the Coulomb clamp erases the lot whenever
     * fric·h is at least that much — i.e. whenever a·visc <= fric, the h
     * cancelling out. Comparing the bare drive against friction instead left a
     * band 0.7% wide where the gate called a body awake that the integrator
     * could not shift by a single float: velocity zeroed by the clamp, position
     * never touched, for ever. Eight bodies in a 576-run sweep sat in it,
     * measured moving exactly 0.0 m in the two seconds after being called awake.
     *
     * The second clause is why the contact record exists. A beetle wedged
     * against a twig on a patch steeper than `restSlope` is exactly and
     * permanently stationary, but with the raw drive it read as wide awake: the
     * sleep timer was re-zeroed every substep, so the beetle never breathed,
     * never took its upright pose and pinned the leaf's flex sag. Now that the
     * prop's share is already out of `ax/az`, the same test covers it, and a
     * beetle still free to run along the twig keeps a residual the friction
     * cannot beat and stays awake — which is exactly when it does move. */
    if (spd0 < T.restSpeed && (slope < T.restSlope || aMag * visc <= fric)) {
      if (b.restT === 0 && b.speed > 1e-5 && !b.isMover) {
        b.vx = 0; b.vz = 0;
        _evRest.bug = b;
        this.events.emit('rest', _evRest);
      }
      b.vx = 0; b.vz = 0; b.vy = 0;
      b.speed = 0;
      b.restT += h;
      return;
    }
    b.restT = 0;

    let vx = b.vx + ax * h;
    let vz = b.vz + az * h;
    vx *= visc; vz *= visc;

    // Coulomb-ish term, clamped so friction can slow a body but never reverse it.
    const spd = Math.hypot(vx, vz);
    if (spd > 1e-9) {
      const drop = fric * h;
      if (drop >= spd) { vx = 0; vz = 0; }
      else { const k = (spd - drop) / spd; vx *= k; vz *= k; }
    }

    const spd2 = Math.hypot(vx, vz);
    if (spd2 > T.maxSpeed) { const k = T.maxSpeed / spd2; vx *= k; vz *= k; }

    b.vx = vx; b.vz = vz;
    b.x += vx * h;
    b.z += vz * h;
    b.speed = Math.hypot(vx, vz);

    // Rolling orientation: ω = (n × v)/r with v following the surface, so the
    // shell rolls the way it travels even across a vein.
    const vsy = _s.hx * vx + _s.hz * vz;
    const r = b.r > 1e-4 ? b.r : 1e-4;
    b._wx = (ny * vz - nz * vsy) / r;
    b._wy = (nz * vx - nx * vz) / r;
    b._wz = (nx * vsy - ny * vx) / r;
    this._spin(b, h);

    b.contactNormal.x = nx; b.contactNormal.y = ny; b.contactNormal.z = nz;

    this._collideObstacles(b);
  }

  /** Ballistic arc in board space — enough for the renderer until the catch. */
  _stepFall(b, dt) {
    const T = this.tuning;
    if (b.y < T.fallFloor) { b.vx = b.vy = b.vz = 0; return; }
    b.vx += this._gx * dt;
    b.vy += this._gy * dt;
    b.vz += this._gz * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.speed = Math.hypot(b.vx, b.vz);
    this._spin(b, dt);   // keeps the tumble it left with
  }

  /** Sink-and-settle once a burrow has taken a beetle. */
  _advanceCapture(b, dt) {
    const T = this.tuning;
    if (b.captureT >= 1) return;
    b.captureT = clamp01(b.captureT + dt / Math.max(0.05, T.captureDur));
    const t = b.captureT;
    const h = b.hole;
    if (!h) return;
    // Lateral centring finishes early — it reads as the beetle finding the
    // mouth — while the drop keeps accelerating under it.
    const lat = easeOutCubic(clamp01(t * 1.7));
    const drop = t * t * (3 - 2 * t);
    b.x = b._cx + (h.x - b._cx) * lat;
    b.z = b._cz + (h.z - b._cz) * lat;
    b.y = b._cy - (b.r * 2.2 + 0.12) * drop;
    b.speed = 0;
    this._spin(b, dt * (1 - t));    // a last lazy half-turn as it goes under
  }

  /** Apply the stored ω for `h` seconds. Allocation-free. */
  _spin(b, h) {
    const w = Math.hypot(b._wx, b._wy, b._wz);
    if (w < 1e-6 || h <= 0) return;
    _axis.set(b._wx / w, b._wy / w, b._wz / w);
    _dq.setFromAxisAngle(_axis, w * h);
    b.spin.premultiply(_dq);
  }

  /* ------------------------------------------------------------------ *
   * Post-move: surface, rim, burrows
   * ------------------------------------------------------------------ */

  _settle(b, dt) {
    const T = this.tuning;
    b.squash = b.squash > 1e-4 ? b.squash * Math.exp(-T.squashDecay * dt) : 0;
    if (b.state !== 'roll') return;

    const f = this.field;
    f.sample(b.x, b.z, _s);
    b.y = _s.h + b.r;
    const inv = 1 / Math.sqrt(_s.hx * _s.hx + _s.hz * _s.hz + 1);
    b.contactNormal.x = -_s.hx * inv;
    b.contactNormal.y = inv;
    b.contactNormal.z = -_s.hz * inv;

    if (!b.isMover) {
      if (this._checkHoles(b)) return;
      // The rim curl is the wall; a beetle only lets go once its *centre* is
      // past the outline, by which point it has already climbed the whole lip.
      if (_s.sdf >= 0) { this._detach(b); return; }

      // Climbing that lip is the one contact here that is not a knock against a
      // thing, which is what makes it the only place `edge` can honestly come
      // from: shell over the outline, centre still inside. It fires on arrival
      // rather than every frame because a beetle can lean on the curl for the
      // better part of five seconds — 566 frames of it, driving every board at
      // 98% of maxTilt with the tilt swinging to hold bodies against the rim —
      // and a contact that lasts is still only one event. `wrongHole` keeps
      // itself honest the same way and for the same reason. Over that whole
      // sweep, twenty-five minutes of play spent hunting for the rim, this
      // arrives thirty times.
      const onRim = _s.sdf > -b.r;
      if (onRim && !b._onRim && b.speed >= T.hitMinSpeed) {
        _evHit.bug = b; _evHit.other = null; _evHit.kind = 'rim'; _evHit.edge = true;
        _evHit.x = b.x; _evHit.z = b.z; _evHit.speed = b.speed;
        this.events.emit('hit', _evHit);
      }
      b._onRim = onRim;
    } else if (b.free) {
      // Free movers are never lost — they bounce off the outline so the level
      // keeps its hazard for as long as the player needs it.
      this._bounceOffRim(b, _s);
    }
  }

  _detach(b) {
    const T = this.tuning;
    b.state = 'falling';
    b.restT = 0;
    b.vy = 0;
    const spd = Math.hypot(b.vx, b.vz);
    if (spd > 1e-4) {
      // A whisker of outward push so the arc clears the lip visually.
      b.vx += (b.vx / spd) * T.fallGrip;
      b.vz += (b.vz / spd) * T.fallGrip;
    }
    _evFall.bug = b; _evFall.x = b.x; _evFall.z = b.z;
    this.events.emit('fall', _evFall);
  }

  /**
   * Burrows. A beetle is swallowed when its centre is inside the mouth by a
   * comfortable lip *and* it is slow enough to drop rather than skim — the
   * speed rule is a teaching tool, not a bug.
   */
  _checkHoles(b) {
    const T = this.tuning;
    const holes = this._holes;
    const swallow = T.captureLip * b.r;
    for (let i = 0; i < holes.length; i++) {
      const hl = holes[i];
      const dx = b.x - hl.x, dz = b.z - hl.z;
      const d = Math.hypot(dx, dz);
      if (d > hl.r + b.r) {
        if (b._rejected === hl.id) b._rejected = null;   // clear once we are clear
        continue;
      }
      if (d >= hl.r - swallow) continue;
      if (b.speed >= T.captureSpeed) continue;           // too fast — it skims over

      const wrongColour = this.colorMatch && hl.target && hl.color && hl.color !== b.color;
      if (wrongColour) { this._reject(b, hl, dx, dz, d); return false; }
      if (!hl.target) { this._detach(b); return true; }  // a bite in the blade

      b.state = 'captured';
      b.hole = hl;
      b.captureT = 0;
      b.restT = 0;
      b.vx = b.vy = b.vz = 0;
      b.speed = 0;
      b._cx = b.x; b._cz = b.z; b._cy = b.y;
      _evCap.bug = b; _evCap.hole = hl; _evCap.remaining = this.remaining;
      this.events.emit('capture', _evCap);
      return true;
    }
    return false;
  }

  /** Soft, readable rejection from a burrow of the wrong colour. */
  _reject(b, hl, dx, dz, d) {
    const T = this.tuning;
    let nx, nz;
    if (d > 1e-4) { nx = dx / d; nz = dz / d; }
    else {
      const s = Math.hypot(b.vx, b.vz);
      if (s > 1e-4) { nx = -b.vx / s; nz = -b.vz / s; } else { nx = 0; nz = 1; }
    }
    const want = hl.r - T.captureLip * b.r + b.r * 0.12;
    b.x = hl.x + nx * want;
    b.z = hl.z + nz * want;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) { b.vx -= vn * 1.35 * nx; b.vz -= vn * 1.35 * nz; }
    b.vx += nx * T.wrongPush;
    b.vz += nz * T.wrongPush;
    b.speed = Math.hypot(b.vx, b.vz);
    b.restT = 0;
    b._held = false;
    b.squash = clamp01(b.squash + 0.25);
    if (b._rejected !== hl.id) {
      b._rejected = hl.id;
      _evWrong.bug = b; _evWrong.hole = hl;
      this.events.emit('wrongHole', _evWrong);
    }
  }

  /* ------------------------------------------------------------------ *
   * Contacts
   * ------------------------------------------------------------------ */

  _collideObstacles(b) {
    const T = this.tuning;
    const list = this._obstacles;
    // The contact record is rebuilt from nothing on every sub-step that moves,
    // so the next sub-step only ever props its drive on a contact belonging to
    // the position the body is standing at. Clearing it here and not on entry to
    // `_integrate` is the whole trick: a sleeping body returns before it reaches
    // this line, and that is the only reason its record lives long enough to
    // keep it asleep.
    b._held = false;
    let sumx = 0, sumz = 0;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      let cx, cz;
      if (o.cap) {
        const dx = o.bx - o.ax, dz = o.bz - o.az;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 1e-12 ? clamp01(((b.x - o.ax) * dx + (b.z - o.az) * dz) / l2) : 0;
        cx = o.ax + dx * t; cz = o.az + dz * t;
      } else { cx = o.x; cz = o.z; }

      let px = b.x - cx, pz = b.z - cz;
      let d = Math.hypot(px, pz);
      const R = o.r + b.r;
      // A micron of skin, because the line below parks a body at *exactly* R and
      // a bare `d >= R` would then call that same body untouched on the very next
      // sub-step. The record would flicker off and on, the drive would alternate
      // between propped and full, and a beetle the gate had already settled would
      // ratchet along the twig a fraction of a millimetre per frame. A micron is
      // orders of magnitude below anything the surface or the eye resolves.
      if (d >= R + 1e-6) continue;
      if (d < 1e-5) { px = 0; pz = 1; d = 1e-5; }        // dead centre: pick a way out
      const nx = px / d, nz = pz / d;

      b.x = cx + nx * R;
      b.z = cz + nz * R;
      b._held = true;
      sumx += nx; sumz += nz;
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) {
        const e = o.e >= 0 ? o.e : T.restitution;
        b.vx -= (1 + e) * vn * nx;
        b.vz -= (1 + e) * vn * nz;
        b.speed = Math.hypot(b.vx, b.vz);
        b.squash = clamp01(b.squash + -vn * T.squashPerSpeed);
        // A beetle leaning on a prop grazes it every step; only a real knock is
        // worth an event, or FX and audio would machine-gun on resting contact.
        if (-vn >= T.hitMinSpeed) {
          _evHit.bug = b; _evHit.other = o; _evHit.kind = o.kind; _evHit.edge = false;
          _evHit.x = cx + nx * o.r; _evHit.z = cz + nz * o.r; _evHit.speed = -vn;
          this.events.emit('hit', _evHit);
        }
      }
    }
    if (b._held) {
      // Touching two props at once, the honest normal is the bisector: it under-
      // states what the pair can absorb, so a wedged body may stay awake, but it
      // can never claim support that isn't there. A perfect pinch cancels out,
      // and that is the one case with no single normal to record at all.
      const l = Math.hypot(sumx, sumz);
      if (l > 1e-9) { b._cnx = sumx / l; b._cnz = sumz / l; }
      else b._held = false;
    }
  }

  /** Beetle vs beetle, and beetle vs mover. n is small; the O(n²) is free. */
  _collidePairs(dt) {
    const T = this.tuning;
    const bugs = this._bugs;
    // Rebuilt from nothing every frame, awake or asleep — see the note on the
    // field. This runs for every body, including ones the rest gate sent home,
    // which is what stops a beetle sleeping on the memory of a neighbour that
    // has since rolled away. The cost of being wrong here is a body left behind
    // when the pile wakes, so it is worth the extra sweep.
    const movers = this._movers;
    for (let i = 0; i < bugs.length; i++) { const b = bugs[i]; b._pHeld = false; b._sx = b.x; b._sz = b.z; }
    for (let i = 0; i < movers.length; i++) { const m = movers[i]; m._pHeld = false; m._sx = m.x; m._sz = m.z; }

    for (let i = 0; i < bugs.length; i++) {
      const a = bugs[i];
      if (a.state !== 'roll') continue;
      for (let j = i + 1; j < bugs.length; j++) {
        const b = bugs[j];
        if (b.state !== 'roll') continue;
        this._resolvePair(a, b, T.ballRestitution, 1, 1);
      }
      for (let k = 0; k < movers.length; k++) {
        const m = movers[k];
        if (m.free) this._resolvePair(a, m, T.moverRestitution, T.moverPush, 1);
        else this._shove(a, m, T.moverRestitution);
      }
    }

    // Did the sweep as a whole actually move anybody? This is the only place the
    // question can be answered honestly. A body in the middle of a pile is
    // corrected once per neighbour, and those corrections mostly cancel: judging
    // each one on its own, a three-deep chain looks like it is being shoved from
    // both sides every frame when the truth is that it has not moved at all.
    //
    // The bar is one frame of travel at `restSpeed`, and it has to be that
    // rather than something merely small. `restSpeed` is already this solver's
    // one answer to "how slow is not moving", so a displacement under
    // restSpeed·dt is by the solver's own definition not motion, and the gate
    // would put the body straight back to sleep for saying otherwise. Set it any
    // tighter — a micron, say — and the microscopic give-and-take between two
    // beetles leaning together is read as a shove: each wakes the other, neither
    // can then serve as the other's prop, and the pair holds itself awake for
    // ever by a mechanism that exists only in the bookkeeping.
    const wake = this.tuning.restSpeed * dt;
    this._wakeIfMoved(bugs, wake * wake);
    this._wakeIfMoved(movers, wake * wake);
  }

  /** Second half of `_collidePairs`: net displacement over the contact sweep. */
  _wakeIfMoved(list, wake2) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.state !== 'roll') continue;
      const dx = b.x - b._sx, dz = b.z - b._sz;
      if (dx * dx + dz * dz > wake2) { b._held = false; b.restT = 0; }
    }
  }

  /**
   * Equal-treatment impulse between two dynamic bodies. `pushA` lets a free dew
   * drop shove harder than momentum alone would — the drops are meant to feel
   * like weather, not like billiard balls.
   *
   * Waking is decided per body rather than for the pair, and that distinction is
   * the whole reason a pile can settle. Two beetles leaning together at
   * equilibrium are in contact on every single frame: the drive closes a
   * sub-micron gap, this method opens it again, and for ever. Read as "the pair
   * is being resolved, so both are awake" that is an unbroken stream of wakes on
   * bodies whose own coordinates are not changing — which is what kept every
   * multi-beetle board from ever breathing, posing or letting the leaf's flex
   * sag past its floor. A resolution earns a wake only when it did something the
   * body can tell happened: shifted it further than the contact skin, or left it
   * moving fast enough that the rest gate will not simply put it back to sleep
   * on the next step. The displacement half of that is not decided here — a body
   * in the middle of a chain is corrected once per neighbour and the corrections
   * largely cancel, so only `_collidePairs`, which can see the whole sweep, is in
   * a position to answer "did this body actually move".
   */
  _resolvePair(a, b, e, pushA, pushB) {
    let dx = a.x - b.x, dz = a.z - b.z;
    let d = Math.hypot(dx, dz);
    const R = a.r + b.r;
    // The same micron of skin `_collideObstacles` gives its own re-contact test,
    // and needed here for the same reason: the de-overlap below parks the pair at
    // *exactly* R, so a bare `d >= R` calls two beetles still leaning on each
    // other untouched on the very next frame. That is not a cosmetic difference.
    // Contact is what the prop record is built from, so losing it for one frame
    // hands the propped body its whole drive back, it creeps a few microns into
    // its neighbour, and the resolution that undoes the creep is large enough to
    // count as a wake — a settling pile that ticks awake two or three times a
    // second for ever, which is much harder to see than never settling at all.
    if (d >= R + CONTACT_SKIN) return;
    if (d < 1e-5) { dx = 1; dz = 0; d = 1e-5; }
    const nx = dx / d, nz = dz / d;

    // Positional de-overlap, split by inverse mass so the light one moves more.
    // Inside the skin band there is nothing to push apart — the pair is touching,
    // not overlapping — and pushing anyway would drag them together.
    const ima = 1 / a.mass, imb = 1 / b.mass;
    const pen = R - d;
    const isum = ima + imb;
    if (pen > 0) {
      a.x += nx * pen * (ima / isum); a.z += nz * pen * (ima / isum);
      b.x -= nx * pen * (imb / isum); b.z -= nz * pen * (imb / isum);
    }

    // A neighbour is as good a prop as a twig, but only for as long as it stays
    // put, and the question of whether it will is answerable right here without
    // guessing: `_dx, _dz` is what each body would do with no beetles in the
    // world, so the component of that pointing out from under the other one,
    // measured against the neighbour's own friction, says whether the support is
    // about to walk away. A queue of beetles sliding down an open slope fails it
    // — the one in front is leaving, so the one behind may claim nothing and the
    // whole queue keeps sliding, which is the behaviour that must never be lost.
    // Two beetles squeezed together against the rim pass it, because neither has
    // anywhere to go. Deciding it on the drive rather than on who fell asleep
    // first is what takes the ordering out: nobody waits for a neighbour to go
    // first, so a pair that arrives in the same instant settles in the same
    // instant, which is more than anything before it managed.
    //
    // Two is also as far as it reaches, and the next person along should know
    // where the wall is. The body actually touching scenery has the twig's share
    // taken out of `ax/az` before `_dx/_dz` is cached, so it reads as going
    // nowhere and can hold the one behind it. That second body's cache is still
    // the whole drive — the neighbour's share comes off afterwards, deliberately
    // — so it can never hold a third. Sharper still, the third's arrival costs
    // the second the sleep it had: it is touched from both sides now, `_propUp`
    // adds two nearly opposite normals, and the small residual it normalises
    // points across the drive rather than along it, so it cancels nothing. Lined
    // up behind l1's mushroom at 95% of maxTilt, the middle beetle is left with
    // 1.93 of drive against 0.99 of friction, which is precisely what it would
    // have with no prop at all, where the downhill normal alone would have left
    // it 0.23 and asleep. Moving the cache below the neighbour's share does not
    // lift the limit — that was tried and measured and changes nothing — since
    // the middle body has no usable record to subtract in the first place.
    //
    // Whether that matters is a question about the shipped boards, and there it
    // is nearly moot: six of the nine carry one beetle, three carry two — the
    // case that works — and only l8 carries three. Driven through twelve
    // directions and four tilt schedules, l8 stands in a three-chain touching
    // scenery on 2,096 of 126,720 frames, 1.65% of them, the longest unbroken
    // stretch ten seconds, and `settled` is false in every single one. Real,
    // then, on one board, and a redesign of the pile solver is a bigger decision
    // than this note should make for anyone.
    if (-(b._dx * nx + b._dz * nz) <= b._fric) this._propUp(a, nx, nz);
    if (a._dx * nx + a._dz * nz <= a._fric) this._propUp(b, -nx, -nz);

    const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (vn >= 0) return;
    const j = (-(1 + e) * vn) / isum;
    a.vx += j * ima * nx * pushA; a.vz += j * ima * nz * pushA;
    b.vx -= j * imb * nx * pushB; b.vz -= j * imb * nz * pushB;
    a.speed = Math.hypot(a.vx, a.vz);
    b.speed = Math.hypot(b.vx, b.vz);
    // Testing the speed the impulse actually left behind, against the same
    // constant the gate uses, makes the two agree by construction: a body woken
    // here is one the gate is going to keep awake, and a body left alone is one
    // the gate would have re-slept a step later anyway.
    if (a.speed >= this.tuning.restSpeed) a.restT = 0;
    if (b.speed >= this.tuning.restSpeed) b.restT = 0;
    const imp = -vn;
    a.squash = clamp01(a.squash + imp * this.tuning.squashPerSpeed * 0.7);
    b.squash = clamp01(b.squash + imp * this.tuning.squashPerSpeed * 0.7);
    if (imp < this.tuning.hitMinSpeed) return;
    _evHit.bug = a; _evHit.other = b; _evHit.kind = b.isMover ? b.kind : 'bug'; _evHit.edge = false;
    _evHit.x = a.x - nx * a.r; _evHit.z = a.z - nz * a.r; _evHit.speed = imp;
    this.events.emit('hit', _evHit);
  }

  /**
   * Fold one neighbour contact into a body's prop record. `nx, nz` points from
   * the prop out towards the body, matching what `_collideObstacles` stores, so
   * `_integrate` can treat both records with one piece of arithmetic.
   */
  _propUp(b, nx, nz) {
    if (!b._pHeld) { b._pnx = nx; b._pnz = nz; b._pHeld = true; return; }
    const sx = b._pnx + nx, sz = b._pnz + nz;
    const l = Math.hypot(sx, sz);
    // Squeezed between two sleepers from opposite sides there is no single
    // normal to record. That is the one case with nothing honest to say, and
    // saying nothing leaves the body awake, which is the safe way to be wrong.
    if (l > 1e-9) { b._pnx = sx / l; b._pnz = sz / l; }
    else b._pHeld = false;
  }

  /** Kinematic mover: it moves the beetle, the beetle never moves it. */
  _shove(b, m, e) {
    let dx = b.x - m.x, dz = b.z - m.z;
    let d = Math.hypot(dx, dz);
    const R = b.r + m.r;
    if (d >= R) return;
    if (d < 1e-5) { dx = 1; dz = 0; d = 1e-5; }
    const nx = dx / d, nz = dz / d;
    b.x = m.x + nx * R;
    b.z = m.z + nz * R;
    const vn = (b.vx - m.vx) * nx + (b.vz - m.vz) * nz;
    if (vn >= 0) return;
    b.vx -= (1 + e) * vn * nx;
    b.vz -= (1 + e) * vn * nz;
    b.speed = Math.hypot(b.vx, b.vz);
    // Whether the teleport above counts as having moved the beetle is settled by
    // `_collidePairs` once the whole sweep is in, on the same terms as a beetle
    // pair. The impulse is judged here, against the gate's own constant, because
    // a caterpillar creeping through its turnaround imparts a speed far too small
    // to be worth calling a body awake for.
    if (b.speed >= this.tuning.restSpeed) b.restT = 0;
    b.squash = clamp01(b.squash + -vn * this.tuning.squashPerSpeed * 0.6);
    if (-vn < this.tuning.hitMinSpeed) return;
    _evHit.bug = b; _evHit.other = m; _evHit.kind = m.kind; _evHit.edge = false;
    _evHit.x = m.x + nx * m.r; _evHit.z = m.z + nz * m.r; _evHit.speed = -vn;
    this.events.emit('hit', _evHit);
  }

  /* ------------------------------------------------------------------ *
   * Movers
   * ------------------------------------------------------------------ */

  _stepMover(m, dt) {
    if (m.free) { this._stepBody(m, dt); return; }
    const f = this.field;
    const t = this.time;
    const x0 = m.x, z0 = m.z;
    switch (m.path) {
      case 'orbit': {
        const a = m.phase + t * m.speedParam;
        m.x = m.cx + Math.cos(a) * m.rad;
        m.z = m.cz + Math.sin(a) * m.rad;
        break;
      }
      case 'line': {
        // Cosine ease: constant-ish travel with a soft turnaround, so a
        // caterpillar never reverses with an infinite acceleration.
        const u = 0.5 - 0.5 * Math.cos(m.phase + t * m._w);
        m.x = m.ax + (m.bx - m.ax) * u;
        m.z = m.az + (m.bz - m.az) * u;
        break;
      }
      case 'wander': {
        const w = m.speedParam;
        m.x = m.cx + Math.sin(t * w * 0.83 + m.phase) * m.rad;
        m.z = m.cz + Math.sin(t * w * 1.19 + m.phase * 1.7) * m.rad * 0.8;
        break;
      }
      default: break;
    }
    // Velocity by difference: the shove impulse needs it and it stays exact
    // whatever the path does.
    m.vx = (m.x - x0) / dt;
    m.vz = (m.z - z0) / dt;
    m.speed = Math.hypot(m.vx, m.vz);
    m.y = f.height(m.x, m.z) + m.r;
    const r = m.r > 1e-4 ? m.r : 1e-4;
    m._wx = m.vz / r; m._wy = 0; m._wz = -m.vx / r;
    this._spin(m, dt);
  }

  /** Keep a free mover on the blade: reflect it off the outline. */
  _bounceOffRim(m, s) {
    if (s.sdf < -m.r * 0.5) return;
    const f = this.field;
    const e = 0.014;
    const gx = (f.sdf(m.x + e, m.z) - f.sdf(m.x - e, m.z)) / (2 * e);
    const gz = (f.sdf(m.x, m.z + e) - f.sdf(m.x, m.z - e)) / (2 * e);
    const gl = Math.hypot(gx, gz);
    if (gl < 1e-5) return;
    const nx = -gx / gl, nz = -gz / gl;              // inward
    const push = s.sdf + m.r * 0.5;
    m.x += nx * push; m.z += nz * push;
    m._held = false;
    const vn = m.vx * nx + m.vz * nz;
    if (vn < 0) {
      m.vx -= (1 + this.tuning.moverRestitution) * vn * nx;
      m.vz -= (1 + this.tuning.moverRestitution) * vn * nz;
      m.speed = Math.hypot(m.vx, m.vz);
    }
  }

  /* ------------------------------------------------------------------ *
   * Director hooks
   * ------------------------------------------------------------------ */

  /** Freeze a falling beetle while the rescue choreography carries it. */
  markRescued(bugId) {
    const b = this.bugById(bugId);
    if (!b || b.state === 'captured') return false;
    b.state = 'rescued';
    b.vx = b.vy = b.vz = 0;
    b.speed = 0;
    b._wx = b._wy = b._wz = 0;
    return true;
  }

  /** Put a beetle back on solid ground. Snaps to the nearest safe spot. */
  respawn(bugId, x, z) {
    const b = this.bugById(bugId);
    if (!b || !this.field) return false;
    const home = b.home;
    const tx = x != null ? x : home.x;
    const tz = z != null ? z : home.z;
    const p = this.field.nearestSafe(tx, tz, b.r + 0.2, home);
    this._place(b, p.x, p.z);
    b.px = b.x; b.py = b.y; b.pz = b.z;
    return true;
  }

  bugById(id) {
    for (let i = 0; i < this._bugs.length; i++) if (this._bugs[i].id === id) return this._bugs[i];
    return null;
  }

  /** Debug: send everyone home. */
  captureAll() {
    for (let i = 0; i < this._bugs.length; i++) {
      const b = this._bugs[i];
      if (b.state === 'captured') continue;
      const hl = this._bestHole(b);
      if (!hl) continue;
      b.state = 'captured';
      b.hole = hl;
      b.captureT = 0;
      b.vx = b.vy = b.vz = 0;
      b.speed = 0;
      b._cx = b.x; b._cz = b.z; b._cy = b.y;
      _evCap.bug = b; _evCap.hole = hl; _evCap.remaining = this.remaining;
      this.events.emit('capture', _evCap);
    }
  }

  _bestHole(b) {
    let best = null, bd = Infinity;
    for (let i = 0; i < this._holes.length; i++) {
      const hl = this._holes[i];
      if (!hl.target) continue;
      if (this.colorMatch && hl.color && hl.color !== b.color) continue;
      const d = Math.hypot(b.x - hl.x, b.z - hl.z);
      if (d < bd) { bd = d; best = hl; }
    }
    return best;
  }

  /** True while every live beetle is asleep — the director's "level is calm" cue. */
  get settled() {
    for (let i = 0; i < this._bugs.length; i++) {
      const b = this._bugs[i];
      if (b.state === 'roll' && b.restT < 0.2) return false;
    }
    return true;
  }

  dispose() {
    this.events.clear();
    this._bugs.length = 0;
    this._movers.length = 0;
    this._obstacles.length = 0;
  }
}

export default LeafSim;
