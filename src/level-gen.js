/**
 * MOSS TILT — procedural boards.
 *
 * THE RULE THIS FILE OBEYS: nothing here invents a *kind* of leaf. Every
 * archetype below is the composition of an authored board, re-parameterised —
 * the four-lobed cross is B03's, the subtractive ring is A03's, the island
 * field is A08's. Randomness moves radii, angles, counts and placements inside
 * ranges the authored set already occupies. It never draws a shape the art
 * direction has not already signed off on.
 *
 * That constraint is the whole design. A generator free to emit arbitrary
 * blobs produces boards that are technically playable and visibly cheaper than
 * the sixteen hand-built ones, which is the failure mode worth avoiding.
 *
 * Placement is not authored, because it cannot be: holes and spawns depend on
 * the surface the shapes and features actually produce. So the generator
 * samples the built Field, keeps only the points that satisfy the contract in
 * `level-validate.js`, and redraws the whole board when it cannot. Generation
 * is therefore "propose and check", never "trust the maths".
 */

import { Field } from "./mossfall/sim/field.js";
import { validateLevel } from "./level-validate.js";
import { BUG_RADIUS } from "./levels.js";

/* BUG_RADIUS 仍然是正典那 16 关的尺寸基准；生成关按难度在它上下浮动。 */

/** The insect colours the authored levels use, and the species each implies. */
const SPECIES_BY_COLOR = Object.freeze({
  red: "ladybug",
  black: "scarab",
  teal: "firefly",
  pink: "firefly",
  white: "weevil",
  green: "beetle",
  yellow: "beetle",
  orange: "roly"
});

const COLORS = Object.freeze(Object.keys(SPECIES_BY_COLOR));

// Leaf silhouettes carry a recognisable insect cast. The outline therefore
// becomes useful information instead of being only decoration.
const LEAF_COLOR_POOLS = Object.freeze({
  "single-blade": ["red", "green", "yellow"],
  "twin-lobe": ["orange", "green", "white"],
  "twin-island": ["orange", "green", "white"],
  "lobed-cross": ["red", "black", "yellow", "white"],
  pinwheel: ["orange", "teal", "pink"],
  serpentine: ["green", "orange", "pink"],
  rosette: ["white", "teal", "yellow", "pink"],
  ring: ["black", "teal", "white"],
  islands: ["red", "green", "orange", "teal"],
  wave: ["pink", "white", "yellow", "green"]
});

/** Blend between two numbers. `t` is the difficulty ramp, always in [0, 1]. */
const mix = (a, b, t) => a + (b - a) * t;

/**
 * 等比缩放整块板子。
 *
 * 相似变换 —— 所有长度同乘一个系数，所以坡度（高度 / 水平距离）**完全不变**：
 * 一块缩小的板子仍然是一块可以用同样倾斜角滚过去的板子。这是能拿它当难度旋钮
 * 的前提，否则缩小会连带改变物理手感。
 *
 * `ripple.scale` 是频率不是长度，所以反着乘 —— 板子缩小时噪声要同步变细，
 * 不然纹理会显得被放大了一截。
 */
function scaleBoard(board, k) {
  if (Math.abs(k - 1) < 1e-6) return board;
  const p = (v) => Number((v * k).toFixed(4));
  return {
    ...board,
    /* `smooth` 是形状并集的 smin 混合半径，也就是一个**长度**，必须跟着缩。
       漏掉它，缩小后的板子上混合区相对变大，两瓣交界的凹口形状就变了；`curl`
       是从 sdf 推出来的，于是边缘坡度跟着漂 —— 在 B02 那种双瓣板上量到 0.052
       的偏差，正好全部落在交界处。 */
    smooth: board.smooth != null ? p(board.smooth) : board.smooth,
    shapes: board.shapes.map((shape) => {
      const out = { ...shape };
      for (const key of ["x", "z", "ax", "az", "bx", "bz", "r", "rx", "rz", "s"]) {
        if (out[key] != null) out[key] = p(out[key]);
      }
      return out;
    }),
    features: board.features.map((feature) => {
      const out = { ...feature };
      for (const key of ["x", "z", "r", "width", "amp"]) {
        if (out[key] != null) out[key] = p(out[key]);
      }
      if (out.pts) out.pts = out.pts.map(([x, z]) => [p(x), p(z)]);
      if (feature.kind === "ripple" && out.scale != null) {
        out.scale = Number((feature.scale / k).toFixed(4));
        out.amp = p(feature.amp ?? 0);
      }
      return out;
    })
  };
}

/** `count` spokes from the origin, evenly spaced from `phase`. */
function radial(count, phase, reach) {
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const angle = phase + (index * Math.PI * 2) / count;
    out.push([[0, 0], [
      Number((Math.cos(angle) * reach).toFixed(2)),
      Number((Math.sin(angle) * reach).toFixed(2))
    ]]);
  }
  return out;
}

