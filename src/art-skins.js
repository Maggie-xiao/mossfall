/**
 * MOSS TILT — art skins for Endless.
 *
 * WHAT THIS DOES, AND WHY IT IS ALLOWED TO
 *
 * `src/mossfall/**` is vendored read-only and hash-locked. But the lock is on
 * *file contents*, and `palette.js` exports `ZONES` and `WORLD` as live objects
 * that every renderer reads through at draw time. Rewriting those objects'
 * fields in place therefore re-skins the whole world — world, lighting, leaf,
 * post — without editing one locked byte.
 *
 * The price is that this is global mutable state. Leaving Endless MUST restore
 * the canon values or Beginner and Advanced would inherit the skin. `CANON` is
 * snapshotted at module load, before anything can have touched it, and
 * `applySkin("canon")` puts it back.
 *
 * THE TWO RULES EVERY SKIN KEEPS
 *
 * From `palette.js`'s own header, and not negotiable:
 *
 *   1. Beetles are the only fully saturated things on screen, so they stay
 *      legible over any background.
 *   2. The palette IS the sense of depth — light falls, fog cools and thickens,
 *      and the glow shifts from sunlight to bioluminescence on the way down.
 *
 * Rule 2 is kept structurally: every skin reuses the canon's numeric ramps
 * verbatim (`FOG_NEAR`, `FOG_FAR`, `SUN_INT`, `AMBIENT_INT`, `BLOOM`, `MOTES`).
 * Those ramps *are* the descent; only hue changes between skins. It also keeps
 * zone 6's glow off the neighbouring hue in every skin — the canon's deliberate
 * bioluminescent beat, the one a smooth interpolation measurably destroys.
 *
 * Rule 1 is what makes Autumn hard, and it is worth stating plainly: the insect
 * set contains red, orange and yellow. Drop those onto saturated scarlet
 * foliage and the beetle vanishes into the leaf. Autumn therefore does two
 * things at once — it keeps the environment in muted ochre and umber rather
 * than blazing scarlet, and it declares an `insectBias` so Endless draws from
 * the cool half of the set. A warm world with cool bugs reads; a warm world
 * with warm bugs is a mess.
 */

import { ZONES, WORLD } from "./mossfall/data/palette.js";

/** Every field a zone carries. Used for snapshot, apply and restore. */
const ZONE_FIELDS = [
  "name",
  "fog", "fogNear", "fogFar",
  "sun", "sunInt", "ambient", "ambientInt",
  "rim", "leafTop", "leafBack",
  "hazeTop", "hazeBot",
  "bloom", "motes", "moteColor", "glow"
];

const WORLD_FIELDS = Object.keys(WORLD);

/** The shipped palette, captured before anything can have altered it. */
const CANON_ZONES = ZONES.map((zone) => {
  const copy = {};
  for (const field of ZONE_FIELDS) copy[field] = zone[field];
  return copy;
});

const CANON_WORLD = (() => {
  const copy = {};
  for (const field of WORLD_FIELDS) copy[field] = WORLD[field];
  return copy;
})();

/* The descent, as numbers. Shared by every skin — this is rule 2. */
const FOG_NEAR = [26, 24, 22, 20, 18, 16, 14, 12];
const FOG_FAR = [132, 124, 116, 108, 98, 88, 76, 68];
const SUN_INT = [3.1, 2.85, 2.6, 2.35, 2.05, 1.75, 1.35, 1.55];
const AMBIENT_INT = [0.85, 0.82, 0.8, 0.82, 0.88, 0.95, 1.05, 1.15];
const BLOOM = [0.55, 0.55, 0.6, 0.65, 0.72, 0.85, 1.0, 1.15];
const MOTES = [
  "pollen", "pollen", "pollen", "spore",
  "spore", "droplet", "firefly", "firefly"
];

/**
 * Expand a skin's per-zone hues against the shared ramps.
 * `hues[i]` supplies only what differs between skins.
 */
