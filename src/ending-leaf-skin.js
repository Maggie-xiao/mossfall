/**
 * MOSS TILT — 签语叶的皮（贴图、溶解）。
 *
 * 一张画布铺满整片摊平的复叶：叶轴、11 片小叶、叶脉、斑驳。几何和这张图共用同一个
 * 参数化（见 ending-leaf-shape.js），所以叶缘永远不会露出画布的直角。
 *
 * 字**不在这张图上**。它曾经在（连排版、显影、逐字的光晕都在这里），但那样字就
 * 跟着叶面一起斜、一起被 uv 拉伸、还得躲开叶轴那道断口。现在它是自己一层正对
 * 相机的面片，见 ending-words.js。
 *
 * 三张图，都是同一套 uv：
 *   texture     —— 颜色 + alpha（溶解就是往这张的 alpha 上挖）
 *   normalMap   —— 从一张单独画的高度场做 Sobel 得来。这是「立体」的真来源：
 *                  叶脉、叶缘、叶肉的颗粒会真的吃场景里的光，而不是画上去的
 *                  一层假高光。
 *   emissiveMap —— 叶子本身很淡的自发光（像被背光透着）。
 *
 * 高度场和颜色是**同一段绘制代码**跑两遍，只换一套调色板 —— 这样凹凸和明暗
 * 不可能对不上（分两处画迟早会漂）。
 */

import * as THREE from "three";

import {
  LEAFLETS,
  LEAF_LEN,
  MAX_HALF,
  RACHIS_END_U,
  hash11,
  leafletFlat,
  leafletHalf,
  petioluleFlat,
  rachisHalfAt,
} from "./ending-leaf-shape.js";

/* 画布按世界单位等比：横 1792/4.6 = 389.6 px/单位，纵 716/1.84 = 389.1。
   两个方向必须一致，差一点点字就会被拉扁 —— 上一版 1600×900 差了 38%。 */
const TEX_W = 1792;
const TEX_H = 716;
const PPU_X = TEX_W / LEAF_LEN;
const PPU_Y = TEX_H / (2 * MAX_HALF);

/* 法线贴图和自发光图都是半分辨率：它们是低频的，省一半内存和一半绘制时间。 */
const HALF_W = TEX_W / 2;
const HALF_H = TEX_H / 2;
/** Sobel 出来的斜率放大多少。太大叶脉会像铁丝。 */
const NORMAL_STRENGTH = 2.6;

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
const css = (c, a = 1) =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

/** 高度场那一遍的「调色板」：灰度就是高度，0.5 是叶面。 */
const HEIGHT_PAL = {
  height: true,
  body: "#7d7d7d",
  bodyLo: "#6a6a6a",
  bodyHi: "#8c8c8c",
  back: "#747474",
  pale: "#a6a6a6",
  paleHi: "#d2d2d2",
  veinBody: "#c4c4c4",
  veinHi: "#eaeaea",
  veinShadow: "#3f3f3f",
  rim: "#2f2f2f",
  fibreA: "#909090",
  fibreB: "#6c6c6c",
  blotch: "#868686",
  fleck: "#9a9a9a",
  nick: "#3a3a3a",
};

export class LeafSkin {
  constructor(zone) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    this.ctx = this.canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    const top = new THREE.Color(zone.leafTop);
    const grey = new THREE.Color().setScalar(
      0.2126 * top.r + 0.7152 * top.g + 0.0722 * top.b
    );
    const body = top.clone().lerp(grey, 0.2).lerp(new THREE.Color(0x1b2a17), 0.14);
    const back = new THREE.Color(zone.leafBack).lerp(body, 0.3);
    this.pal = {
      height: false,
      body: css(body),
      bodyLo: css(body.clone().multiplyScalar(0.34)),
      bodyHi: css(body.clone().lerp(new THREE.Color(0xe6f4c4), 0.22)),
      back: css(back),
      /* 叶轴和小叶柄是浅黄绿的 —— 照片里最显眼的一条线就是它。 */
      pale: css(mix(body, 0xd6e8a4, 0.6)),
      paleHi: css(mix(body, 0xf2ffd4, 0.82)),
      veinBody: css(mix(body, 0xd8eca6, 0.42)),
      veinHi: css(mix(body, 0xf1ffcd, 0.72)),
      veinShadow: css(mix(body, 0x0b1d0e, 0.52)),
      rim: css(mix(body, 0x0e2109, 0.62)),
      fibreA: "#e8f4cf",
      fibreB: "#1d3a22",
      blotch: css(mix(body, 0x92843e, 0.5)),
      fleck: "rgb(120,101,42)",
      nick: "rgb(24,34,16)",
    };