/* ===================================================================== *
 * Archetypes — one per authored board family.
 *
 * Each returns the `shapes` array plus the half-extent it occupies, so the
 * caller can size the bowl and the rim curl to the actual outline.
 * ===================================================================== */

function singleBlade(rng, t) {
  const rx = rng.range(3.7, 4.2);
  const rz = rng.range(mix(2.6, 3.0, t), mix(2.9, 3.3, t));
  return {
    id: "single-blade",
    shapes: [{ kind: "ellipse", x: 0, z: 0, rx, rz, rot: 0 }],
    extent: { rx, rz },
    // The midrib, stem to tip. B01's is [[0,1.8],[0,0.2],[0,-1.45]] — down the
    // short axis, which is what makes an ellipse read as a leaf rather than a
    // plate.
    axes: [[[0, rz * 0.66], [0, 0], [0, -rz * 0.54]]],
    components: 1
  };
}

function twinLobe(rng, t) {
  // Two blades. `gap` decides whether they overlap into one board or separate
  // into two islands — B02/B07 versus A02.
  const separated = rng.chance(mix(0.2, 0.6, t));
  const offset = separated ? rng.range(2.2, 2.45) : rng.range(1.55, 1.8);
  const rx = separated ? rng.range(1.55, 1.7) : rng.range(2.05, 2.25);
  const rz = rng.range(2.2, 2.5);
  const tilt = rng.range(0.08, 0.16);
  return {
    id: separated ? "twin-island" : "twin-lobe",
    shapes: [
      { kind: "ellipse", x: -offset, z: 0, rx, rz, rot: -tilt },
      { kind: "ellipse", x: offset, z: 0, rx, rz, rot: tilt }
    ],
    extent: { rx: offset + rx, rz },
    // One midrib per blade, as B07 and A02 both do.
    axes: [
      [[-offset, -rz * 0.7], [-offset, 0], [-offset, rz * 0.7]],
      [[offset, -rz * 0.7], [offset, 0], [offset, rz * 0.7]]
    ],
    components: separated ? 2 : 1
  };
}

function lobedCross(rng, t) {
  const reach = rng.range(2.3, 2.6);
  const arm = rng.range(mix(1.18, 1.02, t), mix(1.3, 1.14, t));
  return {
    id: "lobed-cross",
    shapes: [
      { kind: "capsule", ax: 0, az: 0, bx: -reach, bz: -reach, r: arm },
      { kind: "capsule", ax: 0, az: 0, bx: -reach, bz: reach, r: arm },
      { kind: "capsule", ax: 0, az: 0, bx: reach, bz: -reach, r: arm },
      { kind: "capsule", ax: 0, az: 0, bx: reach, bz: reach, r: arm }
    ],
    extent: { rx: reach + arm, rz: reach + arm },
    // B03 runs a vein down each diagonal, corner to corner through the hub.
    axes: [
      [[-reach, -reach], [0, 0], [reach, reach]],
      [[-reach, reach], [0, 0], [reach, -reach]]
    ],
    components: 1
  };
}

function pinwheel(rng, t) {
  const arms = rng.int(3, 4);
  const reach = rng.range(2.35, 2.7);
  const arm = rng.range(mix(1.14, 1.0, t), mix(1.24, 1.12, t));
  const phase = rng.range(0, Math.PI * 2);
  const shapes = [{ kind: "disc", x: 0, z: 0, r: rng.range(1.25, 1.45) }];
  for (let index = 0; index < arms; index += 1) {
    const angle = phase + (index * Math.PI * 2) / arms;
    shapes.push({
      kind: "capsule",
      ax: 0,
      az: 0,
      bx: Number((Math.cos(angle) * reach).toFixed(3)),
      bz: Number((Math.sin(angle) * reach).toFixed(3)),
      r: arm
    });
  }
  const axes = [];
  for (let index = 0; index < arms; index += 1) {
    const angle = phase + (index * Math.PI * 2) / arms;
    axes.push([[0, 0], [
      Number((Math.cos(angle) * reach * 0.92).toFixed(2)),
      Number((Math.sin(angle) * reach * 0.92).toFixed(2))
    ]]);
  }
  return {
    id: "pinwheel",
    shapes,
    extent: { rx: reach + arm, rz: reach + arm },
    // B04 veins run out along each arm from the hub.
    axes,
    components: 1
  };
}