function zonesFrom(hues) {
  return hues.map((hue, index) => ({
    id: index,
    name: hue.name,
    fog: hue.fog,
    fogNear: FOG_NEAR[index],
    fogFar: FOG_FAR[index],
    sun: hue.sun,
    sunInt: SUN_INT[index],
    ambient: hue.ambient,
    ambientInt: AMBIENT_INT[index],
    rim: hue.rim,
    leafTop: hue.leafTop,
    leafBack: hue.leafBack,
    hazeTop: hue.hazeTop,
    hazeBot: hue.hazeBot,
    bloom: BLOOM[index],
    motes: MOTES[index],
    moteColor: hue.moteColor,
    glow: hue.glow
  }));
}

/**
 * AUTUMN — 锦红 → 赭石.
 *
 * A canopy turning. Warm gold light through amber and rust, descending into
 * ochre, umber and wet earth; the deep glow is an ember, not a firefly.
 */
const AUTUMN = {
  id: "autumn",
  name: "Autumn",
  nameZh: "秋色",
  blurb: "A canopy turning. Gold light, rust foliage, dark earth below.",
  insectBias: ["teal", "green", "white", "pink", "black"],
  zones: zonesFrom([
    { name: "Burning Crown",
      fog: 0xe0c48d, sun: 0xfff0cf, ambient: 0xc9d8ee, rim: 0xffe6ab,
      leafTop: 0xd98b3c, leafBack: 0xf0c274,
      hazeTop: 0xefd9a6, hazeBot: 0xbe9455, moteColor: 0xffe6bb, glow: 0xffdca4 },
    { name: "Amber Bough",
      fog: 0xd3b078, sun: 0xffe6bd, ambient: 0xbccfe6, rim: 0xffdd9c,
      leafTop: 0xc9772f, leafBack: 0xe3b062,
      hazeTop: 0xe2c692, hazeBot: 0xac8549, moteColor: 0xffdca8, glow: 0xf5c98a },
    { name: "Rust Terrace",
      fog: 0xc29a68, sun: 0xffdaa8, ambient: 0xb0c3dd, rim: 0xf7cf8d,
      leafTop: 0xb8632a, leafBack: 0xd39a52,
      hazeTop: 0xd3b07e, hazeBot: 0x97733e, moteColor: 0xf7d09a, glow: 0xe8b477 },
    { name: "Ochre Landing",
      fog: 0xb08758, sun: 0xffd098, ambient: 0xa3b7d3, rim: 0xeec27e,
      leafTop: 0xa5552a, leafBack: 0xc08a4a,
      hazeTop: 0xc39e6f, hazeBot: 0x866434, moteColor: 0xecc490, glow: 0xd9a165 },
    { name: "Umber Gallery",
      fog: 0x96704a, sun: 0xf6c088, ambient: 0x95a9c6, rim: 0xdcb26f,
      leafTop: 0x8e4826, leafBack: 0xa87740,
      hazeTop: 0xa9855c, hazeBot: 0x6f512a, moteColor: 0xdcb680, glow: 0xc48d55 },
    { name: "Cider Hollow",
      fog: 0x7a5a3c, sun: 0xe8b078, ambient: 0x8a9dba, rim: 0xc79c60,
      leafTop: 0x763b22, leafBack: 0x8e6335,
      hazeTop: 0x8c6c48, hazeBot: 0x584022, moteColor: 0xc9a271, glow: 0xa87747 },
    /* 余烬。正典在这一层把辉光切成生物荧光青绿；秋色把它切成一块**冷掉的余烬**
       —— 同样是「和上下都不同调」的那一拍，只是换成了这个世界自己的语言。 */
    { name: "Ember Deep",
      fog: 0x53412f, sun: 0xd49a6a, ambient: 0x7d92b2, rim: 0xffa25c,
      leafTop: 0x5e3020, leafBack: 0x74502c,
      hazeTop: 0x6a5238, hazeBot: 0x3c2c1c, moteColor: 0xff9d55, glow: 0xff8a3d },
    { name: "Old Heartwood",
      fog: 0x3b2f24, sun: 0xffce90, ambient: 0x94a9c6, rim: 0xffdba4,
      leafTop: 0x6b3f26, leafBack: 0x8a6236,
      hazeTop: 0x5a4530, hazeBot: 0x2a2118, moteColor: 0xffdca0, glow: 0xffc478 }
  ]),
  world: {
    bark: 0x6a4a33, barkDark: 0x38251a, barkLight: 0x8f6a46,
    moss: 0x8a6a34, mossLight: 0xbb9a52, mossDark: 0x4d3a1c,
    vine: 0x7a5a2e, stem: 0x9a7a3c,
    mushroomCap: 0xc25a38, mushroomStem: 0xdcc9aa,
    mushroomGlowCap: 0xd9803a, flower: 0xffc48a, flowerAlt: 0xffe0a0,
    petal: 0xfff2e2, soil: 0x3d2a1c, water: 0xc8b48a,
    silk: 0xffeed8, seed: 0xf2e0be
  }
};

