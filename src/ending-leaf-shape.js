/**
 * MOSS TILT — 签语叶的形状（纯几何，不碰 document）。
 *
 * 参考照片是一片**羽状复叶**（辣木那一类）：一根浅色的叶轴，左右五对圆头的
 * 倒卵形小叶，每片小叶自己带一小段浅色的小叶柄，末端再收一片顶生小叶。
 * 上一版的橡树叶是「一整块叶面 + 五个凹口」——那种做法在这里彻底不成立：
 * 复叶的小叶是**互不相连的独立叶片**，凹口再深也只是一块被咬缺的板子。
 *
 * 所以这一层重写成「一叶轴 + 11 片各自成形的小叶」。这么做还顺手换来了真的
 * 闭合动作：复叶收拢不是卷，是每片小叶绕叶轴**整片翻起来**（含羞草那种），
 * 这是一个刚体旋转，弧长天生守恒，比卷曲更好看也更便宜。
 *
 * 这里所有的量都在**摊平的叶子空间**里（世界单位）：
 *   x 沿叶轴，0 = 叶柄尖端（甲虫顶上来的那一点），LEAF_LEN = 顶生小叶的尖；
 *   y 是到叶轴的带符号距离；贴图就是这个平面上一块不变形的矩形。
 * 形变（翻起、横卷、起伏）全部是从这个平面出发算的 —— 贴图和网格共用同一个
 * 参数化，边缘才不会露出画布的直角。
 */

/* --- 尺寸 ---------------------------------------------------------------- */
export const LEAF_LEN = 4.6;
/** 叶轴到最远的小叶尖。贴图 v 的分母留一点余量（叶缘还有起伏）。 */
export const LEAF_HALF_W = 0.86;
export const MAX_HALF = 0.92;

/** 裸叶柄占前 15% —— 它不长小叶，甲虫顶的就是这一段。 */
export const PETIOLE_U = 0.15;
/** 叶轴半宽（世界单位）。叶柄那头略粗。 */
const RACHIS_HALF = 0.052;
const PETIOLE_SWELL = 1.55;
/** 叶轴到这里为止，之后是顶生小叶。 */
export const RACHIS_END_U = 0.875;

/* 五对侧生小叶，等距排在叶轴上。间距是照着「相邻两片在字带那一段必须**在 x 上
   重叠**」定的 —— 签语是一整张页面空间的贴图，字跨过两片小叶的缝就断了。
   照片里相邻的小叶本来就是搭在一起的，所以这不是为了迁就排版而编的形状。 */
const PAIRS = 5;
const PAIR_U0 = 0.255;
const PAIR_DU = 0.147;
/** 小叶尺寸沿叶轴的梯度：中间那对最大，两头收 —— 复叶都是这个长法。 */
const LEAFLET_GAIN = [0.9, 1.0, 1.05, 0.99, 0.86];
const LEAFLET_LEN = 0.72;
const LEAFLET_HALF = 0.44;
const PETIOLULE = 0.095;
/** 前倾角（rad，从垂直于叶轴往叶尖偏）。越靠尖偏得越多，读出来是「朝前长」。 */
const RAKE0 = 0.16;
const RAKE_STEP = 0.035;
/** 顶生小叶：比最后一对稍大一点，正对叶轴的方向长。 */
const TERMINAL_GAIN = 0.82;

/* --- 展开的时序 ----------------------------------------------------------
 * 一片（一对）小叶自己翻开要 OWN 秒，相邻两对错开 STAGGER 秒。左右同序号，
 * 天然成对 —— 这就是「成对展开、从根到尖」。总时长和橡树叶那版**一模一样**，
 * 导演那边的节拍表一个数都不用动。 */
const STAGGER = 0.45;
const OWN = 0.85;
export const UNFURL_SPAN = PAIRS * STAGGER + OWN; // 3.10

/* --- 闭合 ----------------------------------------------------------------
 * 绕叶轴翻起的最大角。刚过垂直一点点：小叶立起来、稍稍往对面倒，观众看到的是
 * 一排浅色的叶背，剪影是一根细纺锤。再往里倒（150° 以上）左右两侧的叶尖会穿
 * 到一起 —— 真叶子是互相插着的，网格穿模却是看得出来的假。两侧给不同的角度，
 * 尖不落在同一个高度，交错的那一小段就藏住了。 */
