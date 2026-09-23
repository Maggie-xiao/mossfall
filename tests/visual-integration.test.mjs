import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as THREE from "three";
import {
  EXPAND_REST_GATE_SEC,
  EXPAND_TRANSITION_SEC,
  INSECT_VISUAL_SCALE,
  SPHERE_TRANSITION_SEC,
  TableTiltInsectView
} from "../src/adapters/insect-presentation.js";
import { PostFX } from "../src/mossfall/fx/postfx.js";
import {
  CAPTURE_BALL_FADE_DURATION_SEC,
  TableTiltScene
} from "../src/scene.js";

function readUint24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function inspectAnimatedWebp(bytes) {
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");

  let offset = 12;
  let alpha = false;
  let width = 0;
  let height = 0;
  let loop = null;
  let frameCount = 0;
  let durationMs = 0;

  while (offset + 8 <= bytes.length) {
    const tag = bytes.subarray(offset, offset + 4).toString("ascii");
    const size = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;

    if (tag === "VP8X") {
      alpha = Boolean(bytes[payload] & 0x10);
      width = readUint24LE(bytes, payload + 4) + 1;
      height = readUint24LE(bytes, payload + 7) + 1;
    } else if (tag === "ANIM") {
      loop = bytes.readUInt16LE(payload + 4);
    } else if (tag === "ANMF") {
      frameCount += 1;
      durationMs += readUint24LE(bytes, payload + 12);
    }

    offset = payload + size + (size & 1);
  }

  return { alpha, width, height, loop, frameCount, durationMs };
}

