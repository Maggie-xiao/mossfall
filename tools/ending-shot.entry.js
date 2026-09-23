/**
 * 谢幕动画的离屏取样台。
 *
 * 为什么要有这个东西：谢幕是一局打完才播的，而且只播一次、十二秒。要核对它的每一
 * 拍（蜷叶落位、甲虫顶叶柄、一对一对张开、出字、溶解），靠真打一局是不可能的 ——
 * 而且区域配色（zone 0 浅黄绿 → zone 7 深墨绿）得挨个看一遍。
 *
 * 于是这里搭一个只有谢幕的最小舞台：真的 WebGLRenderer、真的 postfx、真的
 * EndingDirector，光照抄 scene.js 里那一套的比例。然后**手动步进** —— 不挂
 * requestAnimationFrame。这一点很要紧：这个页面通常跑在一个隐藏的 Browser pane 里，
 * rAF 根本不会被调度，所以只有「同一个 JS turn 里推进时间 + render + toDataURL」
 * 才拿得到画面。
 *
 * 用法（在页面里 eval）：
 *   await window.__run({ zoneIndex: 0, line: "...", marks: [{k:"flat", t:5.6}], prefix: "v1" })
 * marks 是**对象**（{k, t}），不是数组 —— 传数组会静默什么都不抓。
 * 图片 POST 到 tools/shot-sink.mjs（127.0.0.1:4318，JSON {name, data}）。
 */

import * as THREE from "three";

import { EndingDirector } from "../src/ending.js";
import { PostFX } from "../src/mossfall/fx/postfx.js";
import { zoneFor } from "../src/mossfall/data/palette.js";

const W = 1904;
const H = 1040;
const SINK = "http://127.0.0.1:4318/";

const canvas = document.createElement("canvas");
canvas.width = W;
canvas.height = H;
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
/* 和 src/scene.js:310-312 一字不差 —— 取样台的色彩管线必须和游戏里一样，
   否则「白字会不会被 ACES 压成灰」这种问题在这儿看不出来。 */
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 200);
const postfx = new PostFX(renderer, "medium", {});
postfx.resize(W, H);

let director = null;

/** 按区域布光。字段名和亮度比例照 src/mossfall/data/palette.js 里的 ZONES。 */
function light(zone) {
  for (const old of [...scene.children]) if (old.isLight) scene.remove(old);
  scene.background = new THREE.Color(zone.fog);
  scene.fog = new THREE.Fog(zone.fog, zone.fogNear, zone.fogFar);
  scene.add(new THREE.HemisphereLight(zone.hazeTop, zone.hazeBot, zone.ambientInt));
  /* 暖色主光 —— 美术验收要求的就是这个方向。 */
  const key = new THREE.DirectionalLight(zone.sun, zone.sunInt);
  key.position.set(4.2, 7.4, 3.1);
  scene.add(key);
  const fill = new THREE.DirectionalLight(zone.glow, 0.34);
  fill.position.set(-3.6, 2.2, -2.8);
  scene.add(fill);
  postfx.setZone(zone, 1);
}

async function send(name, quality = 0.9) {
  const data = canvas.toDataURL("image/jpeg", quality);
  await fetch(SINK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, data }),
  });
  return name;
}

/**
 * 跑一遍谢幕，在 marks 指定的时刻各抓一张。
 * @param {{zoneIndex?:number, line?:string, marks?:Array<{k:string,t:number}>,
 *          prefix?:string, castIndex?:number, step?:number}} opts
 */
window.__run = async function __run(opts = {}) {
  const {
    zoneIndex = 0,
    line = "You cannot hurry a thing that is already falling.",
    marks = [],
    prefix = "shot",
    castIndex = 0,
    step = 1 / 60,
  } = opts;

  const zone = zoneFor(zoneIndex);
  light(zone);

  director?.dispose();
  camera.position.set(0, 1.55, 4.2);
  camera.quaternion.identity();
  camera.updateMatrixWorld();
  director = new EndingDirector(scene, camera, {}, { line, zoneIndex, castIndex });
  director.start();

  const todo = marks
    .map((m) => ({ k: String(m.k), t: Number(m.t) }))
    .filter((m) => Number.isFinite(m.t))
    .sort((a, b) => a.t - b.t);
  const out = [];
  const end = todo.length ? todo[todo.length - 1].t + step : 0;

  let t = 0;
  let next = 0;
  /* 固定步长：抓图要可复现，不能跟着真实帧率漂。 */
  while (t <= end + 1e-6) {
    director.update(step, t);
    t += step;
    while (next < todo.length && t >= todo[next].t) {
      postfx.render(scene, camera);
      out.push(await send(`${prefix}-${todo[next].k}-${todo[next].t.toFixed(2)}.jpg`));
      next++;
    }
  }
  return out;
};

