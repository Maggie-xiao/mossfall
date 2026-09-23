export const BASE_BALL_RADIUS = 0.058;
export const PREVIOUS_BALL_RADIUS =
  BASE_BALL_RADIUS * Math.cbrt(2);
export const BALL_RADIUS_SCALE = 1.6;
export const BALL_RADIUS =
  PREVIOUS_BALL_RADIUS * BALL_RADIUS_SCALE;
export const BUG_RADIUS = 0.3;

const GAMEPLAY = Object.freeze({
  captureHoldSec: 0.075,
  fallMode: "board-reset"
});

const SPECIES_BY_COLOR = Object.freeze({
  red: "ladybug",
  black: "scarab",
  teal: "firefly",
  pink: "firefly",
  white: "weevil",
  green: "beetle",
  yellow: "beetle",
  orange: "roly"
});

const JOURNEY = Object.freeze([
  {
    origin: { x: 0, y: 0, z: 0 },
    descent: {
      drop: 34,
      duration: 4.4,
      beats: ["sunshaft", "leafbrush", "butterflies"],
      swirl: 0.3
    }
  },
  {
    origin: { x: 1.6, y: -40, z: 0.6 },
    descent: {
      drop: 40,
      duration: 4.7,
      beats: ["leafbrush", "vines", "squirrel"],
      swirl: 0.38
    }
  },
  {
    origin: { x: -1.8, y: -86, z: -0.4 },
    descent: {
      drop: 46,
      duration: 5,
      beats: ["hollow", "butterflies", "leafbrush"],
      swirl: 0.34
    }
  },
  {
    origin: { x: 0.9, y: -138, z: 1.1 },
    descent: {
      drop: 52,
      duration: 5.4,
      beats: ["vines", "squirrel", "hollow"],
      swirl: 0.42
    }
  },
  {
    origin: { x: -2.2, y: -196, z: 0.2 },
    descent: {
      drop: 58,
      duration: 5.9,
      beats: ["droplets", "vines", "waterfall"],
      swirl: 0.36
    }
  },
  {
    origin: { x: 1.4, y: -262, z: -0.5 },
    descent: {
      drop: 66,
      duration: 6.4,
      beats: ["waterfall", "droplets", "dark", "fireflies"],
      swirl: 0.3
    }
  },
  {
    origin: { x: -1.2, y: -336, z: 0.9 },
    descent: {
      drop: 74,
      duration: 7,
      beats: ["dark", "hollow", "fireflies", "roots"],
      swirl: 0.26
    }
  },
  {
    origin: { x: 0.6, y: -420, z: -0.2 },
    descent: {
      drop: 84,
      duration: 7.8,
      beats: ["roots", "garden", "fireflies", "sunshaft"],
      swirl: 0.22
    }
  }
]);

function bug(id, color, x, z, mass = 1) {
  return {
    id,
    color,
    species: SPECIES_BY_COLOR[color],
    x,
    z,
    r: BUG_RADIUS,
    mass
  };
}

function hole(id, color, x, z, r = 0.46) {
  return {
    id,
    color,
    x,
    z,
    r,
    target: true,
    style: "bite",
    glow: 0
  };
}

function journey(index, mirrored = false) {
  const source = JOURNEY[index];
  return {
    origin: {
      x: mirrored ? -source.origin.x : source.origin.x,
      y: source.origin.y,
      z: mirrored ? -source.origin.z : source.origin.z
    },
    descent: {
      drop: source.descent.drop,
      duration: source.descent.duration,
      beats: [...source.descent.beats],
      swirl: mirrored
        ? -source.descent.swirl
        : source.descent.swirl
    }
  };
}

function level({
  id,
  name,
  zone,
  maxTilt,
  board,
  bugs,
  props = [],
  mirrored = false
}) {
  const travel = journey(zone, mirrored);
  return {
    id,
    name,
    zone,
    origin: travel.origin,
    descent: travel.descent,
    maxTilt,
    board: {
      shapes: board.shapes,
      smooth: board.smooth,
      features: board.features,
      holes: board.holes,
      obstacles: board.obstacles,
      movers: board.movers
    },
    bugs,
    props,
    gameplay: { ...GAMEPLAY }
  };
}

