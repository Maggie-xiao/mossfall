/**
 * MOSS TILT — 谢幕第二幕的道具：一片**羽状复叶**（签语落在它前面）。
 *
 * 为什么是 3D 网格而不是一个 DOM 层：这一幕里镜头是冻住的，但叶子要吃场景的
 * 区域光、雾和 bloom，要和虫子有正确的前后遮挡，最后还要溶成孢子飘走。这些没有
 * 一件能在 DOM 里做对 —— 一个 overlay 会立刻暴露「它不在那个世界里」。
 *
 * 形状照的是用户给的那张照片：一根浅色的叶轴，左右五对圆头的倒卵形小叶，
 * 各带一小段浅色的小叶柄，末端一片顶生小叶。纯几何在 ending-leaf-shape.js，
 * 贴图 / 溶解在 ending-leaf-skin.js；这个文件只管把它们变成网格。
 * 签语的字**不在这片叶子上** —— 它是自己一层正对相机的面片，见 ending-words.js。
 *
 * 闭合和展开的做法：每片小叶**绕叶轴整片翻起来**（含羞草那种），外加它自己一点
 * 横向的卷。翻起是绕 x 轴的刚体旋转，所以到叶轴的距离严格守恒 —— 小叶是翻开的，
 * 不是被拉长或涨大的；而且左右镜像是结构上成立的，不是靠两边各排一次时序。
 * 逐顶点插值「蜷缩位置 → 摊平位置」在这里是彻底错的：那条直线会让小叶先缩向
 * 叶轴再涨回来，读出来是「充气」。
 *
 * 每一对左右同序号，所以「成对展开、从根到尖」是免费的（leafUnfurlAt）。
 * 总时长 UNFURL_SPAN 和上一版一模一样，ending.js 的节拍表一个数都不用动。
 */

import * as THREE from "three";
import { zoneFor } from "./mossfall/data/palette.js";

import { LeafSkin } from "./ending-leaf-skin.js";
import {
  LEAFLETS,
  LEAF_DIMS,
  LEAF_HALF_W,
  LEAF_LEN,
  MAX_HALF,
  RACHIS_END_U,
  UNFURL_SPAN,
  curlAcross,
  curlOf,
  foldAngleAt,
  hash11,
  leafCovers,
  leafUnfurlAt,
  leafletHalf,
  rachisHalfAt,
  restRelief,
  smoothstep,
} from "./ending-leaf-shape.js";

export {
  LEAFLETS,
  LEAF_DIMS,
  UNFURL_SPAN,
  curlAcross,
  foldAngleAt,
  leafCovers,
  leafUnfurlAt,
};

/* 网格。横向（卷的方向）要够密才卷得圆，纵向（沿小叶中脉）稀一点没关系。
   11 片 × 16 × 20 ≈ 3.5k 顶点，和上一版一个量级。 */
const ALONG = 18;
const ACROSS = 20;
/** 前四排是小叶柄那一小段（τ ≤ 0）——柄跟着小叶一起翻，物理上就该这样。 */
const STALK_ROWS = 4;
/** 小叶柄的半宽（世界单位）。要略宽于贴图上画的那一笔，边缘才不露白。 */
const STALK_HALF = 0.016;
const RACHIS_COLS = 46;
const RACHIS_ROWS = 6;

/* 震动：一个欠阻尼谐振子，约 0.55s 衰完。甲虫「咚」一下顶在叶柄上就是它起振。 */
const JOLT_OMEGA = 18;
const JOLT_ZETA = 0.3;
const JOLT_SWING = 0.19;
const JOLT_RIPPLE = 0.16;
const RIPPLE_K = 9.5;
const RIPPLE_SPEED = 11;

/* 线性光下的亮度归一。THREE.Color 存的是线性值，各层的 leafTop 明暗差好几档，
   直接拿去当 material.color 会有的层白得发光、有的层黑成一块。 */
const TARGET_LUM = 0.17;
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const zoneDim = (leafTop) =>
  Math.max(0.25, Math.min(1, TARGET_LUM / Math.max(0.02, lum(new THREE.Color(leafTop)))));
const clamp01 = (t) => Math.max(0, Math.min(1, t));

