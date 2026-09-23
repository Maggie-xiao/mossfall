/**
 * 世界概念稿 —— 「不是叶子，不是这个背景」。
 *
 * 这是**概念稿，不是产品代码**，所以住在 tools/ 而不是 src/：方向还没定，主干不该
 * 先背上四个世界的实现。选定之后再把中选的那个搬进 src/ 并接进 endless。
 *
 * 为什么换得掉：`Field` 和 `buildFieldMesh` 都是导出的，而它们和渲染无关 ——
 * 碰撞面由 Field 定义，表现由谁画都行。所以这里用**同一个 field** 生成自己的
 * 网格和材质，物理、可解性、安全契约一个字节都没动，换掉的只有看到的东西。
 *
 * 背景同理：World 把 `trunk`、`trunkB`、`descentLayers` 挂成实例属性，隐藏它们
 * 就腾出了整个画面，再加自己的远景。
 *
 * 材质一律走**顶点色 + 标准材质**，不做 shader 注入：
 *   - buildFieldMesh 给了 `aEdge`（0 在中心，1 在边缘）和 `aVein`（脉络强度）
 *   - 在 CPU 上把它们烤成顶点色，就能拿到裂纹、冰纹、熔缝，而不用碰任何着色器
 * 这条路更可靠，也更容易在四个世界之间保持一致的光照反应。
 */

import * as THREE from "three";

/** 把 buildFieldMesh 的原始数组变成一个可用的 BufferGeometry。 */
function geometryFrom(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normal, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.index, 1));
  return geometry;
}

/**
 * 烤顶点色。
 *
 * `paint(edge, vein, x, z, out)` 拿到这个顶点的边缘量、脉络量和世界坐标，把颜色
 * 写进 `out`。每个世界用它表达自己的表面故事 —— 石头的苔藓长在裂缝里，冰的蓝
 * 出现在厚处，岩壳的橙只在缝里。
 */
function paintVertexColors(geometry, mesh, paint) {
  const count = mesh.position.length / 3;
  const colors = new Float32Array(count * 3);
  const out = new THREE.Color();
  for (let index = 0; index < count; index += 1) {
    const edge = mesh.aEdge[index] ?? 0;
    const vein = mesh.aVein[index] ?? 0;
    const x = mesh.position[index * 3];
    const z = mesh.position[index * 3 + 2];
    paint(edge, vein, x, z, out);
    colors[index * 3] = out.r;
    colors[index * 3 + 1] = out.g;
    colors[index * 3 + 2] = out.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/** 值噪声，给表面加不规则感。确定性，同一点永远同一值。 */
function noise(x, z) {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/* ===================================================================== *
 * 石庭 — 裂石板 + 雾中石柱
 * ===================================================================== */

const STONE = {
  id: "stone",
  name: "Stone Court",
  nameZh: "石庭",
  blurb: "A weathered slab in a field of standing pillars.",
  insectBias: ["red", "yellow", "orange", "teal", "white"],
  env: {
    background: 0x8a8f92, fog: 0x8a8f92, fogNear: 14, fogFar: 78,
    sun: 0xfff0da, sunInt: 2.4, ambient: 0xb8c6d4, ambientInt: 0.9,
    bloom: 0.45
  },
  platform(mesh) {
    const geometry = geometryFrom(mesh);
    const base = new THREE.Color(0x8e8b84);
    const dark = new THREE.Color(0x4a4742);
    const moss = new THREE.Color(0x5f7a3c);
    paintVertexColors(geometry, mesh, (edge, vein, x, z, out) => {
      // 斑驳：大尺度噪声决定石头本身的深浅
      const mottle = noise(x * 0.7, z * 0.7) * 0.22;
      out.copy(base).lerp(dark, mottle);
      // 裂纹走 vein —— 原本用来画叶脉的那条数据，在石头上就是裂缝
      const crack = Math.min(1, Math.abs(vein) * 2.6);
      out.lerp(dark, crack * 0.85);
      // 苔藓只长在裂缝里和边缘的湿处，不铺满 —— 铺满就变成绿石头了
      const damp = crack * 0.6 + edge * 0.3;
      out.lerp(moss, Math.min(0.5, damp * noise(x * 2.1, z * 2.1)));
    });
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.94, metalness: 0.0, flatShading: false
    }));
  },
  backdrop() {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: 0x6e7276, roughness: 0.95, metalness: 0
    });
    // 一圈退进雾里的石柱。近的高而实，远的被雾吃掉 —— 纵深靠雾，不靠几何。
    const pillars = [
      [-13, 0, -16, 3.0, 46], [12, 0, -20, 3.6, 54], [-22, 0, -30, 4.2, 62],
      [24, 0, -34, 3.2, 50], [-6, 0, -44, 5.0, 70], [16, 0, -52, 4.4, 66],
      [-30, 0, -58, 5.6, 78]
    ];
    for (const [x, y, z, r, h] of pillars) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.86, r, h, 10, 1),
        material
      );
      pillar.position.set(x, y - h * 0.5 + 6, z);
      pillar.rotation.y = noise(x, z) * Math.PI;
      group.add(pillar);
    }
    return group;
  }
};