/**
 * DUSK — 黄昏.
 *
 * The last hour. Low orange sun in the crown, and a cold violet-blue night
 * climbing up from the roots to meet it.
 */
const DUSK = {
  id: "dusk",
  name: "Dusk",
  nameZh: "黄昏",
  blurb: "The last hour. Low gold above, violet night rising below.",
  insectBias: ["yellow", "white", "teal", "orange", "green"],
  zones: zonesFrom([
    { name: "Gilded Crown",
      fog: 0xe4b98c, sun: 0xffd9a0, ambient: 0xa8b6e8, rim: 0xffc98a,
      leafTop: 0x9fae5a, leafBack: 0xe0cf82,
      hazeTop: 0xf0cfa2, hazeBot: 0xb08a72, moteColor: 0xffd9a8, glow: 0xffc98d },
    { name: "Low Sun",
      fog: 0xd2a08c, sun: 0xffc98d, ambient: 0x9aa8e0, rim: 0xffbc80,
      leafTop: 0x8f9e54, leafBack: 0xd0be7a,
      hazeTop: 0xe0b79e, hazeBot: 0x9a7570, moteColor: 0xffcb9c, glow: 0xffb87c },
    { name: "Amber Fade",
      fog: 0xb98a92, sun: 0xffb87e, ambient: 0x8f9cd8, rim: 0xffab77,
      leafTop: 0x7c8d50, leafBack: 0xbaab72,
      hazeTop: 0xcb9fa4, hazeBot: 0x836572, moteColor: 0xffbc90, glow: 0xffa76c },
    { name: "Blue Hour",
      fog: 0x94759c, sun: 0xf7a878, ambient: 0x8494d4, rim: 0xf59a72,
      leafTop: 0x687d50, leafBack: 0x9c9670,
      hazeTop: 0xa987ae, hazeBot: 0x655a7e, moteColor: 0xe8b2a0, glow: 0xe89570 },
    { name: "Violet Gallery",
      fog: 0x6d5f9c, sun: 0xe0946e, ambient: 0x7d8ed0, rim: 0xd98a6c,
      leafTop: 0x546d4e, leafBack: 0x7d8168,
      hazeTop: 0x8272ac, hazeBot: 0x494780, moteColor: 0xc9a8be, glow: 0xc98a80 },
    { name: "Indigo Hollow",
      fog: 0x4b4a92, sun: 0xc47e66, ambient: 0x7a8ad2, rim: 0xb69ad8,
      leafTop: 0x43604c, leafBack: 0x647060,
      hazeTop: 0x5e5da2, hazeBot: 0x333272, moteColor: 0xc0c4f0, glow: 0xa290d8 },
    /* 夜色最深的一层。正典是青绿萤火，黄昏这里换成**冷紫的月光**。 */
    { name: "Nightfall Deep",
      fog: 0x2e3480, sun: 0xa8708c, ambient: 0x8496e0, rim: 0xd0c0ff,
      leafTop: 0x35544a, leafBack: 0x4e6058,
      hazeTop: 0x3f4390, hazeBot: 0x1f2160, moteColor: 0xd8ccff, glow: 0xb49cff },
    { name: "Moonlit Heart",
      fog: 0x232a6e, sun: 0xffd8b0, ambient: 0x9ab0ee, rim: 0xffe6c4,
      leafTop: 0x3d6252, leafBack: 0x5d7364,
      hazeTop: 0x343c82, hazeBot: 0x161a52, moteColor: 0xffe4c0, glow: 0xffcf9c }
  ]),
  world: {
    bark: 0x53433f, barkDark: 0x2a2028, barkLight: 0x74605c,
    moss: 0x4e6a44, mossLight: 0x7a9660, mossDark: 0x2c3a24,
    vine: 0x415c3c, stem: 0x5e764a,
    mushroomCap: 0xc4645c, mushroomStem: 0xd8c4b4,
    mushroomGlowCap: 0x8a7ad0, flower: 0xffb0c8, flowerAlt: 0xffd49a,
    petal: 0xffeef4, soil: 0x33262c, water: 0x9aa8d8,
    silk: 0xe4e0ff, seed: 0xeadcc0
  }
};