const FOLD_MAX_P = 1.94; // +y 侧，111°
const FOLD_MAX_N = 1.70; // −y 侧，97°
/** 摊平之后也不是一块板：每片小叶自己带一点抬角（真叶子沿叶轴是一道浅槽）。 */
const REST_TILT = 0.055;
/** 每片小叶自己还要横着卷一点 —— 光靠翻起，闭合的时候叶面还是一片片的平板。 */
const CURL_MAX = 2.6;
const CURL_TERMINAL = 3.4;
const CURL_D0 = 0.035;
const CURL_ANGLE_MAX = 6.5;

/* --- 字 ------------------------------------------------------------------
 * 字带落在小叶**外侧**那一圈（|y| 大的地方）：那里相邻小叶重叠得最多，一行字
 * 跨过去是连着的。叶轴那一带（|y| 小）反而是断的 —— 小叶基部窄、中间还夹着
 * 一根光叶轴，字压上去会被切成一段一段。所以签语是两行、骑在叶轴两侧，
 * 上下各一行，中间那根浅色的轴正好读作分隔。
 * tests/ending-leaf 会把这个框逐点扫一遍，确认每一点都真的有叶肉在下面。 */
const TEXT_U0 = 0.235;
const TEXT_U1 = 0.885;
const TEXT_D0 = 0.375;
const TEXT_D1 = 0.665;

