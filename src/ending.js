/**
 * MOSS TILT — ending cinematic.
 *
 * Plays the moment the run ends, BEFORE the result board. It is an overlay on
 * the place where the player actually finished: the camera keeps its end-of-
 * run pose, the level's own zone lighting and fog stay in charge, and the
 * world goes on living behind the cast (leaves keep falling). A backdrop
 * plane hanging just past the stage carries the *same* dimming the result
 * board uses (#screen-backdrop[data-screen="RESULT_CALC"] in styles.css): the
 * real final environment, veiled by one soft radial wash, with the cast sharp
 * in front of it. Living in the scene rather than the DOM is the whole point —
 * a DOM veil would dim the beetle along with the world.
 *
 * 一只虫，一片叶子。
 *
 * 上一版是八只排队谢幕、集体举着一片叶子 —— 被否掉。八只站成一排本身就没有
 * 戏：它们只能一起做同一件事，任何一只单独的反应都被稀释成队形。改成一只之
 * 后，整幕是一段两个角色的哑剧：一片蜷成纺锤的叶子先落到台上，它滚进来「咚」
 * 一下顶在叶柄上，这一震把叶子震开 —— 小叶一对一对翻开，从叶根推到叶尖，
 * 字一个一个洇出来 —— 然后停在那儿，让人读完。
 *
 * 道具**先于**演员上台，这是刻意的：签语已经在那儿了，虫子只是撞上了它。
 * 之前是天上掉一个纸团砸在它头上 —— 那个笑点不错，但那样签语是「送来的」，
 * 不是「本来就长在这儿的」。
 *
 * 谁上场每次都不一样（ENDING_CAST 里随机抽一只）—— 重看一遍不是同一只虫，
 * 抽签这件事才有再抽一次的意思。
 *
 * 舞台建在冻结相机自己的基底里，所以「画面右边」在任何结束姿势下都是字面
 * 意义的右边。dispose() 会把加进去的东西全部摘掉；游戏场景本身从不被改。
 */

import * as THREE from "three";
import { TableTiltInsectView } from "./adapters/insect-presentation.js";
import { EndingLeaf, LEAF_DIMS, UNFURL_SPAN } from "./ending-leaf.js";
import { EndingWords } from "./ending-words.js";

/* 候选演员。颜色是归一化之后的键（见 adapters/runtime-level.js：
 * black→blue、pink→purple、white→yellow）。 */
export const ENDING_CAST = Object.freeze([
  { id: "END_1", species: "ladybug", color: "red" },
  { id: "END_2", species: "roly", color: "orange" },
  { id: "END_3", species: "beetle", color: "green" },
  { id: "END_4", species: "weevil", color: "yellow" },
  { id: "END_5", species: "beetle", color: "yellow" },
  { id: "END_6", species: "firefly", color: "purple" },
  { id: "END_7", species: "firefly", color: "teal" },
  { id: "END_8", species: "scarab", color: "blue" },
]);

const BUG_R = 0.357;            // sim radius; the adapter shows it at 1.4×
const VISUAL_R = BUG_R * 1.4;   // ≈0.5 — rolling contact radius on screen
/* 两个都比原来往右挪了 0.41 —— **同样多**，所以滚进来那一段的距离一点没变，
 * 于是同样的 ROLL_DUR 下速度也没变，第一幕一帧不差，只是整体站得靠右一点。
 * 挪这 0.41 是为了把叶子和签语顶到画面中间：1904×1040 上量过，阅读位的叶面
 * 横跨 335–1257（中心 796），签语中心 919，而画心是 952 —— 两个都偏左，叶子
 * 偏得更多。舞台上 1 单位 ≈ 232px，把两者的中点推到画心正好是 0.41。
 * 剩下的 ±60px 是结构性的：签语挂在叶轴的 TEXT_U 上（0.61，偏叶尖那半边），
 * 它和叶面中心天生差着这一截，除非把字往叶根挪 —— 而那样这一行的左端会探出
 * 最靠根那片小叶掉到背景上，见 TEXT_U。 */
const SPAWN_X = 7.21;
/* 它停在画面偏左。这一幕里两个东西要同框：一只 ~1 宽的虫和一片 4.6 长的叶子，
 * 而 4.6 远处只有 7.6 的可见宽度 —— 虫不站到边上，叶子摊开就会把它盖住。
 * 它停下的位置同时也是叶柄尖端的位置：滚到底那一下是撞上去的（见 PETIOLE_X）。 */
const STAND_X = -1.79;
const FACE_YAW = -0.12;         // "mostly at the camera", not robotic centre

const STAGE_DIST = 4.6;         // cast plane, this far along the frozen view
const ROW_LIFT = -0.1;          // the floor sits a touch below the view centre
const BACKDROP_DIST = 5.6;      // just past the cast; everything beyond dims
const BACKDROP_FADE = 0.9;      // 屏幕渐暗 — the wash eases in

/* The result board's viewport wash, copied stop for stop from styles.css
 * (#screen-backdrop[data-screen="RESULT_CALC"]):
 *   radial-gradient(120% 100% at 50% 34%, rgba(4,18,12,.26), rgba(2,12,8,.72))
 * Percentages are of the element, so in normalised UV the ellipse radii are
 * 1.2 / 1.0 whatever the aspect — one fixed little canvas serves every window.
 * CSS measures the centre from the top, the texture from the bottom. */