/* ===================================================================== *
 * 浮冰 — 半透明冰面 + 极光
 * ===================================================================== */

const ICE = {
  id: "ice",
  name: "Ice Floe",
  nameZh: "浮冰",
  blurb: "Translucent ice adrift under an aurora.",
  insectBias: ["red", "orange", "yellow", "pink", "black"],
  env: {
    background: 0x16283c, fog: 0x1d3350, fogNear: 16, fogFar: 96,
    sun: 0xdcefff, sunInt: 1.9, ambient: 0x6fa8d8, ambientInt: 1.25,
    bloom: 1.0
  },
  platform(mesh) {
    const geometry = geometryFrom(mesh);
    const shallow = new THREE.Color(0xe6f6ff);
    const deep = new THREE.Color(0x4f9ecb);
    paintVertexColors(geometry, mesh, (edge, vein, x, z, out) => {
      // 冰的蓝出现在**厚**的地方，也就是离边缘远的中心 —— 边缘薄，透光发白
      out.copy(deep).lerp(shallow, edge * 0.85 + 0.1);
      // 裂纹在冰里是发白的应力线，不是暗缝
      out.lerp(shallow, Math.min(0.7, Math.abs(vein) * 2.2));
      // 气泡带
      out.lerp(shallow, noise(x * 3.3, z * 3.3) * 0.12);
    });
    return new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.16,
      metalness: 0,
      transmission: 0.55,
      thickness: 0.9,
      ior: 1.31,
      clearcoat: 0.7,
      clearcoatRoughness: 0.12
    }));
  },
  backdrop() {
    const group = new THREE.Group();

    /* 机位是**俯视板子**的，所以挂在天上的东西一律看不到 —— 第一版把极光放在
       y=40、z=-70，完全在视锥外，等于没有背景。正典世界之所以成立，是因为树干
       和树冠包在四周和下方。浮冰照做：海面在下、浮冰在周围、极光压到接近地平
       线的高度，并且在水面留一道倒影。 */

    // 天穹：竖直渐变，顶上深靛，接近地平线转青。顶点色，不写着色器。
    const sky = new THREE.SphereGeometry(300, 32, 20);
    const skyColors = new Float32Array(sky.attributes.position.count * 3);
    const high = new THREE.Color(0x0a1430);
    const low = new THREE.Color(0x1f5670);
    const c = new THREE.Color();
    for (let i = 0; i < sky.attributes.position.count; i += 1) {
      const y = sky.attributes.position.getY(i) / 300;
      c.copy(low).lerp(high, Math.max(0, Math.min(1, y * 1.3 + 0.15)));
      skyColors[i * 3] = c.r;
      skyColors[i * 3 + 1] = c.g;
      skyColors[i * 3 + 2] = c.b;
    }
    sky.setAttribute("color", new THREE.BufferAttribute(skyColors, 3));
    group.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false
    })));

    // 海面。低一点点就好 —— 板子浮在上面，不是悬在半空。
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({
        color: 0x071322, roughness: 0.34, metalness: 0.5
      })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -1.6;
    group.add(sea);

    /* 周围的浮冰群。这是俯视角下真正撑起画面的东西：近处几块大的给尺度，
       远处小的退进雾里给纵深。都压在海面高度，所以一定在画面里。 */
    const floeMaterial = new THREE.MeshStandardMaterial({
      color: 0xbcd8ea, roughness: 0.35, metalness: 0
    });
    for (let index = 0; index < 26; index += 1) {
      const angle = noise(index, 17) * Math.PI * 2;
      const distance = 9 + noise(index, 23) * 46;
      const r = 1.4 + noise(index, 29) * 5.2;
      const floe = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 0.82, 0.5 + noise(index, 31) * 0.7, 7, 1),
        floeMaterial
      );
      floe.position.set(
        Math.cos(angle) * distance,
        -1.5 + noise(index, 37) * 0.3,
        Math.sin(angle) * distance
      );
      floe.rotation.y = noise(index, 41) * Math.PI;
      group.add(floe);
    }

    /* 极光：压到接近地平线，且做成**两份** —— 空中一道，水面一道倒影。
       俯视时看到的主要是倒影那一道，那才是让画面「有背景」的东西。 */
    const bands = [
      [0x6ef0c0, 14, -52, 26, 0.5],
      [0x8ad8ff, 9, -66, 20, 0.4],
      [0xa0f0e0, 19, -44, 16, 0.34]
    ];
    for (const [color, y, z, height, opacity] of bands) {
      const material = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, fog: false
      });
      const band = new THREE.Mesh(new THREE.PlaneGeometry(220, height), material);
      band.position.set(0, y, z);
      band.rotation.z = (noise(y, z) - 0.5) * 0.25;
      group.add(band);

      /* 倒影要是**远处水面上的一道**，不是一层地板漆。
         第一版用 200x83 的加色大板铺在相机正下方，把整个海洗成了薄荷绿 ——
         冷暗的水才是这个世界的底，倒影只是水上远处的一笔。所以收窄、压暗，
         并且推到板子后面去。 */
      const reflection = new THREE.Mesh(
        new THREE.PlaneGeometry(120, height * 1.1),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: opacity * 0.22,
          blending: THREE.AdditiveBlending, depthWrite: false,
          side: THREE.DoubleSide, fog: true
        })
      );
      reflection.rotation.x = -Math.PI / 2;
      reflection.position.set(0, -1.54, z * 0.62);
      group.add(reflection);
    }

    return group;
  }
};

