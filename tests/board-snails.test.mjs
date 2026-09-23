import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three";

import { BoardSnails } from "../src/adapters/board-snails.js";
import { createRuntimeCore } from "../src/adapters/runtime-core.js";
import { LeafPlatform } from "../src/mossfall/render/leaf.js";
import { ADVANCED_DATA, BEGINNER_DATA } from "../src/levels.js";

const ALL_LEVELS = [...BEGINNER_DATA.levels, ...ADVANCED_DATA.levels];
const levelById = (id) => ALL_LEVELS.find((level) => level.id === id);

function build(id) {
  const level = levelById(id);
  const { field, runtimeLevel } = createRuntimeCore(level, "advanced");
  const leaf = new LeafPlatform(field, runtimeLevel, "medium");
  return { leaf, props: leaf.props, snails: new BoardSnails(leaf, runtimeLevel) };
}

/** Every vertex under `root`, expressed in `root`'s own frame. */
function* vertices(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const meshes = [];
  root.traverse((node) => { if (node.isMesh) meshes.push(node); });
  for (const mesh of meshes) {
    rel.multiplyMatrices(inv, mesh.matrixWorld);
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      yield v.fromBufferAttribute(position, i).applyMatrix4(rel);
    }
  }
}

test("A05 hands all four blocker seats to BoardSnails", () => {
  const { props, snails } = build("A05");
  assert.equal(snails.count, 4);
  assert.deepEqual(
    snails.snapshot().map(({ id }) => id),
    ["BLOCK_01", "BLOCK_02", "BLOCK_03", "BLOCK_04"]
  );

  for (const snail of snails.snails) {
    const seat = snail.wobble.parent;
    // The seat record props.js built stays in `_statics`, so its per-frame
    // `position.y` flex write keeps following the blade for free.
    assert.ok(
      props._statics.some((entry) => entry.group === seat),
      `${snail.id} lost its seat in props._statics`
    );
    // Fallback body out, snail plus contact shade in.
    assert.equal(seat.children.length, 2);
    assert.ok(seat.children.includes(snail.wobble));
    // Registered for teardown, so props.dispose() is still the only owner.
    assert.ok(props._geos.includes(snail.mesh.geometry));
  }
  // Two materials for four snails, and fresh/aged is not the split: the art
  // spec puts that difference in the colour, which rides the vertex buffer.
  // The split is body vs shell, because those are the two surfaces the spec
  // gives different sheen colours — and only the shell carries the spiral map.
  assert.ok(props._mats.includes(snails.matBody));
  assert.ok(props._mats.includes(snails.matShell));
});

test("each snail is drawn to the disc the solver bounces off", () => {
  const { snails } = build("A05");
  const byId = new Map(
    levelById("A05").board.obstacles.map((obstacle) => [obstacle.id, obstacle])
  );

  for (const snail of snails.snails) {
    const { r, h } = byId.get(snail.id);
    let widest = 0;
    let inBand = 0;
    let tallest = 0;
    for (const v of vertices(snail.wobble)) {
      const radius = Math.hypot(v.x, v.z);
      widest = Math.max(widest, radius);
      tallest = Math.max(tallest, v.y);
      // The beetle's own radius is 0.30, so it strikes across the whole
      // collider height; the middle of that is where the shell has to be true.
      if (v.y > h * 0.2 && v.y < h * 0.8) inBand = Math.max(inBand, radius);
    }
    assert.ok(
      widest <= r + 1e-6,
      `${snail.id} overhangs its collider: ${widest} > ${r}`
    );
    // The fit lands the widest vertex on the wall exactly, but which vertex
    // that is varies by build: A and C hand it to the back of the shell, at
    // 0.60–0.63 h, while B and D are long enough (`long` 1.12 and 1.14) that
    // their nose tip out-reaches their shell and takes it, down at 0.09 h. So
    // inside the sampled band those two arrive 0.2 mm short rather than flush.
    // A millimetre is the honest tolerance here — a 48-station loft cannot be
    // asked to place a vertex on a band edge it knows nothing about.
    assert.ok(
      inBand > r - 1e-3,
      `${snail.id} narrows inside the contact band: ${inBand} < ${r}`
    );
    // Shell crown and eye stalks may clear the collider's top. That is above
    // the beetle's shoulder and cannot lie about a contact, and the art spec
    // grants it in as many words ("壳和眼柄可以在 y > 0.60 m 处外扩") — it is
    // the room that buys four silhouettes their read at 60 px. The four land
    // between 1.16 h (C) and 1.31 h (B); the window here is wider than that on
    // purpose, because how far the stalks reach is an art call and only the
    // ceiling is a rule.
    assert.ok(tallest > h * 1.05 && tallest < h * 1.4, `${snail.id} y ${tallest}`);
  }
});