const beginnerLevels = [
  level({
    id: "B01",
    name: "Wide Ellipse Leaf",
    zone: 0,
    maxTilt: 0.18,
    board: {
      shapes: [
        { kind: "ellipse", x: 0, z: 0, rx: 3.8, rz: 2.7, rot: 0 }
      ],
      smooth: 0.35,
      features: [
        { kind: "dish", amp: -0.07, r: 3.5, x: 0, z: 0.1 },
        { kind: "curl", amp: 0.44, width: 0.95 },
        {
          kind: "vein",
          amp: -0.035,
          width: 0.7,
          taper: 0,
          pts: [[0, 1.8], [0, 0.2], [0, -1.45]]
        },
        { kind: "ripple", amp: 0.004, scale: 1.7 }
      ],
      holes: [
        hole("HOLE_01", "green", 0, -1.05, 0.5)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "green", 0, 0.45)
    ]
  }),
  level({
    id: "B02",
    name: "Twin-Lobe Figure Eight",
    zone: 1,
    maxTilt: 0.185,
    board: {
      shapes: [
        {
          kind: "ellipse",
          x: -1.65,
          z: 0,
          rx: 2.15,
          rz: 2.35,
          rot: -0.08
        },
        {
          kind: "ellipse",
          x: 1.65,
          z: 0,
          rx: 2.15,
          rz: 2.35,
          rot: 0.08
        }
      ],
      smooth: 0.32,
      features: [
        { kind: "dish", amp: -0.06, r: 4, x: 0, z: 0 },
        { kind: "curl", amp: 0.42, width: 0.9 },
        {
          kind: "vein",
          amp: -0.04,
          width: 0.62,
          taper: 0,
          pts: [[-2.35, 0.4], [0, 0], [2, -0.85]]
        },
        { kind: "dish", amp: -0.08, r: 1.1, x: 2, z: -0.85 },
        { kind: "ripple", amp: 0.004, scale: 1.8 }
      ],
      holes: [
        hole("HOLE_01", "orange", 2, -0.85, 0.48)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "green", -2.15, 0.35),
      bug("BALL_02", "orange", 0.65, 0.65)
    ]
  }),
  level({
    id: "B03",
    name: "Four-Lobed Cross",
    zone: 2,
    maxTilt: 0.19,
    board: {
      shapes: [
        { kind: "capsule", ax: 0, az: 0, bx: -2.45, bz: -2.45, r: 1.18 },
        { kind: "capsule", ax: 0, az: 0, bx: -2.45, bz: 2.45, r: 1.18 },
        { kind: "capsule", ax: 0, az: 0, bx: 2.45, bz: -2.45, r: 1.18 },
        { kind: "capsule", ax: 0, az: 0, bx: 2.45, bz: 2.45, r: 1.18 }
      ],
      smooth: 0.36,
      features: [
        { kind: "dish", amp: -0.06, r: 4.4, x: 0, z: 0 },
        { kind: "curl", amp: 0.41, width: 0.88 },
        {
          kind: "vein",
          amp: -0.035,
          width: 0.58,
          taper: 0,
          pts: [[-2.5, -2.5], [0, 0], [2.5, 2.5]]
        },
        {
          kind: "vein",
          amp: -0.035,
          width: 0.58,
          taper: 0,
          pts: [[-2.5, 2.5], [0, 0], [2.5, -2.5]]
        },
        { kind: "ripple", amp: 0.0038, scale: 1.9 }
      ],
      holes: [
        hole("HOLE_01", "orange", -1.75, 1.75),
        hole("HOLE_02", "green", 1.75, -1.75)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "orange", -1.75, -1.75),
      bug("BALL_02", "green", 1.75, 1.75)
    ]
  }),
  level({
    id: "B04",
    name: "Three-Lobed Pinwheel",
    zone: 3,
    maxTilt: 0.195,
    board: {
      shapes: [
        { kind: "disc", x: 0, z: 0, r: 1.35 },
        { kind: "capsule", ax: 0, az: 0, bx: 0, bz: -2.65, r: 1.16 },
        { kind: "capsule", ax: 0, az: 0, bx: -2.3, bz: 1.33, r: 1.16 },
        { kind: "capsule", ax: 0, az: 0, bx: 2.3, bz: 1.33, r: 1.16 }
      ],
      smooth: 0.36,
      features: [
        { kind: "curl", amp: 0.4, width: 0.88 },
        { kind: "dish", amp: -0.13, r: 1.45, x: 0, z: 0 },
        {
          kind: "vein",
          amp: -0.035,
          width: 0.56,
          taper: 0,
          pts: [[0, -2.5], [0, 0]]
        },
        {
          kind: "vein",
          amp: -0.035,
          width: 0.56,
          taper: 0,
          pts: [[-2.2, 1.25], [0, 0], [2.2, 1.25]]
        },
        { kind: "ripple", amp: 0.0038, scale: 2 }
      ],
      holes: [
        hole("HOLE_01", "orange", 0, 0, 0.52)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "orange", 0, -2.35),
      bug("BALL_02", "green", -2.03, 1.17),
      bug("BALL_03", "pink", 2.03, 1.17)
    ]
  }),
  level({
    id: "B05",
    name: "Three-Part Serpentine",
    zone: 4,
    maxTilt: 0.2,
    board: {
      shapes: [
        { kind: "ellipse", x: -2.2, z: -1.2, rx: 1.75, rz: 1.55, rot: 0.32 },
        { kind: "ellipse", x: 0, z: 0, rx: 1.75, rz: 1.55, rot: 0.32 },
        { kind: "ellipse", x: 2.2, z: 1.2, rx: 1.75, rz: 1.55, rot: 0.32 },
        { kind: "capsule", ax: -2.0, az: -1.1, bx: 0, bz: 0, r: 0.78 },
        { kind: "capsule", ax: 0, az: 0, bx: 2.0, bz: 1.1, r: 0.78 }
      ],
      smooth: 0.32,
      features: [
        { kind: "curl", amp: 0.4, width: 0.84 },
        {
          kind: "vein",
          amp: -0.04,
          width: 0.58,
          taper: 0,
          pts: [[-2.7, -1.35], [-1.1, -0.75], [0, 0], [1.1, 0.7], [2.5, 1.3]]
        },
        { kind: "dish", amp: -0.075, r: 1.05, x: -1.85, z: -1 },
        { kind: "dish", amp: -0.075, r: 1.05, x: 2.25, z: 1.15 },
        { kind: "ripple", amp: 0.0036, scale: 2.1 }
      ],
      holes: [
        hole("HOLE_01", "orange", -1.85, -1),
        hole("HOLE_02", "green", 2.25, 1.15)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "orange", -3, -0.9),
      bug("BALL_02", "pink", -0.45, -0.2),
      bug("BALL_03", "green", 1.25, 0.7)
    ]
  }),
  level({
    id: "B06",
    name: "Five-Leaf Rosette",
    zone: 5,
    maxTilt: 0.205,
    board: {
      shapes: [
        { kind: "lobe", x: 0, z: 0, r: 3.7, lobes: 5, depth: 0.18, rot: 0.32 },
        { kind: "disc", x: 0, z: 0, r: 2.25 }
      ],
      smooth: 0.38,
      features: [
        { kind: "dish", amp: -0.075, r: 3.6, x: 0, z: 0 },
        { kind: "curl", amp: 0.39, width: 0.86 },
        {
          kind: "vein",
          amp: 0.032,
          width: 0.5,
          taper: 0.65,
          pts: [[0, 0], [2.7, 0]]
        },
        {
          kind: "vein",
          amp: 0.032,
          width: 0.5,
          taper: 0.65,
          pts: [[0, 0], [-2.2, -1.6]]
        },
        {
          kind: "vein",
          amp: 0.032,
          width: 0.5,
          taper: 0.65,
          pts: [[0, 0], [-0.2, 2.8]]
        },
        { kind: "dish", amp: -0.07, r: 1.1, x: 1.5, z: 0 },
        { kind: "ripple", amp: 0.0035, scale: 2.2 }
      ],
      holes: [
        hole("HOLE_01", "orange", 1.5, 0, 0.5)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "white", -1.8, 0),
      bug("BALL_02", "green", 0, -1.8),
      bug("BALL_03", "orange", 0, 0),
      bug("BALL_04", "pink", -0.1, 1.8)
    ]
  }),
  level({
    id: "B07",
    name: "Opposed Twin Leaves",
    zone: 6,
    maxTilt: 0.21,
    board: {
      shapes: [
        {
          kind: "ellipse",
          x: -2.35,
          z: 0,
          rx: 1.65,
          rz: 2.25,
          rot: -0.15
        },
        {
          kind: "ellipse",
          x: 2.35,
          z: 0,
          rx: 1.65,
          rz: 2.25,
          rot: 0.15
        }
      ],
      smooth: 0.22,
      features: [
        { kind: "curl", amp: 0.4, width: 0.86 },
        { kind: "dish", amp: -0.08, r: 1.1, x: -2.65, z: 0.15 },
        { kind: "dish", amp: -0.08, r: 1.1, x: 2.65, z: -0.55 },
        {
          kind: "vein",
          amp: -0.035,
          width: 0.5,
          taper: 0,
          pts: [[-2.55, -1.65], [-2.35, 0], [-2.25, 1.65]]
        },
        {
          kind: "vein",
          amp: -0.035,
          width: 0.5,
          taper: 0,
          pts: [[2.55, -1.65], [2.35, 0], [2.25, 1.65]]
        },
        { kind: "ripple", amp: 0.0034, scale: 2.3 }
      ],
      holes: [
        hole("HOLE_01", "white", -2.65, 0.15),
        hole("HOLE_02", "orange", 2.65, -0.55)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "white", -2, -1.25),
      bug("BALL_02", "green", -2.3, 1.25),
      bug("BALL_03", "orange", 1.55, -0.75),
      bug("BALL_04", "pink", 1.85, 0.55),
      bug("BALL_05", "black", 2.8, 1.15)
    ]
  }),
  level({
    id: "B08",
    name: "Four-Part W Leaf",
    zone: 7,
    maxTilt: 0.215,
    board: {
      shapes: [
        { kind: "capsule", ax: -3.2, az: -1.2, bx: -1.6, bz: 1.15, r: 1.08 },
        { kind: "capsule", ax: -1.6, az: 1.15, bx: 0, bz: -0.65, r: 1.08 },
        { kind: "capsule", ax: 0, az: -0.65, bx: 1.6, bz: 1.15, r: 1.08 },
        { kind: "capsule", ax: 1.6, az: 1.15, bx: 3.2, bz: -1.2, r: 1.08 }
      ],
      smooth: 0.32,
      features: [
        { kind: "curl", amp: 0.38, width: 0.55 },
        {
          kind: "vein",
          amp: -0.04,
          width: 0.54,
          taper: 0,
          pts: [[-3.2, -1.2], [-1.6, 1.15], [0, -0.65], [1.6, 1.15], [3.2, -1.2]]
        },
        { kind: "dish", amp: -0.055, r: 0.65, x: -2.4, z: -0.025 },
        { kind: "dish", amp: -0.055, r: 0.65, x: -0.8, z: 0.25 },
        { kind: "dish", amp: -0.055, r: 0.65, x: 0.8, z: 0.25 },
        { kind: "dish", amp: -0.055, r: 0.65, x: 2.4, z: -0.025 },
        { kind: "ripple", amp: 0.0032, scale: 2.4 }
      ],
      holes: [
        hole("HOLE_01", "red", -2.4, -0.025, 0.44),
        hole("HOLE_02", "green", -0.8, 0.25, 0.44),
        hole("HOLE_03", "pink", 0.8, 0.25, 0.44),
        hole("HOLE_04", "black", 2.4, -0.025, 0.44)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "red", -3.45, -0.725),
      bug("BALL_02", "orange", -2.9, -1.625),
      bug("BALL_03", "green", -1.7, 1),
      bug("BALL_04", "white", -1.2, 1.6),
      bug("BALL_05", "pink", 0, -0.45),
      bug("BALL_06", "yellow", 0.225, -1.2),
      bug("BALL_07", "black", 1.7, 1),
      bug("BALL_08", "teal", 3.45, -0.725)
    ]
  })
];

