/**
 * 关卡审片台 —— 把正典关卡和生成关卡摆在同一台机器上拍。
 *
 * 和 tools/snail-shot.entry.js 是同一套路数，理由也一样：**不挂 requestAnimationFrame**。
 * 隐藏的 Browser pane 里 rAF 不会被调度，必须「同一个 JS turn 里 render 完立刻
 * toDataURL」才抓得到画面。
 *
 * 存在的理由只有一个：**生成关卡好不好看，只能看，不能靠断言**。安全契约能证明一关
 * 可通关，证明不了它的构图配不配得上手工那 16 关。所以这台机器把两边跑在完全相同的
 * 管线上 —— 真 LeafPlatform、真 Lighting、真 World（雾和背景归它管）、真 PostFX、
 * 真 InsectView，渲染器三行色彩管线和 src/scene.js:308-310 一字不差。差一行，
 * 「这个绿在 ACES 下会不会发灰」这种问题在这儿就看不出来。
 *
 * 用法（在页面里 eval）：
 *   await window.__shotCanon("B01")
 *   await window.__shotGenerated(1234, 0.5)
 *   await window.__sheet()          // 正典 8 关 + 生成 8 关，同难度同 zone 并排
 * 图片 POST 到 tools/shot-sink.mjs（127.0.0.1:4318）。
 */

import * as THREE from "three";

import { createRuntimeCore } from "../src/adapters/runtime-core.js";
import { BoardSnails } from "../src/adapters/board-snails.js";
import { TableTiltInsectView } from "../src/adapters/insect-presentation.js";
import { BEGINNER_DATA, ADVANCED_DATA } from "../src/levels.js";
import { generateLevel } from "../src/level-gen.js";
import { makeRng } from "../src/rng.js";
import { Lighting } from "../src/mossfall/render/lighting.js";
import { LeafPlatform } from "../src/mossfall/render/leaf.js";
import { World } from "../src/mossfall/render/world.js";
import { PostFX } from "../src/mossfall/fx/postfx.js";
import { zoneFor } from "../src/mossfall/data/palette.js";
import { SKINS, SKIN_IDS, applySkin } from "../src/art-skins.js";
import { CONCEPTS, CONCEPT_IDS, conceptById } from "./world-concepts.js";
import { repaintCanopy, dressTrunkWithIce } from "../src/art-canopy.js";
import { buildFieldMesh } from "../src/mossfall/sim/field.js";

const W = 1200;
const H = 900;
const SINK = "http://127.0.0.1:4318/";

const canvas = document.createElement("canvas");
canvas.width = W;
canvas.height = H;
canvas.style.cssText = "width:100%;max-width:1000px;height:auto;display:block";
document.body.style.cssText = "margin:0;background:#000";
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// 和 src/scene.js:308-310 一字不差。
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const postfx = new PostFX(renderer, "medium", {});
postfx.resize(W, H);

const CANON = new Map(
  [...BEGINNER_DATA.levels, ...ADVANCED_DATA.levels].map((l) => [l.id, l])
);

/** 每次换关卡都整台重搭 —— 审片不追求效率，追求没有上一关的残留。 */
let stage = null;

function teardown() {
  if (!stage) return;
  stage.leaf?.dispose?.();
  stage.world?.dispose?.();
  stage.lighting?.dispose?.();
  stage.scene.clear();
  stage = null;
}

