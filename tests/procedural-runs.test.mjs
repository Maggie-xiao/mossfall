/**
 * The gate for procedural runs.
 *
 * `mossfall-levels.test.mjs` still owns the sixteen authored boards and is
 * untouched by this file — those assertions are the calibration, and a
 * generated board must never be able to relax them. What is proved here is that
 * everything the generator, the variant transforms and the run planner produce
 * meets the *same* contract the authored boards meet.
 *
 * The seed counts are a deliberate compromise: enough draws to catch a rule
 * that is merely usually satisfied, few enough that `npm test` stays quick.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Field } from "../src/mossfall/sim/field.js";
import { BEGINNER_DATA, ADVANCED_DATA, levelSet } from "../src/levels.js";
import { makeRng, hashSeed, dailySeed } from "../src/rng.js";
import {
  validateLevel,
  canReachAnyHoleSlowly,
  REST_SLOPE
} from "../src/level-validate.js";
import { VARIANTS, applyVariant } from "../src/level-variants.js";
import { generateLevel } from "../src/level-gen.js";
import { planRun, canonRun, resolveSeed, createEndlessRun } from "../src/run-plan.js";

const endlessModule = { createEndlessRun };
import { THEMES, planDescent } from "../src/biomes.js";

const CANON = [...BEGINNER_DATA.levels, ...ADVANCED_DATA.levels];

/* --------------------------------------------------------------------- *
 * The seeded stream
 * --------------------------------------------------------------------- */

test("the rng is deterministic, uniform-ish, and forks independently", () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  for (let index = 0; index < 64; index += 1) {
    assert.equal(a(), b(), `stream diverged at draw ${index}`);
  }

  const rng = makeRng(7);
  let sum = 0;
  const draws = 20000;
  for (let index = 0; index < draws; index += 1) {
    const value = rng();
    assert.ok(value >= 0 && value < 1, "draw outside [0, 1)");
    sum += value;
  }
  assert.ok(Math.abs(sum / draws - 0.5) < 0.02, "mean is far from 0.5");

  // A fork must not replay its parent, or two subsystems drawing from
  // "independent" streams would move in lockstep.
  const parent = makeRng(99);
  const child = parent.fork();
  assert.notEqual(child(), makeRng(99)());

  assert.equal(hashSeed("2026-08-31"), hashSeed("2026-08-31"));
  assert.notEqual(hashSeed("2026-08-31"), hashSeed("2026-09-01"));
  assert.equal(typeof dailySeed(new Date(2026, 7, 31)), "number");
  assert.equal(
    dailySeed(new Date(2026, 7, 31)),
    dailySeed(new Date(2026, 7, 31, 23, 59)),
    "the daily seed must not change within a day"
  );
});

/* --------------------------------------------------------------------- *
 * The validator is the authored contract, not a looser cousin
 * --------------------------------------------------------------------- */

test("every authored board satisfies the extracted contract", () => {
  for (const level of CANON) {
    const verdict = validateLevel(level);
    assert.ok(verdict.ok, `${level.id}: ${verdict.problems.join("; ")}`);
  }
});

test("the validator actually rejects a board that breaks a rule", () => {
  // A validator that never fails proves nothing about the generator it gates.
  const broken = structuredClone(CANON[0]);
  broken.bugs[0].x = 99;
  const verdict = validateLevel(broken);
  assert.ok(!verdict.ok, "an off-board bug was accepted");
  assert.match(verdict.problems.join(" "), /off-board/);

  const unreachable = structuredClone(CANON[0]);
  unreachable.maxTilt = 0.0001;
  assert.ok(
    !canReachAnyHoleSlowly(unreachable, unreachable.bugs[0]),
    "a board that cannot be tilted was still called reachable"
  );
});

/* --------------------------------------------------------------------- *
 * Variant transforms
 * --------------------------------------------------------------------- */