const advancedLevels = [
  level({
    id: "A01",
    name: "Five-Lobed Star Leaf",
    zone: 0,
    maxTilt: 0.2,
    mirrored: true,
    board: {
      shapes: [
        { kind: "lobe", x: 0, z: 0, r: 3.9, lobes: 5, depth: 0.3, rot: 0.18 }
      ],
      smooth: 0.26,
      features: [
        { kind: "dish", amp: -0.055, r: 3.6, x: 0, z: 0 },
        { kind: "curl", amp: 0.3, width: 0.74 },
        {
          kind: "vein",
          amp: 0.045,
          width: 0.38,
          taper: 0.65,
          pts: [[0, 0], [2.75, -0.5]]
        },
        {
          kind: "vein",
          amp: 0.045,
          width: 0.38,
          taper: 0.65,
          pts: [[0, 0], [-2.35, -1.45]]
        },
        { kind: "dish", amp: -0.075, r: 1.05, x: 1.25, z: -0.2 },
        { kind: "ripple", amp: 0.0034, scale: 2.4 }
      ],
      holes: [
        hole("HOLE_01", "green", 1.25, -0.2)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "green", 0, 0.4)
    ]
  }),
  level({
    id: "A02",
    name: "Separated Twin Slopes",
    zone: 1,
    maxTilt: 0.205,
    mirrored: true,
    board: {
      shapes: [
        {
          kind: "ellipse",
          x: -2.2,
          z: 0,
          rx: 1.55,
          rz: 2.5,
          rot: -0.12
        },
        {
          kind: "ellipse",
          x: 2.2,
          z: 0,
          rx: 1.55,
          rz: 2.5,
          rot: 0.12
        }
      ],
      smooth: 0.2,
      features: [
        { kind: "curl", amp: 0.29, width: 0.72 },
        { kind: "dish", amp: -0.095, r: 2.25, x: -2.2, z: 1.05 },
        { kind: "dish", amp: -0.095, r: 2.25, x: 2.2, z: -1.05 },
        {
          kind: "vein",
          amp: 0.04,
          width: 0.4,
          taper: 0.4,
          pts: [[-2.2, -1.8], [-2.2, 1.8]]
        },
        {
          kind: "vein",
          amp: 0.04,
          width: 0.4,
          taper: 0.4,
          pts: [[2.2, -1.8], [2.2, 1.8]]
        },
        { kind: "ripple", amp: 0.0034, scale: 2.5 }
      ],
      holes: [
        hole("HOLE_01", "green", -2.2, 1.05),
        hole("HOLE_02", "orange", 2.2, -1.05)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "green", -2.2, -1.25),
      bug("BALL_02", "orange", 2.2, 1.25)
    ]
  }),
  level({
    id: "A03",
    name: "Subtractive Ring Leaf",
    zone: 2,
    maxTilt: 0.21,
    mirrored: true,
    board: {
      shapes: [
        { kind: "ellipse", x: 0, z: 0, rx: 4.2, rz: 3, rot: 0 },
        { kind: "disc", x: 0, z: 0, r: 1.45, sub: true }
      ],
      smooth: 0.22,
      features: [
        { kind: "curl", amp: 0.28, width: 0.7 },
        {
          kind: "vein",
          amp: -0.035,
          width: 0.48,
          taper: 0,
          pts: [[-2.8, -1.2], [0, -2], [2.7, 0], [0, 2], [-2.8, 1.2]]
        },
        { kind: "dish", amp: -0.07, r: 1.05, x: 2.7, z: 0 },
        { kind: "ripple", amp: 0.0032, scale: 2.6 }
      ],
      holes: [
        hole("HOLE_01", "green", 2.7, 0, 0.44)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "orange", -0.95, -2.2),
      bug("BALL_02", "green", 0.9, 2.1)
    ]
  }),
  level({
    id: "A04",
    name: "Fallen Branch Leaf",
    zone: 3,
    maxTilt: 0.215,
    mirrored: true,
    board: {
      shapes: [
        { kind: "ellipse", x: 0, z: 0, rx: 4.1, rz: 3.2, rot: 0 }
      ],
      smooth: 0.28,
      features: [
        { kind: "dish", amp: -0.055, r: 4, x: 0, z: 0 },
        { kind: "curl", amp: 0.28, width: 0.7 },
        {
          kind: "vein",
          amp: -0.035,
          width: 0.52,
          taper: 0,
          pts: [[-2.7, -2], [-0.7, -2.1], [0.8, -2.05], [2.5, -1.6]]
        },
        { kind: "dish", amp: -0.075, r: 1.05, x: 2.25, z: 0 },
        { kind: "ripple", amp: 0.0031, scale: 2.7 }
      ],
      holes: [
        hole("HOLE_01", "green", 2.25, 0)
      ],
      obstacles: [
        {
          id: "RIDGE",
          kind: "twig",
          ax: 0,
          az: -1.75,
          bx: 0,
          bz: 1.75,
          r: 0.19,
          restitution: 0.35
        }
      ],
      movers: []
    },
    bugs: [
      bug("BALL_01", "black", -2.15, -1.25),
      bug("BALL_02", "green", -2, 0),
      bug("BALL_03", "orange", -2.15, 1.25)
    ]
  }),
  level({
    id: "A05",
    name: "Four-Blocker Leaf",
    zone: 4,
    maxTilt: 0.22,
    mirrored: true,
    board: {
      shapes: [
        { kind: "ellipse", x: 0, z: 0, rx: 4.2, rz: 3.2, rot: 0 }
      ],
      smooth: 0.28,
      features: [
        { kind: "dish", amp: -0.055, r: 4, x: 0, z: 0 },
        { kind: "curl", amp: 0.3, width: 0.74 },
        { kind: "dish", amp: -0.08, r: 1.1, x: 2.45, z: 0 },
        {
          kind: "vein",
          amp: -0.032,
          width: 0.5,
          taper: 0,
          pts: [[-2.8, 0], [-1, 0], [0.2, 0], [2.4, 0]]
        },
        { kind: "ripple", amp: 0.003, scale: 2.8 }
      ],
      holes: [
        hole("HOLE_01", "green", 2.45, 0)
      ],
      obstacles: [
        {
          id: "BLOCK_01",
          kind: "snail",
          x: -0.6,
          z: -1.05,
          r: 0.3,
          h: 0.5,
          restitution: 0.55,
          rebound: {
            normalSpeedMin: 0.3,
            normalSpeedMax: 0.72
          },
          shell: "fresh"
        },
        {
          id: "BLOCK_02",
          kind: "snail",
          x: -0.6,
          z: 1.05,
          r: 0.3,
          h: 0.5,
          restitution: 0.55,
          rebound: {
            normalSpeedMin: 0.3,
            normalSpeedMax: 0.72
          },
          shell: "fresh"
        },
        {
          id: "BLOCK_03",
          kind: "snail",
          x: 0.9,
          z: -1.05,
          r: 0.27,
          h: 0.5,
          restitution: 0.22,
          rebound: {
            normalSpeedMin: 0.1,
            normalSpeedMax: 0.26
          },
          shell: "aged"
        },
        {
          id: "BLOCK_04",
          kind: "snail",
          x: 0.9,
          z: 1.05,
          r: 0.27,
          h: 0.5,
          restitution: 0.22,
          rebound: {
            normalSpeedMin: 0.1,
            normalSpeedMax: 0.26
          },
          shell: "aged"
        }
      ],
      movers: []
    },
    bugs: [
      bug("BALL_01", "black", -2.35, -1.25),
      bug("BALL_02", "white", -2.35, 1),
      bug("BALL_03", "green", -1.65, 0),
      bug("BALL_04", "orange", -1.1, -1.75),
      bug("BALL_05", "pink", -1.1, 1.75)
    ]
  }),
  level({
    id: "A06",
    name: "Central Valley Leaf",
    zone: 5,
    maxTilt: 0.225,
    mirrored: true,
    board: {
      shapes: [
        { kind: "ellipse", x: 0, z: 0, rx: 4.15, rz: 3.2, rot: 0 }
      ],
      smooth: 0.28,
      features: [
        { kind: "dish", amp: -0.05, r: 4, x: 0, z: 0 },
        { kind: "curl", amp: 0.28, width: 0.7 },
        {
          kind: "ridge",
          amp: -0.105,
          width: 0.56,
          pts: [[0, -2.2], [0, 2.2]]
        },
        {
          kind: "vein",
          amp: -0.035,
          width: 0.52,
          taper: 0,
          pts: [[2.8, -2], [1.2, -2.25], [0.2, -2.2], [-1.5, -1.65], [-2.45, 0]]
        },
        { kind: "dish", amp: -0.08, r: 1.05, x: -2.45, z: 0 },
        { kind: "ripple", amp: 0.003, scale: 2.9 }
      ],
      holes: [
        hole("HOLE_01", "green", -2.45, 0)
      ],
      obstacles: [
        {
          id: "VALLEY_GUIDE",
          kind: "twig",
          ax: 0.65,
          az: -1.15,
          bx: 0.65,
          bz: 1.15,
          r: 0.14,
          restitution: 0.3
        }
      ],
      movers: []
    },
    bugs: [
      bug("BALL_01", "black", 2.2, -1.6),
      bug("BALL_02", "white", 2.2, -0.8),
      bug("BALL_03", "green", 2.2, 0),
      bug("BALL_04", "orange", 2.2, 0.8),
      bug("BALL_05", "pink", 2.2, 1.6)
    ]
  }),
  level({
    id: "A07",
    name: "Wave-Edged Multi-Lobe",
    zone: 6,
    maxTilt: 0.23,
    mirrored: true,
    board: {
      shapes: [
        { kind: "lobe", x: 0, z: 0, r: 4.1, lobes: 10, depth: 0.14, rot: 0.12 },
        { kind: "ellipse", x: 0, z: 0, rx: 3.45, rz: 3.35, rot: 0 }
      ],
      smooth: 0.28,
      features: [
        { kind: "dish", amp: -0.06, r: 4, x: 0, z: 0 },
        { kind: "curl", amp: 0.27, width: 0.68 },
        { kind: "bump", amp: 0.11, r: 0.72, x: -2.45, z: -1.65 },
        { kind: "bump", amp: 0.1, r: 0.68, x: -2.6, z: 1.5 },
        { kind: "bump", amp: 0.11, r: 0.72, x: 2.5, z: -1.55 },
        { kind: "bump", amp: 0.1, r: 0.68, x: 2.55, z: 1.55 },
        {
          kind: "vein",
          amp: 0.04,
          width: 0.42,
          taper: 0.6,
          pts: [[0, 0], [0, 2.8]]
        },
        { kind: "ripple", amp: 0.0029, scale: 3 }
      ],
      holes: [
        hole("HOLE_01", "green", 0, 0)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "white", -1.65, -0.95),
      bug("BALL_02", "green", -1.25, 1.1),
      bug("BALL_03", "orange", -0.1, -1.65),
      bug("BALL_04", "pink", 0.45, 1.55),
      bug("BALL_05", "black", 1.55, -0.75),
      bug("BALL_06", "yellow", 1.75, 0.95)
    ]
  }),
  level({
    id: "A08",
    name: "Four Separated Leaves",
    zone: 7,
    maxTilt: 0.24,
    mirrored: true,
    board: {
      shapes: [
        { kind: "ellipse", x: -2.2, z: -1.75, rx: 1.65, rz: 1.55, rot: -0.08 },
        { kind: "ellipse", x: 2.2, z: -1.75, rx: 1.65, rz: 1.55, rot: 0.08 },
        { kind: "ellipse", x: -2.2, z: 1.75, rx: 1.65, rz: 1.55, rot: 0.08 },
        { kind: "ellipse", x: 2.2, z: 1.75, rx: 1.65, rz: 1.55, rot: -0.08 }
      ],
      smooth: 0.12,
      features: [
        { kind: "curl", amp: 0.28, width: 0.7 },
        { kind: "dish", amp: -0.065, r: 0.65, x: -2.2, z: -1.75 },
        { kind: "dish", amp: -0.065, r: 0.65, x: 2.2, z: -1.75 },
        { kind: "dish", amp: -0.065, r: 0.65, x: -2.2, z: 1.75 },
        { kind: "dish", amp: -0.065, r: 0.65, x: 2.2, z: 1.75 },
        {
          kind: "vein",
          amp: 0.035,
          width: 0.38,
          taper: 0.5,
          pts: [[-3.25, -1.75], [-1.15, -1.75]]
        },
        {
          kind: "vein",
          amp: 0.035,
          width: 0.38,
          taper: 0.5,
          pts: [[1.15, -1.75], [3.25, -1.75]]
        },
        {
          kind: "vein",
          amp: 0.035,
          width: 0.38,
          taper: 0.5,
          pts: [[-3.25, 1.75], [-1.15, 1.75]]
        },
        {
          kind: "vein",
          amp: 0.035,
          width: 0.38,
          taper: 0.5,
          pts: [[1.15, 1.75], [3.25, 1.75]]
        },
        { kind: "ripple", amp: 0.0028, scale: 3.1 }
      ],
      holes: [
        hole("HOLE_01", "black", -2.2, -1.75, 0.44),
        hole("HOLE_02", "green", 2.2, -1.75, 0.44),
        hole("HOLE_03", "pink", -2.2, 1.75, 0.44),
        hole("HOLE_04", "red", 2.2, 1.75, 0.44)
      ],
      obstacles: [],
      movers: []
    },
    bugs: [
      bug("BALL_01", "black", -3.1, -1.75),
      bug("BALL_02", "white", -1.3, -1.75),
      bug("BALL_03", "green", 1.3, -1.75),
      bug("BALL_04", "orange", 3.1, -1.75),
      bug("BALL_05", "pink", -3.1, 1.75),
      bug("BALL_06", "yellow", -1.3, 1.75),
      bug("BALL_07", "red", 1.3, 1.75),
      bug("BALL_08", "teal", 3.1, 1.75)
    ]
  })
];