function build(level, mode, zoneOverride, skinId) {
  teardown();
  /* 皮肤必须在建场景**之前**装好：LeafPlatform 在构造函数里就把 zone 的颜色
     烤进材质了（leaf.js:351/444），装晚了叶子还是旧色。 */
  currentSkin = skinId || currentSkin;
  applySkin(currentSkin);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.05, 700);
  const { field, runtimeLevel, sim } = createRuntimeCore(level, mode);
  const zone = zoneOverride ?? (runtimeLevel.index || 0);

  const lighting = new Lighting(scene, "medium");
  lighting.setRenderer(renderer);
  const world = new World(scene, "medium");
  world.attachLighting(lighting);
  // 同 scene.js 的 removeGodrays()：静止取样里那几片体积光只会糊住轮廓。
  if (world.godrays) {
    world.godrays.parent?.remove(world.godrays);
    world.godrays.geometry?.dispose();
    world.godrays = null;
  }

  const boardRoot = new THREE.Group();
  boardRoot.position.set(0, 0, 0);
  scene.add(boardRoot);

  const leaf = new LeafPlatform(field, runtimeLevel, "medium");
  const snails = new BoardSnails(leaf, runtimeLevel);
  boardRoot.add(leaf.group);

  // 甲虫要在。它们是画面上唯一完全饱和的东西，构图好不好看很大程度上是它们在
  // 叶面上的分布好不好看 —— 只拍一张空叶子等于没审。
  // 必须用 **sim 里的虫子**，不是关卡表里的记录。InsectView 的位置和根缩放都是
  // update(dt, elapsed, bug) 的第三个参数驱动的（insect.js:1259 的
  // frame.scale.setScalar(r * ...)）—— 只构造不喂 sim 数据，虫子会停在原点、
  // 顶着默认尺寸，比叶子还大。
  const insects = [];
  for (const bug of sim.bugs) {
    const view = new TableTiltInsectView(bug, "medium");
    boardRoot.add(view.group);
    insects.push({ view, bug });
  }

  /* 视差壳按皮肤重画。必须在 setZone 之前 —— setZone 会照当前材质重算一次
     着色，先换贴图再设 zone，两者才是一致的。 */
  const skinDef = SKINS[currentSkin] || SKINS.canon;
  if (skinDef.canopy) {
    repaintCanopy(world, skinDef.canopy);
    if (skinDef.canopy === "ice") dressTrunkWithIce(world, THREE);
  }

  world.setZone(zone, true);
  lighting.setZone(zone, 0);
  postfx.setZone(zone, 1);
  // 不能省：三盏平行光出厂停在 (0,1,0) 直上直下打，赤道处 n·l 切到 0，球面会被
  // 劈出一条硬明暗界。游戏里是 scene.js:583 的 focusLighting() 摆开的。
  lighting.focusOn(0, 0, 0, Math.max(4, field?.size || 6));
  scene.background = new THREE.Color(zoneFor(zone).fog);

  leaf.update(1 / 60, 0, []);
  world.update(1 / 60, 0, 6);
  lighting.update(1 / 60, 0);
  snails.update(1 / 60);
  // sim 先静置几帧：虫子出生时贴在叶面上方，不落到面上拍出来是悬空的。
  for (let step = 0; step < 8; step += 1) sim.step(1 / 60);
  for (const { view, bug } of insects) view.update(1 / 60, 0, bug);

  stage = { scene, camera, leaf, world, lighting, snails, insects, boardRoot, level, zone, sim };
  return stage;
}

async function send(name, quality = 0.94) {
  const data = canvas.toDataURL("image/jpeg", quality);
  const res = await fetch(SINK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, data })
  });
  if (!res.ok) throw new Error(`sink ${res.status}`);
  return name;
}

/**
 * 拍一张。构图审的是**整块叶子**，所以固定一个能把板子填满画幅的机位 —— 正典和生成
 * 用同一个机位，否则并排比的是运镜不是关卡。
 */
function frame(opts = {}) {
  const { camera } = stage;
  const dist = opts.dist ?? 8.2;
  const lift = opts.lift ?? 0.78;
  const yaw = opts.yaw ?? 0.42;
  camera.fov = opts.fov ?? 34;
  camera.updateProjectionMatrix();
  camera.position.set(
    Math.sin(yaw) * dist,
    lift * dist,
    Math.cos(yaw) * dist
  );
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  postfx.render(stage.scene, stage.camera);
}

/**
 * 渲染，不回传。
 *
 * shot-sink 需要 bind 一个本地端口，沙箱里 listen 会 EPERM，所以审片实际走的是
 * Browser pane 直接截图这条路：先 __renderX 把画面渲进 canvas，再从外面截。
 * __shotX 保留给能起 sink 的环境（批量出图比一张张截快得多）。
 */
let currentSkin = "canon";

window.__setSkin = function __setSkin(id) {
  currentSkin = SKIN_IDS.includes(id) ? id : "canon";
  return currentSkin;
};

window.__renderCanon = function __renderCanon(id, opts = {}) {
  const level = CANON.get(id);
  if (!level) throw new Error(`no canon level ${id}`);
  build(level, id.startsWith("A") ? "advanced" : "beginner", opts.zone, opts.skin);
  frame(opts);
  return window.__info();
};

