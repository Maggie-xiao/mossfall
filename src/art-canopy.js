/**
 * MOSS TILT — repainting the parallax shells.
 *
 * 背景之所以读作「一棵树」，不是因为几何，是因为视差壳上那张贴图画的是叶子。
 * `world.js` 的 `canopyTexture()` 是程序化画进 canvas 的，所以换掉画的内容，就换掉
 * 了世界的身份 —— 而视差系统、雾、光照、渲染顺序全部不动，质量自然和正典对齐。
 *
 * 这条路是刻意选的。上一版我手搓了平台网格和背景几何，结果明显比正典廉价：质量
 * 来自 `leaf.js` 那 1403 行里注入 three 标准材质的 shader（次表面、边缘光、叶脉），
 * 一个下午的顶点色平板打不过它。所以现在**不重写渲染器，只换它的身份来源**。
 *
 * 正典那张贴图把自己的美学规则写在注释里，这里逐条照办：
 *
 *   1. **成团，不是彩纸屑。** 均匀撒开的图元在百米外糊成一片灰，读作飘散的碎屑
 *      而不是一层东西。要成簇，并且**留出真的空隙** —— 是空隙在卖纵深。
 *   2. **变的是明度，不是透明度。** 材质走 `alphaTest: 0.38`，所以半透明的图元
 *      等于**缺了一片**；而暗一点的图元能活过裁剪、变成层次。正典管这叫「平板
 *      剪影和内部有层次之间的差别」。
 *   3. **画九份。** 壳是循环贴的，接缝会直接毁掉视差。
 */

import * as THREE from "three";

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 冰原的视差层：漂浮的冰凌与霜晶。
 *
 * 图元从叶片的软弧线换成**带棱角的碎冰**——这是「不是叶子」真正落地的地方。
 * 其余一切（成簇、明度分层、留空隙、九份平铺）都和正典同构。
 */
export function iceCanopyTexture(seed) {
  if (typeof document === "undefined") return null;
  const S = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const g = canvas.getContext("2d");
  if (!g) return null;

  let state = seed >>> 0;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  /** 一块碎冰。棱角靠不等长的半径做出来，不是规则多边形 —— 规则的读作装饰图案。 */
  const shard = (x, y, r, stretch, rot) => {
    const sides = 5 + ((rnd() * 2) | 0);
    const radii = [];
    for (let i = 0; i < sides; i += 1) radii.push(r * (0.55 + rnd() * 0.65));
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        g.save();
        g.translate(x + dx * S, y + dy * S);
        g.rotate(rot);
        g.scale(1, stretch);
        g.beginPath();
        for (let i = 0; i < sides; i += 1) {
          const a = (i / sides) * TAU;
          const px = Math.cos(a) * radii[i];
          const py = Math.sin(a) * radii[i];
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
        g.restore();
      }
    }
  };

  g.clearRect(0, 0, S, S);
  g.globalAlpha = 1;

  // 成簇。簇的走向用 lean 统一，簇内深浅按到簇心的距离拉开 —— 靠中心的是后面
  // 那些，所以更暗。
  /* 簇更多、单片更小。第一版 13 簇 x 半径 6-21 的碎片，近处读作纸片；正典的叶子
     单片也小，靠数量和成簇关系撑起体量，不靠单片大。 */
  const CLUMPS = 22;
  for (let c = 0; c < CLUMPS; c += 1) {
    const cx = rnd() * S;
    const cy = rnd() * S;
    const spread = 13 + rnd() * 18;
    const lean = rnd() * Math.PI;
    // 冰比叶子亮，整体明度抬高一档，但仍然留足暗部否则没有层次。
    const shade = 0.5 + rnd() * 0.42;
    const n = 6 + ((rnd() * 8) | 0);
    for (let i = 0; i < n; i += 1) {
      const a = rnd() * TAU;
      const d = spread * Math.sqrt(rnd());
      const v = clamp01(shade + (d / spread) * 0.3 + (rnd() - 0.5) * 0.14);
      const q = Math.round(v * 255);
      g.fillStyle = `rgb(${q},${q},${q})`;
      shard(
        cx + Math.cos(a) * d,
        cy + Math.sin(a) * d * 0.72,
        3.5 + rnd() * 8,
        0.5 + rnd() * 0.55,
        // 一簇里的碎冰大体同向，那种一致性是看得出来的。
        lean + (rnd() - 0.5) * 1.3
      );
    }
  }

  // punch 空隙，让光透进这一层。
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 22; i += 1) {
    shard(rnd() * S, rnd() * S, 11 + rnd() * 20, 1, rnd() * Math.PI);
  }
  g.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