/* `linear` is the same stop re-solved for the post-FX path, where the scene
 * renders into a linear target and is tone-mapped afterwards. The browser lays
 * the result board's veil over finished sRGB pixels; this plane goes in before
 * both steps, so the CSS alpha lands far too light there — 0.72 of near-black
 * takes an sRGB 200 down to 59 in the DOM but only to 137 in linear. Darkening
 * by (1−a) in sRGB is roughly (1−a)^2.2 in linear, which would ask for 0.48 /
 * 0.94; the values below are what a sweep against the live tone-mapped frame
 * actually matched best. They disagree with the model, and with each other,
 * because the tone curve sits between the blend and the eye — which is also
 * why the match is close rather than exact. */
const BACKDROP_WASH = Object.freeze({
  inner: { rgb: [4, 18, 12], alpha: 0.26, linear: 0.5 },
  outer: { rgb: [2, 12, 8], alpha: 0.72, linear: 0.88 },
  cx: 0.5,
  cy: 0.34,
  rx: 1.2,
  ry: 1.0,
});
const BACKDROP_TEX = 256;       // a smooth wash; bilinear does the rest

/* 第二幕：签语上台前，世界再退一步。
 * A second plane in front of the wash and still behind the cast, so the world
 * goes near-dark while the beetle stays exactly as lit as it was — the whole
 * reason this layer lives in the scene instead of the DOM. `linear` is the same
 * darkness re-solved for the post-FX blend; see BACKDROP_WASH. */
const VEIL_RGB = 0x081208;
const VEIL_ALPHA = { alpha: 0.62, linear: 0.84 };
const VEIL_DIST = BACKDROP_DIST - 0.15;
const VEIL_FADE = 0.85;         // seconds; starts the moment the line is called

/* --- 第一幕：它上场（秒，从这一幕开始算）---------------------------------
 *   1.35  一只球从画面右边滚进来
 *   1.75  「咚」顶在叶柄上，停住，展开头和腿
 *   2.37  眨一下 —— 这一刻交给 controller 开始计 endingTipMs
 *
 * ROLL_START 从 0.6 推到 1.35，给蜷着的叶子一个像样的入场；下面这几个常量
 * 一个都没动，所以滚进来那一段一帧不差，只是整体晚了 0.75s 开演。 */
const ROLL_START = 1.35;
const ROLL_DUR = 0.4;
const ARRIVE_AT = ROLL_START + ROLL_DUR;
const FACE_DELAY = 0.38;        // after arrival: unfurl is mostly done
const FACE_DUR = 0.26;
const BLINK_DELAY = 0.62;
const FINISH_AFTER_BLINK = 0.55;

/* --- 叶子的一条时间线（秒，和第一幕同一个时钟）---------------------------
 *   0.15  一片蜷成纺锤的叶子从画面上方翻着掉下来
 *   0.70  叶柄尖端落到虫子将要停下的那一点，弹两下停住
 *   1.75  被顶了一下 —— 整片抖起来（ARRIVE_AT，甲虫滚到底）
 *   2.35  小叶开始成对翻开，从叶根推到叶尖（ARRIVE_AT + 0.6）
 *   5.45  最后一对（叶尖）张满，叶面稳定在阅读位
 *   5.60  字一个词一个词洇出来
 *   6.59  末词洇满 —— 然后什么都不发生，让人把这句话读完（READ_HOLD）
 *  10.79  叶子散成光（淡出 + 孢子变多变快往上走）
 *  11.79  完，结算板 12.52 接手
 *
 * 这条线跨在 finishAt（2.92）两边，所以全部用**绝对时间**，不像上一版那样
 * 以第一幕结束为原点 —— 展开在 finishAt 之前就开始了，相对时间会是负数。
 *
 * 为什么先蜷着：展开这个动作本身就是仪式，抽签的乐趣在拆，不在读。
 *
 * 为什么读完就没了：结尾试过四版 —— 往上飘走（像它自己长了翅膀）、落地并
 * 逐词褪字（留下一张空白的叶子，虫子还莫名其妙地滚了）、卷回去带走（动作太
 * 大，像在收拾垃圾，而且签语一卷就没了）、踩脚印当落款（多余）。全都是在那
 * 句话已经说完之后又加戏。这一幕最后该留在画面上的就是那句话本身。
 * 停顿走完就散掉 —— 那不是「叶子做了什么」，是这一幕收束；杵在那儿等切屏
 * 反而奇怪。 */
const LEAF_FALL_AT = 0.15;
const LEAF_FALL_DUR = 0.55;
const LEAF_FALL_FROM = 4.6;     // 起手高度（世界单位，相对落点）
const LEAF_FADE_IN = 0.22;      // 进画那一下别硬切
const LEAF_LAND_AT = LEAF_FALL_AT + LEAF_FALL_DUR;
const LEAF_SETTLE_DUR = 0.45;   // 弹两下停住
/* 叶柄尖端停在这儿 —— 正好是甲虫滚到底时它左缘所在的位置。这一幕唯一需要
 * 对准的就是这一点，所以叶子的 group 原点就设在叶柄尖端（见 ending-leaf.js）。 */
const PETIOLE_X = STAND_X - VISUAL_R - 0.06;
const PETIOLE_H = -0.02;        // 相对 floorY；floorY 是虫子的**球心**
/* 叶子压在甲虫后面一点点。同深度会穿模 —— 叶柄要落在它身上，不是插进它身体。
 * 顺带这也让叶根被虫子挡住一小块，「虫子坐在这片叶子上」才成立。 */
