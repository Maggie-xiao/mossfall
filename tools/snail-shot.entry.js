/**
 * A05 蜗牛的离屏取样台。
 *
 * 和 tools/ending-shot.entry.js 是同一套路数，理由也一样：**不挂 requestAnimationFrame**。
 * 这个页面跑在一个隐藏的 Browser pane 里，rAF 根本不会被调度 —— 游戏本体在那种情况下
 * 整个循环是冻住的，`canvas.toDataURL()` 拿回来的是一张空图。只有「同一个 JS turn 里
 * render 完立刻 toDataURL」才抓得到画面。
 *
 * 舞台是真的：真的 A05 关卡数据、真的 LeafPlatform、真的 BoardSnails、真的区域布光、
 * 真的 World（雾和背景色归它管）、真的 PostFX。少的只有 HUD 和球 —— 要看的是四只蜗牛
 * 的造型和配色，不是玩法。渲染器三行色彩管线和 src/scene.js:308-310 一字不差，不然
 * 「壳在 ACES 下会不会煮成酱色」这种问题在这儿是看不出来的。
 *
 * 用法（在页面里 eval）：
 *   await window.__shot({ view: "wide" })
 *   await window.__shot({ view: "close", target: "BLOCK_02" })
 *   await window.__sheet()
 * 图片 POST 到 tools/shot-sink.mjs（127.0.0.1:4318，JSON {name, data}）。
 */

import * as THREE from "three";

import { BoardSnails } from "../src/adapters/board-snails.js";
import { createRuntimeCore } from "../src/adapters/runtime-core.js";
import { ADVANCED_DATA } from "../src/levels.js";
import { Lighting } from "../src/mossfall/render/lighting.js";
import { LeafPlatform } from "../src/mossfall/render/leaf.js";
import { World } from "../src/mossfall/render/world.js";
import { PostFX } from "../src/mossfall/fx/postfx.js";
import { zoneFor } from "../src/mossfall/data/palette.js";

const W = 1440;
const H = 810;
const SINK = "http://127.0.0.1:4318/";

const canvas = document.createElement("canvas");
canvas.width = W;
canvas.height = H;
canvas.style.cssText = "width:720px;height:405px;display:block";
document.body.style.cssText = "margin:0;background:#000";
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, W / H, 0.05, 700);

const level = ADVANCED_DATA.levels.find((l) => l.id === "A05");
const { field, runtimeLevel } = createRuntimeCore(level, "advanced");
const zone = runtimeLevel.index || 0;

const lighting = new Lighting(scene, "medium");
lighting.setRenderer(renderer);
const world = new World(scene, "medium");
world.attachLighting(lighting);
/* 同 scene.js 的 removeGodrays()：那几片体积光在这种静止取样里只会糊住轮廓。 */
if (world.godrays) {
  world.godrays.parent?.remove(world.godrays);
  world.godrays.geometry?.dispose();
  world.godrays = null;
}
const postfx = new PostFX(renderer, "medium", {});
postfx.resize(W, H);

/* 板子放在关卡自己的原点上（y = -index*30），World 的雾和视差层是按这个高度算的。 */
const boardRoot = new THREE.Group();
boardRoot.position.set(
  Number(runtimeLevel.origin?.x || 0),
  Number(runtimeLevel.origin?.y || 0),
  Number(runtimeLevel.origin?.z || 0)
);
scene.add(boardRoot);

const leaf = new LeafPlatform(field, runtimeLevel, "medium");
const snails = new BoardSnails(leaf, runtimeLevel);
boardRoot.add(leaf.group);

world.setZone(zone, true);
lighting.setZone(zone, 0);
postfx.setZone(zone, 1);
/* 这一步不能省。Lighting 三盏平行光出厂都停在 (0,1,0)、打向 (0,0,0) —— 光是直上直下
   的，于是 n·l 在赤道处直接切到 0，任何球面都会被劈出一条硬邦邦的水平明暗界。游戏里
   是 scene.js:583 的 focusLighting() 把它们摆开的，取样台照抄同一句。 */