test("every variant is an exact isometry of the board surface", () => {
  // The two rotatable primitives use opposite sign conventions for `rot`
  // (ellipse/heart turn with +rot, lobe with -rot), so this is proved against
  // the Field rather than argued. Ripple is excluded because it is world-space
  // by design and documented as such.
  const strip = (level) => ({
    ...level,
    board: {
      ...level.board,
      features: level.board.features.filter((entry) => entry.kind !== "ripple")
    }
  });

  for (const transform of VARIANTS) {
    for (const level of CANON) {
      const bare = strip(level);
      const before = new Field(bare.board);
      const after = new Field(applyVariant(bare, transform).board);

      for (let x = -5; x <= 5; x += 0.5) {
        for (let z = -4; z <= 4; z += 0.5) {
          const [tx, tz] = transform.point(x, z);
          assert.ok(
            Math.abs(before.sdf(x, z) - after.sdf(tx, tz)) < 1e-9,
            `${level.id} ${transform.id} moved the outline at ${x},${z}`
          );
          assert.ok(
            Math.abs(before.height(x, z) - after.height(tx, tz)) < 1e-9,
            `${level.id} ${transform.id} moved the surface at ${x},${z}`
          );
        }
      }
    }
  }
});

test("a reflected authored board keeps a tilt-only route for every bug", () => {
  for (const transform of VARIANTS) {
    for (const level of CANON) {
      const moved = applyVariant(level, transform);
      const field = new Field(moved.board);
      for (const bug of moved.bugs) {
        assert.ok(
          canReachAnyHoleSlowly(moved, bug, { field }),
          `${level.id} ${transform.id} ${bug.id} lost its route`
        );
      }
    }
  }
});

/* --------------------------------------------------------------------- *
 * Descent routes
 * --------------------------------------------------------------------- */

test("every descent route falls, starts at the band top, and ends at its floor", () => {
  for (const theme of THEMES) {
    for (let seed = 0; seed < 400; seed += 1) {
      const route = planDescent(theme, makeRng(seed), 8);
      assert.equal(route.length, 8, `${theme.id} wrong length`);
      assert.equal(route[0], theme.band[0], `${theme.id} did not start at the crown`);
      assert.equal(route[7], theme.band[1], `${theme.id} did not reach the floor`);
      for (let index = 1; index < route.length; index += 1) {
        assert.ok(
          route[index] >= route[index - 1],
          `${theme.id} climbed back up at slot ${index}`
        );
      }
    }
  }
});

test("themes produce more than one route, or the theme is a fixed sequence", () => {
  for (const theme of THEMES) {
    const seen = new Set();
    for (let seed = 0; seed < 300; seed += 1) {
      seen.add(planDescent(theme, makeRng(seed), 8).join(""));
    }
    assert.ok(seen.size > 1, `${theme.id} always descends identically`);
  }
});

/* --------------------------------------------------------------------- *
 * The generator
 * --------------------------------------------------------------------- */

test("generated boards satisfy the authored contract at every difficulty", () => {
  let produced = 0;
  for (let seed = 0; seed < 48; seed += 1) {
    const difficulty = (seed % 8) / 7;
    const level = generateLevel(makeRng(seed * 7919 + 1), {
      difficulty,
      id: `G${seed}`,
      zone: seed % 8
    });
    assert.ok(level, `generator exhausted its budget at seed ${seed}`);
    produced += 1;

    const verdict = validateLevel(level);
    assert.ok(verdict.ok, `${level.id}: ${verdict.problems.join("; ")}`);

    // The board must also survive the things the renderer assumes.
    assert.ok(level.board.holes.length >= 1, `${level.id} has no burrow`);
    assert.ok(level.bugs.length >= 1, `${level.id} has no insect`);
    assert.ok(
      level.maxTilt >= 0.18 && level.maxTilt <= 0.24,
      `${level.id} maxTilt ${level.maxTilt} left the authored range`
    );
    for (const target of level.board.holes) {
      assert.equal(target.style, "bite", `${level.id} used a non-authored hole style`);
    }
  }
  assert.equal(produced, 48);
});

test("generated difficulty actually ramps", () => {
  const easy = [];
  const hard = [];
  for (let seed = 0; seed < 16; seed += 1) {
    easy.push(generateLevel(makeRng(seed * 31 + 3), { difficulty: 0.05, id: "E" }));
    hard.push(generateLevel(makeRng(seed * 31 + 3), { difficulty: 0.95, id: "H" }));
  }
  const mean = (list, read) =>
    list.filter(Boolean).reduce((sum, level) => sum + read(level), 0)
    / list.filter(Boolean).length;

  assert.ok(
    mean(hard, (l) => l.bugs.length) > mean(easy, (l) => l.bugs.length) + 2,
    "hard boards do not carry meaningfully more insects"
  );
  assert.ok(
    mean(hard, (l) => l.maxTilt) > mean(easy, (l) => l.maxTilt),
    "hard boards do not allow more tilt"
  );
  assert.equal(
    mean(easy, (l) => l.board.obstacles.length),
    0,
    "the easiest boards should carry no obstacles"
  );
});