const clamp01 = (t) => Math.max(0, Math.min(1, t));
export const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** 确定性小噪声 —— 同一片叶子每次都长成同一个样子。 */
export function hash11(n) {
  const s = Math.sin(n * 78.233 + 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/* 叶缘的碎边。小叶比整片橡树叶小得多，振幅也要跟着小，不然圆头会变成锯齿。 */
const deckle = (t, seed) =>
  0.004 * Math.sin(t * 23 + seed * 4.1) +
  0.0026 * Math.sin(t * 51 + seed * 12.3) +
  0.0018 * Math.sin(t * 97 + seed * 28.7);

/**
 * 小叶的宽度剖面：τ∈[0,1] 沿它自己的中脉（0 = 基部，1 = 叶尖）→ 0..1。
 *
 * 倒卵形，最宽落在 τ≈0.72（照片里就是上宽下窄的圆头）。尖端那一段用高次的
 * (1−τ⁶) 收 —— 低次会收成一根针，圆头才是这个品种的辨识点。
 */
export function leafletShape(tau) {
  if (tau <= 0 || tau >= 1) return 0;
  return (Math.pow(tau, 0.36) * Math.pow(1 - Math.pow(tau, 6), 0.34)) / 0.845;
}

/**
 * 小叶清单。一片小叶一条 —— 五对是 10 条（side ±1），加一片顶生。
 * `pair` 是展开的序号（0..5），左右同号，所以成对是结构上就成立的。
 */
export const LEAFLETS = Object.freeze(
  (() => {
    const out = [];
    for (let i = 0; i < PAIRS; i++) {
      const gain = LEAFLET_GAIN[i];
      const u = PAIR_U0 + i * PAIR_DU;
      for (const side of [1, -1]) {
        out.push(
          Object.freeze({
            pair: i,
            side,
            terminal: false,
            u,
            x: u * LEAF_LEN,
            len: LEAFLET_LEN * gain,
            halfW: LEAFLET_HALF * gain,
            petiolule: PETIOLULE,
            /* 前倾。左右各自加一点点差别 —— 严格镜像的复叶一眼就假。 */
            rake: RAKE0 + i * RAKE_STEP + (side > 0 ? 0.012 : -0.014),
            seed: i * 3.7 + (side > 0 ? 0 : 1.9),
          })
        );
      }
    }
    out.push(
      Object.freeze({
        pair: PAIRS,
        side: 1,
        terminal: true,
        u: RACHIS_END_U,
        x: RACHIS_END_U * LEAF_LEN,
        len: LEAFLET_LEN * TERMINAL_GAIN,
        halfW: LEAFLET_HALF * TERMINAL_GAIN,
        petiolule: PETIOLULE * 0.75,
        /* 顶生小叶顺着叶轴长：rake = π/2 让 m 正好是 +x。 */
        rake: Math.PI / 2,
        seed: 11.3,
      })
    );
    return out;
  })()
);

/** 小叶在 τ 处的半宽（世界单位，含叶缘的起伏）。 */
export function leafletHalf(spec, tau) {
  const w = spec.halfW * leafletShape(tau);
  if (w <= 0) return 0;
  return Math.max(0, w + deckle(tau, spec.seed) * spec.halfW * 2.4);
}

/**
 * 摊平时的一点。
 *
 * 小叶自己的正交基：m 是它的中脉方向，q 是横向。
 *   m = (sin rake, side·cos rake)   q = (side·cos rake, −sin rake)
 * 基部先沿 m 走一小段 petiolule（那截浅色的小叶柄），叶面从那儿开始。
 *
 * @param {number} tau  0..1 沿中脉
 * @param {number} bn   −1..1 横向（±1 = 叶缘）
 */
export function leafletFlat(spec, tau, bn, out = { x: 0, y: 0 }) {
  const mx = Math.sin(spec.rake);
  const my = spec.side * Math.cos(spec.rake);
  const a = spec.petiolule + tau * spec.len;
  const b = bn * leafletHalf(spec, tau);
  out.x = spec.x + a * mx + b * (spec.side * Math.cos(spec.rake));
  out.y = a * my + b * -Math.sin(spec.rake);
  return out;
}

/** 小叶柄那一小段（贴图要单独画成浅色）。 */
export function petioluleFlat(spec, k, out = { x: 0, y: 0 }) {
  const a = spec.petiolule * clamp01(k);
  out.x = spec.x + a * Math.sin(spec.rake);
  out.y = a * spec.side * Math.cos(spec.rake);
  return out;
}

/**
 * 摊平的叶子空间里这一点有没有叶肉。
 *
 * 反解每片小叶自己的 (a, b)：a = v·m，b = v·q，落在 0≤a≤len 且 |b|≤半宽里就算
 * 盖住。字框就是靠这条逐点验的 —— 一个字伸到两片小叶的缝里，读出来就是断的。
 */
export function leafCovers(x, y) {
  for (const spec of LEAFLETS) {
    const sr = Math.sin(spec.rake);
    const cr = Math.cos(spec.rake);
    const mx = sr;
    const my = spec.side * cr;
    const vx = x - (spec.x + spec.petiolule * mx);
    const vy = y - spec.petiolule * my;
    const a = vx * mx + vy * my;
    if (a < 0 || a > spec.len) continue;
    const b = vx * (spec.side * cr) + vy * -sr;
    if (Math.abs(b) <= leafletHalf(spec, a / spec.len)) return true;
  }
  return false;
}

/** 叶轴的半宽：叶柄那头粗，往叶尖渐细。 */
export function rachisHalfAt(u) {
  const t = clamp01(u / RACHIS_END_U);
  const swell = u < PETIOLE_U ? 1 + (PETIOLE_SWELL - 1) * (1 - u / PETIOLE_U) : 1;
  return RACHIS_HALF * swell * (1.08 - 0.5 * t);
}

/** 某一对小叶在 t 秒时张开到哪儿。0 = 全闭，1 = 全开。 */
export function leafUnfurlAt(pair, t) {
  return clamp01((t - pair * STAGGER) / OWN);
}

/**
 * 绕叶轴翻起的角度（rad）。p=0 全闭（立起来），p=1 摊平（只剩一点抬角）。
 * 每片小叶的终点和起点都带一点自己的偏差 —— 一排角度完全一致的小叶是「算出
 * 来的」最响的破绽。
 */
export function foldAngleAt(spec, p) {
  if (spec.terminal) return 0; // 顶生小叶不翻，它靠自己横着卷（见 curlAcross）
  const max = spec.side > 0 ? FOLD_MAX_P : FOLD_MAX_N;
  /* 抖动只往小的方向走：FOLD_MAX 是硬上限，再翻过去两侧的叶尖会互相穿插。 */
  const jitter = 1 - hash11(spec.seed * 5.3) * 0.14;
  const rest = REST_TILT * (0.55 + hash11(spec.seed * 2.1));
  return (1 - p) * max * jitter + p * rest;
}

/**
 * 把摊平的 (y, z) 绕叶轴（x 轴）转 θ。side 决定往哪边转，两侧都朝 +z 抬。
 * 纯刚体旋转 —— |(y,z)| 严格守恒，所以小叶是**翻起来**的，不是被拉长或压扁。
 */
export function foldPoint(y, z, side, cos, sin, out = { y: 0, z: 0 }) {
  out.y = y * cos - side * z * sin;
  out.z = side * y * sin + z * cos;
  return out;
}

/**
 * 横截面上的一点：把摊平的横向距离 d 绕一条平行中脉的轴卷起来。
 *
 * R = 1/curl，s 是超出硬边 D0 的那段弧长，于是
 *   w = D0 + R·sin(s/R)      横向
 *   n = R·(1 − cos(s/R))     法向（两侧都朝 +z）
 * 弧长按定义守恒：√((dw/ds)² + (dn/ds)²) ≡ 1。所以叶面是卷开的，不是涨开的。
 * curl → 0 时退化成恒等，用线性分支避开 1/0。
 */
export function curlAcross(d, curl, out = { w: 0, n: 0 }) {
  const ad = Math.abs(d);
  const flat = Math.min(ad, CURL_D0);
  const s = ad - flat;
  if (!(curl > 1e-4)) {
    /* 直接还 d，不要拿 flat + s 重新拼——那样会带进浮点误差，摊平态就不是恒等了。 */
    out.w = d;
    out.n = 0;
    return out;
  }
  const R = 1 / curl;
  const a = Math.min(s * curl, CURL_ANGLE_MAX);
  out.w = (d < 0 ? -1 : 1) * (flat + R * Math.sin(a));
  out.n = R * (1 - Math.cos(a));
  return out;
}

/** 这一片小叶最蜷时的曲率。 */
export function curlOf(spec, p) {
  return (spec.terminal ? CURL_TERMINAL : CURL_MAX) * (1 - p);
}

/**
 * 摊开之后每片小叶自己的静止起伏 —— 关键是它不是平的。
 * 叶缘往观众这一侧微翘、顺自己的中脉略塌、两头一点扭。
 */
export function restRelief(tau, nb, seed = 0) {
  const nt = tau * 2 - 1;
  /* 每片小叶是一只很浅的碗：两侧叶缘往观众这边翘、中脉这一带略塌。这一层是「立体」
     的主力 —— 只靠贴图的法线，光是均匀铺在一块平板上的，怎么画都还是贴纸。 */
  const lift = 0.085 * nb * nb;
  const sag = -0.05 * (1 - nt * nt);
  const twist = 0.026 * nt * nb * (1 + hash11(seed) * 0.6);
  /* 叶尖自己往下坠一点，而且每片坠得不一样多 —— 11 片共面才是最假的地方。 */
  const droop = -0.06 * tau * tau * (0.55 + hash11(seed * 7.7));
  return lift + sag + twist + droop;
}

export const LEAF_DIMS = Object.freeze({
  len: LEAF_LEN,
  halfWidth: LEAF_HALF_W,
  maxHalf: MAX_HALF,
  petioleU: PETIOLE_U,
  rachisEndU: RACHIS_END_U,
  pairs: PAIRS,
  leaflets: LEAFLETS.length,
  /* 字带的中心。导演拿它算「虫子该往哪儿看」和光晕挂在哪儿。 */
  bladeCentreU: (TEXT_U0 + TEXT_U1) / 2,
  unfurlSpan: UNFURL_SPAN,
  /* 字框换算到叶子空间：u 的两端，和到叶轴的距离区间（世界单位，两侧对称）。
     贴图是按 v = 0.5 + y/(2·MAX_HALF) 铺的。 */
  textU: Object.freeze([TEXT_U0, TEXT_U1]),
  textD: Object.freeze([TEXT_D0, TEXT_D1]),
  /* 两行字各自的中心线（到叶轴的带符号距离）。骑在叶轴两侧。 */
  lineD: Object.freeze([(TEXT_D0 + TEXT_D1) / 2, -(TEXT_D0 + TEXT_D1) / 2]),
  lineBand: TEXT_D1 - TEXT_D0,
  foldMax: Math.max(FOLD_MAX_P, FOLD_MAX_N),
});