const LEAF_DEPTH = 0.55;
/* 压深了，同一个舞台 x 在屏幕上就会往画面中心缩 —— 按距离比例把它顶回去，
 * 这样 LEAF_DEPTH 只改遮挡关系，不改构图（见 _placeLeaf）。 */
const LEAF_K = (STAGE_DIST + LEAF_DEPTH) / STAGE_DIST;
/* 画面内的倾角（绕视线轴，也就是叶轴在屏幕上的坡度）：蜷着的时候翘着，展开的
 * 过程里落平。绕的是 group 原点 = 叶柄尖端，所以叶柄不动，叶面往上扫开。
 *
 * 阅读位几乎是 0 —— 要的就是叶轴和画框齐平。上一版给到 0.2（11.5°），叶轴从
 * 虫子那儿一路爬到右上角，代价是整个构图被顶出画面中心：字挂在叶轴上（局部
 * y = 0），len·TEXT_U·sin(0.2) = 0.56 单位 = 屏幕上 129px，一行字就这么被抬到
 * 画面上方三分之一处，下面空着一大片。
 *
 * 那为什么不是正 0？因为下面的 YAW_READ 一转，叶轴就不再平行于成像面了，它会
 * 朝地平线收 —— 而叶子悬在视平线**上方**一点点，于是远的那头看着往下掉。量出来
 * 是 −1.7°（叶尖上 27px）。0.030 正是把这一路抬回来的量：加上之后实测 −0.15°，
 * 也就是 953px 长的叶轴两端差 2px。这个数是和 YAW_READ 配对的，改一个要重量一次。 */
const TILT_CURL = 0.18;
const TILT_READ = 0.03;
/* 「叶片倾斜一点」出在这两个上，而它们都不动叶轴在屏幕上的那条线。
 *
 * PITCH 是绕叶轴自身翻面 —— 屏幕上那条线完全不动，代价为零。但也只值这么点：
 * 小叶是**对称**长在叶轴两边的，绕叶轴转，上下两排是一起压扁的，剩下的只有
 * 远近排的透视差，在 4.6 单位外不过百分之几。单给到 −0.42 还是像张标本图。
 *
 * 真正让它立起来的是 YAW —— 一头远一头近，叶尖那半边明显收小，这才读得出是个
 * 斜着放的东西。以前它被压到近乎没有，理由是「整句话被透视拉成梯形」；那条理由
 * 现在不成立了：签语早就不贴在叶面上，是块永远正对镜头的面片（见 _leafBeat
 * 末尾），叶子怎么转都不碰它。0.18 是试出来的上限附近 —— 再大叶面就开始背光发闷。 */
const PITCH_READ = -0.17;
const YAW_READ = 0.18;

const UNFURL_AT = ARRIVE_AT + 0.6;
/* 它抬头看叶子的时刻。不能早于 ARRIVE_AT + FACE_DELAY + FACE_DUR（2.39，
 * 第一幕的转身还在走，会打架），也不能早于眨眼（2.37）。所以排在两者之后：
 * 落地 → 对着镜头 → 眨一下 → 「咦，旁边那玩意儿动了」→ 转头。 */
const LOOK_AT = ARRIVE_AT + 0.95;
const UNFURL_DUR = UNFURL_SPAN;         // 6 步 × 0.45s 错开 + 每步 0.85s = 3.10
const FLAT_AT = UNFURL_AT + UNFURL_DUR;
/* 位姿（升起 + 倾角）在展开的前 1.4s 里走完，不跟满 3.1s —— 慢三秒的平移
 * 会变成飘，而这段时间的主角是小叶。 */
const POSE_DUR = 1.4;
const NUDGE_RISE = 0.13;        // 顶叶柄的时候它自己也踮起来
const PROP_PUSH = 0.16;         // 虫子和叶柄一起往右挪这么点 —— 它俩是贴着的
const READ_LIFT = 0.16;         // 阅读位比落点高这么点

const WORD_AT = FLAT_AT + 0.15;
const WORD_STEP = 0.13;         // 每个词之间
const WORD_RAMP = 2.6;          // 一个词洇满要几个词的时间（相邻的词叠着亮）
/* 签语那块面片。宽度是从叶子自己的字带倒推的：面片中心对着 bladeCentreU（0.56），
 * 0.72 × 叶长 = 3.31 单位，两边各去掉画布的留白（2.7%）之后，落墨的那一段正好是
 * u ∈ [0.22, 0.90] —— 也就是 ending-leaf-shape.js 里的 [TEXT_U0, TEXT_U1]。
 * 所以「一行字」和「叶子最宽的那一带」是同一段，用户框出来的就是这儿。 */
/* 0.72 的时候墨迹是 u ∈ [0.270, 0.950]，而叶面留给字的那条带子只到 0.885
 * （ending-leaf-shape.js 的 TEXT_U0/U1）—— 右端整整探出 0.065 到叶尖上，
 * 抓图上就是「字顶到叶边」。0.656 让墨迹收成 0.620，配下面居中的 TEXT_U 之后
 * 落在 [0.250, 0.870]，两边各留 0.015 的余量。
 *
 * 顺带记一笔给下一个想把字放大的人：**一行字的上限就是这条 0.650 的带子**。
 * 屏幕上的字号 = 墨迹宽度（叶单位）× 叶子在屏幕上的大小，和画布分辨率、PAD 都
 * 无关 —— 字号本来就是按框宽倒推的。所以想真的更大只有两条路：把整片叶子放大
 * （但 STAGE_DIST=4.6 处可见宽度只有 7.6，叶子 4.6 + 甲虫已经贴边，放大就要牺牲
 * 甲虫），或者让签语排两行。改 TEXT_W_K 只会把字推出叶面，不会变大。 */