window.__renderGenerated = function __renderGenerated(seed, difficulty, opts = {}) {
  const skin = SKINS[opts.skin || currentSkin] || SKINS.canon;
  const level = generateLevel(makeRng(seed), {
    difficulty,
    id: `G${seed}`,
    zone: opts.zone ?? 0,
    colors: skin.insectBias || undefined
  });
  if (!level) throw new Error(`generator exhausted at seed ${seed}`);
  build(level, "beginner", opts.zone, opts.skin);
  frame(opts);
  return window.__info();
};

window.__shotCanon = async function __shotCanon(id, opts = {}) {
  window.__renderCanon(id, opts);
  return send(`canon-${id}-z${stage.zone}.jpg`);
};

window.__shotGenerated = async function __shotGenerated(seed, difficulty, opts = {}) {
  window.__renderGenerated(seed, difficulty, opts);
  const tag = String(Math.round(difficulty * 100)).padStart(3, "0");
  return send(`gen-${tag}-s${seed}-${stage.level.archetype}-z${stage.zone}.jpg`);
};

/**
 * 审片主张：正典 8 关 + 生成 8 关，难度和 zone 逐一对齐。
 * 对齐是关键 —— 拿一张亮的正典比一张暗的生成关，比的是布光不是构图。
 */
window.__sheet = async function __sheet(seedBase = 4200) {
  const canonIds = ["B01", "B02", "B04", "B05", "A03", "A05", "A07", "A08"];
  const out = [];
  for (let slot = 0; slot < 8; slot += 1) {
    const difficulty = slot / 7;
    out.push(await window.__shotCanon(canonIds[slot], { zone: slot }));
    out.push(await window.__shotGenerated(seedBase + slot, difficulty, { zone: slot }));
  }
  return out;
};

window.__info = () => ({
  level: stage?.level?.id,
  archetype: stage?.level?.archetype,
  zone: stage?.zone,
  skin: currentSkin,
  bugs: stage?.insects.length,
  holes: stage?.level?.board.holes.length,
  obstacles: stage?.level?.board.obstacles.length
});

/**
 * 世界概念稿：不是叶子，不是这棵树。
 *
 * 和 build() 共用同一个 field 和同一批虫子 —— 换掉的只有平台的网格材质和背景。
 * 玩法、可解性、安全契约全部不受影响，这正是 Field 与渲染解耦换来的。
 */
window.__renderConcept = function __renderConcept(conceptId, seed, difficulty, opts = {}) {
  const concept = conceptById(conceptId);
  const level = generateLevel(makeRng(seed), {
    difficulty,
    id: `C${seed}`,
    zone: opts.zone ?? 0,
    colors: concept.insectBias || undefined
  });
  if (!level) throw new Error(`generator exhausted at seed ${seed}`);

  applySkin("canon");
  build(level, "beginner", opts.zone ?? 0, "canon");

  /* 叶子和这棵树整个让位。
     只藏 trunk / descentLayers 是不够的 —— World 的 group 下还挂着远景壳、藤蔓、
     丝线等一批部件，漏一个就有半透明的绿叶糊在新世界背后。整组藏掉最干净，
     反正概念稿自带背景。 */
  stage.leaf.group.visible = false;
  stage.world.group.visible = false;

  const mesh = buildFieldMesh(stage.leaf.field, {
    res: 128, skirt: true, thickness: 0.06, edgeFade: 0.75
  });
  const platform = concept.platform(mesh);
  stage.boardRoot.add(platform);

  const backdrop = concept.backdrop();
  stage.scene.add(backdrop);

  // 环境完全交给概念稿：雾、背景、两盏灯。
  const env = concept.env;
  stage.scene.background = new THREE.Color(env.background);
  stage.scene.fog = new THREE.Fog(env.fog, env.fogNear, env.fogFar);
  if (stage.lighting?.key) {
    stage.lighting.key.color.setHex(env.sun);
    stage.lighting.key.intensity = env.sunInt;
  }
  if (stage.lighting?.hemi) {
    stage.lighting.hemi.color.setHex(env.ambient);
    stage.lighting.hemi.intensity = env.ambientInt;
  }

  stage.concept = concept.id;
  frame(opts);
  return { ...window.__info(), concept: concept.id, conceptName: concept.name };
};

window.__dbg = { THREE, renderer, postfx, get stage() { return stage; }, build, frame };

/* ===================================================================== *
 * 页面控件
 *
 * 这台机器一开始只有 __renderX 两个 console 入口，于是打开链接看到的是一张黑图 ——
 * 它不挂 rAF，不主动渲任何东西。审片工具让人「先去 console 里敲一句」是失败的：
 * 要看的人不一定是写它的人。所以开机就渲一张，并把常用的几个旋钮摆在画面上。
 * ===================================================================== */