const EMBER = {
  id: "ember",
  name: "Ember Crust",
  nameZh: "余烬",
  blurb: "Cooling basalt, still glowing along the cracks.",
  insectBias: ["teal", "white", "green", "pink", "black"],
  env: {
    background: 0x140d0c, fog: 0x1c110e, fogNear: 10, fogFar: 62,
    sun: 0xffb078, sunInt: 1.15, ambient: 0xff7a44, ambientInt: 0.75,
    bloom: 1.3
  },
  platform(mesh) {
    const geometry = geometryFrom(mesh);
    const crust = new THREE.Color(0x2a2422);
    const cold = new THREE.Color(0x141110);
    paintVertexColors(geometry, mesh, (edge, vein, x, z, out) => {
      out.copy(crust).lerp(cold, noise(x * 0.9, z * 0.9) * 0.5);
      // 边缘更冷更暗：壳先从外面凉下来
      out.lerp(cold, (1 - edge) * 0.35);
    });
    const body = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.86, metalness: 0.1
    }));

    /* 熔缝单独一层加色叠加。MeshStandardMaterial 没有逐顶点自发光，硬做要改
       着色器；叠一层只在缝里可见的加色网格更简单，也更好调。 */
    const glowGeometry = geometryFrom(mesh);
    const glowColors = new Float32Array((mesh.position.length / 3) * 3);
    const hot = new THREE.Color(0xff7326);
    const white = new THREE.Color(0xffd9a0);
    for (let index = 0; index < glowColors.length / 3; index += 1) {
      const vein = Math.min(1, Math.abs(mesh.aVein[index] ?? 0) * 2.8);
      // 缝越深越白热，缝外直接是黑（加色混合下黑等于不可见）
      const c = new THREE.Color().copy(hot).lerp(white, vein * 0.5)
        .multiplyScalar(vein * vein);
      glowColors[index * 3] = c.r;
      glowColors[index * 3 + 1] = c.g;
      glowColors[index * 3 + 2] = c.b;
    }
    glowGeometry.setAttribute("color", new THREE.BufferAttribute(glowColors, 3));
    const glow = new THREE.Mesh(glowGeometry, new THREE.MeshBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false
    }));
    glow.position.y = 0.004;

    const group = new THREE.Group();
    group.add(body, glow);
    return group;
  },
  backdrop() {
    const group = new THREE.Group();
    // 洞穴：一个从里面看的大球，底部透出熔岩的红
    const cave = new THREE.Mesh(
      new THREE.SphereGeometry(160, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x1a100e, side: THREE.BackSide })
    );
    group.add(cave);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(320, 320),
      new THREE.MeshBasicMaterial({
        color: 0xff5a1e, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -34;
    group.add(floor);
    // 几块悬着的余烬，给中景一点层次
    for (let index = 0; index < 9; index += 1) {
      const r = 1.2 + noise(index, 3) * 2.4;
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 0),
        new THREE.MeshStandardMaterial({ color: 0x241c19, roughness: 0.9 })
      );
      rock.position.set(
        (noise(index, 1) - 0.5) * 70,
        -8 - noise(index, 2) * 18,
        -18 - index * 6
      );
      group.add(rock);
    }
    return group;
  }
};