/* --------------------------------------------------------------------- *
 * Whole runs
 * --------------------------------------------------------------------- */

test("a run is a pure function of theme, seed and mode", () => {
  const first = planRun({ theme: "dew-hollow", seed: "2026-08-31", mode: "beginner" });
  const again = planRun({ theme: "dew-hollow", seed: "2026-08-31", mode: "beginner" });
  assert.deepEqual(first.plan, again.plan);
  assert.deepEqual(
    first.levels.map((level) => level.board.shapes),
    again.levels.map((level) => level.board.shapes)
  );

  const elsewhere = planRun({ theme: "dew-hollow", seed: "2026-09-01", mode: "beginner" });
  assert.notDeepEqual(first.plan, elsewhere.plan, "two days produced the same run");

  assert.equal(resolveSeed(1234), 1234);
  assert.equal(resolveSeed("abc"), hashSeed("abc"));
});

test("every board of a planned run meets the contract, on every theme and mode", () => {
  for (const theme of THEMES) {
    for (const mode of ["beginner", "advanced"]) {
      for (let seed = 0; seed < 3; seed += 1) {
        const run = planRun({ theme: theme.id, seed: seed * 104729 + 7, mode });
        assert.equal(run.levels.length, 8, `${theme.id}/${mode} wrong run length`);

        for (const level of run.levels) {
          const verdict = validateLevel(level);
          assert.ok(
            verdict.ok,
            `${theme.id}/${mode}/${seed} ${level.id}: ${verdict.problems.join("; ")}`
          );
        }

        // A run must descend, and must never stall on a missing board.
        for (let slot = 1; slot < run.zones.length; slot += 1) {
          assert.ok(
            run.zones[slot] >= run.zones[slot - 1],
            `${theme.id}/${mode} climbed back up`
          );
        }
        for (const entry of run.plan) {
          assert.ok(
            ["authored", "generated", "authored-fallback"].includes(entry.source),
            `unknown slot source ${entry.source}`
          );
        }
        assert.equal(run.plan[0].source, "authored", "slot 0 must be an authored board");
      }
    }
  }
});

test("the canon run is untouched, so the evidence and hardware gates still replay", () => {
  // runtime:evidence replays a fixed B01 capture trace and stress-passes B03,
  // A03 and A08. If a seeded run could ever be substituted for these, that
  // evidence would stop meaning anything.
  const beginner = canonRun("beginner");
  const advanced = canonRun("advanced");

  assert.deepEqual(
    beginner.levels.map((level) => level.id),
    ["B01", "B02", "B04", "B05", "B03", "B06", "B07", "B08"]
  );
  assert.deepEqual(
    advanced.levels.map((level) => level.id),
    ["A01", "A02", "A03", "A04", "A05", "A06", "A08", "A07"]
  );
  assert.deepEqual(beginner.levels[0], BEGINNER_DATA.levels[0]);
  assert.equal(beginner.levels[0].board.shapes[0].rx, 3.8);
});

test("planning a run never mutates the authored level table", () => {
  const before = JSON.stringify(BEGINNER_DATA.levels);
  for (let seed = 0; seed < 6; seed += 1) {
    planRun({ theme: "full-descent", seed, mode: "beginner" });
    planRun({ theme: "lantern-deep", seed, mode: "advanced" });
  }
  assert.equal(
    JSON.stringify(BEGINNER_DATA.levels),
    before,
    "a run edited the shared authored table in place"
  );
});

/* --------------------------------------------------------------------- *
 * Controller wiring
 *
 * The generator is worth nothing if the controller never asks it for a board.
 * These drive the real methods against stubs, the same way core.test.mjs does.
 * --------------------------------------------------------------------- */

