import { LeafSim } from "../mossfall/sim/physics.js";

export const TABLE_TILT_CAPTURE_HOLD_SEC = 0.075;
export const TABLE_TILT_PHYSICS_TUNING = Object.freeze({
  gravity: 9.81,
  rollFriction: 0.1,
  restSpeed: 0.045
});
export const TABLE_TILT_LINEAR_DAMP = Object.freeze({
  beginner: 0.027,
  advanced: 0.022
});

export class TableTiltLeafSim extends LeafSim {
  constructor(field, spec, options = {}) {
    super(field, spec);
    this.mode = options.mode === "advanced" ? "advanced" : "beginner";
    Object.assign(this.tuning, TABLE_TILT_PHYSICS_TUNING, {
      linearDamp: TABLE_TILT_LINEAR_DAMP[this.mode]
    });
    this._updateGravity();
    this.captureHoldSec =
      options.captureHoldSec ?? TABLE_TILT_CAPTURE_HOLD_SEC;
    this._captureStep = 0;
    this._captureHolds = new Map();
    this._boardFailureLatched = false;
    this.events.on("hit", (event) => this._applyObstacleRebound(event));
  }

  reset(level, field) {
    this._captureHolds.clear();
    this._boardFailureLatched = false;
    super.reset(level, field);
  }

  _bake(board) {
    super._bake(board);
    const source = (board && board.obstacles) || [];
    let bakedIndex = 0;
    for (const obstacle of source) {
      if (!obstacle) continue;
      const baked = this._obstacles[bakedIndex++];
      if (!baked) break;
      if (obstacle.id != null) baked.id = obstacle.id;
      if (obstacle.kind === "spike") {
        baked.spike = true;
        baked.baseRadius = baked.r;
        baked.motion = { ...obstacle.motion };
      }
      if (obstacle.rebound != null) {
        baked.rebound = { ...obstacle.rebound };
      }
    }
  }

  _applyObstacleRebound({ bug, other } = {}) {
    const rebound = other && other.rebound;
    if (
      !bug ||
      !other ||
      other.cap ||
      !rebound ||
      !Number.isFinite(other.x) ||
      !Number.isFinite(other.z)
    ) {
      return;
    }

    const minSpeed = rebound.normalSpeedMin;
    const maxSpeed = rebound.normalSpeedMax;
    if (
      !Number.isFinite(minSpeed) ||
      !Number.isFinite(maxSpeed) ||
      minSpeed < 0 ||
      maxSpeed < minSpeed
    ) {
      return;
    }

    const dx = bug.x - other.x;
    const dz = bug.z - other.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-9) return;

    const nx = dx / distance;
    const nz = dz / distance;
    const outgoingNormalSpeed = bug.vx * nx + bug.vz * nz;
    if (outgoingNormalSpeed < 0) return;