const TEXT_W_K = 0.656;
/* 就压在字带正中（bladeCentreU = (0.235+0.885)/2 = 0.56）。
 * 原来往叶尖偏了 0.05，是为了救左端 —— 那时候墨迹宽 0.681，比字带还宽 0.031，
 * 怎么摆都有一头要出界，于是选了让右端出界。现在墨迹收到 0.620 比带子窄了，
 * 居中就两头都在里面，不用再拆东墙补西墙。 */
const TEXT_U = LEAF_DIMS.bladeCentreU;
/* 往镜头这边提多少。签语是块**平**的面片（永远正对镜头），叶子却是斜的，所以这个
 * 数要够大到让整条线都浮在叶面前面 —— 只够中点是不行的。
 *
 * YAW_READ 一转，叶根那半边就朝镜头压过来了。面片半宽 = len·TEXT_W_K/2 = 1.66
 * 单位，也就是沿叶轴 ±0.36 的 u；线的左端落在 u = 0.25，比字带中心（0.61）近
 * (0.61−0.25)·4.6·sin(0.18) = 0.296 单位。原来只提 0.18，于是最靠根那两片小叶
 * 正好挡在字前面，「You cannot h」直接没了 —— 抓图上看得一清二楚。0.42 是这
 * 0.296 加上小叶自身的起伏（卷 + restRelief）再留一点余量。
 *
 * 上限是 LEAF_DEPTH（0.55）：提过头字就跑到甲虫（深度 0）前面去了，那一小段
 * 被虫子挡住的重叠是特意留的 —— 字在叶子上，虫子在字前面，层次才对。 */
const TEXT_LIFT = 0.42;
/* 末词洇满之后停这么久。
 * 对齐 dunesong 的 oracle：那边最后一个词落在 ~9.8s，结算板 14.2s 才接手 ——
 * 中间 4.4s 什么都不发生。它自己的注释写得很清楚：这段「不是留白，是停顿；
 * 它决定了这句话是被读了，还是只是被显示过」。之前这里只给了 0.84s，那就是
 * 显示过。 */
const READ_HOLD = 4.2;
const VANISH_DUR = 1.0;
const VANISH_RISE = 0.18;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const UP = new THREE.Vector3(0, 1, 0);
const _dq = new THREE.Quaternion();

/**
 * Rasterise the result board's wash into a texture. Canvas2D and CSS paint
 * radial gradients the same way (premultiplied stops, last stop extended
 * outwards), so drawing it here instead of hand-mixing it in a shader is what
 * keeps the two screens honestly identical — and it keeps colour management in
 * three's hands, which a raw shader would sidestep.
 *
 * `linearBlend` says the renderer will composite this in linear space (the
 * post-FX path); see BACKDROP_WASH.
 */