test("the flat spiral costs the flanks a gap, and a measured one", () => {
  // A snail is long and a collider is round, so broadside there is real air
  // between the paint and the wall. Spec §5 caps it: "侧向视觉表面与碰撞体之间
  // 的空隙不得大于 0.14 m" — visual surface against the *collider*, which is
  // the cylinder of radius r and height 0.50 named in the table above it.
  //
  // An earlier version of this test measured the gap to the beetle *ball's*
  // surface at the moment of contact instead, which is a different and always
  // larger quantity (it adds the ball's own curvature away from the contact
  // height — up to 0.05 m at the widest part of the body). That is a fine thing
  // to care about, but it is not the number §5 states, and holding delivered
  // art to a bound it was never authored against is how a correct asset gets
  // rejected. The measurement below is the spec's.
  const { snails } = build("A05");
  const byId = new Map(
    levelById("A05").board.obstacles.map((obstacle) => [obstacle.id, obstacle])
  );
  const BALL = 0.3;   // every beetle on A05 is a 0.30 sphere centred at y 0.30
  const BINS = 24;
  const SLICES = 24;

  for (const snail of snails.snails) {
    const { r, h } = byId.get(snail.id);
    // How far the paint reaches, per compass direction and per height slice.
    const reach = Array.from({ length: BINS }, () => new Array(SLICES).fill(0));
    for (const v of vertices(snail.wobble)) {
      if (v.y < 0 || v.y >= h) continue;
      const turn = (Math.atan2(v.z, v.x) + Math.PI * 2) % (Math.PI * 2);
      const bin = Math.floor((turn / (Math.PI * 2)) * BINS) % BINS;
      const slice = Math.min(SLICES - 1, Math.floor((v.y / h) * SLICES));
      reach[bin][slice] = Math.max(reach[bin][slice], Math.hypot(v.x, v.z));
    }
    // Per direction, the closest the paint gets to the wall anywhere the beetle
    // could meet it — heights the ball cannot reach at all are skipped, since a
    // gap up there is not a gap anyone can stand in.
    const gaps = [];
    for (let bin = 0; bin < BINS; bin++) {
      let gap = Infinity;
      for (let slice = 0; slice < SLICES; slice++) {
        const y = ((slice + 0.5) / SLICES) * h;
        if (Math.abs(y - BALL) >= BALL) continue;
        gap = Math.min(gap, r - reach[bin][slice]);
      }
      gaps.push(gap);
    }
    // Fore and aft the shell's back and the head's nose touch the collider, so
    // some direction has to come out flush.
    assert.ok(Math.min(...gaps) < 0.01, `${snail.id} never touches: ${Math.min(...gaps)}`);
    // Broadside is the worst case: 0.095 on A and C, 0.114 on the two long
    // builds (B `long` 1.12, D 1.14) — about a third of a beetle's width, on a
    // leaf four metres across.
    assert.ok(
      Math.max(...gaps) < 0.14,
      `${snail.id} flank gap grew to ${Math.max(...gaps)}`
    );
  }
});