function serpentine(rng, t) {
  const stride = rng.range(2.0, 2.3);
  const rise = rng.range(1.0, 1.35);
  const rx = rng.range(1.6, 1.85);
  const rz = rng.range(1.45, 1.65);
  const rot = rng.range(0.24, 0.4);
  const link = rng.range(mix(0.78, 0.7, t), mix(0.9, 0.8, t));
  const nodes = [
    [-stride, -rise],
    [0, 0],
    [stride, rise]
  ];
  const shapes = nodes.map(([x, z]) => ({
    kind: "ellipse", x, z, rx, rz, rot
  }));
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const [ax, az] = nodes[index];
    const [bx, bz] = nodes[index + 1];
    shapes.push({
      kind: "capsule",
      ax: ax * 0.92, az: az * 0.92,
      bx: bx * 0.92, bz: bz * 0.92,
      r: link
    });
  }
  return {
    id: "serpentine",
    shapes,
    extent: { rx: stride + rx, rz: rise + rz },
    // B05 threads one vein through every node — the chain is the structure.
    axes: [[
      [-stride - rx * 0.5, -rise - 0.15],
      [-stride * 0.5, -rise * 0.5],
      [0, 0],
      [stride * 0.5, rise * 0.5],
      [stride + rx * 0.4, rise + 0.1]
    ]],
    components: 1
  };
}

function rosette(rng, t) {
  // A scalloped outline over a solid core. Deeper scallops read as older,
  // more weathered leaves, which the authored set uses for the harder boards.
  const r = rng.range(3.7, 4.15);
  // Petal counts stay low and the scallops stay deep. Ten shallow lobes is a
  // legal Field but renders as a wobbling amoeba rather than a leaf; B06 and
  // A01 both use five deliberate petals, and A07's ten-lobe wave only works
  // because a second ellipse underneath holds the silhouette together.
  const lobes = rng.pick([5, 5, 5, 6, 6, 10]);
  const depth = lobes >= 10 ? rng.range(0.13, 0.16) : rng.range(0.19, 0.31);
  const core = rng.range(2.2, 2.6);
  return {
    id: "rosette",
    shapes: [
      { kind: "lobe", x: 0, z: 0, r, lobes, depth, rot: rng.range(0, 1.25) },
      { kind: "disc", x: 0, z: 0, r: core }
    ],
    extent: { rx: r * (1 - depth * 0.5), rz: r * (1 - depth * 0.5) },
    // B06 radiates three veins from the crown. Without them a scalloped disc
    // reads as a puddle rather than a leaf — this is the single biggest thing
    // separating the generated rosette from the authored one.
    axes: radial(3, rng.range(0, Math.PI * 2), r * 0.74),
    components: 1
  };
}

function ring(rng, t) {
  const rx = rng.range(4.0, 4.3);
  const rz = rng.range(2.9, 3.2);
  // The void has to leave a band wide enough to roll along, or the ring is a
  // corridor the bug cannot turn around in.
  const void_ = rng.range(1.3, Math.min(1.6, rz - 1.25));
  // A03 runs its vein around the band rather than across the void.
  const band = (void_ + Math.min(rx, rz)) * 0.5;
  const loop = [];
  for (let step = 0; step <= 10; step += 1) {
    const angle = (step / 10) * Math.PI * 2;
    loop.push([
      Number((Math.cos(angle) * band * (rx / Math.min(rx, rz))).toFixed(2)),
      Number((Math.sin(angle) * band).toFixed(2))
    ]);
  }
  return {
    id: "ring",
    shapes: [
      { kind: "ellipse", x: 0, z: 0, rx, rz, rot: 0 },
      { kind: "disc", x: 0, z: 0, r: void_, sub: true }
    ],
    extent: { rx, rz },
    axes: [loop],
    components: 1
  };
}

function islands(rng, t) {
  const spanX = rng.range(2.0, 2.35);
  const spanZ = rng.range(1.6, 1.9);
  const rx = rng.range(1.55, 1.72);
  const rz = rng.range(1.45, 1.62);
  const tilt = rng.range(0.05, 0.12);
  return {
    id: "islands",
    shapes: [
      { kind: "ellipse", x: -spanX, z: -spanZ, rx, rz, rot: -tilt },
      { kind: "ellipse", x: spanX, z: -spanZ, rx, rz, rot: tilt },
      { kind: "ellipse", x: -spanX, z: spanZ, rx, rz, rot: tilt },
      { kind: "ellipse", x: spanX, z: spanZ, rx, rz, rot: -tilt }
    ],
    extent: { rx: spanX + rx, rz: spanZ + rz },
    // A08 gives every island its own short vein across the blade.
    axes: [
      [[-spanX - rx * 0.6, -spanZ], [-spanX + rx * 0.6, -spanZ]],
      [[spanX - rx * 0.6, -spanZ], [spanX + rx * 0.6, -spanZ]],
      [[-spanX - rx * 0.6, spanZ], [-spanX + rx * 0.6, spanZ]],
      [[spanX - rx * 0.6, spanZ], [spanX + rx * 0.6, spanZ]]
    ],
    components: 4
  };
}

function zigzag(rng, t) {
  const arm = rng.range(mix(1.08, 0.98, t), mix(1.18, 1.08, t));
  const step = rng.range(1.5, 1.7);
  const swing = rng.range(1.0, 1.3);
  const nodes = [
    [-step * 2, -swing],
    [-step, swing],
    [0, -swing * 0.6],
    [step, swing],
    [step * 2, -swing]
  ];
  const shapes = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    shapes.push({
      kind: "capsule",
      ax: nodes[index][0], az: nodes[index][1],
      bx: nodes[index + 1][0], bz: nodes[index + 1][1],
      r: arm
    });
  }
  return {
    id: "zigzag",
    shapes,
    extent: { rx: step * 2 + arm, rz: swing + arm },
    // B08 traces the whole W with one vein.
    axes: [nodes.map(([x, z]) => [Number(x.toFixed(2)), Number(z.toFixed(2))])],
    components: 1
  };
}