/**
 * RAIN — 雨夜.
 *
 * Everything is wet. Cold grey-green haze in the crown, thinning light, and
 * bioluminescence taking over completely by the bottom.
 */
const RAIN = {
  id: "rain",
  name: "Rain",
  nameZh: "雨夜",
  blurb: "Everything is wet. Grey light above, cold lanterns below.",
  insectBias: ["red", "orange", "yellow", "white", "pink"],
  zones: zonesFrom([
    { name: "Grey Crown",
      fog: 0xb9c4bd, sun: 0xe4ecec, ambient: 0xaebcd0, rim: 0xdcecec,
      leafTop: 0x6f9060, leafBack: 0xa8c090,
      hazeTop: 0xc9d4cc, hazeBot: 0x92a099, moteColor: 0xdcecf4, glow: 0xcfe4e8 },
    { name: "Drizzle Bough",
      fog: 0xa6b6b2, sun: 0xd8e4e8, ambient: 0xa0b2ca, rim: 0xd0e4e8,
      leafTop: 0x628a54, leafBack: 0x9ab486,
      hazeTop: 0xb8c8c4, hazeBot: 0x849490, moteColor: 0xd0e4f0, glow: 0xc0dce4 },
    { name: "Wet Terrace",
      fog: 0x92a8a8, sun: 0xc8dce4, ambient: 0x92a6c2, rim: 0xc0dce4,
      leafTop: 0x567c4c, leafBack: 0x8aa87c,
      hazeTop: 0xa6bcbc, hazeBot: 0x748886, moteColor: 0xc4dcec, glow: 0xb0d4e0 },
    { name: "Streaming Landing",
      fog: 0x7c9aa0, sun: 0xb8d0dc, ambient: 0x8498ba, rim: 0xb0d4e0,
      leafTop: 0x4a7248, leafBack: 0x7a9c72,
      hazeTop: 0x92aeb2, hazeBot: 0x647c7e, moteColor: 0xb8d8ec, glow: 0xa0cce0 },
    { name: "Runoff Gallery",
      fog: 0x648c96, sun: 0xa4c4d4, ambient: 0x7a8eb2, rim: 0xa0cce0,
      leafTop: 0x3e6a4a, leafBack: 0x6a9068,
      hazeTop: 0x7aa2aa, hazeBot: 0x4e7076, moteColor: 0xacd4ec, glow: 0x90c4dc },
    { name: "Pool Hollow",
      fog: 0x4a7c8c, sun: 0x90b4c8, ambient: 0x7288b0, rim: 0x9ae0e8,
      leafTop: 0x346249, leafBack: 0x5c8460,
      hazeTop: 0x60929e, hazeBot: 0x3a626c, moteColor: 0xa8e8f4, glow: 0x7ad4dc },
    /* 雨夜最深处，正典的青绿萤火在这里是全场唯一的光源，所以推得更亮更冷。 */
    { name: "Lantern Deep",
      fog: 0x2c5c74, sun: 0x7098b4, ambient: 0x6c84ac, rim: 0x9cf0e4,
      leafTop: 0x2a5844, leafBack: 0x4c7658,
      hazeTop: 0x3e7688, hazeBot: 0x224a5e, moteColor: 0xa8ffe0, glow: 0x74f0c4 },
    { name: "Flooded Heart",
      fog: 0x1e4660, sun: 0x9cc0d8, ambient: 0x7e9ac4, rim: 0xc4f4ff,
      leafTop: 0x2e6450, leafBack: 0x548064,
      hazeTop: 0x2e5e78, hazeBot: 0x143548, moteColor: 0xc8f4ff, glow: 0x8ce0f4 }
  ]),
  world: {
    bark: 0x4e4a44, barkDark: 0x2a2824, barkLight: 0x6e6a60,
    moss: 0x4a7040, mossLight: 0x74a058, mossDark: 0x28401e,
    vine: 0x3c6236, stem: 0x568044,
    mushroomCap: 0xb06a5e, mushroomStem: 0xc8c4b8,
    mushroomGlowCap: 0x4ac0c4, flower: 0xf0b8cc, flowerAlt: 0xe8d8a0,
    petal: 0xf4f6f8, soil: 0x36302a, water: 0xa8d8e8,
    silk: 0xe8f6ff, seed: 0xe4dcc4
  }
};