/* 自发光。叶肉在 emissiveMap 里只有 0.1，所以这一档顶上去是「叶片被背光透着」，
 * 不是「叶子在发光」。字自己那点光归 ending-words.js 管，不再从这里加档 ——
 * 上一版字画在这张贴图上，得靠 emissiveIntensity 把字顶亮，整片叶子跟着一起亮。 */
const EMISSIVE_FRONT = 0.4;
const EMISSIVE_BACK = 0.16;

/** 叶片自己的一点起伏（τ<0 是柄，不参与）。 */
const bladeHalf = (spec, tau) =>
  tau <= 0
    ? STALK_HALF
    : Math.max(leafletHalf(spec, tau), STALK_HALF * (1 - clamp01(tau / 0.05)));

export class EndingLeaf {
  constructor(zoneIndex = 0) {
    this.zone = zoneFor(zoneIndex);
    this.group = new THREE.Group();
    this.group.name = "endingLeaf";
    this.group.visible = false;

    this.unfurlT = 0;
    this.opacity = 0;
    this._t = 0;
    this.haloGain = 0;
    this.dissolve = 0;
    this.joltX = 0;
    this.joltV = 0;
    this._joltActive = false;
    this._dirty = true;

    this.skin = new LeafSkin(this.zone);
    this._buildGeometry();

    const dim = zoneDim(this.zone.leafTop);
    const shared = {
      map: this.skin.texture,
      normalMap: this.skin.normalMap,
      emissiveMap: this.skin.emissiveMap,
      metalness: 0,
      transparent: true,
      opacity: 0,
      emissive: new THREE.Color(0xffffff),
    };
    this.materialFront = new THREE.MeshStandardMaterial({
      ...shared,
      side: THREE.FrontSide,
      /* 叶面是有蜡质的 —— 全糙（0.9+）看起来像纸，留一点镜面反射，脉络之间那些
         微鼓的小格才会各自挑一点高光出来。 */
      roughness: 0.79,
      color: new THREE.Color().setScalar(dim),
      /* 法线的强度：叶脉要凸得看得见，但不能变成铁丝。 */
      normalScale: new THREE.Vector2(1.55, 1.55),
      emissiveIntensity: EMISSIVE_FRONT,
    });
    /* 叶背单独一个材质：蜷着的时候观众看到的主要就是它，它得是叶背的浅色。
       共用同一张贴图，所以溶解的挖除对两面自动生效，不用写第二套。 */
    const backTint = new THREE.Color(this.zone.leafBack).lerp(new THREE.Color(0xffffff), 0.34);
    backTint.multiplyScalar((dim * 1.12) / Math.max(0.02, lum(backTint)));
    this.materialBack = new THREE.MeshStandardMaterial({
      ...shared,
      side: THREE.BackSide,
      roughness: 1,
      color: backTint,
      normalScale: new THREE.Vector2(-1.55, -1.55),
      emissiveIntensity: EMISSIVE_BACK,
    });

    this.swing = new THREE.Group();
    this.group.add(this.swing);
    for (const material of [this.materialFront, this.materialBack]) {
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      this.swing.add(mesh);
    }

    /* 字带后面挂一层朝着相机的柔光，和萤火那几层同一个调子。 */
    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(LEAF_LEN * 1.7, LEAF_LEN * 1.7),
      new THREE.MeshBasicMaterial({
        map: makeHaloTexture(this.zone.glow),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
    this.halo.position.set(LEAF_LEN * LEAF_DIMS.bladeCentreU, 0, -0.35);
    this.halo.renderOrder = -1;
    this.group.add(this.halo);

    this.motes = makeMotes(this.zone.moteColor || 0xffe9a8);
    this.group.add(this.motes.points);

    this._rebuild();
  }

  /* --- 网格 --------------------------------------------------------------- */
  /**
   * 11 片小叶 + 一根叶轴，各自一片规则网格，合进同一个 BufferGeometry。
   * 顶点不跨片共用 —— 它们本来就是**互不相连的独立叶片**，共用了法线会被平均，
   * 重叠处就成了一块糊在一起的板子。
   *
   * 每个顶点存的是它在摊平叶子空间里的静态参数（a、b、τ、归一化横距），每帧的
   * 形变是从这些参数重新算的，不是从上一帧的位置推的。
   */
  _buildGeometry() {
    const patches = [];
    let count = 0;
    for (let i = 0; i < LEAFLETS.length; i++) {
      patches.push({ blade: i, nI: ALONG, nJ: ACROSS, base: count, flip: true });
      count += ALONG * ACROSS;
    }
    patches.push({ blade: -1, nI: RACHIS_COLS, nJ: RACHIS_ROWS, base: count, flip: false });
    count += RACHIS_COLS * RACHIS_ROWS;

    const uv = new Float32Array(count * 2);
    const a = new Float32Array(count);
    const b = new Float32Array(count);
    const tau = new Float32Array(count);
    const nb = new Float32Array(count);
    const blade = new Int8Array(count);
    const fx = new Float32Array(count);
    const fy = new Float32Array(count);
    const rz = new Float32Array(count);
    const indices = [];

    const setUV = (k, x, y) => {
      uv[k * 2] = x / LEAF_LEN;
      uv[k * 2 + 1] = clamp01(0.5 + y / (2 * MAX_HALF));
    };

    for (const patch of patches) {
      /* 索引：绕向要让 FrontSide 朝 +z（摊平时正对相机）。 */
      for (let i = 0; i < patch.nI - 1; i++) {
        for (let j = 0; j < patch.nJ - 1; j++) {
          const p0 = patch.base + i * patch.nJ + j;
          const p1 = p0 + 1;
          const p2 = p0 + patch.nJ;
          const p3 = p2 + 1;
          if (patch.flip) indices.push(p0, p1, p2, p1, p3, p2);
          else indices.push(p0, p2, p1, p2, p3, p1);
        }
      }

      if (patch.blade < 0) {
        /* 叶轴：一根朝相机微鼓的半圆柱。叶柄那头略粗（甲虫顶的就是那一点）。 */
        for (let i = 0; i < RACHIS_COLS; i++) {
          const u = (i / (RACHIS_COLS - 1)) * RACHIS_END_U;
          const half = rachisHalfAt(u);
          for (let j = 0; j < RACHIS_ROWS; j++) {
            const t = (j / (RACHIS_ROWS - 1)) * 2 - 1;
            const k = patch.base + i * RACHIS_ROWS + j;
            fx[k] = u * LEAF_LEN;
            fy[k] = t * half;
            rz[k] = half * 0.85 * Math.sqrt(Math.max(0, 1 - t * t));
            blade[k] = -1;
            setUV(k, fx[k], fy[k]);
          }
        }
        continue;
      }

      const spec = LEAFLETS[patch.blade];
      const stalkTau = -spec.petiolule / spec.len;
      const mx = Math.sin(spec.rake);
      const my = spec.side * Math.cos(spec.rake);
      const qx = spec.side * Math.cos(spec.rake);
      const qy = -Math.sin(spec.rake);
      for (let i = 0; i < ALONG; i++) {
        /* τ 的取样：柄占前四排（末排正好落在 τ=0，和叶面接上）；叶面那一段用余弦
           分布，两头密中间疏。两头都必须密：leafletShape 在 τ→0 和 τ→1 都是
           分数次幂，斜率无穷大，均匀取样会把圆钝的基部和叶尖都削成尖角。 */
        let t;
        if (i < STALK_ROWS) t = stalkTau * (1 - i / (STALK_ROWS - 1));
        else {
          const q = (i - STALK_ROWS + 1) / (ALONG - STALK_ROWS);
          t = 0.5 - 0.5 * Math.cos(Math.PI * q);
        }
        const half = bladeHalf(spec, t);
        const av = spec.petiolule + t * spec.len;
        for (let j = 0; j < ACROSS; j++) {
          const n = (j / (ACROSS - 1)) * 2 - 1;
          const k = patch.base + i * ACROSS + j;
          a[k] = av;
          b[k] = n * half;
          tau[k] = clamp01(t);
          nb[k] = n;
          blade[k] = patch.blade;
          fx[k] = spec.x + av * mx + b[k] * qx;
          fy[k] = av * my + b[k] * qy;
          setUV(k, fx[k], fy[k]);
        }
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.position);
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    this.geometry.setIndex(indices);
    this._count = count;
    this._a = a;
    this._b = b;
    this._tau = tau;
    this._nb = nb;
    this._blade = blade;
    this._fx = fx;
    this._fy = fy;
    this._rz = rz;
    /* 每片小叶一行的每帧查表：翻起的角度、卷的曲率、朝向。 */
    this._table = LEAFLETS.map((spec, i) => ({
      spec,
      side: spec.side,
      mx: Math.sin(spec.rake),
      my: spec.side * Math.cos(spec.rake),
      qx: spec.side * Math.cos(spec.rake),
      qy: -Math.sin(spec.rake),
      /* 靠尖的小叶叠在靠根的上面，像瓦一样 —— 重叠处才有个稳定的前后。 */
      lift: 0.005 * spec.pair + (spec.side > 0 ? 0.002 : 0),
      seed: spec.seed,
      p: 0,
      curl: 0,
      cos: 1,
      sin: 0,
      relief: 0,
      _i: i,
    }));
  }

  /* --- 接口 --------------------------------------------------------------- */
  setUnfurl(t) {
    const next = Math.max(0, t);
    if (Math.abs(next - this.unfurlT) < 1e-4) return;
    this.unfurlT = next;
    this._dirty = true;
  }

  get unfurl() {
    return clamp01(this.unfurlT / UNFURL_SPAN);
  }

  /** 甲虫「咚」一下顶在叶柄上。 */
  jolt(strength = 1) {
    this.joltV += 26 * clamp01(strength);
    this._joltActive = true;
  }

  setOpacity(o) {
    this.opacity = clamp01(o);
    this.materialFront.opacity = 0.95 * this.opacity;
    this.materialBack.opacity = 0.95 * this.opacity;
  }

  setHaloGain(g) {
    this.haloGain = clamp01(g);
  }

  setDissolve(f) {
    this.dissolve = clamp01(f);
    this.skin.setVanish(this.dissolve);
  }

  update(dt, cameraQuat) {
    this._t += dt;

    if (this._joltActive && dt > 0) {
      /* 固定小步长积分：dt 抖一下不能让振幅跟着抖。 */
      const steps = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 120))));
      const sdt = dt / steps;
      const k = JOLT_OMEGA * JOLT_OMEGA;
      const c = 2 * JOLT_ZETA * JOLT_OMEGA;
      for (let i = 0; i < steps; i++) {
        this.joltV += (-k * this.joltX - c * this.joltV) * sdt;
        this.joltX += this.joltV * sdt;
      }
      if (Math.abs(this.joltX) < 1.5e-3 && Math.abs(this.joltV) < 1.5e-2) {
        this.joltX = 0;
        this.joltV = 0;
        this._joltActive = false;
        this.swing.quaternion.identity();
      } else {
        _e.set(0, 0, this.joltX * JOLT_SWING, "XYZ");
        _e.x = this.joltX * JOLT_SWING * 0.45;
        this.swing.quaternion.setFromEuler(_e);
      }
      this._dirty = true;
    }
    if (this._dirty) this._rebuild();