export function storybookCanopyTexture(seed) {
  if (typeof document === "undefined") return null;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  let state = seed >>> 0;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const repeat = (draw, x, y) => {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) draw(x + dx * size, y + dy * size);
    }
  };

  g.clearRect(0, 0, size, size);
  for (let clump = 0; clump < 18; clump += 1) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const base = 72 + Math.floor(rnd() * 62);
    const count = 7 + Math.floor(rnd() * 8);
    for (let i = 0; i < count; i += 1) {
      const angle = rnd() * TAU;
      const distance = Math.sqrt(rnd()) * (10 + rnd() * 24);
      const radius = 5 + rnd() * 13;
      const tone = Math.min(188, base + Math.floor(rnd() * 40));
      g.fillStyle = `rgb(${Math.floor(tone * 0.58)},${tone},${Math.floor(tone * 0.82)})`;
      repeat((x, y) => {
        g.save();
        g.translate(x, y);
        g.rotate(angle + (rnd() - 0.5) * 0.5);
        g.scale(1.35, 0.82);
        g.beginPath();
        g.arc(0, 0, radius, 0, TAU);
        g.fill();
        g.restore();
      }, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.7);
    }
  }

  for (let i = 0; i < 34; i += 1) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 1.2 + rnd() * 2.8;
    g.fillStyle = i % 3 === 0 ? "rgb(255,185,116)" : "rgb(184,255,224)";
    repeat((px, py) => {
      g.beginPath();
      g.arc(px, py, r, 0, TAU);
      g.fill();
    }, x, y);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

const PAINTERS = { ice: iceCanopyTexture, storybook: storybookCanopyTexture };

/**
 * 把一个 World 实例的视差壳换成另一套贴图。
 *
 * 只改实例上的 `mat.map`，不碰 `world.js` —— 那是哈希锁定的上游。旧贴图的
 * `repeat` / `offset` / `wrap` 必须原样搬过来：那几个值是视差调过的，重画的是
 * 内容，不是节奏。
 *
 * 返回一个还原函数。皮肤是全局可变状态，离开 endless 必须还原，否则
 * beginner/advanced 会继承它。
 */
export function repaintCanopy(world, painterId) {
  const painter = PAINTERS[painterId];
  const shells = world?._shells;
  if (!painter || !shells?.length) return () => {};

  const restore = [];
  shells.forEach((shell, index) => {
    const previous = shell.mat.map;
    if (!previous) return;
    const next = painter(index % 2 ? 4211 : 7);
    if (!next) return;
    // 节奏照搬，内容换新。
    next.wrapS = previous.wrapS;
    next.wrapT = previous.wrapT;
    next.repeat.copy(previous.repeat);
    next.offset.copy(previous.offset);
    next.anisotropy = previous.anisotropy;
    shell.mat.map = next;
    shell.mat.needsUpdate = true;
    restore.push(() => {
      next.dispose();
      shell.mat.map = previous;
      shell.mat.needsUpdate = true;
    });
  });

  return () => restore.forEach((undo) => undo());
}

/* ===================================================================== *
 * 树干的冰凌
 * ===================================================================== */

const TRUNK_Z = -13;   // 树干轴心，和 world.js 的常量一致
const TRUNK_R = 7;

/**
 * 给树干挂一层冰凌和霜壳。
 *
 * 换了配色之后树干读作一堵**光滑的**蓝灰墙 —— 正典的树干上有几十件程序化附生物
 * （层菌、树瘤、苔团、花），换色保留了它们的存在但那是苔藓的形状。冰世界需要
 * 自己的附生物。
 *
 * 两条位置约束照抄 `patches/README.md` 里记录过的教训，违反任何一条都会让附生物
 * 飘在树干旁边的空气里：
 *
 *   1. **方位角必须落在 lathe 的圆弧内。** 树干不是圆柱，是
 *      `LatheGeometry(prof, radial, -1.95, 3.9)` —— 只有 |θ| ≤ 1.95 处有表面。
 *      超出去就是锚在从未生成过的几何上。
 *   2. **锚定半径要低于剖面最小值。** 剖面半径随高度在 6.37–7.63 之间起伏，
 *      而附生物在烘焙时无从知道自己最终的高度。锚在最小值以下，它只会被埋进
 *      树干，永远不会悬空。
 */