/**
 * ICE — 浮冰.
 *
 * 用**真的叶片渲染器**画冰。这不是将就 —— `leaf.js` 的次表面透光正好是冰最需要
 * 的东西：薄处透光发白、厚处压出蓝、边缘卷唇变成冰檐。把 leafTop/leafBack 换成
 * 冰的蓝白，那套 shader 立刻在为冰工作。
 *
 * 上一版我手搓了一块顶点色冰板，明显比正典廉价，原因就在这里：质量在 shader 里，
 * 不在我的几何里。
 *
 * `canopy: "ice"` 让 art-canopy.js 把视差壳重画成漂浮的碎冰 —— 背景的「树感」
 * 来自那张贴图画的是叶子，换掉画的内容就换掉了世界。
 */
const ICE = {
  id: "ice",
  name: "Ice Floe",
  nameZh: "浮冰",
  blurb: "Translucent floes adrift, deep water below.",
  canopy: "ice",
  // 冷世界配暖虫：红橙黄在冰蓝上是全场最跳的东西，铁律自动成立。
  insectBias: ["red", "orange", "yellow", "white", "pink"],
  zones: zonesFrom([
    { name: "Glare Field",
      fog: 0xdceaf4, sun: 0xffffff, ambient: 0xbcd8f0, rim: 0xffffff,
      leafTop: 0xcfe8f6, leafBack: 0xf2fbff,
      hazeTop: 0xcadeee, hazeBot: 0xb4ccdd, moteColor: 0xffffff, glow: 0xe8f6ff },
    { name: "Drift Shelf",
      fog: 0xc4dcec, sun: 0xf4fbff, ambient: 0xaccce8, rim: 0xf4feff,
      leafTop: 0xb8dcf0, leafBack: 0xe4f6ff,
      hazeTop: 0xb4cee2, hazeBot: 0x9cbad0, moteColor: 0xf4fdff, glow: 0xd4eeff },
    { name: "Blue Shelf",
      fog: 0xa4c8e0, sun: 0xe8f4ff, ambient: 0x94bce0, rim: 0xe4f8ff,
      leafTop: 0x9cccea, leafBack: 0xd0ecfc,
      hazeTop: 0x9cbcd6, hazeBot: 0x80a4c0, moteColor: 0xe8f8ff, glow: 0xbce4ff },
    { name: "Meltwater",
      fog: 0x80acd0, sun: 0xd8ecff, ambient: 0x7cacd8, rim: 0xd0f0ff,
      leafTop: 0x7cb8e0, leafBack: 0xb4dcf4,
      hazeTop: 0x7ea6c6, hazeBot: 0x648cae, moteColor: 0xd8f0ff, glow: 0x9cd4f8 },
    { name: "Deep Shelf",
      fog: 0x5c8cb8, sun: 0xc0dcf8, ambient: 0x6498cc, rim: 0xb8e4ff,
      leafTop: 0x5c9cce, leafBack: 0x94c8e8,
      hazeTop: 0x5e88ae, hazeBot: 0x486c94, moteColor: 0xc4e8ff, glow: 0x7cc0f0 },
    { name: "Under Ice",
      fog: 0x3c6c9c, sun: 0xb4d4f4, ambient: 0x5c94cc, rim: 0xb4ecff,
      leafTop: 0x5a9ccc, leafBack: 0x9ccce8,
      hazeTop: 0x56809c, hazeBot: 0x2e5078, moteColor: 0xc4ecff, glow: 0x7cc8f4 },
    /* 冰下最深的一层。正典在这一拍把辉光切成生物荧光青绿；浮冰切成**极光的
       青绿**，同样是和上下都不同调的那一记，只是换成了这个世界的语言。 */
    /* 极光深处。这一拍要有「灯笼」感 —— 正典靠的不是环境光，是**叶子本身亮**
       加一记跳色的辉光。之前把 leafTop 压到 0x2e5c88，整块冰沉进背景，青绿辉光
       被深蓝吃掉。现在把冰body抬到发光的青绿，让它自己是光源。 */
    { name: "Aurora Deep",
      fog: 0x22486e, sun: 0x8cc4d8, ambient: 0x4c9cc4, rim: 0xa8ffe4,
      leafTop: 0x46a496, leafBack: 0x8ce0c8,
      hazeTop: 0x2e6478, hazeBot: 0x18324e, moteColor: 0xb4ffe8, glow: 0x74ffcc },
    { name: "Black Water",
      fog: 0x142c48, sun: 0xd8ecff, ambient: 0x6c9cd4, rim: 0xeafaff,
      leafTop: 0x5a92bc, leafBack: 0x9cc8e4,
      hazeTop: 0x1e3c5c, hazeBot: 0x0c1c30, moteColor: 0xeafaff, glow: 0xbce8ff }
  ]),
  world: {
    /* 冰崖要**暗**。
       第一版把 bark 设成 0x7e94a6（红 0.49），配 zone 2 的 sunInt 2.6 和 ACES
       直接吹爆成白，整张图挤在一档浅蓝里没有明暗结构。正典的 bark 是 0x6b5140,
       红通道只有 0.42 —— 它扛得住同样的光靠的是低反照率，不是靠调光。
       所以这里压到和正典同量级的暗度，只是把色相从暖褐换成冷蓝。 */
    bark: 0x3c5468, barkDark: 0x18283a, barkLight: 0x647f98,
    // 苔藓变成附在冰上的霜和藻，同样压暗。
    moss: 0x406478, mossLight: 0x7ea4b8, mossDark: 0x203848,
    vine: 0x365468, stem: 0x4e7288,
    mushroomCap: 0x5e8ca8, mushroomStem: 0xb4ccdc,
    mushroomGlowCap: 0x3cc8b0, flower: 0xc8e4fa, flowerAlt: 0xa8d8ee,
    petal: 0xeaf6ff, soil: 0x14222e, water: 0x6cb4d4,
    silk: 0xeaf8ff, seed: 0xdcecf4
  }
};