/** 单帧：给定时刻推到那里，抓一张。 */
window.__at = async (t, name, opts = {}) =>
  window.__run({ ...opts, marks: [{ k: name, t }], prefix: opts.prefix || "at" });

/**
 * 量一量：签语面片和叶子在屏幕上各占多少 px。
 * 「字有没有落在她框出来的那一块里」只有量出来才算数，看图是估的。
 */
window.__measure = function __measure() {
  if (!director) return null;
  const project = (v) => {
    const p = v.clone().project(camera);
    return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H };
  };
  /* 一个 Object3D 在屏幕上占的方框。世界包围盒的八个角各投一次取包络 —— 对
     一片起伏的叶子这是偏大的估计（盒子角不在叶面上），但「构图偏了多少」问的
     是外形占位，偏大的那点在两边是对称的，不影响中心。 */
  const boxPx = (obj) => {
    const b = new THREE.Box3().setFromObject(obj);
    if (b.isEmpty()) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = project(new THREE.Vector3(
        i & 1 ? b.max.x : b.min.x,
        i & 2 ? b.max.y : b.min.y,
        i & 4 ? b.max.z : b.min.z
      ));
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return {
      px: [x0, y0, x1, y1].map(Math.round),
      /* 中心相对画面中心的偏移，用半宽/半高归一化：0 = 正中，±1 = 贴边。 */
      off: [
        +(((x0 + x1) / 2 - W / 2) / (W / 2)).toFixed(3),
        +(((y0 + y1) / 2 - H / 2) / (H / 2)).toFixed(3),
      ],
    };
  };

  const words = director.words;
  const leaf = director.leaf;
  const half = words.mesh.geometry.parameters.width / 2;
  const l = project(words.mesh.localToWorld(new THREE.Vector3(-half, 0, 0)));
  const r = project(words.mesh.localToWorld(new THREE.Vector3(half, 0, 0)));
  const p0 = project(leaf.group.localToWorld(new THREE.Vector3(0, 0, 0)));
  const p1 = project(leaf.group.localToWorld(new THREE.Vector3(4.6, 0, 0)));
  return {
    frame: [W, H],
    planeWorldW: half * 2,
    planePx: [Math.round(l.x), Math.round(r.x)],
    planeWidthPx: Math.round(r.x - l.x),
    rachisPx: [Math.round(p0.x), Math.round(p0.y), Math.round(p1.x), Math.round(p1.y)],
    rachisLenPx: Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y)),
    /* 叶轴在屏幕上的坡度，度。「根茎和画面齐平」就是这一个数。 */
    rachisSlopeDeg: +((Math.atan2(p0.y - p1.y, p1.x - p0.x) * 180) / Math.PI).toFixed(2),
    leafBox: boxPx(leaf.group),
    bugBox: director.view?.group ? boxPx(director.view.group) : null,
    wordsBox: boxPx(words.mesh),
    fontSize: words.fontSize,
    inkFracOfCanvas: words.words.length
      ? (words.words[words.words.length - 1].x - words.words[0].x) / 2048
      : 0,
  };
};

/**
 * 把台子摊出来，方便在页面里改一个数、立刻重渲一张。
 *
 * 「叶片倾斜多少才看得出来是斜的」这种问题，一次 rebuild 只能试一个值 —— 而绕叶轴
 * 转的那一路靠的是透视，远近两排小叶的大小差在 4.6 单位的距离上只有百分之几，光靠
 * 算是定不下来的，必须一张一张比。`__pose` 就是干这个的：先 __run 到某一拍，然后
 * 直接改 group 的欧拉角重渲，绕过整条时间线。
 *
 * 注意：__pose 改的是**当前这一帧**，下一次 director.update() 就会把它覆盖回去。
 * 试出来的值要写回 src/ending.js 的 PITCH_READ 才算数。
 */
window.__dbg = { THREE, scene, camera, renderer, postfx, send, get director() { return director; } };

/** 覆盖当前帧的叶子朝向并抓图。角度是弧度，缺省保持现值。 */
window.__pose = async function __pose(o = {}) {
  const g = director.leaf.group;
  const e = new THREE.Euler().setFromQuaternion(g.quaternion, "XYZ");
  g.quaternion.setFromEuler(
    new THREE.Euler(o.pitch ?? e.x, o.yaw ?? e.y, o.roll ?? e.z, "XYZ")
  );
  g.updateMatrixWorld(true);
  postfx.render(scene, camera);
  return send(`${o.prefix || "pose"}-${(o.pitch ?? e.x).toFixed(2)}.jpg`);
};

window.__ready = true;