test("the aged pair's moss is on the outside of the shell, where it can be seen", () => {
  // Spec §6 gives C and D "壳顶部增加少量不规则苔痕" and nothing else about them
  // is allowed to change. The first port placed the two patches at the fractions
  // of `h` the preview uses, which are a surface on the swept tube it draws and
  // are inside the lens this one draws — so the moss built, merged, shipped, and
  // rendered exactly nothing. Vertex counts and bounding boxes all looked right;
  // the only thing that would have caught it is asking whether you can see it.
  //
  // So that is what this asks. From a point out along each moss vertex's own
  // normal, fire back down the normal: if the moss stands proud, the first thing
  // the ray meets is the moss itself. A buried patch is shadowed by the shell
  // and the ray stops short.
  const { snails } = build("A05");
  const raycaster = new THREE.Raycaster();
  const OFFSET = 0.5;
  const from = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (const snail of snails.snails) {
    const aged = snail.id === "BLOCK_03" || snail.id === "BLOCK_04";
    const mesh = snail.mesh;
    mesh.updateMatrixWorld(true);
    const position = mesh.geometry.getAttribute("position");
    const normals = mesh.geometry.getAttribute("normal");
    const colour = mesh.geometry.getAttribute("color");

    // Moss is the only green on an ember snail, so its vertices name themselves.
    const moss = [];
    for (let i = 0; i < colour.count; i++) {
      const [red, green, blue] = [colour.getX(i), colour.getY(i), colour.getZ(i)];
      if (green > red * 1.05 && green > blue * 1.2) moss.push(i);
    }
    if (!aged) {
      assert.equal(moss.length, 0, `${snail.id} is fresh and grew moss anyway`);
      continue;
    }
    // Two caps at 56x8 segments: a 57x9 vertex grid each, seam column and the
    // fanned pole row included.
    assert.equal(moss.length, 1026, `${snail.id} moss vertex count`);

    // A patch is an open cap of the shell's own surface, so unlike a blob laid
    // against one it has no far half — every vertex is meant to be lit from
    // outside. The dot filter below is still worth keeping for the handful at
    // the rim, where `crustGeometry`'s swell tips the normal sideways and the
    // ray would graze along the shell rather than sample it. Which way is out
    // comes off the mesh's own bounding sphere: the moss sits on the crown, so
    // a normal leaning away from that centre is pointing off the snail.
    mesh.geometry.computeBoundingSphere();
    const core = mesh.geometry.boundingSphere.center.clone()
      .applyMatrix4(mesh.matrixWorld);
    const out = new THREE.Vector3();
    let cap = 0;
    let visible = 0;
    for (const i of moss) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      normal.fromBufferAttribute(normals, i)
        .transformDirection(mesh.matrixWorld).normalize();
      if (normal.dot(out.subVectors(point, core).normalize()) < 0.4) continue;
      cap++;
      from.copy(point).addScaledVector(normal, OFFSET);
      dir.copy(normal).negate();
      raycaster.set(from, dir);
      const hit = raycaster.intersectObject(mesh, false)[0];
      // Within a tenth of a millimetre of the offset means the ray landed on
      // this vertex's own patch and not on shell in front of it.
      if (hit && hit.distance > OFFSET - 1e-4) visible++;
    }
    assert.ok(cap > 300, `${snail.id} moss has almost no outward face: ${cap}`);
    // Still a loose bound, though the cap construction clears far more of it
    // than the blob it replaced: 0.99 today against that one's 0.77. How proud
    // the rim stands is an art call and not something to pin to three decimals;
    // the defect this guards against reads 0.00.
    assert.ok(
      visible > cap * 0.8,
      `${snail.id} moss is buried: only ${visible} of ${cap} cap samples clear the shell`
    );
  }
});

test("a struck snail squashes, leans away, and pulls its eye stalks in", () => {
  const { snails } = build("A05");

  assert.equal(snails.hit("NOT_A_SNAIL", 3, 1, 0), false);
  assert.equal(snails.hit("BLOCK_01", 3, 1, 0), true);

  const struck = snails.byId.get("BLOCK_01");
  assert.equal(struck.active, true);
  // Pushed along the impact, which is the opposite of the obstacle -> beetle
  // normal the solver reports.
  assert.equal(struck.dirX, -1);
  assert.ok(Math.abs(struck.dirZ) < 1e-12);

  let peakSquash = 0;
  let peakLean = 0;
  let minAntenna = 1;
  let minHeight = 1;
  let recoil = 0;
  for (let i = 0; i < 30; i++) {
    snails.update(1 / 60);
    peakSquash = Math.max(peakSquash, struck.squash);
    peakLean = Math.max(peakLean, struck.lean);
    minAntenna = Math.min(minAntenna, struck.antennae.scale.x);
    minHeight = Math.min(minHeight, struck.wobble.scale.y);
    recoil = Math.min(recoil, struck.wobble.position.x);
  }
  assert.ok(peakSquash > 0.15 && peakSquash <= 0.42, `squash ${peakSquash}`);
  assert.ok(peakLean > 0.08 && peakLean < 0.30, `lean ${peakLean}`);
  assert.ok(minAntenna < 0.95, `antennae never retracted: ${minAntenna}`);
  assert.ok(minHeight < 0.92, `never visibly squashed: ${minHeight}`);
  // It recoils away from the beetle, never into it.
  assert.ok(recoil < -1e-3, `no recoil along the impact: ${recoil}`);

  // Nothing else on the board moved.
  for (const other of snails.snails.slice(1)) {
    assert.equal(other.active, false);
    assert.equal(other.squash, 0);
    assert.equal(other.wobble.scale.y, 1);
  }
});