/* ===================================================================== *
 * 纸灯 — 折纸台 + 夜空灯笼
 * ===================================================================== */

const PAPER = {
  id: "paper",
  name: "Paper Lantern",
  nameZh: "纸灯",
  blurb: "A folded paper stage among hanging lanterns.",
  insectBias: ["red", "black", "teal", "green", "orange"],
  env: {
    background: 0x0e1024, fog: 0x141838, fogNear: 18, fogFar: 92,
    sun: 0xffe4b8, sunInt: 1.5, ambient: 0xffc98a, ambientInt: 1.1,
    bloom: 1.15
  },
  platform(mesh) {
    const geometry = geometryFrom(mesh);
    const paper = new THREE.Color(0xfff0d2);
    const shade = new THREE.Color(0xe0b47a);
    paintVertexColors(geometry, mesh, (edge, vein, x, z, out) => {
      out.copy(paper);
      // 折痕：vein 在这里是折线，压出一道更暗的窄带
      out.lerp(shade, Math.min(0.55, Math.abs(vein) * 3.0));
      // 边缘透光更强，中心厚一点
      out.lerp(shade, (1 - edge) * 0.18);
    });
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.82, metalness: 0,
      emissive: 0xffbe72, emissiveIntensity: 0.32,
      side: THREE.DoubleSide, flatShading: true
    }));
  },
  backdrop() {
    const group = new THREE.Group();
    const night = new THREE.Mesh(
      new THREE.SphereGeometry(200, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x0b0e20, side: THREE.BackSide })
    );
    group.add(night);
    // 一群悬着的灯笼，近大远小，颜色在暖橙到暖红之间摆
    for (let index = 0; index < 22; index += 1) {
      const depth = 12 + index * 3.4;
      const r = 1.0 + noise(index, 7) * 2.2;
      const lantern = new THREE.Mesh(
        new THREE.SphereGeometry(r, 12, 10),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(
            0.045 + noise(index, 11) * 0.04, 0.85, 0.62
          )
        })
      );
      lantern.scale.y = 1.25;
      lantern.position.set(
        (noise(index, 5) - 0.5) * 90,
        4 + (noise(index, 9) - 0.5) * 46,
        -depth
      );
      group.add(lantern);
    }
    return group;
  }
};

export const CONCEPTS = Object.freeze({
  stone: STONE,
  ice: ICE,
  ember: EMBER,
  paper: PAPER
});

export const CONCEPT_IDS = Object.freeze(Object.keys(CONCEPTS));

export function conceptById(id) {
  return CONCEPTS[id] || CONCEPTS.stone;
}
