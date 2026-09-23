/**
 * MOSSFALL — colour.
 *
 * Two jobs. First, the beetles: they are the only fully saturated things in the
 * game, so they stay the most legible objects on screen no matter how busy the
 * canopy gets behind them. Everything in the world is desaturated relative to
 * these swatches on purpose.
 *
 * Second, the descent. Eight zones carry the journey from the hot open crown
 * down into the cool luminous root garden — light drops, the fog cools and
 * thickens, and the glow sources shift from sunlight to bioluminescence. The
 * palette *is* the sense of depth; the geometry only agrees with it.
 */

/** Beetles. `shell` is the body, `shellDark` the underside, `glow` the capture flash. */
export const INSECTS = {
  red: {
    name: 'Ember',
    shell: 0xf0453c, shellDark: 0x9b1f1c, spot: 0x2a1512,
    glow: 0xff8a6b, accent: 0xffd9c9, hue: 4,
  },
  yellow: {
    name: 'Buttercup',
    shell: 0xffc21f, shellDark: 0xc17d05, spot: 0x40260a,
    glow: 0xffe89a, accent: 0xfff3cc, hue: 44,
  },
  blue: {
    name: 'Inkcap',
    shell: 0x3f8ef5, shellDark: 0x1d4ba8, spot: 0x10203f,
    glow: 0x9ed0ff, accent: 0xd6ecff, hue: 212,
  },
  green: {
    name: 'Sorrel',
    shell: 0x4fd06a, shellDark: 0x1f7c3c, spot: 0x123320,
    glow: 0xa8f5b6, accent: 0xdcffe3, hue: 133,
  },
  purple: {
    name: 'Thistle',
    shell: 0xa96bf0, shellDark: 0x6535a6, spot: 0x241242,
    glow: 0xd9b4ff, accent: 0xefe1ff, hue: 272,
  },
  teal: {
    name: 'Dewling',
    shell: 0x2fc8bd, shellDark: 0x137a76, spot: 0x0d3231,
    glow: 0x9ff2ea, accent: 0xd8fffb, hue: 176,
  },
  orange: {
    name: 'Marigold',
    shell: 0xff8a2b, shellDark: 0xb84f06, spot: 0x3d1c06,
    glow: 0xffc389, accent: 0xffe6cc, hue: 26,
  },
};

export const INSECT_KEYS = Object.keys(INSECTS);
export const insect = (key) => INSECTS[key] || INSECTS.red;

/**
 * Depth zones, top to bottom. `fogNear/Far` are in world metres from the camera.
 * `motes` is the ambient particle family; `bloom` scales the post pass.
 */