export function dressTrunkWithIce(world, THREE) {
  if (!world?.group) return () => {};

  const group = new THREE.Group();
  group.name = "ice-trunk-dressing";

  let state = 0x9e3779b9;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const iceMaterial = new THREE.MeshStandardMaterial({
    color: 0xd4ecfa, roughness: 0.22, metalness: 0,
    transparent: true, opacity: 0.9
  });
  const frostMaterial = new THREE.MeshStandardMaterial({
    color: 0xa8ccdf, roughness: 0.6, metalness: 0
  });

  // 半径埋在剖面最小值（约 6.37）以下。
  const ANCHOR = TRUNK_R - 0.85;
  // 圆弧是 ±1.95，留 0.25 给附生物自己的半宽。
  const ARC = 1.7;

  for (let index = 0; index < 54; index += 1) {
    const sign = rnd() > 0.5 ? 1 : -1;
    const angle = sign * (0.35 + rnd() * ARC);
    const y = 26 - rnd() * 92;
    const long = rnd() > 0.62;

    // 冰凌：细长的锥，尖端朝下。
    const height = long ? 2.2 + rnd() * 4.4 : 0.8 + rnd() * 1.6;
    const radius = (long ? 0.2 : 0.14) + rnd() * 0.16;
    const icicle = new THREE.Mesh(
      new THREE.ConeGeometry(radius, height, 6, 1),
      iceMaterial
    );
    icicle.position.set(
      Math.sin(angle) * ANCHOR,
      y - height * 0.5,
      TRUNK_Z + Math.cos(angle) * ANCHOR
    );
    // 尖朝下：ConeGeometry 默认尖朝上。
    icicle.rotation.x = Math.PI;
    icicle.rotation.z = (rnd() - 0.5) * 0.22;
    group.add(icicle);

    // 每隔几根配一块霜壳，免得树干只有针没有面。
    if (index % 3 === 0) {
      const crust = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.7 + rnd() * 1.5, 0),
        frostMaterial
      );
      crust.position.set(
        Math.sin(angle) * (ANCHOR + 0.15),
        y + 0.4,
        TRUNK_Z + Math.cos(angle) * (ANCHOR + 0.15)
      );
      crust.scale.set(1, 0.42 + rnd() * 0.4, 1);
      crust.rotation.y = rnd() * Math.PI;
      group.add(crust);
    }
  }

  world.group.add(group);

  return () => {
    world.group.remove(group);
    group.traverse((node) => node.geometry?.dispose?.());
    iceMaterial.dispose();
    frostMaterial.dispose();
  };
}

export function dressTrunkStorybook(world, THREE) {
  if (!world?.group) return () => {};
  const group = new THREE.Group();
  group.name = "storybook-trunk-dressing";
  const bark = new THREE.MeshStandardMaterial({ color: 0x705149, roughness: 0.92 });
  const barkLight = new THREE.MeshStandardMaterial({ color: 0x9a7565, roughness: 0.9 });
  const glow = new THREE.MeshStandardMaterial({
    color: 0x72d6b0,
    emissive: 0x2a947c,
    emissiveIntensity: 1.1,
    roughness: 0.45
  });
  const cap = new THREE.MeshStandardMaterial({
    color: 0x765da8,
    emissive: 0x25194b,
    emissiveIntensity: 0.65,
    roughness: 0.72
  });
  const stem = new THREE.MeshStandardMaterial({ color: 0xe5c7ae, roughness: 0.88 });
  const anchor = TRUNK_R - 0.7;

  for (let index = 0; index < 9; index += 1) {
    const angle = (index % 2 ? 1 : -1) * (0.42 + (index % 4) * 0.28);
    const y = 24 - index * 8.6;
    const ridge = new THREE.Mesh(
      new THREE.TorusGeometry(1.2 + (index % 3) * 0.35, 0.2 + (index % 2) * 0.08, 7, 18, Math.PI * 1.25),
      index % 3 ? bark : barkLight
    );
    ridge.position.set(Math.sin(angle) * anchor, y, TRUNK_Z + Math.cos(angle) * anchor);
    ridge.rotation.set(Math.PI / 2, angle, index * 0.47);
    ridge.scale.set(1.1, 1.8, 1);
    group.add(ridge);
  }

  for (let index = 0; index < 5; index += 1) {
    const angle = (index % 2 ? 1 : -1) * (0.7 + index * 0.17);
    const y = 18 - index * 15;
    const hollow = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.16, 10, 28), glow);
    hollow.position.set(Math.sin(angle) * (anchor + 0.18), y, TRUNK_Z + Math.cos(angle) * (anchor + 0.18));
    hollow.rotation.set(Math.PI / 2, angle, 0);
    hollow.scale.set(1.35, 1, 0.7);
    group.add(hollow);

    const mushroom = new THREE.Group();
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.1, 7), stem);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 8, 0, TAU, 0, Math.PI * 0.55), cap);
    crown.scale.y = 0.42;
    crown.position.y = 0.55;
    stalk.position.y = 0.1;
    mushroom.add(stalk, crown);
    mushroom.position.set(Math.sin(-angle) * (anchor + 0.45), y + 4.6, TRUNK_Z + Math.cos(-angle) * (anchor + 0.45));
    mushroom.rotation.z = -angle * 0.4;
    group.add(mushroom);
  }

  world.group.add(group);
  return () => {
    world.group.remove(group);
    group.traverse((node) => node.geometry?.dispose?.());
    bark.dispose();
    barkLight.dispose();
    glow.dispose();
    cap.dispose();
    stem.dispose();
  };
}