    const clampedNormalSpeed = Math.min(
      maxSpeed,
      Math.max(minSpeed, outgoingNormalSpeed)
    );
    const normalDelta = clampedNormalSpeed - outgoingNormalSpeed;
    bug.vx += normalDelta * nx;
    bug.vz += normalDelta * nz;
    bug.speed = Math.hypot(bug.vx, bug.vz);
    bug.restT = 0;
  }

  step(dt) {
    this._captureStep = dt;
    this._updateSpikes();
    super.step(dt);
    this._applyInkDrag(dt);
    this._captureStep = 0;
  }

  _updateSpikes() {
    for (const obstacle of this._obstacles) {
      if (!obstacle.spike) continue;
      const period = Math.max(0.5, obstacle.motion?.period || 2.8);
      const phase = obstacle.motion?.phase || 0;
      const extension = 0.5 + 0.5 * Math.sin((this.time / period) * Math.PI * 2 + phase);
      obstacle.extension = extension;
      obstacle.r = obstacle.baseRadius * (0.18 + 0.82 * extension);
    }
  }

  _applyInkDrag(dt) {
    const hazards = this.level?.board?.hazards || [];
    if (!hazards.length) return;
    for (const bug of this._bugs) {
      if (bug.state !== "roll") continue;
      for (const hazard of hazards) {
        if (hazard.kind !== "ink") continue;
        if (Math.hypot(bug.x - hazard.x, bug.z - hazard.z) > hazard.r) continue;
        const damping = Math.exp(-Math.max(0, hazard.drag || 2.5) * dt);
        bug.vx *= damping;
        bug.vz *= damping;
        bug.speed = Math.hypot(bug.vx, bug.vz);
        break;
      }
    }
  }

  _checkHoles(bug) {
    const tuning = this.tuning;
    const swallow = tuning.captureLip * bug.r;
    let hold = this._captureHolds.get(bug.id) || null;
    let candidate = null;

    if (hold) {
        const active = this._holes.find((hole) => hole.id === hold.holeId);
      if (active) {
        const distance = Math.hypot(bug.x - active.x, bug.z - active.z);
        const exitRadius = active.r - swallow + bug.r * 0.12;
        if (distance <= exitRadius) {
          candidate = active;
        }
      }
    }

    if (!candidate) {
      hold = null;
      for (const hole of this._holes) {
        const distance = Math.hypot(bug.x - hole.x, bug.z - hole.z);
        if (distance < hole.r - swallow) {
          candidate = hole;
          break;
        }
      }
    }

    if (!candidate) {
      this._captureHolds.delete(bug.id);
      bug.captureHoldT = 0;
      return false;
    }

    if (!hold || hold.holeId !== candidate.id) {
      hold = { holeId: candidate.id, elapsed: 0 };
      this._captureHolds.set(bug.id, hold);
    }
    hold.elapsed += this._captureStep;
    bug.captureHoldT = Math.min(1, hold.elapsed / this.captureHoldSec);
    if (hold.elapsed + 1e-9 < this.captureHoldSec) return false;

    this._captureHolds.delete(bug.id);
    return this._captureInto(bug, candidate);
  }

  _captureInto(bug, hole) {
    if (!bug || !hole || bug.state === "captured") return false;
    if (!hole.target) {
      this._detach(bug);
      return true;
    }
    const wrongColour =
      this.colorMatch &&
      hole.color &&
      hole.color !== bug.color;
    if (wrongColour) {
      const dx = bug.x - hole.x;
      const dz = bug.z - hole.z;
      this._reject(bug, hole, dx, dz, Math.hypot(dx, dz));
      return false;
    }

    bug.state = "captured";
    bug.hole = hole;
    bug.captureT = 0;
    bug.captureHoldT = 1;
    bug.restT = 0;
    bug.vx = bug.vy = bug.vz = 0;
    bug.speed = 0;
    bug._cx = bug.x;
    bug._cz = bug.z;
    bug._cy = bug.y;
    this.events.emit("capture", {
      bug,
      hole,
      remaining: this.remaining
    });
    return true;
  }

  forceCapture(bugOrId, holeOrId) {
    const bug =
      typeof bugOrId === "string" ? this.bugById(bugOrId) : bugOrId;
    const hole =
      typeof holeOrId === "string"
        ? this._holes.find((entry) => entry.id === holeOrId)
        : holeOrId;
    return this._captureInto(bug, hole);
  }

  forceFall(bugOrId) {
    const bug =
      typeof bugOrId === "string" ? this.bugById(bugOrId) : bugOrId;
    if (!bug || bug.state === "captured" || bug.state === "falling") {
      return false;
    }
    this._detach(bug);
    return true;
  }

  _detach(bug) {
    super._detach(bug);
    this._captureHolds.delete(bug.id);
    if (this._boardFailureLatched) return;
    this._boardFailureLatched = true;
    this.events.emit("boardFailure", {
      bug,
      triggerBugId: bug.id,
      bugIds: this._bugs
        .filter((entry) => entry.state !== "captured")
        .map((entry) => entry.id),
      capturedBugIds: this._bugs
        .filter((entry) => entry.state === "captured")
        .map((entry) => entry.id)
    });
  }

  resetUncaptured() {
    for (const bug of this._bugs) {
      if (bug.state === "captured") continue;
      this._place(bug, bug.home.x, bug.home.z);
    }
    this._captureHolds.clear();
    this._boardFailureLatched = false;
  }
}