lighting.focusOn(
  boardRoot.position.x,
  boardRoot.position.y,
  boardRoot.position.z,
  Math.max(4, field?.size || 6)
);
/* World 的远景幕布是照着游戏相机的画幅铺的；这台机器的 fov 和站位都不一样，边角会
   露出没画到的黑。清成雾色，看的是蜗牛，不是穿帮。 */
scene.background = new THREE.Color(zoneFor(zone).fog);

/* 静止一帧就够，但 update 得跑一次，材质里那些 uniform 才有值。 */
leaf.update(1 / 60, 0, []);
world.update(1 / 60, 0, boardRoot.position.y + 6);
lighting.update(1 / 60, 0);
snails.update(1 / 60);

const seats = new Map(
  (level.board.obstacles || []).map((o) => [o.id, o])
);

async function send(name, quality = 0.95) {
  const data = canvas.toDataURL("image/jpeg", quality);
  const res = await fetch(SINK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, data }),
  });
  if (!res.ok) throw new Error(`sink ${res.status}`);
  return name;
}

/**
 * 抓一张。相机永远看向板面上的一个点，绕它转 yaw、抬 lift。
 *
 * `aim` 给的是**板面局部坐标**（y 会自动加到 boardRoot 上）。全景那个默认落点是当年
 * 照着板心随手定的，可四只蜗牛是挤在板子一侧的（质心 x≈2.35），照默认拍出来它们全堆在
 * 右下角、左上一大片空。要拍合影就把 aim 传成它们的质心。
 *
 * @param {{view?:string, target?:string, prefix?:string, aim?:number[],
 *          yaw?:number, dist?:number, lift?:number, fov?:number}} opts
 */
window.__shot = async function __shot(opts = {}) {
  const { view = "wide", target = "BLOCK_01", prefix = "a05" } = opts;
  const seat = seats.get(target) || { x: 0, z: 0, r: 0.3, h: 0.5 };
  const wide = view === "wide";

  /* 近景对准的是**建好的那个节点**的世界坐标，不是关卡表里的 x/z。板面自己有 dish
     和 curl，座位的实际高度是算出来的 —— 照着关卡表摆相机会拍到一片叶子。 */
  const at = new THREE.Vector3(0.15, boardRoot.position.y + 0.3, 0);
  if (opts.aim) {
    at.set(opts.aim[0], boardRoot.position.y + (opts.aim[1] || 0), opts.aim[2]);
  } else if (!wide) {
    const rec = snails.byId.get(target);
    if (rec) rec.wobble.getWorldPosition(at);
    else at.set(seat.x, boardRoot.position.y, seat.z);
    at.y += seat.h * 0.5;
  }
  const dist = opts.dist ?? (wide ? 6.4 : 1.6);
  const lift = opts.lift ?? (wide ? 0.62 : 0.34);
  const yaw = opts.yaw ?? (wide ? 0.55 : 0.7);

  camera.fov = opts.fov ?? (wide ? 34 : 26);
  camera.updateProjectionMatrix();
  camera.position.set(
    at.x + Math.sin(yaw) * dist,
    at.y + lift * dist,
    at.z + Math.cos(yaw) * dist
  );
  camera.lookAt(at);
  camera.updateMatrixWorld();

  postfx.render(scene, camera);
  return send(`${prefix}-${view}-${target}.jpg`);
};

/** 一张全景 + 四只各一张近景。 */
window.__sheet = async function __sheet(prefix = "a05") {
  const out = [await window.__shot({ view: "wide", prefix })];
  for (const id of ["BLOCK_01", "BLOCK_02", "BLOCK_03", "BLOCK_04"]) {
    out.push(await window.__shot({ view: "close", target: id, prefix }));
  }
  return out;
};

window.__snailInfo = () => ({
  built: snails.count,
  ids: snails.snails.map((s) => s.id),
  seats: [...seats.values()].map((o) => ({
    id: o.id, kind: o.kind, x: o.x, z: o.z, r: o.r, h: o.h, shell: o.shell,
  })),
  zone,
  boardY: boardRoot.position.y,
});

/* 整个台子摊出来，方便在页面里直接量、直接关掉某个部件重拍 —— 审片就是要能拆开看。 */
window.__dbg = { THREE, scene, camera, renderer, postfx, world, lighting, leaf, snails, boardRoot };

window.__ready = true;