const CANON_IDS = [
  "B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08",
  "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08"
];

const bar = document.createElement("div");
bar.style.cssText = `
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #dfeee0; background: #10160f; padding: 10px 14px;
  display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
  border-bottom: 1px solid #2c3a2a;
`;
document.body.insertBefore(bar, canvas);

const label = document.createElement("div");
label.style.cssText = `
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #9fc79a; background: #0c110b; padding: 8px 14px;
`;
document.body.appendChild(label);

function control(html) {
  const wrap = document.createElement("label");
  wrap.style.cssText = "display:flex;gap:6px;align-items:center";
  wrap.innerHTML = html;
  bar.appendChild(wrap);
  return wrap;
}

const skinPick = control("skin <select></select>").querySelector("select");
for (const id of SKIN_IDS) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = `${SKINS[id].name}${SKINS[id].nameZh ? ` ${SKINS[id].nameZh}` : ""}`;
  skinPick.appendChild(option);
}
skinPick.onchange = () => {
  window.__setSkin(skinPick.value);
  if (label.textContent.includes("[generated")) showGenerated();
  else showCanon();
};

const conceptPick = control("world <select></select>").querySelector("select");
{
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— leaf (canon) —";
  conceptPick.appendChild(none);
  for (const id of CONCEPT_IDS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = `${CONCEPTS[id].name} ${CONCEPTS[id].nameZh}`;
    conceptPick.appendChild(option);
  }
}
conceptPick.onchange = () => {
  if (conceptPick.value) showConcept();
  else showGenerated();
};

const canonPick = control("canon <select></select>").querySelector("select");
for (const id of CANON_IDS) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = id;
  canonPick.appendChild(option);
}

const seedInput = control(
  "gen seed <input type='number' value='4219' style='width:8em'>"
).querySelector("input");
const diffInput = control(
  "difficulty <input type='range' min='0' max='100' value='60'>"
).querySelector("input");
const zoneInput = control(
  "zone <input type='range' min='0' max='7' value='0'>"
).querySelector("input");

function button(text, onClick) {
  const element = document.createElement("button");
  element.textContent = text;
  element.style.cssText =
    "font:inherit;padding:4px 12px;background:#24361f;color:#dfeee0;" +
    "border:1px solid #40563a;border-radius:5px;cursor:pointer";
  element.onclick = onClick;
  bar.appendChild(element);
  return element;
}

function describe(info, extra = "") {
  label.textContent =
    `${info.level}   ${info.archetype ? `archetype=${info.archetype}   ` : ""}` +
    `skin=${info.skin}   zone=${info.zone}   ${info.bugs} bugs / ${info.holes} burrows / ` +
    `${info.obstacles} obstacles${extra}`;
}

const zone = () => Number(zoneInput.value);
const difficulty = () => Number(diffInput.value) / 100;

function showCanon() {
  describe(window.__renderCanon(canonPick.value, { zone: zone() }), "   [authored]");
}

function showGenerated() {
  try {
    describe(
      window.__renderGenerated(Number(seedInput.value), difficulty(), { zone: zone() }),
      `   [generated, difficulty ${difficulty().toFixed(2)}]`
    );
  } catch (error) {
    label.textContent = `generator failed: ${error.message}`;
  }
}

function showConcept() {
  try {
    const info = window.__renderConcept(
      conceptPick.value || "stone",
      Number(seedInput.value),
      difficulty(),
      { zone: zone() }
    );
    label.textContent =
      `${info.conceptName}   ${info.archetype || ""}   ` +
      `${info.bugs} bugs / ${info.holes} burrows / ${info.obstacles} obstacles`;
  } catch (error) {
    label.textContent = `concept failed: ${error.message}`;
  }
}

button("show world", showConcept);
button("show canon", showCanon);
button("show generated", showGenerated);
button("next seed", () => {
  seedInput.value = String(Number(seedInput.value) + 1);
  showGenerated();
});
canonPick.onchange = showCanon;
for (const input of [seedInput, diffInput, zoneInput]) {
  input.oninput = () => {
    if (label.textContent.includes("[generated")) showGenerated();
    else showCanon();
  };
}

// 开机先摆一张手工关：审片的基准是正典，第一眼就该是它。
showCanon();

window.__ready = true;