    /* 叶子的自发光很慢地起伏一下 —— 光是「活的」，不是加了个常数。 */
    const breathe = 1 + 0.17 * Math.sin(this._t * 1.5);
    const fade = 1 - this.dissolve * 0.55;
    this.materialFront.emissiveIntensity =
      EMISSIVE_FRONT * this.opacity * breathe * fade;
    this.materialBack.emissiveIntensity =
      EMISSIVE_BACK * this.opacity * breathe * fade;

    const d = this.dissolve;
    this.halo.material.opacity =
      this.opacity * this.haloGain * (0.34 + 0.06 * Math.sin(this._t * 1.9)) +
      Math.sin(clamp01(d) * Math.PI) * 0.3 * this.haloGain;
    const moteGain =
      this.haloGain * Math.max(this.opacity, Math.sin(clamp01(d) * Math.PI) * 1.5);
    this.motes.update(dt, moteGain, 1 + d * 3.5);

    if (cameraQuat) {
      this.halo.quaternion.copy(cameraQuat).premultiply(_inv.copy(this.group.quaternion).invert());
    }
  }

  /**
   * 一帧的形变。
   *
   * 每片小叶：先在自己的平面里算横向的卷（curlAcross，保弧长），加上摊开后自己的
   * 静止起伏，再把 (y, z) 整体绕叶轴转 θ。最后那一步是刚体旋转 —— 到叶轴的距离
   * 严格不变，所以这是「翻开」而不是「拉开」。叶轴自己不翻，只吃震动的波纹。
   */
  _rebuild() {
    this._dirty = false;
    const arr = this.position.array;
    const T = this.unfurlT;
    const rippleAmp = this.joltX * JOLT_RIPPLE;
    const ripplePh = this._t * RIPPLE_SPEED;

    for (const row of this._table) {
      row.p = leafUnfurlAt(row.spec.pair, T);
      row.curl = curlOf(row.spec, row.p);
      const theta = foldAngleAt(row.spec, row.p);
      row.cos = Math.cos(theta);
      row.sin = Math.sin(theta);
    }

    for (let k = 0; k < this._count; k++) {
      const i3 = k * 3;
      const bi = this._blade[k];
      const x = this._fx[k];
      const ripple =
        rippleAmp === 0
          ? 0
          : rippleAmp * Math.sin((x / LEAF_LEN) * RIPPLE_K - ripplePh) *
            smoothstep(x / LEAF_LEN / 0.35);
      if (bi < 0) {
        arr[i3] = x;
        arr[i3 + 1] = this._fy[k];
        arr[i3 + 2] = this._rz[k] + ripple;
        continue;
      }
      const row = this._table[bi];
      curlAcross(this._b[k], row.curl, _cross);
      const av = this._a[k];
      const fy = av * row.my + _cross.w * row.qy;
      const fz =
        _cross.n +
        row.p * restRelief(this._tau[k], this._nb[k], row.seed) +
        row.lift;
      arr[i3] = row.spec.x + av * row.mx + _cross.w * row.qx;
      arr[i3 + 1] = fy * row.cos - row.side * fz * row.sin;
      arr[i3 + 2] = row.side * fy * row.sin + fz * row.cos + ripple;
    }

    this.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose() {
    this.geometry?.dispose();
    this.materialFront.dispose();
    this.materialBack.dispose();
    this.skin.dispose();
    this.halo.geometry.dispose();
    this.halo.material.map?.dispose();
    this.halo.material.dispose();
    this.motes.dispose();
    this.group.parent?.remove(this.group);
    this.geometry = null;
  }
}