test("startRun plans a fresh seeded run and loads its first board", async () => {
  const { TableTiltController } = await import("../src/controller.js");
  const loaded = [];
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, {
    // 随机只属于 ENDLESS。beginner/advanced 走的是正典表，见下一条。
    mode: "endless",
    theme: "dew-hollow",
    runSeed: null,
    pendingSeed: null,
    run: null,
    currentLevelIndex: 0,
    scene: { loadLevel: (level) => loaded.push(level) }
  });

  controller.startRun();

  assert.ok(controller.run, "startRun did not plan a run");
  assert.ok(controller.run.endless, "endless mode did not get an endless run");
  // 主题按下降轮换，所以一局没有单一主题 —— 见 createEndlessRun 的说明。
  assert.equal(controller.run.theme, "rotating");
  assert.equal(loaded.length, 1, "startRun must load exactly one board");
  assert.equal(loaded[0], controller.levelAt(0));
  assert.equal(controller.timeRemaining, 60);
  assert.equal(controller.currentLevelIndex, 0);
});

test("endless never runs out of levels, and stays valid deep into a run", () => {
  const { createEndlessRun } = endlessModule;
  const run = createEndlessRun({ seed: 20260831 });

  // 走得比任何固定局都深。没有最后一关，所以这里要证的是「问多深都有」。
  for (const index of [0, 1, 7, 8, 23, 40, 41]) {
    const level = run.levelAt(index);
    assert.ok(level, `endless returned nothing at level ${index}`);
    const verdict = validateLevel(level);
    assert.ok(verdict.ok, `endless level ${index}: ${verdict.problems.join("; ")}`);
    assert.ok(level.board.holes.length <= level.bugs.length,
      `endless level ${index} has more burrows than insects`);
  }

  // 随机访问必须和顺序访问一致，否则缓存或续玩会悄悄换掉板子。
  const fresh = createEndlessRun({ seed: 20260831 });
  assert.deepEqual(fresh.levelAt(33), run.levelAt(33));

  // 难度必须真的往上爬，否则「无限」只是「重复」。
  const early = run.levelAt(1);
  const late = run.levelAt(30);
  assert.ok(late.maxTilt >= early.maxTilt);
  assert.ok(late.bugs.length > early.bugs.length,
    "deep endless boards carry no more insects than the opening ones");
});

test("endless keeps descending and never repeats a theme back to back", () => {
  const { createEndlessRun } = endlessModule;
  const run = createEndlessRun({ seed: 5150 });
  for (let index = 0; index < 40; index += 1) run.levelAt(index);

  for (let index = 1; index < 40; index += 1) {
    const previous = run.plan[index - 1];
    const current = run.plan[index];
    if (current.boundary) {
      // 跨树边界：主题必须换，落差必须明显长 —— 那一跳是「掉进另一棵树的树冠」，
      // 不是「爬回树顶」。
      assert.notEqual(current.theme, previous.theme, `theme repeated at ${index}`);
      assert.ok(run.levelAt(index).descent.drop > 40, `boundary fall too short at ${index}`);
    } else {
      assert.equal(current.theme, previous.theme);
      assert.ok(current.zone >= previous.zone, `climbed back up at ${index}`);
    }
  }
});

test("a fixed runSeed reproduces the run exactly; no seed gives a new one", async () => {
  const { TableTiltController } = await import("../src/controller.js");
  const make = (runSeed) => {
    const controller = Object.create(TableTiltController.prototype);
    Object.assign(controller, {
      mode: "endless",
      theme: "full-descent",
      runSeed,
      pendingSeed: null,
      run: null,
      currentLevelIndex: 0,
      scene: { loadLevel() {} }
    });
    controller.startRun();
    return controller.run;
  };

  assert.deepEqual(make(4242).plan, make(4242).plan, "a pinned seed drifted");

  // Unpinned runs draw fresh entropy. Two of them matching would mean the seed
  // is not actually being redrawn.
  const seeds = new Set();
  for (let index = 0; index < 8; index += 1) seeds.add(make(null).seed);
  assert.ok(seeds.size > 1, "unseeded runs all produced the same board set");
});

