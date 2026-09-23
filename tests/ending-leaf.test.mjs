/**
 * 签语叶的几何（src/ending-leaf-shape.js）。
 *
 * 这一层的测试全程不碰 document —— 叶面是一张 canvas 贴图，Node 里画不出来，
 * 但**形状**和**展开的时序**是纯函数，那才是这一幕会坏的地方：小叶一挪位置签语就
 * 断在缝上，翻起一写歪就从「舒展」变成「充气」，时序一改就不再是成对的了。
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  LEAFLETS,
  LEAF_DIMS,
  LEAF_LEN,
  UNFURL_SPAN,
  curlAcross,
  curlOf,
  foldAngleAt,
  foldPoint,
  leafCovers,
  leafUnfurlAt,
  leafletFlat,
  leafletHalf,
  leafletShape,
} from "../src/ending-leaf-shape.js";

const clamp01 = (t) => Math.max(0, Math.min(1, t));

test("复叶是五对小叶加一片顶生，左右严格镜像", () => {
  assert.equal(LEAFLETS.length, 11);
  assert.equal(LEAF_DIMS.leaflets, 11);
  assert.equal(LEAF_DIMS.pairs, 5);

  const terminal = LEAFLETS.filter((s) => s.terminal);
  assert.equal(terminal.length, 1, "只能有一片顶生小叶");
  assert.equal(terminal[0].pair, LEAF_DIMS.pairs);

  for (let pair = 0; pair < LEAF_DIMS.pairs; pair++) {
    const both = LEAFLETS.filter((s) => s.pair === pair && !s.terminal);
    assert.equal(both.length, 2, `第 ${pair} 对应该正好两片`);
    const [right, left] = both;
    assert.equal(right.side, 1);
    assert.equal(left.side, -1);
    /* 同一对必须长在叶轴的同一点上、同样大——不然「成对展开」看起来是错位的。 */
    assert.equal(right.u, left.u);
    assert.equal(right.x, left.x);
    assert.equal(right.len, left.len);
    assert.equal(right.halfW, left.halfW);
  }
});

test("小叶沿叶轴单调外移，中段最大、两头略小", () => {
  const pairs = [];
  for (let pair = 0; pair < LEAF_DIMS.pairs; pair++) {
    pairs.push(LEAFLETS.find((s) => s.pair === pair && s.side === 1));
  }
  for (let i = 1; i < pairs.length; i++) {
    assert.ok(pairs[i].u > pairs[i - 1].u, `第 ${i} 对必须比上一对更靠叶尖`);
  }
  assert.ok(pairs[0].u > LEAF_DIMS.petioleU, "第一对不能长在叶柄上");
  assert.ok(
    pairs[pairs.length - 1].u < LEAF_DIMS.rachisEndU,
    "最后一对必须在顶生小叶之前"
  );

  /* 真的复叶不是一根等宽的梳子：中间几对最大。 */
  const widths = pairs.map((s) => s.halfW);
  const widest = widths.indexOf(Math.max(...widths));
  assert.ok(widest >= 1 && widest <= 3, `最宽的一对应该在中段，实际第 ${widest} 对`);
  assert.ok(widths[0] < widths[widest]);
  assert.ok(widths[widths.length - 1] < widths[widest]);
});

test("小叶是倒卵形：两端收拢，最宽点偏向叶尖", () => {
  assert.equal(leafletShape(0), 0);
  assert.ok(leafletShape(1) < 1e-9, "叶尖必须收口，否则贴图边缘会露出直角");

  let peakTau = 0;
  let peak = 0;
  for (let i = 1; i < 1000; i++) {
    const tau = i / 1000;
    const v = leafletShape(tau);
    if (v > peak) {
      peak = v;
      peakTau = tau;
    }
  }
  assert.ok(peak > 0.97 && peak <= 1.02, `峰值应归一到 1 附近，实际 ${peak.toFixed(3)}`);
  assert.ok(peakTau > 0.55 && peakTau < 0.85, `倒卵形的最宽点应偏叶尖，实际 ${peakTau}`);
});

/* 这一条是整套排版的地基。复叶大部分面积是空的，签语要是压在小叶之间的缝上，
   字就断成两半。所以两条字带上的每一点都必须落在某片小叶的实处。 */