/**
 * The archetype table, with the difficulty window each is allowed to appear in.
 * The windows come from where the equivalent authored board sits in the
 * beginner/advanced ramp — an island field is a late board, a single blade an
 * early one.
 */
const ARCHETYPES = Object.freeze([
  { build: singleBlade, window: [0.0, 0.7], weight: 3 },
  { build: twinLobe, window: [0.05, 0.9], weight: 3 },
  { build: rosette, window: [0.1, 1.0], weight: 3 },
  { build: pinwheel, window: [0.15, 0.8], weight: 2 },
  { build: lobedCross, window: [0.2, 0.85], weight: 2 },
  { build: serpentine, window: [0.3, 1.0], weight: 2 },
  { build: ring, window: [0.45, 1.0], weight: 2 },
  { build: zigzag, window: [0.55, 1.0], weight: 2 },
  { build: islands, window: [0.6, 1.0], weight: 2 }
]);

function pickArchetype(rng, t) {
  const eligible = ARCHETYPES.filter(
    (entry) => t >= entry.window[0] && t <= entry.window[1]
  );
  const pool = eligible.length ? eligible : ARCHETYPES;
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return pool[pool.length - 1];
}

/* ===================================================================== *
 * Surface features
 * ===================================================================== */

/**
 * The base relief every authored board shares: a shallow bowl so loose bugs
 * drift inward, a rim curl so they do not simply leave, and a ripple for grain.
 *
 * The curl is the safety rail, so it relaxes as difficulty climbs — exactly the
 * 0.44-down-to-0.27 ramp the authored set walks from B01 to A08.
 */
function baseFeatures(rng, t, extent) {
  const reach = Math.max(extent.rx, extent.rz);
  return [
    {
      kind: "dish",
      amp: -rng.range(mix(0.05, 0.05, t), mix(0.08, 0.065, t)),
      r: Number((reach * rng.range(0.9, 1.02)).toFixed(2)),
      x: 0,
      z: 0
    },
    {
      kind: "curl",
      amp: Number(rng.range(mix(0.4, 0.27, t), mix(0.44, 0.31, t)).toFixed(3)),
      width: Number(rng.range(mix(0.86, 0.68, t), mix(0.95, 0.76, t)).toFixed(3))
    },
    {
      kind: "ripple",
      amp: Number(rng.range(0.0028, 0.004).toFixed(4)),
      scale: Number(rng.range(1.7, 3.1).toFixed(2))
    }
  ];
}

/**
 * Veins. Structural in the authored boards: they run along the blade's spine
 * or out to the lobes, and their sign decides whether they are a channel that
 * gathers bugs (negative) or a rib that turns them (positive).
 */
function veinFeatures(rng, t, built) {
  const axes = built.axes || [];
  if (!axes.length) return [];

  // Follow the skeleton the archetype declared rather than drawing a vein at a
  // random angle. Looking at the first pass made this the clearest gap: a vein
  // that ignores the board's structure reads as a smudge on the surface, and a
  // scalloped rosette with no radiating veins reads as a puddle rather than a
  // leaf. Every authored board runs its veins along its own structure.
  const raised = rng.chance(0.4);
  const amp = raised
    ? rng.range(0.032, 0.045)
    : -rng.range(0.032, 0.04);
  const width = Number(rng.range(0.38, 0.62).toFixed(2));
  const taper = raised ? Number(rng.range(0.4, 0.65).toFixed(2)) : 0;

  // Drop a spoke or two sometimes, so two boards of one archetype are not the
  // same drawing. The first axis always survives — it is the primary structure.
  const kept = axes.filter((_, index) => index === 0 || rng.chance(0.75));

  return kept.map((pts) => ({
    kind: "vein",
    amp,
    width,
    taper,
    pts: pts.map(([x, z]) => [
      Number(x.toFixed(2)),
      Number(z.toFixed(2))
    ])
  }));
}

/* ===================================================================== *
 * Placement — sampled from the built surface, never assumed
 * ===================================================================== */

/**
 * Grid-sample the Field and keep the points that are far enough inside the
 * outline. `clearance` is the metres of leaf a point needs around it.
 */
function interiorPoints(field, clearance, step = 0.18) {
  const bounds = field.bounds;
  const points = [];
  for (let z = bounds.minZ; z <= bounds.maxZ; z += step) {
    for (let x = bounds.minX; x <= bounds.maxX; x += step) {
      const depth = -field.sdf(x, z);
      if (depth >= clearance) {
        points.push({ x: Number(x.toFixed(3)), z: Number(z.toFixed(3)), depth });
      }
    }
  }
  return points;
}