export const BEGINNER_PLAY_ORDER = Object.freeze([
  "B01",
  "B02",
  "B04",
  "B05",
  "B03",
  "B06",
  "B07",
  "B08"
]);

export const ADVANCED_PLAY_ORDER = Object.freeze([
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "A06",
  "A08",
  "A07"
]);

const beginnerLevelById = new Map(
  beginnerLevels.map((entry) => [entry.id, entry])
);

const beginnerPlayLevels = BEGINNER_PLAY_ORDER.map((id, slot) => {
  const content = beginnerLevelById.get(id);
  const travel = journey(slot);
  return {
    ...content,
    zone: slot,
    origin: travel.origin,
    descent: travel.descent
  };
});

const advancedLevelById = new Map(
  advancedLevels.map((entry) => [entry.id, entry])
);

const advancedPlayLevels = ADVANCED_PLAY_ORDER.map((id, slot) => {
  const content = advancedLevelById.get(id);
  const travel = journey(slot, true);
  return {
    ...content,
    zone: slot,
    origin: travel.origin,
    descent: travel.descent
  };
});

export const BEGINNER_DATA = {
  schemaVersion: 3,
  status: "MOSSFALL_NATIVE_LEVEL_DATA",
  mode: "beginner",
  levelCount: 8,
  shared: {
    initialTimeSec: 60,
    timeAddedPerClearSec: 20,
    timeCapSec: 99,
    pointsPerLevel: 10,
    fallResetDelaySec: 2.25,
    successHoldSec: 0.85
  },
  levels: beginnerPlayLevels
};

export const ADVANCED_DATA = {
  schemaVersion: 3,
  status: "MOSSFALL_NATIVE_LEVEL_DATA",
  mode: "advanced",
  levelCount: 8,
  shared: {
    initialTimeSec: 60,
    timeAddedPerClearSec: 30,
    timeCapSec: 99,
    pointsPerLevel: 10,
    fallResetDelaySec: 2.25,
    successHoldSec: 0.85
  },
  levels: advancedPlayLevels
};

export const BEGINNER_LEVELS = beginnerPlayLevels;
export const ADVANCED_LEVELS = advancedPlayLevels;

export function levelSet(mode) {
  return mode === "advanced"
    ? ADVANCED_LEVELS
    : BEGINNER_LEVELS;
}

export function sharedRules(mode) {
  return mode === "advanced"
    ? { ...ADVANCED_DATA.shared }
    : { ...BEGINNER_DATA.shared };
}