function makeHaloTexture(tint = 0xffe9a8) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = new THREE.Color(tint);
  const rgb = `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${rgb}, 0.5)`);
  g.addColorStop(0.42, `rgba(${rgb}, 0.16)`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 叶子周围慢慢往上飘的一层孢子。 */
function makeMotes(tint) {
  const COUNT = 90;
  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    /* 沿叶面铺开，不是绕原点 —— 原点在叶柄尖上。 */
    pos[i * 3] = LEAF_LEN * (0.15 + hash11(i * 1.3) * 0.95);
    pos[i * 3 + 1] = (hash11(i * 2.7 + 5) - 0.5) * LEAF_HALF_W * 3.2;
    pos[i * 3 + 2] = (hash11(i * 4.1 + 9) - 0.5) * 0.7;
    vel[i] = 0.06 + hash11(i * 6.7) * 0.16;
  }
  const geometry = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", attr);
  const material = new THREE.PointsMaterial({
    size: 0.075,
    map: makeMoteTexture(),
    color: tint,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const top = LEAF_HALF_W * 1.8;
  return {
    points,
    update(dt, gain, rush = 1) {
      material.opacity = 0.55 * clamp01(gain);
      if (gain <= 0.001) return;
      const arr = attr.array;
      for (let i = 0; i < COUNT; i++) {
        arr[i * 3 + 1] += vel[i] * rush * dt;
        if (arr[i * 3 + 1] > top) arr[i * 3 + 1] = -top;
      }
      attr.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
  };
}

function makeMoteTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.4, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const _inv = new THREE.Quaternion();
const _e = new THREE.Euler();
const _cross = { w: 0, n: 0 };

export default EndingLeaf;
