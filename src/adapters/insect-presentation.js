import { makeInsect } from "../mossfall/render/insect.js";

export const SPHERE_TRANSITION_SEC = 0.1;
export const EXPAND_REST_GATE_SEC = 0.35;
export const EXPAND_TRANSITION_SEC = 0.28;
export const INSECT_VISUAL_SCALE = 1.4;

/* ---------------------------------------------------------------------
 * The pronotum plate — the hexagon on the shell
 *
 * At medium and high quality bodyGeo adds a "collar": a sphere with six
 * width segments, squashed to (0.44, 0.11, 0.36) and parked 0.84 rad off
 * vertical (mossfall/render/insect.js, `tier.collar`). Meant as a beetle's
 * neck plate, at game scale it reads as a flat hexagonal sticker on the front
 * of every shell — loudest in the ending's curtain call, where eight of them
 * face the camera at once.
 *
 * It cannot be hidden as an object: bodyGeo merges every part into one
 * geometry, and src/mossfall is read-only upstream (see patches/README.md), so
 * the switch that builds it is out of reach. Collapsing its vertices onto
 * their own centre leaves nothing but degenerate triangles, which draw as
 * nothing — the same trick in spirit as scene.js's removeGodrays().
 *
 * The plate is the only thing in the merged body anywhere near that point (the
 * skirt and its shelf live a full unit below it, and the stub antennae only
 * exist on the low tier, which has no collar), so the radius test is safe.
 * Body geometries are cached per (tier, species) and shared, so this runs once
 * each and reaches every beetle the game draws, ending cast included.
 * ------------------------------------------------------------------- */
const PLATE_CENTRE = [0, Math.cos(0.84) * 0.97, Math.sin(0.84) * 0.97];
const PLATE_REACH = 0.5;        // its widest half-axis is 0.44
const PLATE_STRIPPED = Symbol("pronotumStripped");

function stripPronotumPlate(group) {
  group?.traverse?.((object) => {
    const geometry = object.isMesh ? object.geometry : null;
    const position = geometry?.attributes?.position;
    if (!position || geometry[PLATE_STRIPPED]) return;
    geometry[PLATE_STRIPPED] = true;
    const [cx, cy, cz] = PLATE_CENTRE;
    let collapsed = 0;
    for (let i = 0; i < position.count; i += 1) {
      const dx = position.getX(i) - cx;
      const dy = position.getY(i) - cy;
      const dz = position.getZ(i) - cz;
      if (dx * dx + dy * dy + dz * dz > PLATE_REACH * PLATE_REACH) continue;
      position.setXYZ(i, cx, cy, cz);
      collapsed += 1;
    }
    if (collapsed) {
      position.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
  });
}

export class TableTiltInsectView {
  constructor(spec, quality) {
    this.view = makeInsect(spec, quality);
    this.group = this.view.group;
    this.shell = this.view.shell;
    this.rig = this.view.rig;
    stripPronotumPlate(this.group);
    this.formBlend = 1;
    this.opacity = 1;
    this.opacityMaterials = [];
    const seen = new Set();
    this.group?.traverse?.((object) => {
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (!material || seen.has(material)) continue;
        seen.add(material);
        this.opacityMaterials.push({
          material,
          opacity: Number.isFinite(material.opacity) ? material.opacity : 1,
          transparent: material.transparent === true,
          depthWrite: material.depthWrite !== false
        });
      }
    });
  }

  update(dt, elapsed, bug) {
    this.view.update(dt, elapsed, bug);
    if (this.view.frame && this.group?.visible !== false) {
      const baseScale = this.view.frame.scale.y;
      this.view.frame.position.y +=
        baseScale * (INSECT_VISUAL_SCALE - 1);
      this.view.frame.scale.multiplyScalar(INSECT_VISUAL_SCALE);
    }
    const rolling =
      bug?.state === "roll" &&
      (bug?.speed || Math.hypot(bug?.vx || 0, bug?.vz || 0)) > 0.06;
    if (rolling) {
      this.formBlend = Math.max(
        0,
        this.formBlend - dt / SPHERE_TRANSITION_SEC
      );
    } else if (
      bug?.state === "roll" &&
      (bug?.restT || 0) >= EXPAND_REST_GATE_SEC
    ) {
      this.formBlend = Math.min(
        1,
        this.formBlend + dt / EXPAND_TRANSITION_SEC
      );
    }
    if (this.formBlend < 1e-9) this.formBlend = 0;
    if (this.formBlend > 1 - 1e-9) this.formBlend = 1;
    if (this.rig) {
      this.rig.visible = this.formBlend > 0.001;
      this.rig.scale.setScalar(this.formBlend);
    }
  }

  setExpression(name) {
    this.view.setExpression(name);
  }

  pop() {
    this.view.pop();
  }

  glow(value) {
    this.view.glow(value);
  }

  /* The two cinematic hooks below reach into the upstream view's private
   * animation state (the same way this adapter already rewrites the frame's
   * scale): src/mossfall is a read-only upstream tree, so game-side control
   * has to live here rather than as new methods on InsectView. */

  /** Blink right now; `double` queues the paired second blink immediately. */
  blink(double = false) {
    const view = this.view;
    if (!view || view._dead || typeof view._blinking !== "number") return;
    view._blinking = 0.15;
    if (double) view._blinkTimer = 0.19;
  }

  /** Hard-set the rig's facing (radians, 0 = +Z); velocity-driven heading
   *  takes back over as soon as the bug actually moves. */
  setYaw(yaw) {
    const view = this.view;
    if (!view || view._dead || !Number.isFinite(yaw)) return;
    if (typeof view._heading === "number") view._heading = yaw;
  }

  setOpacity(value) {
    const opacity = Math.max(0, Math.min(1, Number(value) || 0));
    this.opacity = opacity;
    for (const record of this.opacityMaterials) {
      const transparent = record.transparent || opacity < 0.999;
      const depthWrite = record.depthWrite && opacity >= 0.999;
      if (
        record.material.transparent !== transparent ||
        record.material.depthWrite !== depthWrite
      ) {
        record.material.transparent = transparent;
        record.material.depthWrite = depthWrite;
        record.material.needsUpdate = true;
      }
      record.material.opacity = record.opacity * opacity;
    }
  }

  snapshot() {
    let shellCount = 0;
    let rigCount = 0;
    let castShadowMeshCount = 0;
    let ghostCount = 0;
    let trailCount = 0;
    let haloCount = 0;
    this.group?.traverse?.((object) => {
      if (object === this.shell) shellCount += 1;
      if (object === this.rig) rigCount += 1;
      if (object.isMesh && object.castShadow) castShadowMeshCount += 1;
      const name = String(object.name || "");
      if (/ghost|afterimage/i.test(name)) ghostCount += 1;
      if (/trail/i.test(name)) trailCount += 1;
      if (/halo/i.test(name)) haloCount += 1;
    });
    return {
      ownerCount: this.group ? 1 : 0,
      shellCount,
      rigCount,
      castShadowMeshCount,
      formBlend: this.formBlend,
      opacity: this.opacity,
      visualScale: INSECT_VISUAL_SCALE,
      haloCount,
      trailCount,
      ghostCount
    };
  }

  dispose() {
    this.view.dispose();
  }
}