test("scene activates the native Mossfall runtime and removes legacy owners", async () => {
  const source = await readFile(
    new URL("../src/scene.js", import.meta.url),
    "utf8"
  );
  for (const contract of [
    "createRuntimeCore(",
    "new LeafPlatform(",
    "new TableTiltInsectView(",
    "new GameCamera(",
    "new Lighting(",
    "new World(",
    "new Effects(",
    "new MossfallPostFX("
  ]) {
    assert.match(source, new RegExp(contract.replace("(", "\\(")));
  }
  assert.doesNotMatch(
    source,
    /CANNON|cannon-es|BoardFieldAdapter|pointInBoardShape|createMossBall/
  );
  assert.doesNotMatch(source, /updateCameraPose|CAMERA_HEIGHT|CAMERA_DISTANCE/);
  assert.match(source, /runtimeLevel\?\.maxTilt/);
  assert.doesNotMatch(source, /MAX_TILT_BEGINNER|MAX_TILT_ADVANCED/);
  assert.doesNotMatch(source, /mossWorld\.buildFor\(/);
  assert.match(
    source,
    /localDressingCount:\s*this\.mossWorld\?\.local\?\.children\.length \|\| 0/
  );
  assert.match(source, /insectScale:\s*insect\.visualScale/);
});

test("PostFX remains the upstream bloom, grading, and fallback implementation", async () => {
  const source = await readFile(
    new URL("../src/mossfall/fx/postfx.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /FRAG_BRIGHT/);
  assert.match(source, /FRAG_BLUR/);
  assert.match(source, /FRAG_COMPOSITE/);
  assert.match(source, /falling back to direct render/);
  assert.equal(typeof PostFX, "function");
});

test("one upstream InsectView spheres in 0.10 s and expands after rest", () => {
  const view = new TableTiltInsectView(
    {
      id: "BUG",
      color: "green",
      species: "ladybug",
      r: 0.3
    },
    "low"
  );
  const bug = {
    id: "BUG",
    r: 0.3,
    x: 0,
    y: 0.3,
    z: 0,
    vx: 1,
    vz: 0,
    speed: 1,
    state: "roll",
    restT: 0,
    squash: 0,
    spin: new THREE.Quaternion(),
    pspin: new THREE.Quaternion(),
    rspin: new THREE.Quaternion(),
    contactNormal: { x: 0, y: 1, z: 0 }
  };
  const physicalRadius = bug.r;

  for (let i = 0; i < 10; i += 1) {
    view.update(SPHERE_TRANSITION_SEC / 10, i / 100, bug);
  }
  assert.equal(bug.r, physicalRadius);
  assert.equal(view.view.r, physicalRadius);
  assert.ok(
    Math.abs(view.view.frame.scale.x - physicalRadius * INSECT_VISUAL_SCALE) <
      1e-12
  );
  assert.ok(view.formBlend < 1e-9);
  assert.equal(view.rig.visible, false);

  bug.speed = 0;
  bug.vx = 0;
  bug.restT = EXPAND_REST_GATE_SEC - 0.01;
  view.update(0.2, 1, bug);
  assert.equal(view.formBlend, 0);

  bug.restT = EXPAND_REST_GATE_SEC;
  for (let i = 0; i < 28; i += 1) {
    view.update(EXPAND_TRANSITION_SEC / 28, 1 + i / 100, bug);
  }
  const snapshot = view.snapshot();
  assert.equal(snapshot.visualScale, 1.4);
  assert.equal(view.view.group, view.group);
  assert.equal(view.shell.parent, view.view.shellPivot);
  assert.equal(view.rig.parent, view.view.upright);
  assert.ok(snapshot.formBlend > 0.999);
  assert.deepEqual(
    {
      ownerCount: snapshot.ownerCount,
      shellCount: snapshot.shellCount,
      rigCount: snapshot.rigCount,
      castShadowMeshCount: snapshot.castShadowMeshCount,
      haloCount: snapshot.haloCount,
      trailCount: snapshot.trailCount,
      ghostCount: snapshot.ghostCount
    },
    {
      ownerCount: 1,
      shellCount: 1,
      rigCount: 1,
      castShadowMeshCount: snapshot.castShadowMeshCount,
      haloCount: 0,
      trailCount: 0,
      ghostCount: 0
    }
  );
  assert.ok(snapshot.castShadowMeshCount >= 1);

  const materialBaselines = view.opacityMaterials.map((record) => ({
    record,
    opacity: record.material.opacity,
    transparent: record.material.transparent,
    depthWrite: record.material.depthWrite
  }));
  view.setOpacity(0.4);
  assert.equal(view.snapshot().opacity, 0.4);
  for (const { record, opacity } of materialBaselines) {
    assert.ok(
      Math.abs(record.material.opacity - opacity * 0.4) < 1e-12
    );
    assert.equal(record.material.transparent, true);
    assert.equal(record.material.depthWrite, false);
  }
  view.setOpacity(1);
  for (const baseline of materialBaselines) {
    assert.equal(
      baseline.record.material.opacity,
      baseline.opacity
    );
    assert.equal(
      baseline.record.material.transparent,
      baseline.transparent
    );
    assert.equal(
      baseline.record.material.depthWrite,
      baseline.depthWrite
    );
  }
  view.dispose();
});

test("connection-required presentation has no hardware capture UI", async () => {
  const [html, ui, controller] = await Promise.all([
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controller.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="connection-required"/);
  assert.match(html, /Balance Board connection required/);
  assert.doesNotMatch(ui, /renderSetup|setSetupProgress|setSetupBalance/);
  assert.doesNotMatch(controller, /renderSetup|setSetupProgress|setSetupBalance/);
});

test("result is read-only and ranking owns replay and quit", async () => {
  const [source, controller] = await Promise.all([
    readFile(new URL("../src/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controller.js", import.meta.url), "utf8")
  ]);
  const resultStart = source.indexOf("renderResult({");
  const rankStart = source.indexOf("renderGlobalRank({");
  assert.ok(resultStart >= 0);
  assert.ok(rankStart > resultStart);

  const resultBlock = source.slice(resultStart, rankStart);
  const rankBlock = source.slice(rankStart);
  assert.doesNotMatch(
    resultBlock,
    /retry-button|quit-button|data-testid="retry"|data-testid="quit"/
  );
  /* 断言必须锁在这颗按钮自己的标签里。原来写的是 id="quit-button"[\s\S]*Quit，
     `[\s\S]*` 会一路滑到后面 renderConfirmQuit 的 "Quit this run?"，于是把标签
     从 Quit 改成 QUIT 之后测试照样绿 —— 等于没测。改成「不跨 `<` 」的匹配，
     两个按钮的大小写才真的被钉住。V3 §2.5：这两颗按钮只出现在 Rank 一屏。 */
  assert.match(rankBlock, /id="retry-button"[^<]*>PLAY AGAIN</);
  assert.match(rankBlock, /id="quit-button"[^<]*>QUIT</);
  assert.match(
    controller,
    /this\.score = payload\.score \|\| scoreRun\([\s\S]*const runScore = this\.score\?\.totalPoints \?\? 0;[\s\S]*renderGlobalRank\(\{[\s\S]*runScore,/
  );
});

test("全球榜页脚：打平最佳时说打平，不说「还差 1 分」", async () => {
  const source = await readFile(new URL("../src/ui.js", import.meta.url), "utf8");
  const rank = source.slice(source.indexOf("renderGlobalRank({"));
  /* 差为 0 走「打平」那支，只有真落后才印差值。旧写法把差值钳在 1 以上，
     打平也会印成 1，那是句假话。 */
  assert.match(rank, /best - runScore > 0/);
  assert.match(rank, /MATCHED YOUR BEST/);
  assert.doesNotMatch(rank, /Math\.max\(\s*1,\s*best - runScore/);
});

test("V3 §1.2 · 算式印在值单元格里，乘号是小写 x", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../src/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);
  const cell = source.match(/id="result-level-points">([\s\S]*?)<\/span>\s*\n/);
  assert.ok(cell, "LEVEL POINTS 那格没找到");
  /* `×` 是排版乘号，V3 §1.2 要的是小写字母 x —— 两个字形在 Space Grotesk 里
     宽度不一样，混用会让这一列对不齐。整个文件都不该再出现它。 */
  assert.doesNotMatch(cell[1], /×/);
  assert.match(cell[1], /<span class="wk">[\s\S]*<span class="op">x 10<\/span> = <\/span>/);
  /* 算式压暗缩小、乘号取 --accent-lt，结果留在 .vl 的 22px —— 三层字重都得在。 */
  assert.match(css, /\.rboard\s+\.row\s+\.vl\s+\.wk\s*\{[\s\S]*?font-size:\s*15px;/);
  assert.match(css, /\.rboard\s+\.row\s+\.vl\s+\.wk\s+\.op\s*\{[\s\S]*?color:\s*var\(--accent-lt\);/);
});

test("menu presentation gives the leaf a restrained ambient drift", () => {
  const scene = Object.create(TableTiltScene.prototype);
  scene.presentation = "menu";
  scene.failureActive = false;
  scene.boardYaw = 0;
  scene.handoffPhase = null;
  scene.clockTime = 12;
  scene.pitch = { angle: 0.2, velocity: 0 };
  scene.roll = { angle: -0.3, velocity: 0 };
  scene.boardTilt = { rotation: { x: 0.4, y: 0, z: -0.5 } };
  scene.boardRoot = { scale: { setScalar() {} } };

  scene.updatePresentation(1 / 60);

  assert.ok(Math.abs(scene.boardTilt.rotation.x) <= 0.012);
  assert.ok(Math.abs(scene.boardTilt.rotation.z) <= 0.016);
  assert.ok(Math.abs(scene.boardTilt.rotation.y) <= 0.028);
});

test("menu presentation advances visual systems at a restrained rate", () => {
  const calls = [];
  const scene = Object.create(TableTiltScene.prototype);
  scene.presentation = "menu";
  scene.clockTime = 12;
  scene.updatePresentation = (dt) => calls.push(["presentation", dt]);
  scene.leafPlatform = {
    setTilt() {},
    update(dt, elapsed) {
      calls.push(["leaf", dt, elapsed]);
    }
  };
  scene.pitch = { angle: 0 };
  scene.roll = { angle: 0 };
  scene.sim = { bugs: [] };
  scene.updateBallVisuals = (dt) => calls.push(["balls", dt]);
  scene.gameCamera = {
    update(dt, elapsed) {
      calls.push(["camera", dt, elapsed]);
    },
    focusPoint() {
      return { y: 0 };
    }
  };
  scene.camera = {
    position: { x: 0, y: 0, z: 0 },
    lookAt(target) {
      calls.push(["lookAt", target.y]);
    }
  };
  scene.mossWorld = {
    update(dt, elapsed) {
      calls.push(["world", dt, elapsed]);
    }
  };
  scene.mossLighting = {
    update(dt, elapsed) {
      calls.push(["lighting", dt, elapsed]);
    }
  };
  scene.mossEffects = {
    update(dt, elapsed) {
      calls.push(["effects", dt, elapsed]);
    }
  };

  scene.update(1 / 60);

  const menuDt = (1 / 60) * 0.55;
  assert.equal(scene.clockTime, 12 + menuDt);
  assert.deepEqual(calls, [
    ["presentation", menuDt],
    ["leaf", menuDt, 12 + menuDt],
    ["balls", menuDt],
    ["camera", menuDt, 12 + menuDt],
    ["lookAt", 0],
    ["world", menuDt, 12 + menuDt],
    ["lighting", menuDt, 12 + menuDt],
    ["effects", menuDt, 12 + menuDt]
  ]);
});

test("captured beetles fade out even after gameplay physics stops", () => {
  const opacity = [];
  const scene = Object.create(TableTiltScene.prototype);
  scene.clockTime = 3;
  scene.failureFallenBallIds = new Set();
  scene.balls = [
    {
      id: "BALL_01",
      captured: true,
      captureFadeElapsed: 0,
      failureFadeElapsed: 0,
      visualOpacity: 1,
      simBug: { state: "captured", captureT: 0 },
      insect: {
        group: { visible: true },
        update() {
          this.group.visible = true;
        },
        setOpacity(value) {
          opacity.push(value);
        }
      }
    }
  ];

  scene.updateBallVisuals(CAPTURE_BALL_FADE_DURATION_SEC / 2);

  assert.ok(scene.balls[0].visualOpacity > 0);
  assert.ok(scene.balls[0].visualOpacity < 1);
  assert.equal(scene.balls[0].insect.group.visible, true);

  scene.updateBallVisuals(CAPTURE_BALL_FADE_DURATION_SEC / 2);

  assert.equal(scene.balls[0].visualOpacity, 0);
  assert.equal(scene.balls[0].insect.group.visible, false);
  assert.equal(opacity.at(-1), 0);
});

test("level handoff retains cleared boards until the run is reset", () => {
  const disposed = [];
  const scene = Object.create(TableTiltScene.prototype);
  scene.scene = new THREE.Scene();
  scene.boardRoot = new THREE.Group();
  scene.boardTilt = new THREE.Group();
  scene.boardContent = new THREE.Group();
  scene.boardRoot.add(scene.boardTilt);
  scene.boardTilt.add(scene.boardContent);
  scene.scene.add(scene.boardRoot);
  scene.retiredBoards = [];
  scene._simOff = [() => disposed.push("listener")];
  scene.balls = [
    {
      insect: {
        dispose() {
          disposed.push("insect");
        }
      }
    }
  ];
  scene.leafPlatform = {
    dispose() {
      disposed.push("leaf");
    }
  };
  scene.sim = {
    dispose() {
      disposed.push("sim");
    }
  };
  scene.field = {};
  scene.mossEffects = {
    clear() {},
    setBoard() {}
  };
  scene.gameCamera = {
    isDescending: false,
    frameLevel() {}
  };

  const oldRoot = scene.boardRoot;
  scene.retireCurrentBoard();

  assert.equal(scene.retiredBoards.length, 1);
  assert.equal(scene.retiredBoards[0].root, oldRoot);
  assert.equal(oldRoot.parent, scene.scene);
  assert.notEqual(scene.boardRoot, oldRoot);
  assert.equal(scene.boardRoot.parent, scene.scene);
  assert.deepEqual(disposed, ["listener"]);

  scene.endLevelHandoff();

  assert.equal(scene.retiredBoards.length, 1);
  assert.equal(oldRoot.parent, scene.scene);
  assert.deepEqual(disposed, ["listener"]);

  scene.clearLevel();

  assert.equal(scene.retiredBoards.length, 0);
  assert.equal(oldRoot.parent, null);
  assert.deepEqual(disposed, ["listener", "insect", "leaf", "sim"]);
});

test("gameplay hides visible CoP feedback while retaining touch source telemetry", async () => {
  const [html, css, main, ui, controller] = await Promise.all([
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controller.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="touch-stick"[^>]*class="touch-stick hidden"/);
  assert.match(html, /id="touch-knob"[^>]*class="touch-knob"/);
  assert.match(html, /id="touch-surface"[^>]*class="touch-surface"/);
  assert.doesNotMatch(html, /id="cop-hud"/);
  assert.doesNotMatch(html, /id="cop-hud-dot"/);
  assert.match(css, /\.touch-stick\s*\{[\s\S]*?display:\s*none\s*!important;/);
  assert.match(css, /\.touch-surface\s*\{[\s\S]*?pointer-events:\s*none;[\s\S]*?touch-action:\s*none;/);
  assert.match(css, /\.touch-surface\.interactive\s*\{[\s\S]*?pointer-events:\s*auto;/);
  assert.match(main, /querySelector\("#touch-surface"\)/);
  assert.match(ui, /touchSurface/);
  assert.doesNotMatch(ui, /touchStick\?\.classList\.toggle\("hidden"/);
  assert.doesNotMatch(ui, /mapCopToHudPosition/);
  assert.doesNotMatch(ui, /copHud/);
  assert.doesNotMatch(css, /\.cop-hud/);
  assert.match(controller, /updateTouchDisplay/);
  assert.match(ui, /touchSurface\.dataset\.source/);
  assert.match(controller, /stage\.dataset\.cop/);
});

test("event effects transform board-local points through the visible owner", () => {
  const scene = Object.create(TableTiltScene.prototype);
  scene.fxWorldPoint = new THREE.Vector3();
  scene.boardRoot = new THREE.Group();
  scene.boardTilt = new THREE.Group();
  scene.boardContent = new THREE.Group();
  scene.boardRoot.add(scene.boardTilt);
  scene.boardTilt.add(scene.boardContent);
  scene.boardRoot.position.set(1.5, 0.7, -0.4);
  scene.boardTilt.rotation.set(0.18, 0.42, -0.12);
  scene.boardRoot.updateWorldMatrix(true, true);

  const local = new THREE.Vector3(0.8, 0.15, -0.55);
  const expected = local.clone().applyMatrix4(scene.boardContent.matrixWorld);
  const actual = scene.boardPointToWorld(local.x, local.y, local.z).clone();
  assert.ok(actual.distanceTo(expected) < 1e-10);
});

test("HUD and standalone packaging contracts remain intact", async () => {
  const css = await readFile(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );
  const html = await readFile(
    new URL("../src/index.html", import.meta.url),
    "utf8"
  );
  const build = await readFile(
    new URL("../scripts/build.mjs", import.meta.url),
    "utf8"
  );
  assert.match(css, /#hud-level \.nv\s*\{[\s\S]*?color:\s*#f4ffe9/);
  /* mossfall-ui-v2 K2：局中 HUD 只有 LEVEL + TIME，不放 How-to 入口 */
  assert.doesNotMatch(html, /gameplay-howto/);
  assert.match(
    css,
    /\.timer-shell\s*\{[\s\S]*?left:\s*50%;[\s\S]*?right:\s*auto;[\s\S]*?width:\s*max-content;[\s\S]*?transform:\s*translateX\(-50%\);/
  );
  assert.match(
    css,
    /\.title-screen \.logo\s*\{[\s\S]*?left:\s*50%;[\s\S]*?transform:\s*translateX\(-50%\);/
  );
  assert.match(
    css,
    /\.title-screen \.ui\s*\{[\s\S]*?left:\s*50%;[\s\S]*?transform:\s*translateX\(-50%\);/
  );
  assert.match(html, /id="touch-stick"/);
  assert.match(html, /id="touch-knob"/);
  assert.match(html, /id="touch-surface"/);
  assert.match(css, /\.touch-surface\.interactive\s*\{[\s\S]*?pointer-events:\s*auto;/);
  assert.match(build, /table-tilt-standalone\.html/);
  assert.match(
    build,
    /cp\(resolve\(dist, "app\.js"\), resolve\(root, "app\.js"\)\)/
  );
  assert.match(
    build,
    /resolve\(root, "table-tilt-standalone\.html"\)/
  );
});

test("ending quote packages and selects the uploaded Luminari font", async () => {
  const [css, words, build, sourceFont, previewFont] = await Promise.all([
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/ending-words.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/fonts/luminari.ttf", import.meta.url)),
    readFile(new URL("../fonts/luminari.ttf", import.meta.url))
  ]);

  assert.match(
    css,
    /@font-face\s*\{[^}]*font-family:\s*"Luminari";[^}]*url\("fonts\/luminari\.ttf"\)[^}]*\}/
  );
  assert.match(words, /const FONT_STACK = 'Luminari,/);
  assert.match(words, /document\.fonts\?\.load\('400 96px "Luminari"'\)/);
  assert.match(build, /const FONTS = \[[\s\S]*?"luminari\.ttf"/);
  assert.equal(
    createHash("sha256").update(previewFont).digest("hex"),
    createHash("sha256").update(sourceFont).digest("hex")
  );
});

test("root release entry versions app and stylesheet from their built content", async () => {
  const [html, css, js] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url)),
    readFile(new URL("../app.js", import.meta.url))
  ]);
  const cssRevision = createHash("sha256").update(css).digest("hex").slice(0, 8);
  const jsRevision = createHash("sha256").update(js).digest("hex").slice(0, 8);

  assert.match(
    html,
    new RegExp(`href=["']\\./styles\\.css\\?v=${cssRevision}["']`)
  );
  assert.match(
    html,
    new RegExp(`src=["']\\./app\\.js\\?v=${jsRevision}["']`)
  );
});

test("countdown teaching motion is synchronized across preview and release sources", async () => {
  const [asset, sourceHtml, sourceCss, previewHtml, previewCss, build] =
    await Promise.all([
      readFile(new URL("../src/images/motion02-countdown.webp", import.meta.url)),
      readFile(new URL("../src/index.html", import.meta.url), "utf8"),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
      readFile(new URL("../index.html", import.meta.url), "utf8"),
      readFile(new URL("../styles.css", import.meta.url), "utf8"),
      readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8")
    ]);

  assert.deepEqual(inspectAnimatedWebp(asset), {
    alpha: true,
    width: 540,
    height: 720,
    loop: 1,
    frameCount: 178,
    durationMs: 6150
  });
  for (const html of [sourceHtml, previewHtml]) {
    assert.match(html, /class="countdown-demo-motion"/);
    assert.match(html, /data-motion-src="\.\/images\/motion02-countdown\.webp"/);
    assert.match(html, /new MutationObserver\(sync\)/);
    assert.doesNotMatch(html, /BEETLE FIGURE|countdown-demo-slot/);
  }
  for (const css of [sourceCss, previewCss]) {
    assert.match(
      css,
      /\.countdown-demo-motion\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?object-fit:\s*contain;/
    );
  }
  assert.match(build, /\["motion02-countdown\.webp", "image\/webp"\]/);
  assert.doesNotMatch(build, /mossfall-title-wordmark\.png/);
  assert.match(build, /standaloneHtml[\s\S]*?data:\$\{mime\};base64/);
  assert.match(build, /standaloneJs[\s\S]*?split\(`\.\/images\/\$\{file\}`\)/);
  assert.match(
    build,
    /Standalone release still references an external JavaScript image file/
  );
});

test("opening masks cover the viewport outside the scaled 16:9 stage", async () => {
  const css = await readFile(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );
  const html = await readFile(
    new URL("../src/index.html", import.meta.url),
    "utf8"
  );
  const ui = await readFile(
    new URL("../src/ui.js", import.meta.url),
    "utf8"
  );

  assert.match(
    html,
    /<main id="app-shell">\s*<div id="screen-backdrop"[^>]*><\/div>\s*<div id="screen-layer"[^>]*>\s*<div id="screen-stage"><\/div>\s*<\/div>\s*<section id="stage"/
  );
  assert.match(
    css,
    /#screen-backdrop\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;/
  );
  assert.match(
    css,
    /#screen-stage\s*\{[\s\S]*?width:\s*1280px;[\s\S]*?height:\s*720px;[\s\S]*?scale\(var\(--ui-fit/
  );
  assert.match(css, /\.connection-required\s*\{[\s\S]*?position:\s*absolute;/);
  assert.doesNotMatch(ui, /class="cover"/);
  assert.match(ui, /<h1 class="logo-wordmark" aria-label="Moss Tilt">/);
  assert.match(ui, /<svg class="logo-svg"[^>]*aria-label="Moss Tilt"/);
  assert.doesNotMatch(ui, /KIWII BALANCE/);
  assert.doesNotMatch(ui, /start-button" class="btn big idle-pulse"/);
  assert.match(
    css,
    /Moss Tilt revision 1057 corrections[\s\S]*?\.title-screen \.logo\s*\{[\s\S]*?animation:\s*none;[\s\S]*?\.title-screen \.ui\s*\{[\s\S]*?animation:\s*none;/
  );
  assert.doesNotMatch(ui, /aria-label="Mossfall"|>MOSSFALL<\/span>/);
  assert.match(ui, />Beginner<\/button>/);
  assert.match(ui, />Advanced<\/button>/);
  assert.match(ui, /data-testid="start">START<\/button>/);
  assert.match(ui, />How to play<\/button>/);
  assert.match(ui, />Kiwii Move<\/span>/);
  /* 常亮绿点，不是电量计、不是闪烁点（闪烁 = 连接中）。 */
  assert.match(ui, /class="ic ic--link"/);

  /* 封面震动控件（KIWII-GLOBAL-SPEC §6.1，基准 hoop-whirl）。
     Moss Tilt 不是震动游戏 —— 默认 Light。 */
  assert.match(ui, /<div class="vibration-setting-row">/);
  assert.match(ui, /id="vibration-toggle" type="checkbox" role="switch" checked/);
  assert.equal(ui.match(/<button class="vibration-level/g)?.length, 3);
  assert.match(
    ui,
    /class="vibration-level is-selected" data-vibration-level="light"[^>]*aria-pressed="true"/
  );
  /* 关闭态用 aria-disabled：disabled 的按钮会掉出 tab 顺序。 */
  assert.doesNotMatch(ui, /class="vibration-level[^>]*\sdisabled/);
  assert.match(css, /\.vibration-level\[aria-disabled="true"\]/);
  /* 控件排在难度胶囊之前 —— 底部读下来是 设置 → 选择 → 动作。 */
  assert.ok(
    ui.indexOf('vibration-setting-row') < ui.indexOf('class="diffseg"'),
    "vibration chip sits above the difficulty pill"
  );
  /* 占位标的 CJK 回退必须写全：游戏自带字体是纯拉丁，设备 WebView 会掉方块。 */
  assert.match(css, /\.tpanel \.teachin-motion \{ width: 100%; height: 100%; \}/);

  /* 封面圆角按角色分组（KIWII-GLOBAL-SPEC §5.1）。断言落在家族关系上，
     不是具体数字 —— 只钉数字的话，下次谁单独动一个就抓不到。 */
  const radiusOf = (selector) => {
    const block = css.match(
      new RegExp(`\\n${selector.replace(/[.\\[\\]]/g, "\\\\$&")}\\s*\\{[^}]*\\}`, "g")
    );
    assert.ok(block, `no rule for ${selector}`);
    const radii = block
      .map((b) => b.match(/border-radius:\s*([0-9.]+)px/)?.[1])
      .filter(Boolean)
      .map(Number);
    assert.ok(radii.length, `no border-radius for ${selector}`);
    /* 同一个选择器可能有基线 + 覆盖两块；最后一块赢。 */
    return radii.at(-1);
  };

  /* 底部操作列读成一个整体：三者半径必须相等。 */
  const start = radiusOf("\\.title-screen \\.btn\\.big");
  const vibShell = radiusOf("\\.vibration-setting-row");
  const diffShell = radiusOf("\\.diffseg");
  assert.equal(vibShell, start, "vibration shell matches START");
  assert.equal(diffShell, start, "difficulty shell matches START");

  /* 嵌套层必须严格更小（同心：内 = 外 − 该层 padding）。 */
  const track = radiusOf("\\.miniseg");
  const level = radiusOf("\\.vibration-level");
  const mode = radiusOf("\\.diffseg button");
  assert.ok(track < vibShell, "strength track is inside the vibration shell");
  assert.ok(level < track, "a strength sits inside its track");
  assert.ok(mode < diffShell, "a mode sits inside the difficulty shell");

  /* 右上角那族是浮在世界上的胶囊，不跟着底部走。 */
  assert.match(css, /\.title-howto\s*\{[^}]*border-radius:\s*999px/);
  assert.match(css, /\.bpill\s*\{[^}]*border-radius:\s*999px/);

  /* 教学文案贴底居中，且 safe-area 不能省。 */
  assert.match(
    css,
    /\.teach-caption\s*\{[^}]*bottom:\s*max\(38px,\s*env\(safe-area-inset-bottom\)\)/
  );
  /* 状态由主点表达，独立的「搜索中」小点必须删掉——两颗点同时闪会读成
     两个不同的故障。 */
  assert.doesNotMatch(css, /\.bpill \.dotp/);
  assert.doesNotMatch(ui, /renderSetup|setSetupProgress|setSetupBalance/);
  assert.match(ui, /this\.screenBackdrop\.dataset\.screen\s*=/);
  assert.match(ui, /this\.screenBackdrop\.removeAttribute\("data-screen"\)/);
  assert.match(
    css,
    /Moss Tilt result viewport backdrop[\s\S]*?#screen-backdrop\[data-screen="RESULT_CALC"\][\s\S]*?display:\s*block;/
  );
  assert.match(
    css,
    /Moss Tilt result viewport backdrop[\s\S]*?\.result-screen \.veil\s*\{[\s\S]*?display:\s*none;/
  );
});

test("portrait How to Play and result screens use a readable viewport-native layout", async () => {
  const [css, ui] = await Promise.all([
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/ui.js", import.meta.url), "utf8")
  ]);
  const marker = "Moss Tilt portrait essential-screen layout";
  const markerIndex = css.indexOf(marker);
  const finalResultIndex = css.lastIndexOf(".rboard .final", markerIndex);

  assert.ok(markerIndex >= 0, "portrait essential-screen override is missing");
  assert.ok(finalResultIndex >= 0, "late Moss Tilt result corrections are missing");
  const portrait = css.slice(markerIndex);
  const resultPolish = css.slice(finalResultIndex, markerIndex);

  assert.match(ui, /this\.screenLayer\.dataset\.screen\s*=\s*screenName/);
  assert.match(ui, /this\.screenLayer\.removeAttribute\("data-screen"\)/);
  assert.match(portrait, /@media\s*\(max-aspect-ratio:\s*3\s*\/\s*4\)/);
  assert.match(
    portrait,
    /#screen-stage\[data-screen="HOW_TO_PLAY"\],[\s\S]*?#screen-stage\[data-screen="RESULT_CALC"\],\s*#screen-stage\[data-screen="GLOBAL_RANK"\]\s*\{[\s\S]*?inset:\s*0;[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?transform:\s*none;/
  );
  assert.match(
    portrait,
    /#screen-stage\[data-screen="HOW_TO_PLAY"\]\s+\.howto\s+\.cx\s*\{[\s\S]*?font-size:\s*13px;/
  );
  assert.match(
    portrait,
    /#screen-stage\[data-screen="RESULT_CALC"\]\s+\.rboard\s+\.row\s+\.lb\s*\{[\s\S]*?font-size:\s*12px;/
  );
  assert.match(
    portrait,
    /#screen-stage\[data-screen="RESULT_CALC"\]\s+\.rboard\s+\.flab\s*\{[\s\S]*?font-size:\s*12px;/
  );
  assert.match(
    portrait,
    /#screen-stage\[data-screen="RESULT_CALC"\]\s+\.rboard\s+\.final\s*\{[\s\S]*?margin-top:\s*10px;/
  );
  assert.match(
    portrait,
    /#screen-stage\[data-screen="RESULT_CALC"\]\s+\.rboard\s+\.rec\s+\.stack\s+\.tm\s*\{[\s\S]*?margin-top:\s*4px;/
  );
  /* 竖屏不再有自己的一套按钮几何：PLAY AGAIN / QUIT 跟横屏共用 280/120。
     竖屏分支里只剩窄屏兜底的两条 min()——只许缩不许涨，≥436px 完全惰性。
     旧断言锁的是已经作废的 min-width:0 !important 和 flex:0 0 112px。 */
  assert.match(
    portrait,
    /\.result-action\s+#retry-button\s*\{[\s\S]*?min-width:\s*min\(280px,\s*calc\(\(100vw - 36px\) \* 0\.7\)\);/
  );
  assert.match(
    portrait,
    /\.result-action\s+#quit-button\s*\{[\s\S]*?min-width:\s*min\(120px,\s*calc\(\(100vw - 36px\) \* 0\.3\)\);/
  );
  assert.doesNotMatch(portrait, /min-width:\s*0\s*!important/);
  assert.match(portrait, /#quit-button\s*\{[^}]*flex:\s*0\s+0\s+112px/);
  assert.match(
    resultPolish,
    /\.rboard\s+\.final\s*\{[\s\S]*?margin-top:\s*12px;/
  );
  assert.match(
    resultPolish,
    /\.rboard\s+\.rec\s+\.stack\s+\.tm\s*\{[\s\S]*?margin-top:\s*4px;/
  );
});

test("final critique accounts for rejected P2s and gives executable residual checks", async () => {
  const critique = await readFile(
    new URL("../docs/moss-tilt-design-critique-2026-08-10.md", import.meta.url),
    "utf8"
  );

  for (const issue of [
    "MTV-P2-001",
    "MTV-P2-002",
    "MTV-P2-003",
    "MTV-P2-004"
  ]) {
    assert.match(critique, new RegExp(issue));
  }
  assert.doesNotMatch(
    critique,
    /No known P0, P1, or P2 design issue remains in the browser candidate/
  );
  assert.match(critique, /npm run verify/);
  assert.match(critique, /npm run verify:evidence/);
  assert.match(critique, /adb devices -l/);
  assert.match(critique, /\?qa=1&realtime=1&screen=GAMEPLAY/);
  assert.match(critique, /390x844/);
  assert.match(critique, /Threshold/);
  assert.match(critique, /Evidence/);
});

test("approved Moss Tilt UI copy and controls stay strict", async () => {
  const [html, ui, controller, css] = await Promise.all([
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8")
  ]);

  assert.match(html, /<title>Moss Tilt<\/title>/);
  assert.match(html, /aria-label="Moss Tilt game"/);
  /* 卡片文案铁律：sentence case、一句祈使、一个 <b>、句号收尾。
     全大写是审计表的排版惯例，不是卡片该有的样子。 */
  assert.match(
    ui,
    /const teachingCopy = "Lean <b>any direction<\/b> to roll the leaf\.";/
  );
  assert.doesNotMatch(ui, /const teachingCopy = "[A-Z ]+";/);
  /* 分页教学的遗物：一张卡不需要 Next、页点或额外的关闭钮。 */
  assert.doesNotMatch(ui, /teach-next|teach-dots|howto-dismiss/);
  assert.doesNotMatch(css, /\.pdots|\.teach-next/);
  /* 占位标注只贴教学卡，不贴 How-to-Play 的图鉴件。 */
  assert.doesNotMatch(ui, /动画下周会更换|art-pending/);
  assert.match(ui, /"motion_07"/);
  assert.match(
    ui,
    /showCountdown\(text, holdMs\)[\s\S]*?countdownDemo\?\.classList\.add\("hidden"\)/
  );
  assert.match(
    ui,
    /holdCountdown\(text\)[\s\S]*?countdownDemo\?\.classList\.add\("hidden"\)/
  );
  assert.doesNotMatch(controller, /showCountdownDemo/);
  assert.doesNotMatch(ui, /toast-icon/);
  /* HUD 关卡计数。固定局仍然是「n / 8」那个已批准的写法；ENDLESS 没有最后一关，
     分母是 Infinity，所以那一支只出数字 —— 「3 / ∞」是把一个空洞的符号塞进
     一个很小的字号里。两支都钉住，改任何一支都要过这道门。 */
  assert.match(
    ui,
    /`\$\{level\}<small> \/ \$\{this\.totalLevels \?\? TOTAL_LEVELS\}<\/small>`/
  );
  assert.match(ui, /: `\$\{level\}`;/);
  assert.match(ui, /Number\.isFinite\(this\.totalLevels \?\? TOTAL_LEVELS\)/);
  assert.match(css, /Dune Carve countdown parity[\s\S]*?\.level-flash \.n,[\s\S]*?font:\s*800 120px\/1 "Space Grotesk"[\s\S]*?\.level-flash \.n\.go\s*\{[\s\S]*?font:\s*800 104px\/1 "Space Grotesk"/);
  assert.match(css, /\.level-flash \.halo\s*\{\s*display:\s*none;/);
  assert.match(css, /\.level-flash \.n,[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(ui, /transform:\s*at\(go \? 1\.14 : 1\.02\)/);
  assert.match(ui, /transform:\s*at\(go \? 1\.5 : 1\.22\)/);
  assert.match(html, /Balance Board connection required/);
  assert.match(ui, /Reconnect the Balance Board to continue\./);
  assert.match(ui, /Step back onto the Balance Board to continue\./);
  assert.match(ui, /Waiting for Balance Board input/);
  assert.match(ui, /Stand on the Balance Board and hold still for a moment\./);
  assert.doesNotMatch(
    `${html}\n${ui}\n${controller}`,
    /Step off the board|Reading its resting weight|Now step on|Calibrating|Zeroing|You're set/
  );
  assert.doesNotMatch(ui, /off the table/i);
  assert.doesNotMatch(controller, /Off the table/i);
  assert.match(ui, /data-session-best=/);
  assert.match(ui, /data-device-best=/);
  assert.match(controller, /recordPersonalBests\(\s*this\.score\.totalPoints/);
  assert.match(controller, /const labels = \["3", "2", "1", "GO"\]/);
});

test("runtime dependency contract locks Three r169 and excludes Cannon", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  assert.equal(packageJson.dependencies.three, "0.169.0");
  assert.equal(packageJson.dependencies["cannon-es"], undefined);
  assert.match(packageJson.scripts.verify, /npm test && npm run build/);
});

test("External Game menu selection has an explicit visible focus ring", async () => {
  const [css, ui] = await Promise.all([
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/ui.js", import.meta.url), "utf8")
  ]);
  assert.match(
    css,
    /\.btn\[data-gamepad-focused="true"\],[\s\S]*?\.pmA \.mi\[data-gamepad-focused="true"\]\s*\{[\s\S]*?outline:\s*3px solid/
  );
  assert.match(
    ui,
    /control\.dataset\.gamepadFocused = "true"[\s\S]*?control\.focus\(\{ preventScroll: true \}\)/
  );
});