test("the wobble is visually done by half a second and exactly at rest by 1.5", () => {
  const { snails } = build("A05");
  snails.hit("BLOCK_03", 5, 0, -1);
  const struck = snails.byId.get("BLOCK_03");

  let peak = 0;
  for (let i = 0; i < 30; i++) {
    snails.update(1 / 60);
    peak = Math.max(peak, Math.abs(struck.squash));
  }
  // Half a second in, the envelope has taken it under a tenth of its peak —
  // under 3% of scale, which is the "settles in about half a second" the
  // spec promises. The float keeps ringing below that for a while longer.
  assert.ok(peak > 0.3, `hit never landed: ${peak}`);
  assert.ok(
    Math.abs(struck.squash) < peak * 0.1,
    `still visibly wobbling at 0.5 s: ${struck.squash} of ${peak}`
  );

  for (let i = 0; i < 60; i++) snails.update(1 / 60);
  assert.equal(struck.active, false, "still ringing after 1.5 s");
  assert.equal(struck.squash, 0);
  assert.equal(struck.lean, 0);
  assert.equal(struck.wobble.scale.x, 1);
  assert.equal(struck.wobble.scale.y, 1);
  assert.equal(struck.wobble.position.length(), 0);
  assert.equal(struck.wobble.quaternion.w, 1);
  assert.equal(struck.antennae.scale.x, 1);

  // Rest is a real state: an idle update does not resurrect it.
  snails.update(1 / 60);
  assert.equal(struck.active, false);
});

test("the bounce is scaled to the speeds A05 actually delivers", () => {
  // Sweeping the board through eight tilt directions gives 32 beetle-on-snail
  // impacts between 0.28 and 2.74 m/s, median 1.17. Tuning against a round
  // 5 m/s instead left the median hit at a quarter strength nobody could see,
  // so these three points pin the curve to the board rather than to a guess.
  const peakOf = (speed) => {
    const { snails } = build("A05");
    snails.hit("BLOCK_01", speed, 1, 0);
    const struck = snails.byId.get("BLOCK_01");
    let minY = 1;
    for (let i = 0; i < 30; i++) {
      snails.update(1 / 60);
      minY = Math.min(minY, struck.wobble.scale.y);
    }
    return minY;
  };

  const graze = peakOf(0.28);
  const typical = peakOf(1.17);
  const hardest = peakOf(2.74);
  assert.ok(graze > 0.93 && graze < 0.985, `graze ${graze}`);
  assert.ok(typical > 0.80 && typical < 0.91, `median impact ${typical}`);
  assert.ok(hardest > 0.72 && hardest < 0.80, `hardest impact ${hardest}`);
  // Saturated at the top of the range, so a freak reading cannot fold a snail
  // flat: twice the fastest impact ever measured looks the same as that one.
  assert.equal(peakOf(6), hardest);
});

test("a long frame cannot blow the spring up", () => {
  const { snails } = build("A05");
  snails.hit("BLOCK_01", 12, 1, 0);
  const struck = snails.byId.get("BLOCK_01");
  for (let i = 0; i < 20; i++) {
    snails.update(0.25);
    assert.ok(Number.isFinite(struck.squash) && Math.abs(struck.squash) < 1);
    assert.ok(struck.wobble.scale.y > 0.5);
  }
});

test("levels without snails build nothing and stay callable", () => {
  for (const id of ["B01", "A04"]) {
    const { snails } = build(id);
    assert.equal(snails.count, 0);
    assert.deepEqual(snails.snapshot(), []);
    assert.equal(snails.hit("BLOCK_01", 3, 1, 0), false);
    snails.update(1 / 60);
  }
});

test("BoardSnails survives a platform that never built props", () => {
  const snails = new BoardSnails({ props: null }, levelById("A05"));
  assert.equal(snails.count, 0);
  assert.equal(snails.hit("BLOCK_01", 3, 1, 0), false);
  snails.update(1 / 60);
});