test("beginner and advanced still play the authored boards, in the authored order", async () => {
  // 这一条是整个改动的边界。程序化内容只能从 ENDLESS 那扇门进来；两个调过的
  // 模式必须逐关等于 levels.js，否则难度曲线、成绩基线和硬件验证同时失去意义。
  const { TableTiltController } = await import("../src/controller.js");
  for (const mode of ["beginner", "advanced"]) {
    const loaded = [];
    const controller = Object.create(TableTiltController.prototype);
    Object.assign(controller, {
      mode,
      theme: "lantern-deep",
      runSeed: null,
      pendingSeed: null,
      run: null,
      currentLevelIndex: 0,
      scene: { loadLevel: (level) => loaded.push(level) }
    });

    controller.startRun();

    assert.equal(controller.run, null, `${mode} planned a seeded run`);
    assert.deepEqual(
      controller.runLevels().map((level) => level.id),
      levelSet(mode).map((level) => level.id),
      `${mode} no longer plays the authored boards`
    );
    assert.equal(loaded[0], levelSet(mode)[0]);
  }
});

test("runLevels falls back to the authored table before a run is planned", async () => {
  const { TableTiltController } = await import("../src/controller.js");
  const controller = Object.create(TableTiltController.prototype);
  Object.assign(controller, { mode: "advanced", run: null });
  // BOOT and the title screen both draw a board before any run exists; that
  // board must be an authored one, not a crash.
  assert.equal(controller.runLevels()[0].id, "A01");
});

test("every board a run hands the scene is a complete level record", async () => {
  // scene.loadLevel reads these directly, so a missing field is a black screen
  // rather than a test failure.
  const run = planRun({ theme: "lantern-deep", seed: 99, mode: "advanced" });
  for (const level of run.levels) {
    for (const key of ["id", "name", "zone", "origin", "descent", "maxTilt", "board", "bugs", "props", "gameplay"]) {
      assert.ok(level[key] != null, `${level.id} is missing ${key}`);
    }
    for (const key of ["shapes", "smooth", "features", "holes", "obstacles", "movers"]) {
      assert.ok(level.board[key] != null, `${level.id} board is missing ${key}`);
    }
    assert.ok(Number.isFinite(level.origin.x + level.origin.y + level.origin.z));
    assert.ok(level.descent.duration > 0 && level.descent.drop > 0);
    assert.ok(Array.isArray(level.descent.beats) && level.descent.beats.length > 0);
    assert.equal(level.gameplay.fallMode, "board-reset");
  }
});

/* --------------------------------------------------------------------- *
 * Size progression
 *
 * Endless has to keep changing, not just keep going. Insects and boards both
 * shrink as the run deepens, which is a similarity transform — slope, and so
 * the feel of the tilt, is preserved exactly; what changes is how much
 * precision the player needs.
 * --------------------------------------------------------------------- */

test("insects and boards shrink as endless deepens", async () => {
  const { createEndlessRun } = endlessModule;
  const run = createEndlessRun({ seed: 31415 });

  const early = [];
  const late = [];
  for (let index = 0; index < 4; index += 1) early.push(run.levelAt(index));
  for (let index = 26; index < 30; index += 1) late.push(run.levelAt(index));

  const mean = (list, read) =>
    list.reduce((sum, level) => sum + read(level), 0) / list.length;

  assert.ok(
    mean(late, (l) => l.bugRadius) < mean(early, (l) => l.bugRadius) - 0.03,
    "insects did not get meaningfully smaller"
  );
  assert.ok(
    mean(late, (l) => l.boardScale) < mean(early, (l) => l.boardScale) - 0.05,
    "boards did not get meaningfully smaller"
  );

  // 洞必须跟着虫缩，否则小虫掉进任何缝、或者大虫卡在洞口。
  for (const level of [...early, ...late]) {
    for (const target of level.board.holes) {
      const ratio = target.r / level.bugRadius;
      assert.ok(
        ratio > 1.35 && ratio < 1.75,
        `${level.id} burrow/insect ratio ${ratio.toFixed(2)} left the authored band`
      );
    }
  }
});