function makeWashTexture(linearBlend) {
  const stop = ({ rgb: [r, g, b], alpha, linear }) =>
    `rgba(${r}, ${g}, ${b}, ${linearBlend ? linear : alpha})`;
  const canvas = document.createElement("canvas");
  canvas.width = BACKDROP_TEX;
  canvas.height = BACKDROP_TEX;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  /* A unit circle drawn through an anisotropic transform — the only way to
   * get CSS's elliptical `120% 100%` out of Canvas2D. The corners sit past the
   * end stop, where both APIs hold that last colour. */
  const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  wash.addColorStop(0, stop(BACKDROP_WASH.inner));
  wash.addColorStop(1, stop(BACKDROP_WASH.outer));
  ctx.setTransform(
    BACKDROP_WASH.rx * w,
    0,
    0,
    BACKDROP_WASH.ry * h,
    BACKDROP_WASH.cx * w,
    /* CSS measures 34% down from the top; UV counts up from the bottom. */
    (1 - BACKDROP_WASH.cy) * h
  );
  ctx.fillStyle = wash;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

export class EndingDirector {
  constructor(
    scene,
    camera,
    callbacks = {},
    { linearBlend = false, line = "", zoneIndex = 0, castIndex = null } = {}
  ) {
    this.scene = scene;
    this.camera = camera;
    this.callbacks = callbacks;
    this.active = false;
    this.finished = false;
    this.t = 0;
    this.line = line;
    this.zoneIndex = zoneIndex;
    this.leaf = null;

    /* --- freeze the end-of-run pose and build the stage in its basis ----- */
    this.basePos = camera.position.clone();
    this.baseQuat = camera.quaternion.clone();
    this.fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.baseQuat);
    this.rightH = new THREE.Vector3().crossVectors(this.fwd, UP).setY(0);
    if (this.rightH.lengthSq() < 1e-6) this.rightH.set(1, 0, 0);
    this.rightH.normalize();
    this.centre = this.basePos.clone().addScaledVector(this.fwd, STAGE_DIST);
    /* Rolling right→left on screen = along −rightH; the shell rolls about this. */
    this.rollAxis = new THREE.Vector3().crossVectors(UP, this.rightH);
    this.rollYaw = Math.atan2(-this.rightH.x, -this.rightH.z);
    this.floorY = this.centre.y + ROW_LIFT;

    this.group = new THREE.Group();
    this.group.name = "endingStage";

    /* --- backdrop: the result board's wash, hung in the scene ------------ *
     * A camera-following plane between the cast and the world, carrying the
     * RESULT_CALC gradient as its map. The final environment stays itself,
     * just veiled — and because the plane sits behind the cast, depth alone
     * keeps the beetle out of the wash. */
    this.backdropTex = makeWashTexture(linearBlend);
    this.backdropMat = new THREE.MeshBasicMaterial({
      map: this.backdropTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const bh = 2 * BACKDROP_DIST * Math.tan(vFov / 2) * 1.04;
    const bw = bh * camera.aspect * 1.04;
    this.backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(bw, bh),
      this.backdropMat
    );
    this.backdrop.frustumCulled = false;
    this.group.add(this.backdrop);

    /* --- act two's veil: the world steps back so the line can speak ------- */
    this.veilMat = new THREE.MeshBasicMaterial({
      color: VEIL_RGB,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.veilTarget = linearBlend ? VEIL_ALPHA.linear : VEIL_ALPHA.alpha;
    const vh = 2 * VEIL_DIST * Math.tan(vFov / 2) * 1.04;
    this.veil = new THREE.Mesh(
      new THREE.PlaneGeometry(vh * camera.aspect * 1.04, vh),
      this.veilMat
    );
    this.veil.frustumCulled = false;
    this.group.add(this.veil);

    /* --- 演员：一只，每次不同 -------------------------------------------- */
    this.castIndex =
      castIndex == null
        ? Math.floor(Math.random() * ENDING_CAST.length)
        : ((castIndex % ENDING_CAST.length) + ENDING_CAST.length) %
          ENDING_CAST.length;
    this.spec = ENDING_CAST[this.castIndex];
    this.view = new TableTiltInsectView({ ...this.spec, r: BUG_R }, "medium");
    this.view.group.visible = false;
    this.group.add(this.view.group);

    this.bug = {
      x: SPAWN_X,
      prevX: SPAWN_X,
      restT: 0,
      squash: 0,
      lift: 0,
      faceU: 0,
      faceYaw: 0,
      yaw: this.rollYaw,
      arrived: false,
      blinked: false,
      rspin: new THREE.Quaternion(),
    };

    this.blinkAt = ARRIVE_AT + BLINK_DELAY;
    this.finishAt = this.blinkAt + FINISH_AFTER_BLINK;

    /* --- 道具当场就造 ---------------------------------------------------- *
     * 上一版是趁虫子还在往里滚的时候偷偷造纸（SCROLL_WARM_AT），因为它只在
     * 第一幕结束那一帧才要出场。现在叶子 0.15s 就要露面，来不及偷 —— 就在
     * 这里造。这一帧本来就是切场那一帧，掉一帧看不见。 */
    this.leaf = new EndingLeaf(zoneIndex);
    this.leaf.setUnfurl(0);
    this.leaf.group.visible = false;
    this.group.add(this.leaf.group);

    /* 签语单独一层，正对镜头（见 ending-words.js）。挂在 this.group 上 ——
       它是恒等变换，所以 place() 收的就是世界坐标。 */
    this.words = new EndingWords(line, LEAF_DIMS.len * TEXT_W_K);
    this.group.add(this.words.mesh);

    /* 词数决定后半段的长度 —— 一句话有几个词，就得念几个词的时间。 */
    const words = Math.max(1, this.words.count);
    this.readAt = WORD_AT + (words - 1) * WORD_STEP + WORD_RAMP * WORD_STEP;
    /* 停顿走完叶子就散掉，这一幕到头 —— 后面不再有戏。虫子留在原地，
       controller 的 endingTipMs 到点切结算板。 */
    this.vanishAt = this.readAt + READ_HOLD;
    this.endsAt = this.vanishAt + VANISH_DUR;
    /* 叶面中心（也就是字所在的那一带）的舞台 x —— 虫子抬头往这儿看。叶子在
       更深的一层上，世界单位的偏移换算到舞台坐标要除掉那个比例。 */
    this.bladeX =
      PETIOLE_X +
      (LEAF_DIMS.len *
        LEAF_DIMS.bladeCentreU *
        Math.cos(TILT_READ) *
        Math.cos(YAW_READ)) /
        LEAF_K;
    this._propPush = 0;

    scene.add(this.group);
  }

  start() {
    this.active = true;
    this.t = 0;
  }

  /** World x/z for a scalar stage coordinate. */
  _worldX(bx) {
    return this.centre.x + this.rightH.x * bx;
  }

  _worldZ(bx) {
    return this.centre.z + this.rightH.z * bx;
  }

  /** 让它转头看向舞台上的某个 x；depth 是那东西压在后面多少（叶子有 0.55）。 */
  _yawToward(bx, depth = 0) {
    return Math.atan2(
      this._worldX(bx) + this.fwd.x * depth - this._worldX(this.bug.x),
      this._worldZ(bx) + this.fwd.z * depth - this._worldZ(this.bug.x)
    );
  }

  /**
   * 叶子的落位：舞台坐标 (bx, y) → 世界坐标，整体压到 LEAF_DEPTH 那一层。
   *
   * 直接沿视线推 0.55 会让它在屏幕上往中心缩掉十分之一 —— 叶柄就离开虫子了，
   * 而这一幕唯一需要对准的就是那一点。所以横向和纵向的偏移都按距离比例放大
   * 回去：屏幕上纹丝不动，只是排到了虫子后面（顺带小一圈，本来就该小一圈）。
   */
  _placeLeaf(out, bx, y) {
    out
      .copy(this.basePos)
      .addScaledVector(this.fwd, STAGE_DIST + LEAF_DEPTH)
      .addScaledVector(this.rightH, bx * LEAF_K);
    out.y += (y - this.centre.y) * LEAF_K;
    return out;
  }

  update(dt, elapsed) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const bug = this.bug;

    /* --- camera: the end-of-run pose, breathing gently -------------------- */
    this.camera.position.set(
      this.basePos.x + Math.sin(t * 0.34) * 0.06,
      this.basePos.y + Math.sin(t * 0.26 + 0.8) * 0.04,
      this.basePos.z + Math.cos(t * 0.31) * 0.05
    );
    this.camera.quaternion.copy(this.baseQuat);
    this.camera.updateMatrixWorld();

    /* --- backdrop follows the camera so its map stays screen-aligned ------ */
    this.backdropMat.opacity = clamp01(t / BACKDROP_FADE);
    this.camera.getWorldDirection(_v1);
    this.backdrop.position
      .copy(this.camera.position)
      .addScaledVector(_v1, BACKDROP_DIST);
    this.backdrop.quaternion.copy(this.camera.quaternion);

    /* Act two: once it has taken its seat the world sinks away, so the paper
       is the only lit thing left. It has to stop competing without touching
       the beetle — which is exactly why this plane is in the scene and hung
       behind it rather than being a DOM veil over the canvas. */
    this.veilMat.opacity =
      this.veilTarget * clamp01((t - this.finishAt) / VEIL_FADE);
    this.veil.position
      .copy(this.camera.position)
      .addScaledVector(_v1, VEIL_DIST);
    this.veil.quaternion.copy(this.camera.quaternion);

    /* --- 第一幕：滚进来、顶上叶柄、坐下、眨眼 ------------------------------ */
    if (t >= ROLL_START) {
      this.view.group.visible = true;
      if (!bug.arrived) {
        const u = clamp01((t - ROLL_START) / ROLL_DUR);
        bug.x = THREE.MathUtils.lerp(SPAWN_X, STAND_X, easeOutCubic(u));
        if (u >= 1) {
          bug.arrived = true;
          bug.x = STAND_X;
          bug.faceYaw =
            Math.atan2(
              this.basePos.x - this._worldX(bug.x),
              this.basePos.z - this._worldZ(bug.x)
            ) + FACE_YAW;
          /* 滚到底不是停下，是**撞上**：叶柄尖端就在这一点上。它压扁一下、
             愣一下，整片叶子被震得抖起来 —— 这一震就是展开的动因。上一版是
             天上掉个纸团砸它头上；道具已经先在台上了，那个笑点接不上，换成
             它自己撞上去。onPaperBonk 正好在这儿接那声「咚」。 */
          bug.squash = Math.max(bug.squash, 0.55);
          this.view.setExpression("dizzy");
          this.leaf.jolt(1);
          this._bonked = true;
          this.callbacks.onPaperBonk?.();
        }
      } else {
        bug.restT += dt;
        const since = t - ARRIVE_AT;
        if (since >= FACE_DELAY && bug.faceU < 1) {
          bug.faceU = clamp01((since - FACE_DELAY) / FACE_DUR);
          bug.yaw =
            this.rollYaw +
            wrapPi(bug.faceYaw - this.rollYaw) * easeOutCubic(bug.faceU);
          this.view.setYaw(bug.yaw);
        }
        if (!bug.blinked && t >= this.blinkAt) {
          bug.blinked = true;
          this.view.blink(true);
          this.callbacks.onGroupBlink?.();
        }
      }
      bug.squash = Math.max(0, bug.squash - dt * 2.4);
    }

    if (t >= this.finishAt && !this.finished) {
      this.finished = true;
      this.callbacks.onFinished?.();
    }

    /* --- 两条线，同一个时钟 ------------------------------------------------ *
     * 叶子的戏跨在 finishAt 两边（2.35 就开始展开，2.92 才 finishAt），所以
     * 它们不是「第二幕」—— 用绝对时间各走各的。虫子先算：它的 _propPush 是
     * 叶柄这一帧的落点，叶子读它。 */
    this._bugBeats(t);
    this._leafBeat(t, dt);

    /* --- feed the view ---------------------------------------------------- */
    if (this.view.group.visible) {
      const dx = bug.x - bug.prevX;
      const dvx = dt > 0 ? dx / dt : 0;
      bug.prevX = bug.x;

      /* 滚的时候如实报速度，adapter 自己就会把头和腿收回去变成球
       * （TableTiltInsectView 的 formBlend 本来就这么工作）—— 不需要为进场
       * 和退场各写一套姿态。坐着的时候报静止，免得它一动就重新缩壳。 */
      const rolling = !bug.arrived;
      if (rolling && Math.abs(dvx) > 0.01) {
        _dq.setFromAxisAngle(this.rollAxis, dx / VISUAL_R);
        bug.rspin.premultiply(_dq);
      }
      this.view.update(dt, elapsed, {
        x: this._worldX(bug.x),
        y: this.floorY + bug.lift,
        z: this._worldZ(bug.x),
        r: BUG_R,
        state: "roll",
        vx: rolling ? this.rightH.x * dvx : 0,
        vz: rolling ? this.rightH.z * dvx : 0,
        speed: rolling ? Math.abs(dvx) : 0,
        restT: bug.arrived ? bug.restT : 0,
        squash: bug.squash,
        rspin: bug.rspin,
        contactNormal: { x: 0, y: 1, z: 0 },
        flexY: 0,
      });
    }
  }

  /**
   * 虫子在叶子这条线上的几拍（撞上去那一下在第一幕里，见 ARRIVE_AT）。
   *
   * 看：叶子开始动了，它转头去看。
   * 撑：它凑着叶柄往右顶了一点，自己踮起来 —— 叶柄跟着走（_propPush）。
   * 读：展满了转回镜头，这句话是说给玩家听的，不是说给它自己听的。
   * 停：念完眨一下，然后什么都不做 —— 剩下的时间是留给那句话的。
   */
  _bugBeats(t) {
    const bug = this.bug;
    if (!bug.arrived) return;

    /* 转头看那片正在张开的叶子 */
    if (!this._looked && t >= LOOK_AT) {
      this._looked = true;
      this.view.setExpression("zoom");
      this.view.setYaw(this._yawToward(this.bladeX, LEAF_DEPTH));
    }

    /* 顶着叶柄往右撑：位移很小（0.16），但它和叶子必须是同一个位移 ——
       一个动一个不动，「贴着」就散了。 */
    if (t >= UNFURL_AT) {
      const k = clamp01((t - UNFURL_AT) / POSE_DUR);
      bug.lift = Math.sin(k * Math.PI) * NUDGE_RISE;
      this._propPush = easeInOutCubic(k) * PROP_PUSH;
      bug.x = STAND_X + this._propPush;
    }

    /* 展满了，转回来对着镜头 */
    if (!this._readFace && t >= FLAT_AT) {
      this._readFace = true;
      this.view.setYaw(bug.faceYaw);
      this.view.setExpression("happy");
    }
    /* 念完了，眨一下 */
    if (!this._readDone && this.readAt != null && t >= this.readAt) {
      this._readDone = true;
      this.view.blink(true);
      this.callbacks.onGroupBlink?.();
    }
  }

  /** 叶子自己的一条线：翻着掉下来 → 弹两下停住 → 被顶开 → 出字 → 散掉。 */
  _leafBeat(t, dt) {
    const leaf = this.leaf;
    if (!leaf || t < LEAF_FALL_AT) return;
    leaf.group.visible = true;
    /* 淡入。叶子是从画框上边缘进来的，硬切会「啪」地凭空出现在边上；两帧多一点
       的淡入就够骗过去。淡**出**不在这里 —— 交给 setDissolve，它是在贴图的 alpha
       上挖，不动材质 opacity（见 ending-leaf.js:setDissolve）。 */
    leaf.setOpacity(clamp01((t - LEAF_FALL_AT) / LEAF_FADE_IN));

    /* 叶柄尖端的落点。虫子撑过去的时候它跟着走 —— 它俩是贴着的。 */
    let x = PETIOLE_X + this._propPush;
    const restY = this.floorY + PETIOLE_H;
    let y = restY;
    let tumble = 0;

    if (t < LEAF_LAND_AT) {
      /* 自由落体，不是匀速 —— 匀速掉下来的东西没有重量。一片蜷成纺锤的叶子
         在空气里是打着转下来的。 */
      const k = clamp01((t - LEAF_FALL_AT) / LEAF_FALL_DUR);
      y = restY + LEAF_FALL_FROM * (1 - k * k);
      tumble = (1 - k) * 3.1;
    } else {
      /* 落地弹两下：|sin| 的包络随时间衰减，第二下明显比第一下矮。 */
      const k = clamp01((t - LEAF_LAND_AT) / LEAF_SETTLE_DUR);
      y = restY + Math.abs(Math.sin(k * Math.PI * 2)) * 0.3 * Math.pow(1 - k, 1.8);
      tumble = 0.4 * Math.pow(1 - k, 2.4);
    }

    /* 位姿：展开的前 POSE_DUR 秒里，从翘着的纺锤落到阅读角度、同时升起来。
       不跟满 3.1s —— 慢三秒的平移会变成飘，这段时间的主角是小叶。 */
    const pose = easeInOutCubic(clamp01((t - UNFURL_AT) / POSE_DUR));
    y += pose * READ_LIFT;
    const tilt = THREE.MathUtils.lerp(TILT_CURL, TILT_READ, pose);
    /* yaw 也跟着 pose 走。蜷成纺锤的时候它基本正对镜头（0.02），是展开这个动作
       把它转过去的 —— 一片叶子摊平的同时侧过来，比一开始就侧着待在那儿更像活的。 */
    const yaw = THREE.MathUtils.lerp(0.02, YAW_READ, pose);

    /* 一对一对张开，从叶根推到叶尖。setUnfurl 吃的是秒（见 ending-leaf.js）：
       每一对小叶有自己的起跑时间和自己的时长，用秒才对得上这张节拍表。 */
    leaf.setUnfurl(t - UNFURL_AT);

    /* 摊平之后一直在动：上下呼吸 + 左右轻摆。完全静止的东西看起来是贴在屏幕
       上的，不是长在空气里的。 */
    if (t >= FLAT_AT) {
      y += Math.sin((t - FLAT_AT) * 1.15) * 0.032;
      x += Math.sin((t - FLAT_AT) * 0.83 + 1.1) * 0.024;
    }

    /* 散掉。淡出交给 setDissolve（它同时把孢子催快、把光晕顶上去）。 */
    let vanish = 0;
    if (t >= this.vanishAt) {
      if (!this._fortuneVanished) {
        this._fortuneVanished = true;
        this.callbacks.onFortuneVanish?.();
      }
      vanish = clamp01((t - this.vanishAt) / VANISH_DUR);
      leaf.setDissolve(vanish);
      y += easeOutCubic(vanish) * VANISH_RISE;
    }

    this._placeLeaf(leaf.group.position, x, y);

    /* 朝向：掉下来的时候乱翻，落地之后稳成阅读角度。 */
    _q1.copy(this.camera.quaternion);
    if (tumble > 0.001) {
      _q2.setFromEuler(_e1.set(tumble * 1.3, tumble * 0.5, tumble * 2.1));
      _q1.multiply(_q2);
    }
    /* 不要正对镜头 —— 正对的平面读起来就是一块 UI 卡片。
     *
     * 但三个轴不是等价的。局部 x 就是叶轴，所以：
     *   绕 x（pitch）＝ 沿叶轴翻面。屏幕上那条线一动不动，可小叶是对称长在轴
     *     两边的，一起压扁，看得出来的只有远近两排那点透视差 —— 便宜，但单靠
     *     它撑不起「斜」。
     *   绕 y（yaw）＝ 一头远一头近，叶尖那半边明显收小。斜的读感主要来自它。
     *   绕 z（roll）＝ 叶轴在画面内的坡度，也就是「齐平」那条线。它同时抬构图：
     *     字挂在叶轴上，坡多少整行字就被抬多少。所以它不用来出斜度，只用来把
     *     yaw 带出的那 −1.7° 抵回去 —— 见 TILT_READ。
     *
     * 三条上都留了一点极慢的正弦，幅度都在一度上下：完全静止的东西看起来是贴在
     * 屏幕上的。z 上那一路收得最紧（±0.014 ≈ 0.8°，叶尖上不到 12px），因为它
     * 动的正是齐平的那条线。 */
    _q2.setFromEuler(
      _e1.set(
        PITCH_READ + Math.sin(t * 0.77) * 0.022,
        yaw + Math.sin(t * 0.53 + 2.1) * 0.018,
        tilt + Math.sin(t * 0.91 + 0.6) * 0.014
      )
    );
    leaf.group.quaternion.copy(_q1).multiply(_q2);

    leaf.setHaloGain(pose);
    leaf.update(dt, this.camera.quaternion);

    /* --- 签语 ------------------------------------------------------------ *
     * 位置跟叶子（沿叶轴量到字带中心，再往镜头这边提一点），朝向跟相机。
     * 所以叶子怎么斜、怎么呼吸、怎么升起，这一行字都跟着走，但永远是屏幕上
     * 水平的一整行 —— 上面那段注释里说的 yaw 梯形变形，在这儿是零。 */
    const words = this.words;
    if (words) {
      _v2.set(LEAF_DIMS.len * TEXT_U, 0, 0)
        .applyQuaternion(leaf.group.quaternion)
        .add(leaf.group.position)
        .addScaledVector(this.fwd, -TEXT_LIFT);
      words.place(_v2, this.camera.quaternion);
      /* 字不单独退场：跟着溶解一起走（面片没法被挖，所以是淡出）。 */
      words.setOpacity(leaf.opacity * (1 - vanish));
      /* 一个词一个词地洇出来。k 的单位是「词」：第 i 个词在 k=i 开始显影，用
         WORD_RAMP 个词的时间洇满 —— 相邻的词是叠着亮的，不是一个亮完下一个
         才开始。 */
      if (t >= WORD_AT) {
        if (!this._fortuneAppeared) {
          this._fortuneAppeared = true;
          this.callbacks.onFortuneAppear?.();
        }
        words.setReveal((t - WORD_AT) / WORD_STEP, WORD_RAMP, -1);
      }
    }
  }

  snapshot() {
    return {
      active: this.active,
      finished: this.finished,
      t: this.t,
      cast: this.spec.id,
      backdropOpacity: this.backdropMat.opacity,
      veilOpacity: this.veilMat.opacity,
      bugVisible: this.view.group.visible,
      bugArrived: this.bug.arrived,
      leafVisible: !!this.leaf?.group.visible,
      leafUnfurl: this.leaf ? this.leaf.unfurl : 0,
      leafWords: this.words ? this.words.count : 0,
      leafReveal: this.words ? this.words.reveal : 0,
      paperBonkPlayed: this._bonked === true,
      fortuneAppearPlayed: this._fortuneAppeared === true,
      fortuneVanishPlayed: this._fortuneVanished === true,
    };
  }

  dispose() {
    this.active = false;
    this.leaf?.dispose();
    this.leaf = null;
    this.words?.dispose();
    this.words = null;
    this.view.dispose();
    this.backdrop.geometry.dispose();
    this.backdropMat.dispose();
    this.backdropTex.dispose();
    this.veil.geometry.dispose();
    this.veilMat.dispose();
    this.group.removeFromParent();
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