export const SKINS = Object.freeze({
  canon: {
    id: "canon",
    name: "Deep Canopy",
    nameZh: "深林",
    blurb: "The shipped world. Green crown to luminous root garden.",
    insectBias: null,
    canopy: null,
    zones: CANON_ZONES,
    world: CANON_WORLD
  },
  ice: ICE,
  autumn: AUTUMN,
  dusk: DUSK,
  rain: RAIN
});

export const SKIN_IDS = Object.freeze(Object.keys(SKINS));

export function skinById(id) {
  return SKINS[id] || SKINS.canon;
}

/**
 * Install a skin by rewriting the live palette objects in place.
 *
 * In place is the whole point: every renderer holds a reference to these exact
 * objects (or reads them through `zoneFor`), so mutating fields re-skins a
 * scene that is already built. Reassigning the exports would change nothing.
 *
 * Returns the skin, so callers can read `insectBias`.
 */
export function applySkin(id) {
  const skin = skinById(id);
  for (let index = 0; index < ZONES.length; index += 1) {
    const source = skin.zones[index] || CANON_ZONES[index];
    for (const field of ZONE_FIELDS) {
      if (source[field] !== undefined) ZONES[index][field] = source[field];
    }
    // `id` is what the renderers use to compute depth (`z.id / 7`), so it must
    // keep matching the slot, never the source object's own numbering.
    ZONES[index].id = index;
  }
  for (const field of WORLD_FIELDS) {
    if (skin.world?.[field] !== undefined) WORLD[field] = skin.world[field];
    else WORLD[field] = CANON_WORLD[field];
  }
  return skin;
}

/** Put the shipped palette back. Beginner and Advanced must never see a skin. */
export function restoreCanon() {
  return applySkin("canon");
}