test("两条字带全程落在叶面实处", () => {
  const [u0, u1] = LEAF_DIMS.textU;
  const holes = [];
  for (const d of LEAF_DIMS.lineD) {
    const band = LEAF_DIMS.lineBand / 2;
    for (const dy of [-band, -band * 0.5, 0, band * 0.5, band]) {
      for (let i = 0; i <= 240; i++) {
        const u = u0 + ((u1 - u0) * i) / 240;
        if (!leafCovers(u * LEAF_LEN, d + dy)) {
          holes.push([u.toFixed(4), (d + dy).toFixed(3)]);
        }
      }
    }
  }
  assert.equal(
    holes.length,
    0,
    `字带上有 ${holes.length} 处漏空，第一处 u=${holes[0]?.[0]} d=${holes[0]?.[1]}`
  );
});

test("同侧相邻小叶在字带高度上互相重叠", () => {
  const d = Math.abs(LEAF_DIMS.lineD[0]);
  const side = LEAFLETS.filter((s) => s.side === 1 && !s.terminal);
  const point = { x: 0, y: 0 };
  /* 每片小叶在 |y| = d 这条线上能盖到的 x 区间。 */
  const spans = side.map((spec) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= 600; i++) {
      const tau = i / 600;
      for (const bn of [-1, -0.5, 0, 0.5, 1]) {
        leafletFlat(spec, tau, bn, point);
        if (Math.abs(point.y - d) > 0.02) continue;
        lo = Math.min(lo, point.x);
        hi = Math.max(hi, point.x);
      }
    }
    return { lo, hi };
  });
  for (const span of spans) {
    assert.ok(Number.isFinite(span.lo), "每片小叶都必须够到字带的高度");
  }
  for (let i = 1; i < spans.length; i++) {
    assert.ok(
      spans[i].lo <= spans[i - 1].hi,
      `第 ${i - 1} 与第 ${i} 片小叶在字带上留了缝：` +
        `${spans[i - 1].hi.toFixed(3)} → ${spans[i].lo.toFixed(3)}`
    );
  }
});

/* 翻起是绕叶轴的刚体旋转。这一条是「小叶是翻开的、不是被拉长或涨大的」的
   机器可读版本：到叶轴的距离必须一个数都不差。 */
test("绕叶轴翻起严格保持到叶轴的距离", () => {
  const out = { y: 0, z: 0 };
  for (const side of [1, -1]) {
    for (const theta of [0, 0.3, 0.9, 1.7, 1.94, Math.PI]) {
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      for (const y of [0.05, 0.3, 0.72, 0.92]) {
        for (const z of [-0.1, 0, 0.06, 0.25]) {
          foldPoint(y * side, z, side, cos, sin, out);
          const before = Math.hypot(y, z);
          const after = Math.hypot(out.y, out.z);
          assert.ok(Math.abs(after - before) < 1e-12, `翻起改变了半径：${before} → ${after}`);
        }
      }
    }
  }
});

test("翻起从蜷缩角走到静止角，顶生小叶不翻", () => {
  for (const spec of LEAFLETS) {
    if (spec.terminal) {
      assert.equal(foldAngleAt(spec, 0), 0, "顶生小叶没有可绕的叶轴，只能卷");
      assert.equal(foldAngleAt(spec, 1), 0);
      continue;
    }
    const closed = foldAngleAt(spec, 0);
    const open = foldAngleAt(spec, 1);
    assert.ok(closed > 1.2, `蜷缩时必须翻起来挡住叶面，实际 ${closed.toFixed(2)} rad`);
    assert.ok(closed < Math.PI * 0.65, "翻过头两侧的叶尖会互相穿插");
    assert.ok(open < 0.2, `摊开后只留一点仰角，实际 ${open.toFixed(3)} rad`);
    for (let i = 1; i <= 20; i++) {
      assert.ok(
        foldAngleAt(spec, i / 20) <= foldAngleAt(spec, (i - 1) / 20) + 1e-12,
        "必须单调张开"
      );
    }
  }
});