test("scaling a board preserves its slopes", async () => {
  /* 尺寸能当难度旋钮，靠的是缩放是**相似变换**：所有长度同乘一个系数，于是坡度
     （高度差 / 水平距离）完全不变，倾斜的手感一点没动，变的只有需要的精度。
     这一条直接验它 —— 拿正典的板子缩一遍，比对应点的梯度。
     （不要去验「内部没有超过 maxTilt 的坡」：洞口的碗壁本来就该比玩家能开上去
     的坡更陡，那正是让球吃进去的东西，正典关同样如此。） */
  const { scaleBoard } = await import("../src/level-gen.js");
  const gradientA = { hx: 0, hz: 0 };
  const gradientB = { hx: 0, hz: 0 };

  for (const k of [0.86, 0.93, 1.12]) {
    for (const level of CANON.slice(0, 6)) {
      const before = new Field(level.board);
      const after = new Field(scaleBoard(level.board, k));

      /* 边缘那一薄圈要排除，原因是采样而不是几何：网格上一个刚好在内 0.01m 的
         点，缩放后可能落到界外，而 curl 在边缘极陡且变化极快，半格偏移就是
         0.05 的差。真正要证的是内部 —— 排掉 0.15m 之后误差回到 1e-3 量级。 */
      let worst = 0;
      for (let x = -4; x <= 4; x += 0.4) {
        for (let z = -3; z <= 3; z += 0.4) {
          if (-before.sdf(x, z) < 0.15) continue;
          before.gradient(x, z, gradientA);
          after.gradient(x * k, z * k, gradientB);
          worst = Math.max(
            worst,
            Math.abs(Math.hypot(gradientA.hx, gradientA.hz)
              - Math.hypot(gradientB.hx, gradientB.hz))
          );
        }
      }
      /* 容差绑在 REST_SLOPE 上，不是随手挑一个小数。
         Field 的 sdf 是**一阶估计**不是精确距离（lobe 带 0.75 修正、ellipse 是
         一阶展开、并集走 smin），所以缩放只能精确到这个估计的精度，残差实测
         5e-3 量级。要紧的不是它等于零，而是它**远低于虫子会开始滑动的坡度**
         —— 只要这条成立，缩放就不可能把一个静止的虫子变成滑动的。 */
      assert.ok(
        worst < REST_SLOPE / 5,
        `${level.id} scaled by ${k} changed its slope by ${worst.toFixed(4)}, `
        + `which is not comfortably under the ${REST_SLOPE} rest slope`
      );
    }
  }
});

test("every endless level validates against a field built from what ships", async () => {
  /* 这一条钉的是一个真出现过的 bug：生成器裁掉多余洞口时会连带删掉洞下的 dish，
     而当时没有重建 field —— 于是验证器看到的是带 dish 的旧地形（平），玩家拿到
     的是删了 dish 的新地形（斜），虫子开局自己滑走。420 关里中过 4 次。
     所以这里刻意**不复用**任何内部 field，一律新建。 */
  const { createEndlessRun } = endlessModule;
  for (let seed = 0; seed < 3; seed += 1) {
    const run = createEndlessRun({ seed: seed * 7919 });
    for (let index = 0; index < 24; index += 1) {
      const level = run.levelAt(index);
      const verdict = validateLevel(level);
      assert.ok(
        verdict.ok,
        `seed ${seed} level ${index} (${level.id}): ${verdict.problems.join("; ")}`
      );
    }
  }
});

test("endless introduces matching and hazards in readable stages", () => {
  const run = createEndlessRun({ seed: 20260915 });
  const opening = run.levelAt(1);
  assert.equal(opening.colorMatch, false, "opening should teach capture first");
  assert.equal(opening.board.hazards.length, 0, "opening should not contain ink");

  const later = Array.from({ length: 24 }, (_, index) => run.levelAt(index + 8));
  assert.ok(later.some((level) => level.colorMatch), "matching never appeared");
  assert.ok(later.some((level) => level.board.hazards.length), "ink never appeared");
  assert.ok(later.some((level) => level.board.movers.length), "moving hazards never appeared");
  assert.ok(later.some((level) => level.board.collectibles.length), "collectible dew never appeared");

  for (const level of later.filter((entry) => entry.colorMatch)) {
    const targets = new Map();
    const bugs = new Map();
    for (const hole of level.board.holes) {
      targets.set(hole.color, (targets.get(hole.color) || 0) + 1);
    }
    for (const bug of level.bugs) {
      bugs.set(bug.color, (bugs.get(bug.color) || 0) + 1);
    }
    for (const [color, count] of bugs) {
      assert.ok(
        (targets.get(color) || 0) >= count,
        `${level.id} has ${count} ${color} bugs but only ${targets.get(color) || 0} targets`
      );
    }
  }
});