/**
 * Lay actors out in mirror pairs about an axis, the way every authored board
 * does: A06's column of five, A08's 2x2 grid, A05's paired snail gate, B07's
 * two-and-three split. Greedy random picking satisfies the spacing contract but
 * clumps everything into one half of the board, which is what the first render
 * pass actually looked like.
 *
 * A point is only kept when its mirror is also a legal site, so the result is
 * genuinely symmetric rather than symmetric-where-convenient. An odd `count`
 * finishes with one site on the axis itself.
 */
function symmetricPick(points, count, spacing, rng, axis = "x") {
  const mirror = axis === "x"
    ? (point) => ({ x: -point.x, z: point.z })
    : (point) => ({ x: point.x, z: -point.z });
  const key = (point) =>
    `${Math.round(point.x / 0.18)}:${Math.round(point.z / 0.18)}`;
  /* key -> **真正通过筛选的那个点**，不只是「这一格里有合格点」。
     早先这里存的是一个 Set，配对时把算出来的镜像坐标直接塞进结果 —— 那个坐标
     本身从没被坡度过滤器看过。板子因为世界空间 ripple 从来不是完美对称的，于是
     镜像位置偶尔落在一块 0.08 的斜坡上，而 0.055 就会让虫子自己滑走。
     240 关里中了 3 次。存点本身，配对就只会用已经合格的点。 */
  const legal = new Map();
  for (const point of points) if (!legal.has(key(point))) legal.set(key(point), point);

  const far = (chosen, point) => chosen.every((other) =>
    Math.hypot(other.x - point.x, other.z - point.z) >= spacing);

  const chosen = [];
  // Take from one half only, so a point and its mirror are never both drawn as
  // independent candidates.
  const half = rng.shuffle(points.filter((point) =>
    (axis === "x" ? point.x : point.z) > spacing * 0.4));

  for (const point of half) {
    if (chosen.length + 2 > count) break;
    const twin = legal.get(key(mirror(point)));
    if (!twin || twin === point) continue;
    if (!far(chosen, point) || !far(chosen, twin)) continue;
    chosen.push(point, twin);
  }

  if (chosen.length < count) {
    // Odd counts, and boards too narrow to pair up, finish on the axis.
    const spine = rng.shuffle(points.filter((point) =>
      Math.abs(axis === "x" ? point.x : point.z) <= spacing * 0.4));
    for (const point of spine) {
      if (chosen.length >= count) break;
      if (far(chosen, point)) chosen.push(point);
    }
  }

  // Still short — the board simply cannot hold this many. Fall back to the
  // greedy fill so the caller gets a playable board rather than nothing.
  if (chosen.length < count) {
    for (const point of rng.shuffle(points)) {
      if (chosen.length >= count) break;
      if (far(chosen, point)) chosen.push(point);
    }
  }

  return chosen.slice(0, count);
}

/** Greedily take `count` points that are at least `spacing` apart. */
function spreadPick(points, count, spacing, rng) {
  const shuffled = rng.shuffle(points);
  const chosen = [];
  for (const point of shuffled) {
    if (chosen.length >= count) break;
    if (chosen.every((other) =>
      Math.hypot(other.x - point.x, other.z - point.z) >= spacing
    )) {
      chosen.push(point);
    }
  }
  return chosen;
}

/**
 * One attempt at a board. Returns null when the draw fails any contract, which
 * the caller answers by drawing again with a fresh stream.
 */