/* 横向的卷保弧长——卷紧的时候小叶是卷起来的，不是缩窄的。 */
test("卷曲保持横向弧长", () => {
  const out = { w: 0, n: 0 };
  for (const curl of [0, 0.3, 1.2, 2.6, 3.4]) {
    for (const half of [0.12, 0.3, 0.44]) {
      const steps = 4000;
      let length = 0;
      curlAcross(0, curl, out);
      let prevW = out.w;
      let prevN = out.n;
      for (let i = 1; i <= steps; i++) {
        curlAcross((half * i) / steps, curl, out);
        length += Math.hypot(out.w - prevW, out.n - prevN);
        prevW = out.w;
        prevN = out.n;
      }
      const err = Math.abs(length - half) / half;
      assert.ok(err < 1e-3, `curl=${curl} half=${half} 弧长误差 ${err.toExponential(2)}`);
    }
  }
});

test("卷曲左右镜像，curl=0 是恒等", () => {
  const l = { w: 0, n: 0 };
  const r = { w: 0, n: 0 };
  for (const d of [0.04, 0.2, 0.44]) {
    for (const curl of [0.5, 1.8, 3.4]) {
      curlAcross(-d, curl, l);
      curlAcross(d, curl, r);
      assert.equal(l.w, -r.w);
      assert.equal(l.n, r.n);
    }
    curlAcross(d, 0, r);
    assert.equal(r.w, d);
    assert.equal(r.n, 0);
  }
  /* 卷得越紧，横向摊出来的宽度越小。 */
  let prev = Infinity;
  for (const curl of [0.5, 1.2, 2, 2.6, 3.4]) {
    curlAcross(0.44, curl, r);
    assert.ok(r.w < prev, `curl=${curl} 没有更窄`);
    prev = r.w;
  }
});

test("卷曲随展开退到零，顶生小叶卷得更紧", () => {
  const terminal = LEAFLETS.find((s) => s.terminal);
  const first = LEAFLETS[0];
  assert.ok(curlOf(terminal, 0) > curlOf(first, 0), "顶生小叶窄，要卷更紧才藏得住");
  for (const spec of [first, terminal]) {
    assert.equal(curlOf(spec, 1), 0, "摊开后不能还留着卷");
    assert.ok(curlOf(spec, 0.5) < curlOf(spec, 0));
  }
});

test("成对展开，从根到尖", () => {
  for (const t of [0, 0.4, 1.1, 1.8, 2.4, 3.0, UNFURL_SPAN]) {
    let prev = Infinity;
    for (let pair = 0; pair <= LEAF_DIMS.pairs; pair++) {
      const p = leafUnfurlAt(pair, t);
      assert.ok(p >= 0 && p <= 1);
      assert.ok(p <= prev + 1e-12, `t=${t} 第 ${pair} 对抢在了上一对前面`);
      prev = p;
    }
    /* 同一对左右两片读到的是同一个数——成对是结构上的，不是两边各排一次时序。 */
    for (const spec of LEAFLETS) {
      const twin = LEAFLETS.find((s) => s.pair === spec.pair && s.side === -spec.side);
      if (twin) assert.equal(leafUnfurlAt(spec.pair, t), leafUnfurlAt(twin.pair, t));
    }
  }
  assert.equal(leafUnfurlAt(0, 0.85), 1, "第一对在自己的 0.85s 里就该张满");
  assert.equal(leafUnfurlAt(LEAF_DIMS.pairs, 0.85), 0, "叶尖那时还没开始");
  for (let pair = 0; pair <= LEAF_DIMS.pairs; pair++) {
    assert.equal(leafUnfurlAt(pair, UNFURL_SPAN), 1, `t 走满时第 ${pair} 对必须张满`);
  }
});

test("UNFURL_SPAN 正好是最后一对张满的时刻", () => {
  assert.equal(LEAF_DIMS.unfurlSpan, UNFURL_SPAN);
  assert.ok(clamp01(leafUnfurlAt(LEAF_DIMS.pairs, UNFURL_SPAN - 1e-4)) < 1 - 1e-9);
  assert.equal(leafUnfurlAt(LEAF_DIMS.pairs, UNFURL_SPAN), 1);
});

test("小叶半宽含边缘的碎口，但不越过硬上限", () => {
  for (const spec of LEAFLETS) {
    let max = 0;
    for (let i = 0; i <= 400; i++) {
      const h = leafletHalf(spec, i / 400);
      assert.ok(h >= 0, "半宽不能是负的");
      max = Math.max(max, h);
    }
    assert.ok(max <= LEAF_DIMS.maxHalf, `${spec.pair}/${spec.side} 越过了贴图的边界`);
    assert.ok(max > spec.halfW * 0.9, "碎口不该把叶子啃掉一圈");
  }
});