    this.vanishF = 0;

    /* 叶脉的路径只算一次：颜色和高度两遍都照着同一份走。 */
    this._veins = this._buildVeins();

    this.base = document.createElement("canvas");
    this.base.width = TEX_W;
    this.base.height = TEX_H;
    this._paint(this.base.getContext("2d"), this.pal);

    this.normalMap = this._buildNormal();

    this.glow = document.createElement("canvas");
    this.glow.width = HALF_W;
    this.glow.height = HALF_H;
    this.emissiveMap = new THREE.CanvasTexture(this.glow);
    this.emissiveMap.colorSpace = THREE.SRGBColorSpace;

    this.ctx.drawImage(this.base, 0, 0);
    this._paintGlow();
    this.texture.needsUpdate = true;
  }

  /* --- 坐标 --------------------------------------------------------------- */
  /** 摊平叶子空间的 x（世界单位）→ 画布 px。 */
  _px(x) {
    return x * PPU_X;
  }

  /** 到叶轴的带符号距离 → 画布 px。CanvasTexture 默认 flipY，所以这里要翻。 */
  _py(y) {
    return (0.5 - y / (2 * MAX_HALF)) * TEX_H;
  }

  /* --- 轮廓 --------------------------------------------------------------- */
  /** 一片小叶的闭合轮廓。几何用的是同一个 leafletFlat，边界严格对齐。 */
  _leafletPath(ctx, spec, inset = 1) {
    const N = 44;
    const p = { x: 0, y: 0 };
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      leafletFlat(spec, i / N, inset, p);
      const x = this._px(p.x);
      const y = this._py(p.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = N; i >= 0; i--) {
      leafletFlat(spec, i / N, -inset, p);
      ctx.lineTo(this._px(p.x), this._py(p.y));
    }
    ctx.closePath();
  }

  _rachisPath(ctx) {
    const N = 60;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * RACHIS_END_U;
      const x = this._px(u * LEAF_LEN);
      const y = this._py(rachisHalfAt(u));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = N; i >= 0; i--) {
      const u = (i / N) * RACHIS_END_U;
      ctx.lineTo(this._px(u * LEAF_LEN), this._py(-rachisHalfAt(u)));
    }
    ctx.closePath();
  }

  /* --- 叶脉 --------------------------------------------------------------- */
  /**
   * 每片小叶：一条中脉 + 七对羽状侧脉 + 一层很淡的细网。
   * 全部先算成画布 px 的折线，颜色和高度两遍共用。
   */
  _buildVeins() {
    const out = [];
    const p = { x: 0, y: 0 };
    const pt = (spec, tau, bn) => {
      leafletFlat(spec, tau, bn, p);
      return [this._px(p.x), this._py(p.y)];
    };
    for (const spec of LEAFLETS) {
      const scale = spec.halfW / 0.44;
      /* 中脉：从小叶柄一直推到叶尖，渐细。 */
      const mid = [];
      for (let i = 0; i <= 18; i++) mid.push(pt(spec, i / 18, 0));
      out.push({ p: mid, w: 5.4 * scale, taper: true });

      /* 侧脉。羽状脉是**一离开中脉就带着角度**的一条近直线，末端在叶缘内侧收住。
       *
       * 上一版让横向坐标按 f^0.72 冲到 0.94：出脉几乎垂直于中脉，后半段又贴着
       * 叶缘平行地跑，画出来是一圈套一圈的同心弧 —— 像贝壳，不像叶子。这里换成
       * 近线性（f 的一次项占大头），并且**左右不成对**：真叶子的侧脉是互生的，
       * 严格镜像的那种「羽毛图案」是这张贴图之前最假的一处。 */
      const PAIRS_V = 6;
      for (let k = 1; k <= PAIRS_V; k++) {
        for (const bn of [1, -1]) {
          const j = hash11(spec.seed * 3.7 + k * 11.3 + (bn > 0 ? 0 : 5.1));
          const t0 = 0.12 + ((k - 0.5 + (j - 0.5) * 0.6) / PAIRS_V) * 0.78;
          /* 收在叶缘里侧：真叶子的侧脉不撞边，末端拐进一圈内缘脉里。 */
          const reach = 0.68 + j * 0.17;
          const t1 = Math.min(0.97, t0 + 0.19 + 0.045 * k);
          const seg = [];
          for (let i = 0; i <= 7; i++) {
            const f = i / 7;
            const tau = t0 + (t1 - t0) * f;
            const b = bn * reach * (f * 0.84 + f * f * 0.16);
            seg.push(pt(spec, tau, b));
          }
          out.push({ p: seg, w: (2.05 - k * 0.09) * scale, taper: false });
          /* 细网：侧脉之间横着连两笔，这一层几乎看不见，但没有它叶面是空的。 */
          for (let n = 0; n < 2; n++) {
            const f = 0.42 + n * 0.3;
            const tau = t0 + (t1 - t0) * f;
            const b = bn * reach * (f * 0.84 + f * f * 0.16);
            const net = [
              pt(spec, tau, b),
              pt(spec, tau + 0.05 + hash11(k * 3.1 + n) * 0.03, b * 0.74),
            ];
            out.push({ p: net, w: 1.05 * scale, net: true });
          }
        }
      }
    }
    return out;
  }

  /* --- 一遍绘制（颜色 / 高度共用）----------------------------------------- */
  _paint(ctx, P) {
    ctx.save();
    if (P.height) {
      /* 高度场是半分辨率，缩一半就能沿用同一套 px 坐标。 */
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, HALF_W, HALF_H);
      ctx.scale(0.5, 0.5);
    } else {
      ctx.clearRect(0, 0, TEX_W, TEX_H);
    }

    /* 叶轴先画，让小叶压住它的边 —— 真复叶就是小叶盖在轴上。 */
    this._paintRachis(ctx, P);
    /* 从叶根往叶尖画：靠尖的小叶叠在靠根的上面，像瓦一样。 */
    for (const spec of LEAFLETS) this._paintLeaflet(ctx, spec, P);
    this._paintVeins(ctx, P);
    ctx.restore();
  }

  _paintRachis(ctx, P) {
    ctx.save();
    this._rachisPath(ctx);
    ctx.clip();
    const y0 = this._py(0.14);
    const y1 = this._py(-0.14);
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, P.veinShadow);
    g.addColorStop(0.34, P.paleHi);
    g.addColorStop(0.62, P.pale);
    g.addColorStop(1, P.veinShadow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    /* 叶柄那一段更深一点：它离光远，也提示这是「往下走」的一截。 */
    const gx = ctx.createLinearGradient(0, 0, this._px(LEAF_LEN * RACHIS_END_U), 0);
    gx.addColorStop(0, css(new THREE.Color(0x000000), P.height ? 0.28 : 0.34));
    gx.addColorStop(0.22, "rgba(0,0,0,0)");
    ctx.fillStyle = gx;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.restore();

    /* 小叶柄：每片小叶根上那一小段浅色的柄。 */
    ctx.save();
    ctx.lineCap = "round";
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    for (const spec of LEAFLETS) {
      petioluleFlat(spec, 0, a);
      petioluleFlat(spec, 1.04, b);
      /* 宽度是跟着几何来的：小叶柄在 ending-leaf.js 里是一条 STALK_HALF 的窄网格，
         这一笔必须比它宽，否则那截柄的边上会露出叶轴底色。 */
      ctx.strokeStyle = P.veinShadow;
      ctx.lineWidth = 15.5;
      ctx.beginPath();
      ctx.moveTo(this._px(a.x) + 1.6, this._py(a.y) + 2.4);
      ctx.lineTo(this._px(b.x) + 1.6, this._py(b.y) + 2.4);
      ctx.stroke();
      ctx.strokeStyle = P.pale;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(this._px(a.x), this._py(a.y));
      ctx.lineTo(this._px(b.x), this._py(b.y));
      ctx.stroke();
    }
    ctx.restore();
  }

  _paintLeaflet(ctx, spec, P) {
    const p = { x: 0, y: 0 };
    leafletFlat(spec, 0.5, 0, p);
    const cx = this._px(p.x);
    const cy = this._py(p.y);
    const rx = this._px(spec.len) * 0.8;

    ctx.save();
    this._leafletPath(ctx, spec);
    ctx.clip();

    /* 底色：沿自己的中脉从基部的暗往叶尖的亮走，横向再压一层「中间亮、边缘暗」
       的圆筒明暗 —— 一片小叶自己就是一个微微鼓起的曲面。 */
    leafletFlat(spec, 0, 0, p);
    const bx = this._px(p.x);
    const by = this._py(p.y);
    leafletFlat(spec, 1, 0, p);
    const g = ctx.createLinearGradient(bx, by, this._px(p.x), this._py(p.y));
    g.addColorStop(0, P.bodyLo);
    g.addColorStop(0.34, P.body);
    g.addColorStop(0.78, P.bodyHi);
    g.addColorStop(1, P.back);
    ctx.fillStyle = g;
    ctx.fillRect(cx - rx * 2, cy - rx * 2, rx * 4, rx * 4);

    const r = ctx.createRadialGradient(cx, cy, rx * 0.1, cx, cy, rx * 1.15);
    r.addColorStop(0, "rgba(255,255,255,0.14)");
    r.addColorStop(0.62, "rgba(0,0,0,0)");
    r.addColorStop(1, "rgba(0,0,0,0.2)");
    ctx.fillStyle = r;
    ctx.fillRect(cx - rx * 2, cy - rx * 2, rx * 4, rx * 4);

    /* 斑驳：老斑、透光的亮块、一点阴影。位置是 hash 定死的。 */
    for (let i = 0; i < 5; i++) {
      const s = spec.seed * 7.3 + i * 2.9;
      leafletFlat(spec, 0.15 + hash11(s) * 0.78, (hash11(s + 1.7) - 0.5) * 1.5, p);
      const br = this._px(spec.len) * (0.1 + hash11(s + 3.3) * 0.2);
      const pick = i % 3;
      const blob = ctx.createRadialGradient(
        this._px(p.x), this._py(p.y), 0, this._px(p.x), this._py(p.y), br
      );
      const tint =
        pick === 0 ? P.blotch : pick === 1 ? P.back : P.height ? "#6f6f6f" : "rgb(20,40,24)";
      blob.addColorStop(0, P.height ? tint : css(new THREE.Color(tint), 1));
      blob.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = P.height ? 0.16 : 0.24;
      ctx.fillStyle = blob;
      ctx.fillRect(this._px(p.x) - br, this._py(p.y) - br, br * 2, br * 2);
    }
    ctx.globalAlpha = 1;

    /* 叶肉的颗粒：一层极淡的短纤维，顺着侧脉的方向。它撑起「近看也不是一块
       塑料」，也是法线里最细的那一档。 */
    ctx.globalAlpha = P.height ? 0.035 : 0.05;
    ctx.lineWidth = 1;
    for (let i = 0; i < 190; i++) {
      const s = spec.seed * 11.1 + i * 1.7;
      const tau = 0.04 + hash11(s) * 0.93;
      const bn = (hash11(s + 4.1) - 0.5) * 1.86;
      leafletFlat(spec, tau, bn, p);
      const x0 = this._px(p.x);
      const y0 = this._py(p.y);
      leafletFlat(spec, tau + 0.03, bn * 0.86, p);
      ctx.strokeStyle = i % 2 ? P.fibreA : P.fibreB;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(this._px(p.x), this._py(p.y));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* 叶缘：不规则地压暗一圈。宽窄随 τ 变，读出来是薄边卷起的暗影，不是描边。 */
    ctx.strokeStyle = P.rim;
    ctx.lineCap = "round";
    const STEP = 46;
    for (const bn of [1, -1]) {
      for (let i = 0; i < STEP; i++) {
        const t0 = i / STEP;
        const env = clamp01(
          0.5 +
            0.3 * Math.sin(t0 * 19 + spec.seed) +
            0.18 * Math.sin(t0 * 41 + spec.seed * 2.2)
        );
        leafletFlat(spec, t0, bn, p);
        const x0 = this._px(p.x);
        const y0 = this._py(p.y);
        leafletFlat(spec, (i + 1) / STEP, bn, p);
        ctx.globalAlpha = (P.height ? 0.7 : 1) * (0.1 + 0.3 * env);
        ctx.lineWidth = 3 + 13 * env;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(this._px(p.x), this._py(p.y));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    /* 几个干斑和虫咬。一片没有破损的叶子看着就是渲染出来的。 */
    for (let i = 0; i < 7; i++) {
      const s = spec.seed * 3.9 + i * 5.1;
      leafletFlat(spec, 0.12 + hash11(s) * 0.84, (hash11(s + 2.3) - 0.5) * 1.7, p);
      const fr = 1.4 + hash11(s + 6.1) * 3.4;
      ctx.globalAlpha = 0.1 + hash11(s + 8.3) * 0.22;
      ctx.fillStyle = P.fleck;
      ctx.beginPath();
      ctx.arc(this._px(p.x), this._py(p.y), fr, 0, Math.PI * 2);
      ctx.fill();
    }
    if (hash11(spec.seed * 17.3) > 0.55) {
      const s = spec.seed * 23.7;
      leafletFlat(spec, 0.3 + hash11(s) * 0.6, hash11(s + 1.1) > 0.5 ? 1.05 : -1.05, p);
      ctx.globalCompositeOperation = P.height ? "source-over" : "multiply";
      ctx.globalAlpha = P.height ? 1 : 0.6;
      ctx.fillStyle = P.nick;
      ctx.beginPath();
      ctx.arc(this._px(p.x), this._py(p.y), 5 + hash11(s + 3.7) * 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * 叶脉的「棱」：三笔错位叠出来 —— 右下一道影、中间本体、左上一道高光。
   * 光的方向全局一致（左上），所以这一层读出来是凸起，不是画上去的线。
   * 高度场那一遍只画本体（灰度就是高度，影和高光交给 Sobel 去生成）。
   */
  _paintVeins(ctx, P) {
    const line = (pts, dx, dy, width, style, alpha, blur = 0) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = style;
      ctx.lineWidth = Math.max(0.7, width);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (blur > 0) ctx.filter = `blur(${blur.toFixed(1)}px)`;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
      ctx.stroke();
      ctx.restore();
    };
    const taper = (pts, w, style, alpha, dx = 0, dy = 0) => {
      for (let i = 1; i < pts.length; i++) {
        const k = 1 - (i - 1) / pts.length;
        line([pts[i - 1], pts[i]], dx, dy, w * (0.3 + 0.7 * k), style, alpha);
      }
    };
    for (const v of this._veins) {
      if (v.net) {
        if (P.height) line(v.p, 0, 0, v.w, P.veinBody, 0.3);
        else {
          line(v.p, 0.8, 1.2, v.w * 1.6, P.veinShadow, 0.15, 1.5);
          line(v.p, -0.4, -0.6, v.w, P.veinHi, 0.24);
        }
        continue;
      }
      /* 高度场这一遍比颜色淡：normalScale 在 ending-leaf.js 里是 1.55，脉再刻深
         一点整片叶子就成了铁丝网。中脉该凸，侧脉只是「摸得出来」。 */
      if (P.height) {
        if (v.taper) taper(v.p, v.w, P.veinBody, 0.8);
        else line(v.p, 0, 0, v.w, P.veinBody, 0.5);
        continue;
      }
      if (v.taper) {
        taper(v.p, v.w * 1.5, P.veinShadow, 0.3, 1.5, 2.7);
        taper(v.p, v.w, P.veinBody, 0.52);
        taper(v.p, v.w * 0.44, P.veinHi, 0.62, -1.1, -1.9);
      } else {
        line(v.p, 1.4, 2.4, v.w * 1.55, P.veinShadow, 0.24, v.w * 0.5);
        line(v.p, 0, 0, v.w, P.veinBody, 0.42);
        line(v.p, -1, -1.7, v.w * 0.46, P.veinHi, 0.46);
      }
    }
  }

  /* --- 法线 --------------------------------------------------------------- */
  /**
   * 高度场 → 法线贴图。Sobel 求斜率，法线 = normalize(−dh/du, −dh/dv, 1)。
   * 画布的 y 朝下、贴图的 v 朝上（flipY），所以 dv 那一项要反号。
   * three 没有 tangent 属性时用屏幕空间导数推切线，够用。
   */
  _buildNormal() {
    const h = document.createElement("canvas");
    h.width = HALF_W;
    h.height = HALF_H;
    this._paint(h.getContext("2d"), HEIGHT_PAL);
    const src = h.getContext("2d").getImageData(0, 0, HALF_W, HALF_H).data;

    const out = document.createElement("canvas");
    out.width = HALF_W;
    out.height = HALF_H;
    const octx = out.getContext("2d");
    const img = octx.createImageData(HALF_W, HALF_H);
    const dst = img.data;
    const at = (x, y) => {
      const cx = x < 0 ? 0 : x >= HALF_W ? HALF_W - 1 : x;
      const cy = y < 0 ? 0 : y >= HALF_H ? HALF_H - 1 : y;
      return src[(cy * HALF_W + cx) * 4] / 255;
    };
    for (let y = 0; y < HALF_H; y++) {
      for (let x = 0; x < HALF_W; x++) {
        const dx =
          at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
        const dy =
          at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
        const nx = -dx * NORMAL_STRENGTH;
        const ny = dy * NORMAL_STRENGTH;
        const inv = 1 / Math.hypot(nx, ny, 1);
        const i = (y * HALF_W + x) * 4;
        dst[i] = (nx * inv * 0.5 + 0.5) * 255;
        dst[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
        dst[i + 2] = (inv * 0.5 + 0.5) * 255;
        dst[i + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    const texture = new THREE.CanvasTexture(out);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  }

  /* --- 自发光 ------------------------------------------------------------- */
  /**
   * 自发光图：叶面自己很淡的一层，像被背光透着。
   *
   * 一处非直觉的地方是被 three 的 emissiveMap 语义逼出来的：先铺一层不透明的黑、
   * 再半透明地画叶面（而不是直接 globalAlpha 0.1 画在透明画布上），因为自发光只读
   * RGB、完全不看 alpha —— 画在透明底上 alpha 是 0.1 但 RGB 还是满值，等于没减。
   */
  _paintGlow() {
    const ctx = this.glow.getContext("2d");
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, HALF_W, HALF_H);
    /* 0.1 是「叶肉透一点光」，不是「叶子在发光」。 */
    ctx.globalAlpha = 0.1;
    ctx.drawImage(this.base, 0, 0, HALF_W, HALF_H);
    ctx.globalAlpha = 1;
    this.emissiveMap.needsUpdate = true;
  }

  /**
   * 溶解到 f（0 = 完整，1 = 没了）。
   *
   * 每一步都要「重画底子 → 再挖」：挖是破坏性的，没法在同一张画布上往回退。
   * 20fps 够了（阈值 0.05）。
   */
  setVanish(f) {
    const next = clamp01(f);
    if (Math.abs(next - this.vanishF) < 0.05 && next < 1 && next > 0) return;
    this.vanishF = next;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, TEX_W, TEX_H);
    ctx.drawImage(this.base, 0, 0);
    if (this.vanishF > 0) this._applyVanish(this.vanishF);
    this.texture.needsUpdate = true;
  }

  /** 一块带 alpha 的噪声。遮罩是靠 alpha 起作用的（destination-out 只看
   *  alpha），所以千万不能给它铺底色 —— 铺了整张就是不透明的，等于没有。 */
  _noise() {
    if (this._noiseCanvas) return this._noiseCanvas;
    const NW = 220;
    const NH = Math.round((NW * TEX_H) / TEX_W);
    const c = document.createElement("canvas");
    c.width = NW;
    c.height = NH;
    const ctx = c.getContext("2d");
    /* 大小两层斑点：大的定「先破哪儿」，小的把边缘打碎，不然锋线是一条直线 */
    for (const [count, rMin, rMax, alpha] of [
      [150, 0.025, 0.09, 0.95],
      [460, 0.006, 0.03, 0.85],
    ]) {
      for (let i = 0; i < count; i++) {
        const x = hash11(i * 3.1 + rMin * 97) * NW;
        const y = hash11(i * 7.7 + rMax * 53) * NH;
        const r = NW * (rMin + hash11(i * 5.3) * (rMax - rMin));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,255,255,${alpha})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    const spare = () => {
      const t = document.createElement("canvas");
      t.width = NW;
      t.height = NH;
      return t;
    };
    this._noiseCanvas = c;
    this._scratch = spare();
    this._scratch2 = spare();
    this._band = spare();
    return c;
  }

  /** 锋线的位置。f=0 在左边界外，f≈0.86 时走过右边界。 */
  _front(f) {
    return f * 1.35 - 0.16;
  }

  /**
   * 某个进度下「已经没了」的区域（alpha 越高＝越没了）。
   *
   * 锐化用的是「把同一张噪声叠画 6 次」：alpha 按 1-(1-a)^6 走，高的很快到 1、
   * 低的还是低 —— 一条便宜的阈值曲线，不用写 shader。
   */
  _maskAt(f, into) {
    const noise = this._noise();
    const nw = noise.width;
    const nh = noise.height;
    const c = into.getContext("2d");
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, nw, nh);
    for (let i = 0; i < 6; i++) c.drawImage(noise, 0, 0);
    c.globalCompositeOperation = "destination-in";
    const front = this._front(f);
    const g = c.createLinearGradient(0, 0, nw, 0);
    /* 锋线要窄。宽了就成了「左半边整体变淡」，碎边全被平均掉。 */
    g.addColorStop(clamp01(front - 0.07), "rgba(0,0,0,1)");
    g.addColorStop(clamp01(front + 0.11), "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, nw, nh);
    c.globalCompositeOperation = "source-over";
    return into;
  }

  /**
   * 只有方向、不带噪声的遮罩。噪声遮罩的 alpha 永远到不了 1（叠 6 次 0.3 也
   * 才 0.88），锋线后面会留一层半透的膜；用它在后面再抹一道。
   */
  _fieldAt(f, into) {
    const nw = into.width;
    const nh = into.height;
    const c = into.getContext("2d");
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, nw, nh);
    const front = this._front(f);
    const g = c.createLinearGradient(0, 0, nw, 0);
    g.addColorStop(clamp01(front - 0.07), "rgba(0,0,0,1)");
    g.addColorStop(clamp01(front + 0.11), "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, nw, nh);
    return into;
  }

  /** 挖掉已经没了的部分，并在锋线那一条带上描一道光。 */
  _applyVanish(f) {
    const ctx = this.ctx;
    this._noise();
    const nw = this._band.width;
    const nh = this._band.height;

    /* 锋线 = 当前遮罩减去稍早的遮罩。拿整个已消失区域去发光的话是一团雾，
       不是一道边。 */
    const now = this._maskAt(f, this._scratch);
    const bc = this._band.getContext("2d");
    bc.globalCompositeOperation = "source-over";
    bc.clearRect(0, 0, nw, nh);
    bc.drawImage(now, 0, 0);
    bc.globalCompositeOperation = "destination-out";
    bc.drawImage(this._maskAt(Math.max(0, f - 0.1), this._scratch2), 0, 0);
    bc.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.9 * Math.sin(clamp01(f) * Math.PI);
    ctx.filter = "blur(7px)";
    ctx.drawImage(this._band, 0, 0, TEX_W, TEX_H);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(this._maskAt(f, this._scratch), 0, 0, TEX_W, TEX_H);
    ctx.drawImage(this._fieldAt(f - 0.07, this._scratch2), 0, 0, TEX_W, TEX_H);
    ctx.restore();
  }

  dispose() {
    this.texture.dispose();
    this.normalMap.dispose();
    this.emissiveMap.dispose();
  }
}

export default LeafSkin;