export const ZONES = [
  {
    id: 0, name: 'Sunlit Crown',
    fog: 0xbfe6a8, fogNear: 26, fogFar: 132,
    sun: 0xfff2c8, sunInt: 3.1, ambient: 0xa8d2ff, ambientInt: 0.85,
    rim: 0xfff0b0, leafTop: 0x8fd45a, leafBack: 0xd6f08a,
    hazeTop: 0xd9f5b8, hazeBot: 0x8dc06a,
    bloom: 0.55, motes: 'pollen', moteColor: 0xfff0b8, glow: 0xffe9a8,
  },
  {
    id: 1, name: 'Heart Bough',
    fog: 0xa9dc9a, fogNear: 24, fogFar: 124,
    sun: 0xffeab4, sunInt: 2.85, ambient: 0x9ccbf5, ambientInt: 0.82,
    rim: 0xffe7a4, leafTop: 0x7fc94f, leafBack: 0xcbe97e,
    hazeTop: 0xcdeeae, hazeBot: 0x7fb45f,
    bloom: 0.55, motes: 'pollen', moteColor: 0xffeaa8, glow: 0xffdf95,
  },
  {
    id: 2, name: 'Vein Terrace',
    fog: 0x93cf95, fogNear: 22, fogFar: 116,
    sun: 0xffe3a8, sunInt: 2.6, ambient: 0x92c2ee, ambientInt: 0.8,
    rim: 0xffdf9a, leafTop: 0x6fbe4a, leafBack: 0xbde077,
    hazeTop: 0xbfe6a6, hazeBot: 0x6fa75b,
    bloom: 0.6, motes: 'pollen', moteColor: 0xffe3a0, glow: 0xffd68a,
  },
  {
    id: 3, name: 'Beetle Landing',
    fog: 0x7cc39c, fogNear: 20, fogFar: 108,
    sun: 0xffdb9e, sunInt: 2.35, ambient: 0x87bce9, ambientInt: 0.82,
    rim: 0xffd68f, leafTop: 0x5eb35a, leafBack: 0xa8d977,
    hazeTop: 0xaadfae, hazeBot: 0x5f9b62,
    bloom: 0.65, motes: 'spore', moteColor: 0xf6ecc0, glow: 0xffcf82,
  },
  {
    id: 4, name: 'Split Gallery',
    fog: 0x62b4a4, fogNear: 18, fogFar: 98,
    sun: 0xffd08f, sunInt: 2.05, ambient: 0x7cb4e6, ambientInt: 0.88,
    rim: 0xffcb84, leafTop: 0x4ea567, leafBack: 0x94cf7e,
    hazeTop: 0x92d6b6, hazeBot: 0x4d8d70,
    bloom: 0.72, motes: 'spore', moteColor: 0xe8eec6, glow: 0xffc477,
  },
  {
    id: 5, name: 'Dew Hollow',
    fog: 0x47a0a6, fogNear: 16, fogFar: 88,
    sun: 0xffc98a, sunInt: 1.75, ambient: 0x74b0e4, ambientInt: 0.95,
    rim: 0xa9f0ea, leafTop: 0x3f9670, leafBack: 0x80c489,
    hazeTop: 0x74c6bd, hazeBot: 0x3a7d80,
    bloom: 0.85, motes: 'droplet', moteColor: 0xcdf3ff, glow: 0x8fe8de,
  },
  {
    id: 6, name: 'Lantern Deep',
    fog: 0x2d7b93, fogNear: 14, fogFar: 76,
    sun: 0xffbf86, sunInt: 1.35, ambient: 0x6ea4dd, ambientInt: 1.05,
    rim: 0x9ce8ff, leafTop: 0x36846b, leafBack: 0x6cae83,
    hazeTop: 0x4f9fb2, hazeBot: 0x255f76,
    bloom: 1.0, motes: 'firefly', moteColor: 0xc7f8b0, glow: 0x7fe0b4,
  },
  {
    id: 7, name: 'Ancient Heart',
    fog: 0x255f7f, fogNear: 12, fogFar: 68,
    sun: 0xffd7a0, sunInt: 1.55, ambient: 0x7fb0e0, ambientInt: 1.15,
    rim: 0xffe7b8, leafTop: 0x3d9a76, leafBack: 0x84c99a,
    hazeTop: 0x468da8, hazeBot: 0x1d4d68,
    bloom: 1.15, motes: 'firefly', moteColor: 0xffe9a8, glow: 0xffd98f,
  },
];

export const zoneFor = (i) => ZONES[Math.max(0, Math.min(ZONES.length - 1, i | 0))];

/** Materials shared across the world build. Kept here so a re-tint is one edit. */
export const WORLD = {
  bark: 0x6b5140, barkDark: 0x3c2c22, barkLight: 0x8f7256,
  moss: 0x5f8f42, mossLight: 0x8fbc5f, mossDark: 0x35521f,
  vine: 0x4a7a3a, stem: 0x6f9a4a,
  mushroomCap: 0xd9694f, mushroomStem: 0xdcc9aa,
  // Saturated, not pale. A lantern reads as a lantern because it is a strong
  // colour with light coming out of it; a near-white cap under the board's fill
  // just clips, and then two mushrooms are brighter than the beetle the player
  // is supposed to be watching. The glow comes from the emissive in props.js.
  mushroomGlowCap: 0x46a394, flower: 0xffb8d9, flowerAlt: 0xffe08a,
  petal: 0xfff0f6, soil: 0x4a3728, water: 0x9fd8e8,
  silk: 0xdff3ff, seed: 0xf2e6c2,
};

/** Kept in sync by hand with styles/ui.css — used where JS must match CSS. */
export const UI = {
  ink: '#0e1a13',
  paper: 'rgba(238, 252, 232, 0.92)',
  glass: 'rgba(226, 246, 214, 0.14)',
  glassLine: 'rgba(255, 255, 255, 0.34)',
  gold: '#ffd98f',
  leaf: '#8fd45a',
  deep: '#0b2a2b',
  danger: '#ff8a6b',
};
