/**
 * MOSS TILT — 签语的字。
 *
 * 字曾经画在叶子的贴图里，于是它跟着叶面一起斜、一起被 uv 拉伸、还得躲开叶轴
 * 那道断口（所以只能排成骑在两侧的两行）。用户要的是另一件事：**一行，不换行，
 * 不跟着叶片倾斜**，就浮在叶子中段那一带（她在截图上框出来的那个位置），白色，
 * 带一点点光晕。
 *
 * 所以字从叶子里搬出来，自己成了一层：一块正对相机的 billboard。
 *   位置跟着叶子 —— 它属于这片叶子，叶子呼吸、被顶、升起、散掉，字都跟着走；
 *   朝向跟着相机 —— 所以叶片怎么斜，这一行字都是屏幕上水平的，透视一点不吃。
 * 一行字最难读的就是 yaw 带来的梯形变形（见 ending.js 里那段朝向的注释），
 * 现在它是零。
 *
 * 为什么仍然是场景里的一块面片，而不是一个 DOM 层：它要和叶子一起淡入、要被
 * 前面的虫子正确遮挡、要吃 postfx 的 bloom（「一点点光晕」有一半是它给的）、
 * 最后要跟着叶子一起被溶解带走。这几件里没有一件能在 DOM 里做对。
 *
 * 白字的可读性不靠给叶面打光（上一版在贴图里垫了两条透光带，把深绿的墨衬出来；
 * 白字要的是反过来的东西）—— 靠每个字自己带的一圈很淡的暗边。暗边在字底下，
 * 白字盖在上面，所以观众看到的是白，只有笔画外那一圈是压着的。
 */

import * as THREE from "three";

/* 画布：一行字，宽得离谱是故意的 —— 最长的那句签语有 49 个字符
   （"You cannot hurry a thing that is already falling."），一行放不下就只能缩字号，
   横向分辨率给足了缩完还是清楚的。高度只要装得下一个 em 加两侧的晕。 */
const TEX_W = 2048;
const TEX_H = 320;
/** 左右留白：光晕会往外糊 26px，被画布边裁掉会露出一条硬边。 */
const PAD = 56;

const FONT_STACK = 'Luminari, Herculanum, "Oracle Serif", Papyrus, serif';
/** 字距。比贴图那一版（0.03）紧一点 —— 一行要塞进框里，这里每一个百分点都是字号。 */
const TRACK = 0.015;
const FONT_MAX = 148;
const FONT_MIN = 34;
/**
 * 词间距，单位是 em —— **不用字体自带的空格**。
 *
 * Luminari 的空格只有 0.24em，画布上是 20px；这块 2048 宽的画布最后只占屏幕 700px，
 * 缩掉 2.9 倍之后那个空隙剩 7px，而白字外面那圈晕本身就有这么宽 —— 于是 "You cannot"
 * 糊成了一个词。字号已经顶到框宽了没法再放大，所以只能把词掰开：空格自己定，
 * 排版的宽度也用这个自定的空格去量（下面 setLine 里逐词累加，不再量整句）。
 */
const SPACE_EM = 0.38;

/* 光晕。比上一版弱：那时候是 emissiveMap 上两层 blur(17/6px)、halo 到 0.95，
   再加材质 0.55 的 emissiveIntensity 顶上去。现在只有一层 15px 的柔光、
   0.26 的峰值 —— 剩下的交给 postfx 的 bloom（阈值 0.80，纯白的笔画本来就过线）。
   收到 15px 还有第二个理由：晕糊得比词间距还宽的话，读到的就不是一行词而是一条光带。 */
const HALO_BLUR = 15;
const HALO_A = 0.26;
const HALO_RGB = "236,255,222";
/* 暗边：不是描边，是一圈糊开的影子。叶面从最浅的黄绿到最深的墨绿都有，白字要在
   两头都读得出来，靠的就是这一圈。糊得紧一点、压得深一点 —— 同样是为了别把词粘上。 */
const DARK_BLUR = 9;
const DARK_A = 0.56;

const clamp01 = (t) => Math.max(0, Math.min(1, t));