function attempt(rng, options) {
  const { difficulty: t, id, name, zone } = options;
  /* 可选的配色池。皮肤用它来守住 palette.js 那条铁律：暖世界里再放暖虫，
     红瓢虫贴在赭石叶上就没了。见 art-skins.js 的 insectBias。 */
  const requestedPalette = options.colors?.length ? options.colors : COLORS;

  const archetype = pickArchetype(rng, t);
  const built = archetype.build(rng, t);
  const familyPalette = LEAF_COLOR_POOLS[built.id] || requestedPalette;
  const palette = familyPalette.filter((color) => requestedPalette.includes(color));
  if (!palette.length) palette.push(...requestedPalette);
  const maxTilt = Number(mix(0.18, 0.24, t).toFixed(3));

  /* 尺寸随难度走，而且每关都抖一点 —— 玩家要感觉到「东西在变」，不只是
     「变难了」。两个旋钮方向相同但幅度不同：
       - 虫子从 0.30 缩到 0.20：洞口相对变小，需要的精度上升
       - 板子从 1.0 缩到 0.86：可用面积变小，容错变少
     两者都是相似变换，坡度和手感不变，变的是要求的精细程度。 */
  const bugR = Number(
    Math.max(0.17, mix(0.30, 0.205, t) + rng.range(-0.015, 0.015)).toFixed(3)
  );
  const boardScale = Number(
    (mix(1.0, 0.86, t) + rng.range(-0.03, 0.03)).toFixed(3)
  );

  const features = [
    ...baseFeatures(rng, t, built.extent),
    ...veinFeatures(rng, t, built)
  ];

  const board = scaleBoard({
    shapes: built.shapes,
    smooth: Number(rng.range(mix(0.3, 0.12, t), mix(0.38, 0.28, t)).toFixed(3)),
    features,
    holes: [],
    obstacles: [],
    movers: []
  }, boardScale);

  // --- burrows ------------------------------------------------------------
  // The contract wants 1.3 * (holeR + bugR) of leaf around a burrow. Sample
  // against that directly so a rejected placement is impossible rather than
  // unlikely.
  // Bug count first, because the burrow count follows from it. The authored
  // ratio is roughly one burrow per two to four insects — B08 and A08 both give
  // eight insects four burrows, A05/A06 give five insects one. Eight insects
  // funnelled into a single hole (which the first pass produced) is a slog, not
  // a level.
  const bugCount = Math.max(
    1,
    Math.min(8, Math.round(mix(1, 8, t) + rng.range(-0.6, 0.6)))
  );
  const colorMatch = t >= 0.38 && rng.chance(0.55);
  const holeCount = Math.max(
    1,
    colorMatch
      ? bugCount
      : Math.min(4, Math.round(bugCount / rng.range(2, 3.6)))
  );
  /* 洞口跟着虫子缩。正典的比例是 0.46 / 0.30 ≈ 1.53 —— 洞必须比虫大半圈才
     「吃得进去」，比例一旦漂了，小虫会掉进任何缝、大虫会卡在洞口。 */
  const holeR = Number((bugR * rng.range(1.47, 1.62)).toFixed(3));
  const holeClearance = 1.3 * (holeR + bugR) + 0.06;

  let field = new Field(board);
  const symmetryAxis = rng.chance(0.5) ? "x" : "z";
  const holeSites = symmetricPick(
    interiorPoints(field, holeClearance),
    holeCount,
    holeR * 2 + 0.5,
    rng,
    symmetryAxis
  );
  if (!holeSites.length) return null;

  const holeColors = rng.sample(palette, holeSites.length);
  board.holes = holeSites.map((site, index) => ({
    id: `HOLE_0${index + 1}`,
    color: holeColors[index] || COLORS[0],
    x: site.x,
    z: site.z,
    r: holeR,
    target: true,
    style: "bite",
    glow: 0
  }));

  // A dish under each burrow. This is what makes a hole *catch* rather than be
  // rolled over, and every authored board with a burrow has one.
  for (const target of board.holes) {
    board.features.push({
      kind: "dish",
      amp: -rng.range(0.06, 0.115),
      r: Number(rng.range(0.95, 1.35).toFixed(2)),
      x: target.x,
      z: target.z
    });
  }

  // --- obstacles ----------------------------------------------------------
  // Only on the harder half, matching where A04-A06 introduce them.
  field = new Field(board);
  if (t > 0.32) {
    // Even counts, so the gate they form is symmetric like A05's four snails.
    const obstacleCount = rng.int(0, Math.min(2, Math.round(t * 2))) * 2;
    const sites = symmetricPick(
      interiorPoints(field, 0.9).filter((point) =>
        board.holes.every((target) =>
          Math.hypot(point.x - target.x, point.z - target.z) > target.r + 0.75
        )
      ),
      obstacleCount,
      1.15,
      rng,
      symmetryAxis
    );
    const aged = rng.chance(0.5);
    const obstacleKinds = t < 0.58
      ? ["mushroom"]
      : t < 0.78
        ? ["mushroom", "twig", "snail", "spike"]
        : ["mushroom", "twig", "snail", "bud", "spike", "spike"];
    board.obstacles = sites.map((site, index) => {
      const kind = rng.pick(obstacleKinds);
      return {
        id: `BLOCK_0${index + 1}`,
        kind,
        x: site.x,
        z: site.z,
        r: Number(((kind === "spike" ? 0.34 : aged ? 0.27 : 0.3) * boardScale).toFixed(3)),
        h: Number(((kind === "spike" ? 0.78 : 0.5) * boardScale).toFixed(3)),
        restitution: kind === "spike" ? 0.62 : aged ? 0.22 : 0.55,
        rebound: kind === "spike"
          ? { normalSpeedMin: 0.34, normalSpeedMax: 0.78 }
          : aged
            ? { normalSpeedMin: 0.1, normalSpeedMax: 0.26 }
            : { normalSpeedMin: 0.3, normalSpeedMax: 0.72 },
        shell: aged ? "aged" : "fresh",
        ...(kind === "spike" ? {
          motion: {
            period: Number(rng.range(2.2, 3.4).toFixed(2)),
            phase: Number(rng.range(0, Math.PI * 2).toFixed(3))
          }
        } : {})
      };
    });
  }

  // Ink slows momentum without adding a force, so it cannot invalidate the
  // tilt-only routes proved by the level validator.
  if (t > 0.5 && rng.chance(mix(0.2, 0.72, t))) {
    const inkSites = spreadPick(
      interiorPoints(field, 0.72).filter((point) =>
        board.holes.every((hole) =>
          Math.hypot(point.x - hole.x, point.z - hole.z) > hole.r + 0.8
        )
      ),
      t > 0.82 ? 2 : 1,
      1.5,
      rng
    );
    board.hazards = inkSites.map((site, index) => ({
      id: `INK_0${index + 1}`,
      kind: "ink",
      x: site.x,
      z: site.z,
      r: Number((rng.range(0.48, 0.7) * boardScale).toFixed(3)),
      drag: Number(rng.range(2.2, 3.4).toFixed(2))
    }));
  } else {
    board.hazards = [];
  }

  if (t > 0.62 && rng.chance(mix(0.15, 0.68, t))) {
    const moverSite = rng.pick(interiorPoints(field, 1.05).filter((point) =>
      board.holes.every((hole) =>
        Math.hypot(point.x - hole.x, point.z - hole.z) > hole.r + 1
      )
    ));
    if (moverSite) {
      board.movers.push({
        id: "MOVER_01",
        kind: t > 0.84 && rng.chance(0.45) ? "caterpillar" : "dew",
        path: t > 0.84 ? "wander" : "orbit",
        x: moverSite.x,
        z: moverSite.z,
        cx: moverSite.x,
        cz: moverSite.z,
        rad: Number(rng.range(0.45, 0.78).toFixed(2)),
        r: Number((rng.range(0.25, 0.34) * boardScale).toFixed(3)),
        speed: Number(rng.range(0.24, 0.42).toFixed(2)),
        phase: rng.range(0, Math.PI * 2)
      });
    }
  }

  // --- spawns -------------------------------------------------------------
  // A bug must start at rest, so candidates are filtered by the surface
  // gradient as well as by clearance. Sampling this from the finished Field is
  // the only reliable way — the burrow dishes and veins have already changed
  // the slope everywhere.
  field = new Field(board);
  const gradient = { hx: 0, hz: 0 };
  const restSites = interiorPoints(field, bugR + 0.26).filter((point) => {
    field.gradient(point.x, point.z, gradient);
    // Comfortably under the contract's REST_SLOPE, so ripple grain on top of
    // the sample cannot push a spawn over the line.
    if (Math.hypot(gradient.hx, gradient.hz) >= 0.04) return false;
    if (!board.holes.every((target) =>
      Math.hypot(point.x - target.x, point.z - target.z)
        >= bugR + target.r + 0.22
    )) return false;
    return board.obstacles.every((obstacle) =>
      Math.hypot(point.x - obstacle.x, point.z - obstacle.z)
        >= bugR + obstacle.r + 0.18
    );
  });

  // Spacing is set by what the player SEES, not by the collider. InsectView
  // scales the rig by INSECT_VISUAL_SCALE (1.4), so two bugs the physics
  // considers well clear at 0.85 m render almost touching. 1.15 m is the gap
  // the authored boards actually leave.
  const spawns = symmetricPick(
    restSites,
    bugCount,
    bugR * 2 * 1.4 + 0.31,
    rng,
    symmetryAxis
  );
  if (spawns.length < 1) return null;

  // A coloured burrow can hold only one bug. Matching boards must therefore
  // be one-to-one; repeating a burrow colour creates a level that looks valid
  // but can never capture every bug.
  const playableSpawns = colorMatch
    ? spawns.slice(0, holeColors.length)
    : spawns;
  const bugColors = colorMatch
    ? rng.shuffle(holeColors).slice(0, playableSpawns.length)
    : rng.shuffle([
        ...holeColors,
        ...Array.from(
          { length: Math.max(0, playableSpawns.length - holeColors.length) },
          () => rng.pick(palette)
        )
      ]).slice(0, playableSpawns.length);

  const bugs = playableSpawns.map((site, index) => {
    const color = bugColors[index] || palette[index % palette.length];
    return {
      id: `BALL_0${index + 1}`,
      color,
      species: SPECIES_BY_COLOR[color],
      x: site.x,
      z: site.z,
      r: bugR,
      mass: 1
    };
  });

  // Collectible dew arrives after the player has learned the basic route. It
  // is placed away from burrows, bodies and blockers, so collecting it is an
  // optional detour rather than something awarded by the opening layout.
  board.collectibles = [];
  if (t > 0.42) {
    const dewCount = Math.min(3, 1 + Math.floor((t - 0.42) * 4));
    const dewSites = spreadPick(
      interiorPoints(field, 0.48).filter((point) =>
        board.holes.every((hole) =>
          Math.hypot(point.x - hole.x, point.z - hole.z) > hole.r + 0.5
        ) &&
        board.obstacles.every((obstacle) =>
          Math.hypot(point.x - obstacle.x, point.z - obstacle.z) > obstacle.r + 0.45
        ) &&
        spawns.every((spawn) =>
          Math.hypot(point.x - spawn.x, point.z - spawn.z) > bugR + 0.55
        )
      ),
      dewCount,
      1.05,
      rng
    );
    board.collectibles = dewSites.map((site, index) => ({
      id: `DEW_0${index + 1}`,
      kind: "dew",
      x: site.x,
      z: site.z,
      r: Number((0.16 * boardScale).toFixed(3)),
      points: 5
    }));
  }

  // Optional ecosystem encounters arrive one by one in the second half of the
  // ramp. They are presentation/gameplay events rather than permanent terrain,
  // so the route validator intentionally does not count them as blockers.
  const encounterSites = rng.shuffle(interiorPoints(field, 0.7).filter((point) =>
    board.holes.every((hole) =>
      Math.hypot(point.x - hole.x, point.z - hole.z) > hole.r + 0.75
    ) &&
    board.obstacles.every((obstacle) =>
      Math.hypot(point.x - obstacle.x, point.z - obstacle.z) > obstacle.r + 0.55
    )
  ));
  let encounterCursor = 0;
  const takeEncounterSite = () => encounterSites[encounterCursor++] || null;
  board.encounters = [];
  if (t > 0.5 && rng.chance(0.42)) {
    const site = takeEncounterSite();
    if (site) board.encounters.push({ id: "WEB_01", kind: "web", ...site, r: 0.48 });
  }
  if (t > 0.46 && rng.chance(0.3)) {
    const site = takeEncounterSite();
    if (site) board.encounters.push({ id: "CHEST_01", kind: "chest", ...site, r: 0.34 });
  }
  if (t > 0.66 && rng.chance(0.34)) {
    const site = takeEncounterSite();
    if (site) board.encounters.push({ id: "MOLE_01", kind: "mole", ...site, r: 0.5 });
  }
  if (t > 0.6 && rng.chance(0.46)) {
    board.encounters.push({
      id: "HAIL_01",
      kind: "hail",
      interval: Number(rng.range(2.6, 4.1).toFixed(2)),
      freezeSec: 1.5
    });
  }
  if (t > 0.54 && rng.chance(0.4)) {
    board.encounters.push({
      id: "CLOUD_01",
      kind: "cloud",
      interval: Number(rng.range(6.5, 9.5).toFixed(2))
    });
  }
  if (t > 0.58 && rng.chance(0.48)) {
    board.encounters.push({
      id: "FALLING_BUGS_01",
      kind: "falling-bugs",
      count: rng.int(1, 3),
      fallSpeed: Number(rng.range(0.32, 0.44).toFixed(2))
    });
  }

  /* 洞不能比虫多。洞数是按**目标**虫数算的，但实际生成的虫子受摆位约束可能更少，
     于是出现过 3 虫 4 洞 —— 正典里从没有这种局面，看起来像关卡缺了东西。
     多出来的洞连同它的 dish 一起删。

     删 dish 会改变地形，所以**必须重建 field**：那个 dish 原本压平了它周围的一
     小块地，虫子可能正好生在上面。不重建的话，验证器看到的是带 dish 的旧地形
     （坡度 0.03，合格），玩家拿到的是没 dish 的新地形（坡度 0.08，虫子自己滑
     走）。300 关里中了 4 次，全部是这一个原因。 */
  if (board.holes.length > bugs.length) {
    const dropped = board.holes.slice(bugs.length);
    board.holes = board.holes.slice(0, bugs.length);
    board.features = board.features.filter((feature) => !dropped.some(
      (target) => feature.kind === "dish"
        && feature.x === target.x
        && feature.z === target.z
    ));
    field = new Field(board);
  }

  const level = {
    id,
    name: name || `${archetype.build.name} ${id}`,
    zone,
    archetype: built.id,
    generated: true,
    bugRadius: bugR,
    boardScale,
    leafFamily: built.id,
    colorMatch,
    maxTilt,
    board,
    bugs,
    props: [],
    gameplay: { captureHoldSec: 0.075, fallMode: "board-reset" }
  };

  const verdict = validateLevel(level, { field });
  return verdict.ok ? level : null;
}

/**
 * Draw one board at the requested difficulty, retrying until it satisfies the
 * contract.
 *
 * `attempts` is a budget, not a guarantee. Exhausting it returns null and the
 * caller falls back to an authored board — a run must never stall because the
 * dice were unkind, and an authored board is a better failure than a missing
 * one.
 */
export function generateLevel(rng, options = {}) {
  const attempts = options.attempts || 24;
  for (let index = 0; index < attempts; index += 1) {
    const level = attempt(rng.fork(), {
      difficulty: Math.max(0, Math.min(1, options.difficulty ?? 0.5)),
      id: options.id || "G01",
      name: options.name,
      zone: options.zone || 0,
      colors: options.colors
    });
    if (level) return level;
  }
  return null;
}

export { ARCHETYPES, SPECIES_BY_COLOR, COLORS, scaleBoard };