test("endless weather changes between eight-level chapters", () => {
  const run = createEndlessRun({ seed: 404 });
  const first = run.levelAt(0);
  const second = run.levelAt(8);
  assert.ok(first.weather && first.weatherName);
  assert.notEqual(second.weather, first.weather);
  assert.equal(run.plan[0].weather, first.weather);
  assert.equal(run.plan[8].weather, second.weather);
});

test("ecosystem encounters stay bounded and unlock after the opening", () => {
  const run = createEndlessRun({ seed: "ecosystem-encounters" });
  const opening = Array.from({ length: 4 }, (_, index) => run.levelAt(index));
  assert.ok(opening.every((level) => !(level.board.encounters || []).length));

  const later = Array.from({ length: 80 }, (_, index) => run.levelAt(index + 8));
  const kinds = new Set(later.flatMap((level) =>
    (level.board.encounters || []).map((encounter) => encounter.kind)
  ));
  for (const kind of ["web", "chest", "mole", "hail", "cloud", "falling-bugs"]) {
    assert.ok(kinds.has(kind), `${kind} never appeared`);
  }
  for (const level of later) {
    for (const encounter of level.board.encounters || []) {
      if (encounter.kind === "falling-bugs") {
        assert.ok(encounter.count >= 1 && encounter.count <= 3);
        assert.ok(encounter.fallSpeed <= 0.44, "falling ladybugs descend too quickly");
      }
    }
  }
});

test("adaptive offsets change only unbuilt endless levels", () => {
  const easier = createEndlessRun({ seed: 8080 });
  const harder = createEndlessRun({ seed: 8080 });
  assert.equal(easier.setDifficultyOffset(12, -0.2), true);
  assert.equal(harder.setDifficultyOffset(12, 0.2), true);
  easier.levelAt(12);
  harder.levelAt(12);
  assert.ok(easier.plan[12].difficulty < harder.plan[12].difficulty);
  assert.equal(easier.setDifficultyOffset(12, 0.3), false);
});

test("ink pools reduce beetle momentum without moving resting insects", async () => {
  const { TableTiltLeafSim } = await import("../src/adapters/table-tilt-leaf-sim.js");
  const board = {
    shapes: [{ kind: "disc", x: 0, z: 0, r: 3 }],
    smooth: 0.2,
    features: [], holes: [], obstacles: [], movers: [],
    hazards: [{ kind: "ink", x: 0, z: 0, r: 1, drag: 3 }]
  };
  const field = new Field(board);
  const level = {
    id: "INK_TEST", board,
    bugs: [{ id: "BALL_01", color: "red", species: "ladybug", x: 0, z: 0, r: 0.3 }]
  };
  const sim = new TableTiltLeafSim(field, board);
  sim.reset(level, field);
  const bug = sim.bugs[0];
  bug.vx = 2;
  bug.speed = 2;
  sim.step(1 / 120);
  assert.ok(bug.vx < 2, "ink did not damp a moving beetle");
  bug.vx = bug.vz = bug.speed = 0;
  const x = bug.x;
  const z = bug.z;
  sim.step(1 / 120);
  assert.equal(bug.x, x);
  assert.equal(bug.z, z);
});

test("retracting spikes change their physical reach over time", async () => {
  const { TableTiltLeafSim } = await import("../src/adapters/table-tilt-leaf-sim.js");
  const board = {
    shapes: [{ kind: "disc", x: 0, z: 0, r: 3 }],
    smooth: 0.2,
    features: [], holes: [], movers: [], hazards: [],
    obstacles: [{
      id: "SPIKE_01", kind: "spike", x: 1, z: 0, r: 0.34, h: 0.8,
      motion: { period: 2, phase: -Math.PI / 2 }
    }]
  };
  const field = new Field(board);
  const sim = new TableTiltLeafSim(field, board);
  sim.reset({
    id: "SPIKE_TEST", board,
    bugs: [{ id: "BALL_01", color: "red", species: "ladybug", x: -1, z: 0, r: 0.3 }]
  }, field);
  sim._updateSpikes();
  const retracted = sim.obstacles[0].r;
  sim.time = 1;
  sim._updateSpikes();
  assert.ok(sim.obstacles[0].r > retracted * 4, "spike did not extend");
});