export class EndingWords {
  /**
   * @param {string} line   签语（一整句，不换行）
   * @param {number} width  面片在世界单位里的宽度 —— 也就是那个框的宽度
   */
  constructor(line, width) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    this.ctx = this.canvas.getContext("2d");

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      /* 不写深度：它挂在叶子前面一点，写了深度会把叶子自己的溶解和光晕切出一块
         方板的边。测深度还是要的 —— 虫子站在更前面，该挡住就得挡住。 */
      depthWrite: false,
      fog: false,
      /* 不吃 tone mapping：ACES 会把纯白压成灰白，而这一行必须是白的。
         backdrop 和 veil 出于同样的理由也是这么设的（见 ending.js）。 */
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, (width * TEX_H) / TEX_W),
      this.material
    );
    this.mesh.frustumCulled = false;
    /* 排在叶子（0）和它背后那层柔光（-1）之后。 */
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;

    this.words = [];
    this.fontSize = FONT_MAX;
    this.reveal = 0;
    this.ramp = 2.6;
    this.out = -1;
    this._drawn = null;

    this.setLine(line);
    /* Luminari 可能还没下载完；字体一到就得重排一次，否则整句是 fallback 的度量
       （字号是按度量倒推的，差一档就会出框）。 */
    document.fonts?.load('400 96px "Luminari"')?.then(() => {
      if (!this.material) return;
      this.setLine(this._line);
      this._paint();
    });
  }

  get count() {
    return this.words.length;
  }

  /**
   * 排一行。字号是**倒推**出来的：从 FONT_MAX 往下试，第一个整句宽度进框的就是它。
   * 短句子就大，最长的那句就小 —— 但永远是一行。
   */
  setLine(line) {
    const ctx = this.ctx;
    this._line = String(line || "");
    const raw = this._line.split(/\s+/).filter(Boolean);
    const measure = (px) => {
      ctx.font = `400 ${px}px ${FONT_STACK}`;
      ctx.letterSpacing = `${(TRACK * px).toFixed(2)}px`;
    };
    /* 用自定的空格量整行 —— 量的和画的必须是同一套加法，不然词会挤在一起。 */
    const runWidth = (px) => {
      measure(px);
      const gap = SPACE_EM * px;
      let w = 0;
      raw.forEach((word, i) => {
        w += ctx.measureText(word).width + (i ? gap : 0);
      });
      return w;
    };

    let size = FONT_MAX;
    for (; size > FONT_MIN; size -= 2) {
      if (runWidth(size) <= TEX_W - PAD * 2) break;
    }
    const total = runWidth(size);
    this.fontSize = size;

    /* 逐词显影要每个词自己的 x —— 一次算好，之后每帧只是照着写。 */
    const gap = SPACE_EM * size;
    let x = (TEX_W - total) / 2;
    this.words = [];
    raw.forEach((word, index) => {
      this.words.push({ text: word, x, index });
      x += ctx.measureText(word).width + gap;
    });
    this._drawn = null;
  }

  _alpha(word) {
    let a = clamp01((this.reveal - word.index) / this.ramp);
    if (this.out >= 0) a *= 1 - clamp01(this.out - word.index);
    return a;
  }

  /**
   * 显影到某个进度。
   *
   * @param {number} k     单位是「词」：第 i 个词从 k=i 开始显影
   * @param {number} ramp  一个词洇满要几个词的时间（>1 表示相邻的词叠着亮）
   * @param {number} out   褪字的进度，同样以「词」为单位；<0 表示还没开始褪
   */
  setReveal(k, ramp = 2.6, out = -1) {
    const next = Math.max(0, k);
    const nextRamp = Math.max(0.05, ramp);
    /* 每帧重画整张没必要 —— 1/100 个词以内的变化眼睛看不出来。 */
    const key = `${next.toFixed(2)}|${nextRamp.toFixed(2)}|${out.toFixed(2)}`;
    if (this._drawn === key) return;
    this._drawn = key;
    this.reveal = next;
    this.ramp = nextRamp;
    this.out = out;
    this._paint();
  }

  /** 一遍画完：每个词按自己的 alpha 画暗边 → 光晕 → 白字本体。 */
  _paint() {
    const ctx = this.ctx;
    const y = TEX_H / 2;
    ctx.clearRect(0, 0, TEX_W, TEX_H);
    ctx.save();
    ctx.font = `400 ${this.fontSize}px ${FONT_STACK}`;
    ctx.letterSpacing = `${(TRACK * this.fontSize).toFixed(2)}px`;
    ctx.textBaseline = "middle";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    for (const word of this.words) {
      const a = this._alpha(word);
      if (a <= 0.004) continue;

      /* 暗边。画的是字本身，但下一步白字会把它整块盖掉 —— 留在外面的只有那圈影子。 */
      ctx.globalAlpha = a * DARK_A;
      ctx.shadowColor = "rgba(4,12,7,0.95)";
      ctx.shadowBlur = DARK_BLUR;
      ctx.fillStyle = "rgba(5,14,8,0.9)";
      ctx.fillText(word.text, word.x, y);

      /* 光晕。跟着 a² 起来 —— 刚落笔那一阵还在洇，光会盖掉洇的层次。 */
      ctx.globalAlpha = a * a * HALO_A;
      ctx.shadowColor = `rgba(${HALO_RGB},1)`;
      ctx.shadowBlur = HALO_BLUR;
      ctx.fillStyle = `rgba(${HALO_RGB},0.55)`;
      ctx.fillText(word.text, word.x, y);

      /* 白字本体。刚出来的时候自己带一点糊（湿墨那个手法留着，只是墨变白了）。 */
      ctx.globalAlpha = a;
      ctx.shadowColor = "rgba(255,255,255,0.75)";
      ctx.shadowBlur = (1 - a) * 9;
      ctx.fillStyle = "#fff";
      ctx.fillText(word.text, word.x, y);
    }

    ctx.restore();
    this.texture.needsUpdate = true;
  }

  setOpacity(o) {
    const a = clamp01(o);
    this.material.opacity = a;
    this.mesh.visible = a > 0.002;
  }

  /** 位置跟叶子，朝向跟相机。 */
  place(position, quaternion) {
    this.mesh.position.copy(position);
    this.mesh.quaternion.copy(quaternion);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.material = null;
    this.mesh.removeFromParent();
  }
}

export default EndingWords;
