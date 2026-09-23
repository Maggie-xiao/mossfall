import * as THREE from "three";
import { BALANCE_BOARD_CONFIG } from "./balance-board-config.js";
import {
  DEG,
  clamp,
  easeInOutCubic,
  failureSpinAngle,
  mapCopAxis,
  stepCriticalDampedAngle
} from "./core.js";
import { createRuntimeCore } from "./adapters/runtime-core.js";
import { BoardSnails } from "./adapters/board-snails.js";
import { TableTiltInsectView } from "./adapters/insect-presentation.js";
import { EndingDirector } from "./ending.js";
import { EventBus } from "./mossfall/core/events.js";
import { Effects } from "./mossfall/fx/particles.js";
import { PostFX as MossfallPostFX } from "./mossfall/fx/postfx.js";
import { GameCamera } from "./mossfall/game/camera.js";
import { LeafPlatform } from "./mossfall/render/leaf.js";
import { Lighting } from "./mossfall/render/lighting.js";
import { World } from "./mossfall/render/world.js";
import { INSECTS, zoneFor } from "./mossfall/data/palette.js";
import { StorybookEnvironment } from "./storybook-environment.js";

const FAILURE_FADE_SEC = 0.58;
const CAPTURE_FADE_SEC = 0.55;
const FAILURE_SPIN_SEC = 2.2;
export const BALANCE_BOARD_Y_SENSITIVITY =
  BALANCE_BOARD_CONFIG.response.verticalGameplaySensitivity;
export const BALANCE_BOARD_X_GAIN =
  BALANCE_BOARD_CONFIG.response.horizontalGameplayGain;
/* Backing-pixel budget sized for the external-display profile: a 1920x1080
 * TV canvas at full DPR renders ~4.7MP through the leaf system and postFX
 * and measured ~20fps on device, while the phone scene (~0.8MP) holds 60.
 * 1080p-native backing (2.07MP) doubled the external rate to ~40fps; a
 * further 30% cut (1600x900) measured identical ~40fps, so the remaining
 * ceiling is display-pipeline-bound, not pixel-bound — keep the sharper
 * 1080p backing. Phone-sized viewports are unaffected (the 1.5 DPR cap
 * binds first). */
export const MAX_RENDER_BACKING_PIXELS = 1920 * 1080;

export function calculateRenderPixelRatio(
  width,
  height,
  devicePixelRatio = 1
) {
  const cssPixels = Math.max(1, width) * Math.max(1, height);
  const pixelBudgetRatio = Math.sqrt(
    MAX_RENDER_BACKING_PIXELS / cssPixels
  );
  return Math.min(1.5, devicePixelRatio || 1, pixelBudgetRatio);
}

export const FAILURE_BALL_FADE_DURATION_SEC = FAILURE_FADE_SEC;
export const CAPTURE_BALL_FADE_DURATION_SEC = CAPTURE_FADE_SEC;

export function mapGameplayTiltInput(input) {
  const x = clamp(
    (Number.isFinite(input?.x) ? input.x : 0) *
      (input?.source === "balance-board" ? BALANCE_BOARD_X_GAIN : 1),
    -1,
    1
  );
  const yScale =
    input?.source === "balance-board" ? BALANCE_BOARD_Y_SENSITIVITY : 1;
  const y = clamp(
    (Number.isFinite(input?.y) ? input.y : 0) * yScale,
    -1,
    1
  );
  return {
    x: mapCopAxis(x),
    y: mapCopAxis(y)
  };
}

export function rollingRotationForTravel(dx, dz, radius) {
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.00001 || radius <= 0) {
    return { distance: 0, angle: 0, axisX: 0, axisZ: 0 };
  }
  return {
    distance,
    angle: distance / radius,
    axisX: dz / distance,
    axisZ: -dx / distance
  };
}

export function failureBallOpacity(
  elapsedSec,
  durationSec = FAILURE_BALL_FADE_DURATION_SEC
) {
  const progress = clamp(
    Math.max(0, elapsedSec) / Math.max(0.001, durationSec),
    0,
    1
  );
  return 1 - easeInOutCubic(progress);
}

export function capturedBallOpacity(
  elapsedSec,
  durationSec = CAPTURE_BALL_FADE_DURATION_SEC
) {
  const progress = clamp(
    Math.max(0, elapsedSec) / Math.max(0.001, durationSec),
    0,
    1
  );
  return 1 - easeInOutCubic(progress);
}

export function shouldDescendBetweenLevels(handoffPhase) {
  return ["exit", "hidden", "descent"].includes(handoffPhase);
}

function collectLeafPlatformStats(platform) {
  const geometry = platform?.blade?.geometry;
  if (!geometry) {
    return {
      topVertices: 0,
      triangles: 0,
      boundaryEdges: 0,
      heightRange: 0,
      heightRms: 0,
      thicknessRange: 0,
      edgeVertexCount: 0,
      veinVertexCount: 0
    };
  }

  const positions = geometry.getAttribute("position");
  const sides = geometry.getAttribute("aSide");
  const edges = geometry.getAttribute("aEdge");
  const veins = geometry.getAttribute("aVein");
  let topVertices = 0;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let sumHeight = 0;
  let sumHeightSquared = 0;
  let minThickness = Infinity;
  let maxThickness = -Infinity;
  let edgeVertexCount = 0;
  let veinVertexCount = 0;

  for (let index = 0; index < positions.count; index += 1) {
    if (sides?.getX(index) < 0.5) continue;
    const height = positions.getY(index);
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
    sumHeight += height;
    sumHeightSquared += height * height;
    if ((edges?.getX(index) ?? 1) < 0.12) edgeVertexCount += 1;
    if ((veins?.getX(index) ?? 0) > 0.3) veinVertexCount += 1;
    topVertices += 1;
  }

  if (positions.count >= topVertices * 2) {
    for (let index = 0; index < topVertices; index += 1) {
      const thickness =
        positions.getY(index) - positions.getY(index + topVertices);
      minThickness = Math.min(minThickness, thickness);
      maxThickness = Math.max(maxThickness, thickness);
    }
  }

  const meanHeight = sumHeight / Math.max(1, topVertices);
  return {
    topVertices,
    triangles: (geometry.index?.count || 0) / 3,
    boundaryEdges: edgeVertexCount,
    heightRange:
      Number.isFinite(minHeight) && Number.isFinite(maxHeight)
        ? maxHeight - minHeight
        : 0,
    heightRms: Math.sqrt(
      Math.max(
        0,
        sumHeightSquared / Math.max(1, topVertices) -
          meanHeight * meanHeight
      )
    ),
    thicknessRange:
      Number.isFinite(minThickness) && Number.isFinite(maxThickness)
        ? maxThickness - minThickness
        : 0,
    edgeVertexCount,
    veinVertexCount
  };
}

function collectHoleGeometryStats(platform, field, holes) {
  const stats = new Map(
    (holes || []).map((hole) => [
      hole.id,
      {
        vertexCount: 0,
        minOffset: Infinity,
        maxOffset: -Infinity,
        throatCount: 0,
        floorCount: 0,
        funnelCount: 0
      }
    ])
  );
  const positions = platform?.furniture?.geometry?.getAttribute("position");
  if (!positions || !field || !holes?.length) return stats;

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    let nearest = holes[0];
    let nearestDistance = Infinity;
    for (const hole of holes) {
      const distance = Math.hypot(x - hole.x, z - hole.z);
      if (distance < nearestDistance) {
        nearest = hole;
        nearestDistance = distance;
      }
    }
    const entry = stats.get(nearest.id);
    const offset = y - field.height(nearest.x, nearest.z);
    entry.vertexCount += 1;
    entry.minOffset = Math.min(entry.minOffset, offset);
    entry.maxOffset = Math.max(entry.maxOffset, offset);
    if (offset < -0.08) entry.floorCount += 1;
    else if (offset < -0.025) entry.throatCount += 1;
    if (offset > 0.025) entry.funnelCount += 1;
  }
  return stats;
}

function bodyFacade(bug) {
  const position = {
    set(x, y, z) {
      bug.x = x;
      bug.y = y;
      bug.z = z;
    }
  };
  const velocity = {
    set(x, y, z) {
      bug.vx = x;
      bug.vy = y;
      bug.vz = z;
      bug.speed = Math.hypot(x, z);
    },
    setZero() {
      this.set(0, 0, 0);
    }
  };
  for (const key of ["x", "y", "z"]) {
    Object.defineProperty(position, key, {
      get: () => bug[key],
      set: (value) => {
        bug[key] = value;
      }
    });
    const velocityKey = `v${key}`;
    Object.defineProperty(velocity, key, {
      get: () => bug[velocityKey],
      set: (value) => {
        bug[velocityKey] = value;
        bug.speed = Math.hypot(bug.vx, bug.vz);
      }
    });
  }
  return { position, velocity };
}

function ballFacade(bug, insect) {
  const ball = {
    id: bug.id,
    simBug: bug,
    insect,
    body: bodyFacade(bug),
    spawn: { x: bug.home.x, y: bug.y, z: bug.home.z },
    radius: bug.r,
    mass: bug.mass,
    captureFadeElapsed: 0,
    failureFadeElapsed: 0,
    visualOpacity: 1
  };
  Object.defineProperties(ball, {
    captured: { get: () => bug.state === "captured" },
    captureHoleId: { get: () => bug.hole?.id || null },
    holeId: { get: () => bug.hole?.id || null },
    mesh: { get: () => insect.group }
  });
  return ball;
}

export class TableTiltScene {
  constructor(host, onEvent) {
    this.host = host;
    this.onEvent = onEvent;
    this.clockTime = 0;
    this.simTime = 0;
    this.level = null;
    this.runtimeLevel = null;
    this.previousRuntimeLevel = null;
    this.mode = "beginner";
    this.presentation = "menu";
    this.physicsEnabled = false;
    this.inputEnabled = false;
    this.roll = { angle: 0, velocity: 0 };
    this.pitch = { angle: 0, velocity: 0 };
    this.balls = [];
    this.holes = [];
    this.failureActive = false;
    this.failureDropActive = false;
    this.failureElapsed = 0;
    this.failureFallenBallIds = new Set();
    this.allCapturedPendingAt = null;
    this.boardYaw = 0;
    this.handoffPhase = null;
    this.levelDepth = 0;
    this.cameraDepth = 0;
    this.timingScale = 1;
    this.field = null;
    this.sim = null;
    this.leafPlatform = null;
    this.boardSnails = null;
    this.leafStats = collectLeafPlatformStats(null);
    this.holeGeometryStats = new Map();
    this._simOff = [];
    this.retiredBoards = [];
    this.fxWorldPoint = new THREE.Vector3();

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.host.appendChild(this.renderer.domElement);

    this.onWebglContextLost = (event) => {
      event.preventDefault();
      this.onEvent({ type: "contextLost" });
    };
    this.onWebglContextRestored = () => {
      this.onEvent({ type: "contextRestored" });
    };
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      this.onWebglContextLost
    );
    this.renderer.domElement.addEventListener(
      "webglcontextrestored",
      this.onWebglContextRestored
    );

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 700);
    this.runtimeEvents = new EventBus();
    this.cameraSettings = { motion: "full" };
    this.gameCamera = new GameCamera(this.camera, {
      events: this.runtimeEvents,
      settings: this.cameraSettings
    });

    this.mossLighting = new Lighting(this.scene, "medium");
    this.mossLighting.setRenderer(this.renderer);
    this.mossWorld = new World(this.scene, "medium");
    this.mossWorld.attachLighting(this.mossLighting);
    this.mossWorld.group.traverse((node) => {
      if (/^(canopy\d+|godrays|waterfall|silk)$/.test(node.name || "")) {
        node.visible = false;
      }
    });
    this.storybookEnvironment = new StorybookEnvironment(this.scene);
    this.removeGodrays();
    this.mossEffects = new Effects(this.scene, "medium");
    this.mossEffects.pollen(0);
    this.mossEffects.fireflies(false);
    this.mossPostFX = new MossfallPostFX(
      this.renderer,
      "medium",
      { events: this.runtimeEvents }
    );

    this.createBoardOwner();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
  }

  createBoardOwner() {
    this.boardRoot = new THREE.Group();
    this.boardRoot.name = "tableTiltBoardOwner";
    this.boardTilt = new THREE.Group();
    this.boardTilt.name = "fieldTiltOwner";
    this.boardTilt.rotation.order = "ZXY";
    this.boardContent = new THREE.Group();
    this.boardContent.name = "fieldContent";
    this.boardRoot.add(this.boardTilt);
    this.boardTilt.add(this.boardContent);
    this.scene.add(this.boardRoot);
    this.mossEffects?.setBoard(this.boardContent);
  }

  disposeBoardRecord(record) {
    if (!record) return;
    for (const ball of record.balls || []) ball.insect?.dispose?.();
    record.leafPlatform?.dispose?.();
    this.disposeInkHazards(record.inkHazards);
    this.disposeInkHazards(record.spikeHazards);
    this.disposeInkHazards(record.collectibleDewGroup);
    this.disposeInkHazards(record.ecosystemGroup);
    this.disposeInkHazards(record.holeMarkerGroup);
    record.sim?.dispose?.();
    record.root?.removeFromParent?.();
  }

  disposeRetiredBoards() {
    for (const record of this.retiredBoards || []) {
      this.disposeBoardRecord(record);
    }
    if (this.retiredBoards) this.retiredBoards.length = 0;
  }

  retireCurrentBoard() {
    if (!this.boardRoot || (!this.leafPlatform && !this.sim)) return false;
    this.disposeButterflyHint();
    for (const off of this._simOff) off();
    this._simOff.length = 0;
    this.boardRoot.name = "tableTiltRetiredBoard";
    this.retiredBoards.push({
      root: this.boardRoot,
      leafPlatform: this.leafPlatform,
      balls: this.balls,
      sim: this.sim,
      inkHazards: this.inkHazards,
      spikeHazards: this.spikeHazards,
      collectibleDewGroup: this.collectibleDewGroup,
      ecosystemGroup: this.ecosystemGroup,
      holeMarkerGroup: this.holeMarkerGroup
    });

    this.balls = [];
    this.holes = [];
    this.leafPlatform = null;
    // The retired board's snails stop animating with it and are released when
    // its props are — they ride the platform into the record, not out of it.
    this.boardSnails = null;
    this.inkHazards = null;
    this.spikeHazards = null;
    this.collectibleDewGroup = null;
    this.collectibleDew = [];
    this.ecosystemGroup = null;
    this.ecosystem = null;
    this.holeMarkerGroup = null;
    this.sim = null;
    this.field = null;
    this.leafStats = collectLeafPlatformStats(null);
    this.holeGeometryStats = new Map();
    this.mossEffects.clear();
    this.createBoardOwner();
    return true;
  }

  clearLevel() {
    this.disposeButterflyHint();
    this.disposeRetiredBoards();
    for (const off of this._simOff) off();
    this._simOff.length = 0;
    for (const ball of this.balls) ball.insect.dispose();
    this.balls = [];
    this.holes = [];
    this.leafPlatform?.dispose();
    this.leafPlatform = null;
    this.disposeInkHazards(this.inkHazards);
    this.inkHazards = null;
    this.disposeInkHazards(this.spikeHazards);
    this.spikeHazards = null;
    this.disposeInkHazards(this.collectibleDewGroup);
    this.collectibleDewGroup = null;
    this.collectibleDew = [];
    this.disposeInkHazards(this.ecosystemGroup);
    this.ecosystemGroup = null;
    this.ecosystem = null;
    this.disposeInkHazards(this.holeMarkerGroup);
    this.holeMarkerGroup = null;
    // Geometry and materials the snails built are registered with the props
    // builder, so dispose() above has already released them.
    this.boardSnails = null;
    this.sim?.dispose();
    this.sim = null;
    this.field = null;
    this.boardContent.clear();
    this.mossEffects.clear();
    this.leafStats = collectLeafPlatformStats(null);
    this.holeGeometryStats = new Map();
  }

  disposeInkHazards(group) {
    group?.traverse((item) => {
      item.geometry?.dispose?.();
      item.material?.dispose?.();
    });
  }

  loadLevel(level, mode = "beginner", { preserveCamera = false } = {}) {
    const continuesHandoff = shouldDescendBetweenLevels(this.handoffPhase);
    const fromLevel = this.runtimeLevel;
    if (
      !continuesHandoff ||
      !fromLevel ||
      !this.retireCurrentBoard()
    ) {
      this.clearLevel();
    }
    this.level = level;
    this.mode = mode;

    const runtime = createRuntimeCore(level, mode);
    this.runtimeLevel = runtime.runtimeLevel;
    this.field = runtime.field;
    this.sim = runtime.sim;
    this.runtimeLevel.field = this.field;
    this.previousRuntimeLevel = fromLevel;
    this.levelDepth = Number(this.runtimeLevel.origin?.y || 0);
    this.simTime = 0;
    this.roll = { angle: 0, velocity: 0 };
    this.pitch = { angle: 0, velocity: 0 };
    this.failureActive = false;
    this.failureDropActive = false;
    this.failureElapsed = 0;
    this.failureFallenBallIds.clear();
    this.allCapturedPendingAt = null;
    this.boardYaw = 0;
    this.boardRoot.position.set(
      Number(this.runtimeLevel.origin?.x || 0),
      this.levelDepth,
      Number(this.runtimeLevel.origin?.z || 0)
    );
    this.boardRoot.scale.setScalar(1);
    this.boardTilt.rotation.set(0, 0, 0);

    const presentationLevel = {
      ...this.runtimeLevel,
      board: {
        ...this.runtimeLevel.board,
        obstacles: this.runtimeLevel.board.obstacles.filter(
          (obstacle) => obstacle.kind !== "spike"
        )
      }
    };
    this.leafPlatform = new LeafPlatform(
      this.field,
      presentationLevel,
      "medium"
    );
    // Obstacles the upstream props builder has no case for get their bodies
    // replaced here, after it has run — the same after-the-fact edit as
    // removeGodrays(). Levels without them build an empty set for free.
    this.boardSnails = new BoardSnails(this.leafPlatform, this.runtimeLevel);
    this.boardContent.add(this.leafPlatform.group);
    this.addInkHazards();
    this.addSpikeHazards();
    this.addCollectibleDew();
    this.addHoleMarkers();
    this.addEcosystemEncounters();
    this.leafStats = collectLeafPlatformStats(this.leafPlatform);
    this.holeGeometryStats = collectHoleGeometryStats(
      this.leafPlatform,
      this.field,
      this.field.holes
    );

    for (const bug of this.sim.bugs) {
      const insect = new TableTiltInsectView(bug, "medium");
      this.boardContent.add(insect.group);
      this.balls.push(ballFacade(bug, insect));
    }
    this.holes = this.field.holes.map((entry) => ({
      ...entry,
      radius: entry.r,
      captureElapsed: 1,
      glowStrength: 0,
      burstVisible: false,
      burstOpacity: 0
    }));

    this.bindSimulationEvents();
    const zone = this.runtimeLevel.index || 0;
    this.mossWorld.setZone(zone, !continuesHandoff);
    this.storybookEnvironment?.setZone(zone);
    this.mossEffects.setZone(zone, !continuesHandoff);
    this.mossPostFX.setZone(zone, continuesHandoff ? 1.2 : 0);

    if (continuesHandoff && fromLevel) {
      this.handoffPhase = "descent";
      const descent = {
        ...this.runtimeLevel.descent,
        duration:
          Math.max(0.6, Number(this.runtimeLevel.descent?.duration || 0.6)) *
          this.timingScale
      };
      this.gameCamera
        .startDescent(
          fromLevel,
          this.runtimeLevel,
          descent
        )
        .then(() => {
          if (this.handoffPhase === "descent") {
            this.handoffPhase = "enter";
          }
        });
    } else {
      this.handoffPhase = null;
      if (!preserveCamera) {
        this.gameCamera.frameLevel(this.runtimeLevel, true);
      }
    }
    this.focusLighting();
  }

  addInkHazards() {
    const hazards = this.runtimeLevel?.board?.hazards || [];
    if (!hazards.length) return;
    const group = new THREE.Group();
    group.name = "inkHazards";
    for (const hazard of hazards) {
      if (hazard.kind !== "ink") continue;
      const geometry = new THREE.CircleGeometry(hazard.r, 28);
      const material = new THREE.MeshStandardMaterial({
        color: 0x27312f,
        roughness: 0.28,
        transparent: true,
        opacity: 0.82,
        depthWrite: false
      });
      const stain = new THREE.Mesh(geometry, material);
      stain.name = hazard.id;
      stain.rotation.x = -Math.PI / 2;
      stain.position.set(
        hazard.x,
        this.field.height(hazard.x, hazard.z) + 0.025,
        hazard.z
      );
      stain.scale.set(1, 0.72, 1);
      stain.renderOrder = 2;
      group.add(stain);
    }
    this.inkHazards = group;
    this.boardContent.add(group);
  }

  addSpikeHazards() {
    const spikes = (this.runtimeLevel?.board?.obstacles || []).filter(
      (obstacle) => obstacle.kind === "spike"
    );
    if (!spikes.length) return;
    const group = new THREE.Group();
    group.name = "spikeHazards";
    for (const spike of spikes) {
      const geometry = new THREE.ConeGeometry(spike.r, spike.h, 10);
      const material = new THREE.MeshStandardMaterial({
        color: 0x9ca88d,
        roughness: 0.72,
        metalness: 0.05
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = spike.id;
      mesh.userData.spike = spike;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.spikeHazards = group;
    this.boardContent.add(group);
    this.updateSpikeHazards();
  }

  updateSpikeHazards() {
    if (!this.spikeHazards) return;
    for (const mesh of this.spikeHazards.children) {
      const spike = mesh.userData.spike;
      const period = Math.max(0.5, spike.motion?.period || 2.8);
      const phase = spike.motion?.phase || 0;
      const extension = 0.5 + 0.5 * Math.sin(
        (this.simTime / period) * Math.PI * 2 + phase
      );
      const visibleHeight = spike.h * Math.max(0.06, extension);
      mesh.scale.y = Math.max(0.06, extension);
      mesh.position.set(
        spike.x,
        this.field.height(spike.x, spike.z) + visibleHeight / 2,
        spike.z
      );
    }
  }

  addCollectibleDew() {
    const collectibles = this.runtimeLevel?.board?.collectibles || [];
    this.collectibleDew = [];
    if (!collectibles.length) return;
    const group = new THREE.Group();
    group.name = "collectibleDew";
    for (const collectible of collectibles) {
      if (collectible.kind !== "dew") continue;
      const geometry = new THREE.SphereGeometry(collectible.r, 14, 10);
      geometry.scale(1, 0.82, 1);
      const material = new THREE.MeshPhysicalMaterial({
        color: 0xbdeeff,
        emissive: 0x235b69,
        emissiveIntensity: 0.22,
        transmission: 0.42,
        transparent: true,
        opacity: 0.9,
        roughness: 0.12,
        metalness: 0
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = collectible.id;
      mesh.position.set(
        collectible.x,
        this.field.height(collectible.x, collectible.z) + collectible.r * 0.72,
        collectible.z
      );
      mesh.renderOrder = 4;
      group.add(mesh);
      this.collectibleDew.push({ spec: collectible, mesh, collected: false });
    }
    this.collectibleDewGroup = group;
    this.boardContent.add(group);
  }

  collectDew() {
    if (!this.collectibleDew?.length) return;
    for (const dew of this.collectibleDew) {
      if (dew.collected) continue;
      const collector = this.sim.bugs.find((bug) =>
        bug.state === "roll" &&
        Math.hypot(bug.x - dew.spec.x, bug.z - dew.spec.z) <= bug.r + dew.spec.r
      );
      if (!collector) continue;
      dew.collected = true;
      dew.mesh.visible = false;
      this.onEvent({
        type: "dewCollected",
        collectibleId: dew.spec.id,
        ballId: collector.id,
        points: dew.spec.points || 5
      });
    }
  }

  updateCollectibleDew() {
    for (let index = 0; index < (this.collectibleDew || []).length; index += 1) {
      const dew = this.collectibleDew[index];
      if (dew.collected) continue;
      dew.mesh.position.y =
        this.field.height(dew.spec.x, dew.spec.z) +
        dew.spec.r * (0.72 + Math.sin(this.clockTime * 2.4 + index) * 0.12);
    }
  }

  addHoleMarkers() {
    const holes = this.field?.holes || [];
    if (!holes.length) return;
    const group = new THREE.Group();
    group.name = "colourCodedHoleMarkers";
    for (const hole of holes) {
      if (!hole.target) continue;
      const palette = INSECTS[hole.color] || INSECTS.green;
      const marker = new THREE.Group();
      marker.name = `holeMarker:${hole.id}`;
      marker.userData.holeId = hole.id;
      marker.userData.baseScale = 1;
      marker.userData.wrongUntil = 0;
      marker.position.set(
        hole.x,
        this.field.height(hole.x, hole.z) + 0.075,
        hole.z
      );

      const haloMaterial = new THREE.MeshBasicMaterial({
        color: palette.accent,
        transparent: true,
        opacity: 0.48,
        depthWrite: false
      });
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(hole.r * 1.12, Math.max(0.035, hole.r * 0.09), 10, 40),
        haloMaterial
      );
      halo.rotation.x = Math.PI / 2;
      marker.add(halo);

      const ringMaterial = new THREE.MeshStandardMaterial({
        color: palette.shell,
        emissive: palette.glow,
        emissiveIntensity: 0.72,
        roughness: 0.3,
        metalness: 0.05
      });
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(hole.r * 0.98, Math.max(0.045, hole.r * 0.12), 12, 40),
        ringMaterial
      );
      ring.name = "colourRing";
      ring.rotation.x = Math.PI / 2;
      marker.add(ring);

      // Three bright beads keep even blue/black and white/yellow aliases
      // distinguishable against dark holes and changing weather palettes.
      for (let index = 0; index < 3; index += 1) {
        const angle = -Math.PI * 0.82 + index * Math.PI * 0.82;
        const bead = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(0.055, hole.r * 0.13), 10, 8),
          new THREE.MeshBasicMaterial({ color: palette.accent })
        );
        bead.position.set(
          Math.cos(angle) * hole.r * 1.2,
          0.035,
          Math.sin(angle) * hole.r * 1.2
        );
        marker.add(bead);
      }
      group.add(marker);
    }
    this.holeMarkerGroup = group;
    this.boardContent.add(group);
  }

  markWrongHole(holeId) {
    const marker = this.holeMarkerGroup?.getObjectByName(`holeMarker:${holeId}`);
    if (!marker) return;
    marker.userData.wrongUntil = this.clockTime + 0.7;
  }

  updateHoleMarkers() {
    if (!this.holeMarkerGroup) return;
    for (const marker of this.holeMarkerGroup.children) {
      const rejected = marker.userData.wrongUntil > this.clockTime;
      const pulse = 1 + Math.sin(this.clockTime * (rejected ? 22 : 3.2)) * (rejected ? 0.12 : 0.035);
      marker.scale.setScalar(pulse);
      const ring = marker.getObjectByName("colourRing");
      if (ring?.material) ring.material.emissiveIntensity = rejected ? 1.8 : 0.72;
    }
  }

  addEcosystemEncounters() {
    const encounters = this.runtimeLevel?.board?.encounters || [];
    this.ecosystem = {
      frozenUntil: new Map(),
      webCooldown: new Map(),
      stacks: new Map(),
      hail: [],
      fallingBugs: [],
      chest: null,
      web: null,
      mole: null,
      cloud: null
    };
    if (!encounters.length) return;
    const group = new THREE.Group();
    group.name = "ecosystemEncounters";
    const simpleMaterial = (color, options = {}) => new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      transparent: Boolean(options.transparent),
      opacity: options.opacity ?? 1,
      depthWrite: options.depthWrite ?? true,
      side: options.side
    });

    for (const encounter of encounters) {
      if (encounter.kind === "web") {
        const web = new THREE.Group();
        web.position.set(encounter.x, this.field.height(encounter.x, encounter.z) + 0.035, encounter.z);
        web.rotation.x = -Math.PI / 2;
        const material = new THREE.LineBasicMaterial({ color: 0xe7eee4, transparent: true, opacity: 0.72 });
        for (let ring = 1; ring <= 3; ring += 1) {
          const points = [];
          for (let i = 0; i <= 24; i += 1) {
            const angle = i / 24 * Math.PI * 2;
            points.push(new THREE.Vector3(Math.cos(angle) * encounter.r * ring / 3, Math.sin(angle) * encounter.r * ring / 3, 0));
          }
          web.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
        }
        for (let i = 0; i < 8; i += 1) {
          const angle = i / 8 * Math.PI * 2;
          web.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(Math.cos(angle) * encounter.r, Math.sin(angle) * encounter.r, 0)
          ]), material));
        }
        group.add(web);
        this.ecosystem.web = { spec: encounter, mesh: web };
      } else if (encounter.kind === "chest") {
        const chest = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.34, 0.42), simpleMaterial(0x8b542f));
        box.position.y = 0.18;
        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.46), simpleMaterial(0xd4a441));
        lid.position.y = 0.42;
        chest.add(box, lid);
        chest.position.set(encounter.x, this.field.height(encounter.x, encounter.z), encounter.z);
        group.add(chest);
        this.ecosystem.chest = { spec: encounter, mesh: chest, collected: false };
      } else if (encounter.kind === "mole") {
        const mole = new THREE.Group();
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), simpleMaterial(0x71523d));
        body.scale.y = 1.25;
        const nose = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), simpleMaterial(0xd69b82));
        nose.position.set(0, 0.06, 0.32);
        mole.add(body, nose);
        mole.position.set(encounter.x, this.field.height(encounter.x, encounter.z) - 0.4, encounter.z);
        group.add(mole);
        this.ecosystem.mole = { spec: encounter, mesh: mole, emergence: -1 };
      } else if (encounter.kind === "cloud") {
        const cloud = new THREE.Group();
        const material = new THREE.MeshBasicMaterial({ color: 0xe6ece8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
        for (const [x, z, r] of [[-0.7,0,0.9],[0,0.08,1.15],[0.8,-0.04,0.82]]) {
          const puff = new THREE.Mesh(new THREE.CircleGeometry(r, 24), material);
          puff.rotation.x = -Math.PI / 2;
          puff.position.set(x, 0, z);
          cloud.add(puff);
        }
        cloud.position.y = 2.2;
        group.add(cloud);
        this.ecosystem.cloud = { spec: encounter, mesh: cloud, material };
      } else if (encounter.kind === "hail") {
        const hail = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), simpleMaterial(0xc8eff7, { transparent: true, opacity: 0.92 }));
        hail.visible = false;
        group.add(hail);
        this.ecosystem.hail.push({ spec: encounter, mesh: hail, delay: encounter.interval * 0.55, active: false, target: null });
      } else if (encounter.kind === "falling-bugs") {
        for (let index = 0; index < Math.min(3, encounter.count || 1); index += 1) {
          const mesh = new THREE.Group();
          const shell = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), simpleMaterial(0xd54432));
          shell.scale.z = 0.8;
          const seam = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.17, 0.32), simpleMaterial(0x1c1b19));
          mesh.add(shell, seam);
          mesh.visible = false;
          group.add(mesh);
          this.ecosystem.fallingBugs.push({ spec: encounter, mesh, delay: 2.2 + index * 3.1, active: false, caughtBy: null, index });
        }
      }
    }
    this.ecosystemGroup = group;
    this.boardContent.add(group);
  }

  updateEcosystemPhysics(dt) {
    const eco = this.ecosystem;
    if (!eco) return;
    const rolling = this.sim.bugs.filter((bug) => bug.state === "roll");
    const held = new Map();
    for (const bug of rolling) {
      if ((eco.frozenUntil.get(bug.id) || 0) > this.simTime) {
        held.set(bug.id, { x: bug.x, z: bug.z });
        bug.vx = bug.vz = bug.speed = 0;
      }
    }

    const web = eco.web?.spec;
    if (web) for (const bug of rolling) {
      if (Math.hypot(bug.x - web.x, bug.z - web.z) > web.r + bug.r) continue;
      if ((eco.webCooldown.get(bug.id) || 0) > this.simTime) continue;
      eco.webCooldown.set(bug.id, this.simTime + 2.2);
      eco.frozenUntil.set(bug.id, this.simTime + 1);
      this.onEvent({ type: "bugStuck", ballId: bug.id, seconds: 1 });
    }

    const chest = eco.chest;
    if (chest && !chest.collected) {
      const collector = rolling.find((bug) => Math.hypot(bug.x - chest.spec.x, bug.z - chest.spec.z) <= bug.r + chest.spec.r);
      if (collector) {
        chest.collected = true;
        chest.mesh.visible = false;
        this.onEvent({ type: "chestCollected", ballId: collector.id, points: 10, dew: 2 });
      }
    }

    for (const hail of eco.hail) {
      if (!hail.active) {
        hail.delay -= dt;
        if (hail.delay > 0 || !rolling.length) continue;
        const target = rolling[Math.floor(this.simTime * 7) % rolling.length];
        hail.target = target;
        hail.mesh.position.set(target.x + Math.sin(this.simTime * 4) * 0.22, 3.8, target.z + Math.cos(this.simTime * 3) * 0.22);
        hail.mesh.visible = true;
        hail.active = true;
      }
      hail.mesh.position.y -= dt * 2.1;
      const ground = this.field.height(hail.mesh.position.x, hail.mesh.position.z);
      if (hail.target && hail.target.state === "roll" && hail.mesh.position.y <= hail.target.y + 0.35 && Math.hypot(hail.mesh.position.x - hail.target.x, hail.mesh.position.z - hail.target.z) < hail.target.r + 0.18) {
        eco.frozenUntil.set(hail.target.id, this.simTime + (hail.spec.freezeSec || 1.5));
        this.onEvent({ type: "bugFrozen", ballId: hail.target.id, seconds: hail.spec.freezeSec || 1.5 });
        hail.mesh.visible = false;
        hail.active = false;
        hail.delay = hail.spec.interval;
      } else if (hail.mesh.position.y < ground - 0.1) {
        hail.mesh.visible = false;
        hail.active = false;
        hail.delay = hail.spec.interval;
      }
    }

    for (const falling of eco.fallingBugs) {
      if (falling.caughtBy) {
        const carrier = this.sim.bugById(falling.caughtBy);
        if (!carrier || carrier.state === "captured") continue;
        const stack = eco.stacks.get(carrier.id) || 1;
        falling.mesh.position.set(carrier.x, carrier.y + carrier.r + 0.26 * stack, carrier.z);
        continue;
      }
      if (!falling.active) {
        falling.delay -= dt;
        if (falling.delay > 0) continue;
        const target = rolling[(falling.index + Math.floor(this.simTime)) % Math.max(1, rolling.length)];
        if (!target) continue;
        falling.mesh.position.set(target.x + Math.sin(falling.index * 2.1) * 0.5, 4.2, target.z + Math.cos(falling.index * 1.7) * 0.5);
        falling.mesh.visible = true;
        falling.active = true;
      }
      falling.mesh.position.y -= dt * (falling.spec.fallSpeed || 0.38);
      const catcher = rolling.find((bug) => falling.mesh.position.y <= bug.y + 0.72 && falling.mesh.position.y >= bug.y && Math.hypot(falling.mesh.position.x - bug.x, falling.mesh.position.z - bug.z) <= bug.r + 0.38);
      if (catcher) {
        falling.caughtBy = catcher.id;
        const count = (eco.stacks.get(catcher.id) || 0) + 1;
        eco.stacks.set(catcher.id, count);
        this.onEvent({ type: "fallingBugCaught", ballId: catcher.id, stackCount: count });
      } else if (falling.mesh.position.y < this.field.height(falling.mesh.position.x, falling.mesh.position.z) - 0.2) {
        falling.mesh.visible = false;
        falling.active = false;
        falling.delay = 999;
      }
    }

    const mole = eco.mole;
    if (mole) {
      const cycle = this.simTime % 6.4;
      const emergence = Math.floor(this.simTime / 6.4);
      if (cycle < 1.35 && mole.emergence !== emergence) {
        mole.emergence = emergence;
        for (const bug of rolling) {
          const dx = bug.x - mole.spec.x;
          const dz = bug.z - mole.spec.z;
          const distance = Math.hypot(dx, dz);
          if (distance > mole.spec.r + bug.r || distance < 0.01) continue;
          bug.vx += dx / distance * 1.15;
          bug.vz += dz / distance * 1.15;
          this.onEvent({ type: "moleDisturbance", ballId: bug.id });
        }
      }
    }
    return held;
  }

  restoreFrozenBugs(held) {
    if (!held) return;
    for (const [id, position] of held) {
      const bug = this.sim.bugById(id);
      if (!bug || bug.state !== "roll") continue;
      bug.x = position.x;
      bug.z = position.z;
      bug.vx = bug.vz = bug.speed = 0;
    }
  }

  updateEcosystemVisuals() {
    const eco = this.ecosystem;
    if (!eco) return;
    if (eco.mole) {
      const cycle = this.simTime % 6.4;
      const rise = cycle < 0.45 ? cycle / 0.45 : cycle < 1 ? 1 : Math.max(0, 1 - (cycle - 1) / 0.35);
      eco.mole.mesh.position.y = this.field.height(eco.mole.spec.x, eco.mole.spec.z) - 0.42 + rise * 0.48;
    }
    if (eco.cloud) {
      const interval = eco.cloud.spec.interval || 8;
      const progress = (this.simTime % interval) / interval;
      eco.cloud.mesh.position.x = -5.5 + progress * 11;
      eco.cloud.mesh.position.z = Math.sin(progress * Math.PI * 2) * 0.6;
      eco.cloud.material.opacity = Math.sin(progress * Math.PI) * 0.58;
    }
  }

  showButterflyHint() {
    this.disposeButterflyHint();
    const bug = this.sim?.bugs.find((entry) => entry.state === "roll");
    if (!bug) return false;
    const compatible = this.field.holes.filter((hole) =>
      hole.target && (!this.runtimeLevel.colorMatch || !hole.color || hole.color === bug.color)
    );
    const hole = compatible.reduce((best, candidate) => {
      if (!best) return candidate;
      return Math.hypot(bug.x - candidate.x, bug.z - candidate.z) <
        Math.hypot(bug.x - best.x, bug.z - best.z) ? candidate : best;
    }, null);
    if (!hole) return false;

    const startY = this.field.height(bug.x, bug.z) + 0.7;
    const endY = this.field.height(hole.x, hole.z) + 0.55;
    const midX = (bug.x + hole.x) / 2;
    const midZ = (bug.z + hole.z) / 2;
    const dx = hole.x - bug.x;
    const dz = hole.z - bug.z;
    const length = Math.max(0.1, Math.hypot(dx, dz));
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(bug.x, startY, bug.z),
      new THREE.Vector3(midX - (dz / length) * 0.65, Math.max(startY, endY) + 1.05, midZ + (dx / length) * 0.65),
      new THREE.Vector3(hole.x, endY, hole.z)
    ]);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
    const lineMaterial = new THREE.LineDashedMaterial({
      color: 0xffef9a,
      transparent: true,
      opacity: 0.72,
      dashSize: 0.16,
      gapSize: 0.11,
      depthWrite: false
    });
    const trail = new THREE.Line(lineGeometry, lineMaterial);
    trail.computeLineDistances();

    const butterfly = new THREE.Group();
    butterfly.name = "butterflyGuide";
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x49352c, roughness: 0.8 });
    const wingMaterial = new THREE.MeshStandardMaterial({
      color: 0xffcf4d,
      emissive: 0x7a3f16,
      emissiveIntensity: 0.25,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95
    });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.18, 4, 8), bodyMaterial);
    body.rotation.x = Math.PI / 2;
    butterfly.add(body);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.CircleGeometry(0.18, 14), wingMaterial);
      wing.name = side < 0 ? "leftWing" : "rightWing";
      wing.scale.set(1.25, 0.72, 1);
      wing.position.x = side * 0.15;
      butterfly.add(wing);
    }

    const root = new THREE.Group();
    root.name = "butterflyHint";
    root.add(trail, butterfly);
    this.boardContent.add(root);
    this.butterflyHint = {
      root,
      butterfly,
      trail,
      curve,
      startedAt: this.clockTime,
      duration: 4.2
    };
    return true;
  }

  updateButterflyHint() {
    const hint = this.butterflyHint;
    if (!hint) return;
    const elapsed = this.clockTime - hint.startedAt;
    const progress = clamp(elapsed / hint.duration, 0, 1);
    const travel = progress < 0.88 ? progress / 0.88 : 1;
    hint.curve.getPoint(travel, hint.butterfly.position);
    const tangent = hint.curve.getTangent(Math.min(0.999, travel));
    hint.butterfly.rotation.y = Math.atan2(tangent.x, tangent.z);
    const flap = Math.sin(elapsed * 18) * 0.85;
    hint.butterfly.getObjectByName("leftWing").rotation.y = flap;
    hint.butterfly.getObjectByName("rightWing").rotation.y = -flap;
    hint.trail.material.opacity = progress > 0.72
      ? 0.72 * (1 - (progress - 0.72) / 0.28)
      : 0.72;
    if (progress >= 1) this.disposeButterflyHint();
  }

  disposeButterflyHint() {
    if (!this.butterflyHint) return;
    this.butterflyHint.root.traverse((item) => {
      item.geometry?.dispose?.();
      item.material?.dispose?.();
    });
    this.butterflyHint.root.removeFromParent();
    this.butterflyHint = null;
  }

  bindSimulationEvents() {
    this._simOff.push(
      this.sim.events.on(
        "hit",
        ({ bug = null, speed = 0, edge = false, other = null, x = 0, z = 0 } = {}) => {
          const intensity = clamp(speed / (edge ? 4 : 5), 0.08, 1);
          this.gameCamera.impulse("land", intensity);
          // `other.id` survives the bake because TableTiltLeafSim re-stamps it
          // (upstream's _bake drops it). The contact point is the obstacle's
          // centre pushed out along the contact normal, so subtracting the
          // centre recovers the direction the beetle came from.
          if (other?.id) {
            this.boardSnails?.hit(other.id, speed, x - other.x, z - other.z);
          }
          this.onEvent({
            type: "collision",
            intensity,
            ballId: bug?.id || null,
            obstacleId: other?.id || null,
            obstacleKind: other?.kind || null
          });
        }
      ),
      this.sim.events.on("capture", ({ bug, hole, remaining }) => {
        this.leafPlatform?.pulseHole(hole.id);
        bug && this.balls.find((ball) => ball.id === bug.id)?.insect.pop();
        this.gameCamera.impulse("capture", 1);
        const point = this.boardPointToWorld(
          hole.x,
          this.field.height(hole.x, hole.z) + 0.05,
          hole.z
        );
        this.mossEffects.burst(
          point.x,
          point.y,
          point.z,
          zoneFor(this.runtimeLevel.index || 0).glow
        );
        const stackCount = this.ecosystem?.stacks.get(bug.id) || 0;
        if (stackCount) {
          for (const falling of this.ecosystem.fallingBugs) {
            if (falling.caughtBy === bug.id) falling.mesh.visible = false;
          }
          this.ecosystem.stacks.delete(bug.id);
        }
        this.onEvent({
          type: "ballCaptured",
          ballId: bug.id,
          holeId: hole.id,
          stackCount
        });
        if (remaining === 0) {
          // The simulation marks a beetle captured at the lip, while its
          // sink-and-settle animation takes another half second. Keep gameplay
          // alive until that animation reads as a completed entry.
          this.allCapturedPendingAt = this.simTime + 0.62;
        }
      }),
      this.sim.events.on("wrongHole", ({ bug, hole }) => {
        this.markWrongHole(hole.id);
        this.gameCamera.impulse("land", 0.35);
        this.onEvent({
          type: "wrongHole",
          ballId: bug.id,
          ballColor: bug.color,
          holeId: hole.id,
          holeColor: hole.color
        });
      }),
      this.sim.events.on("boardFailure", (failure) => {
        this.onEvent({
          type: "ballFell",
          ballId: failure.triggerBugId,
          boardFailure: {
            bugIds: [...failure.bugIds],
            capturedBugIds: [...failure.capturedBugIds]
          }
        });
      })
    );
  }

  focusLighting() {
    const focus = this.gameCamera.focusPoint();
    this.mossLighting.focusOn(
      focus.x,
      focus.y,
      focus.z,
      Math.max(4, this.field?.size || 6)
    );
  }

  setPresentation(mode) {
    this.presentation = mode;
    if (!this.boardRoot) return;
    this.boardRoot.visible = !["teaching", "result", "ending"].includes(mode);
  }

  /* =================================================================
     Ending cinematic — the eight-beetle curtain call between the end
     of the run and the result board. It overlays the live scene: the
     director freezes the end-of-run camera and hangs the result board's
     own dimming wash behind the cast, so the final level's environment —
     zone lighting included — stays the backdrop, and the hand-off to the
     score board is one continuous picture. Nothing here touches fog,
     background or the dressing
     groups; endEnding() removes the stage and the scene is as it was.
     ================================================================= */
  beginEnding(callbacks, { line = "" } = {}) {
    if (this.ending) this.endEnding();
    this.setPresentation("ending");
    this.ending = new EndingDirector(this.scene, this.camera, callbacks, {
      /* Post-FX renders the scene into a linear target, which changes what an
         alpha means; the wash needs to know which space it is landing in. */
      linearBlend: this.mossPostFX.enabled,
      /* 签语叶就长在这一局结束的那个林层里 —— 用同一套区域配色，它才像是
         从头顶掉下来的，不是从别处飞进来的。 */
      zoneIndex: this.runtimeLevel?.index || 0,
      line
    });
    this.ending.start();
  }

  endEnding() {
    if (!this.ending) return;
    this.ending.dispose();
    this.ending = null;
  }

  setSimulationEnabled(enabled) {
    this.physicsEnabled = Boolean(enabled);
  }

  setInputEnabled(enabled) {
    this.inputEnabled = Boolean(enabled);
  }

  setTimingScale(scale) {
    this.timingScale = clamp(Number(scale) || 1, 0.05, 1);
  }

  updateTilt(input, dt) {
    const maxTilt = clamp(
      Number(this.runtimeLevel?.maxTilt || 0),
      0,
      0.6
    );
    const target = this.inputEnabled
      ? mapGameplayTiltInput(input)
      : { x: 0, y: 0 };
    this.roll = stepCriticalDampedAngle(
      this.roll,
      target.x * maxTilt,
      dt
    );
    this.pitch = stepCriticalDampedAngle(
      this.pitch,
      target.y * maxTilt,
      dt
    );
  }

  fixedStep(fixedDt) {
    if (!this.sim) return;
    const pitch = this.pitch.angle;
    const roll = -this.roll.angle;
    this.sim.setTilt(pitch, roll);
    if (!this.physicsEnabled) return;
    const frozen = this.updateEcosystemPhysics(fixedDt);
    this.sim.step(fixedDt);
    this.restoreFrozenBugs(frozen);
    this.collectDew();
    this.syncFallingBalls();
    this.simTime += fixedDt;
    if (
      this.allCapturedPendingAt != null &&
      this.simTime >= this.allCapturedPendingAt
    ) {
      this.allCapturedPendingAt = null;
      this.onEvent({ type: "allCaptured" });
    }
  }

  trackFallingBall(ballId) {
    if (!ballId || this.failureFallenBallIds.has(ballId)) return false;
    const ball = this.balls.find((entry) => entry.id === ballId);
    if (ball?.captured) return false;
    this.failureFallenBallIds.add(ballId);
    if (ball) {
      ball.failureFadeElapsed = 0;
      ball.visualOpacity = 1;
      ball.insect?.setOpacity?.(1);
      if (ball.insect?.group) ball.insect.group.visible = true;
      else if (ball.mesh) ball.mesh.visible = true;
    }
    return true;
  }

  syncFallingBalls() {
    if (
      !this.failureDropActive &&
      !this.failureActive &&
      this.failureFallenBallIds.size === 0
    ) {
      return false;
    }
    let changed = false;
    for (const bug of this.sim?.bugs || []) {
      if (bug.state !== "falling") continue;
      changed = this.trackFallingBall(bug.id) || changed;
    }
    return changed;
  }

  startFailureDrop(ballId) {
    this.failureDropActive = true;
    this.failureActive = false;
    this.failureElapsed = 0;
    this.trackFallingBall(ballId);
    this.sim?.forceFall(ballId);
    this.syncFallingBalls();
  }

  hasFallenBallClearedBoard(ballId) {
    const bug = this.sim?.bugById(ballId);
    return Boolean(
      bug &&
        bug.state === "falling" &&
        bug.y < -Math.max(0.7, bug.r * 2)
    );
  }

  hasFallenBallFadedOut(ballId) {
    const ball = this.balls.find((entry) => entry.id === ballId);
    return Boolean(ball && ball.failureFadeElapsed >= FAILURE_FADE_SEC);
  }

  hasAllFallenBallsClearedBoard() {
    const ids = [...this.failureFallenBallIds];
    return (
      ids.length > 0 &&
      ids.every((ballId) => this.hasFallenBallClearedBoard(ballId))
    );
  }

  hasAllFallenBallsFadedOut() {
    const ids = [...this.failureFallenBallIds];
    return (
      ids.length > 0 &&
      ids.every((ballId) => this.hasFallenBallFadedOut(ballId))
    );
  }

  latestFallenBallElapsed() {
    let latestElapsed = Infinity;
    for (const ballId of this.failureFallenBallIds) {
      const ball = this.balls.find((entry) => entry.id === ballId);
      if (!ball) return 0;
      latestElapsed = Math.min(
        latestElapsed,
        Math.max(0, Number(ball.failureFadeElapsed) || 0)
      );
    }
    return Number.isFinite(latestElapsed) ? latestElapsed : 0;
  }

  startFailureSpin(ballId) {
    if (ballId) this.failureFallenBallIds.add(ballId);
    this.failureActive = true;
    this.failureDropActive = false;
    this.failureElapsed = 0;
    this.boardYaw = Math.PI * 2;
    for (const ball of this.balls || []) {
      if (!this.failureFallenBallIds.has(ball.id)) continue;
      ball.visualOpacity = 0;
      ball.insect?.setOpacity?.(0);
      if (ball.insect?.group) ball.insect.group.visible = false;
      else if (ball.mesh) ball.mesh.visible = false;
    }
    this.gameCamera?.impulse("shake", 0.8);
  }

  endFailureSpin() {
    this.failureActive = false;
    this.failureDropActive = false;
    this.failureElapsed = 0;
    this.boardYaw = 0;
    this.boardTilt.rotation.y = 0;
  }

  startLevelHandoffExit() {
    this.handoffPhase = "exit";
    this.boardRoot.visible = true;
  }

  hideLevelBoard() {
    this.handoffPhase = "exit";
    this.boardRoot.visible = true;
  }

  startLevelHandoffEnter() {
    this.handoffPhase = this.gameCamera.isDescending ? "descent" : "enter";
    this.boardRoot.visible = true;
    if (!this.gameCamera.isDescending) {
      this.gameCamera.frameLevel(this.runtimeLevel, false);
    }
  }

  /**
   * Drop the world's god rays.
   *
   * They are additive cream sheets that treadmill with
   * `godrays.position.y = Math.round(y / 60) * 60`, so the whole slab
   * teleports once every sixty metres of descent — which reads in play as a
   * ring of pale yellow light snapping across the frame each time the camera
   * drops. Killing the mesh here rather than in `render/world.js` keeps
   * `src/mossfall/**` byte-identical to its read-only upstream (see
   * `src/mossfall/upstream-sha256.json`); world.js already guards its per-frame
   * god-ray block behind `if (this.godrays)`, so clearing the handle is enough.
   */
  removeGodrays() {
    const world = this.mossWorld;
    const mesh = world?.godrays;
    if (!mesh) return false;
    mesh.parent?.remove(mesh);
    mesh.geometry?.dispose();
    world.godrays = null;
    return true;
  }

  isLevelHandoffActive() {
    return Boolean(this.gameCamera?.isDescending);
  }

  endLevelHandoff() {
    if (this.isLevelHandoffActive()) return false;
    this.handoffPhase = null;
    this.boardRoot.visible = true;
    this.boardRoot.scale.setScalar(1);
    this.gameCamera.frameLevel(this.runtimeLevel, true);
    return true;
  }

  captureBall(ball, hole) {
    if (!ball || !hole) return false;
    const bug = ball.simBug || this.sim?.bugById?.(ball.id);
    if (
      this.runtimeLevel?.colorMatch &&
      hole.color &&
      bug?.color !== hole.color
    ) {
      this.markWrongHole(hole.id);
      this.onEvent({
        type: "wrongHole",
        ballId: bug?.id || ball.id,
        ballColor: bug?.color,
        holeId: hole.id,
        holeColor: hole.color
      });
      return false;
    }
    return this.sim?.forceCapture(ball.simBug || ball.id, hole.id) || false;
  }

  celebrateLevelClear() {
    this.gameCamera.impulse("win", 1);
    this.leafPlatform?.bendForWin(1);
    for (const ball of this.balls) ball.insect.glow(0.8);
  }

  resetFallenBalls() {
    this.sim?.resetUncaptured();
    for (const ball of this.balls) {
      if (ball.captured) continue;
      ball.failureFadeElapsed = 0;
      ball.visualOpacity = 1;
      ball.insect.setOpacity?.(1);
      ball.insect.group.visible = true;
      ball.insect.setExpression("auto");
    }
    this.failureFallenBallIds.clear();
    this.roll = { angle: 0, velocity: 0 };
    this.pitch = { angle: 0, velocity: 0 };
    this.endFailureSpin();
  }

  boardPointToWorld(x, y, z) {
    this.fxWorldPoint.set(x, y, z);
    this.boardContent.updateWorldMatrix(true, false);
    return this.fxWorldPoint.applyMatrix4(this.boardContent.matrixWorld);
  }

  updatePresentation(dt) {
    this.updateSpikeHazards();
    this.updateCollectibleDew();
    this.updateButterflyHint();
    this.updateEcosystemVisuals();
    this.updateHoleMarkers();
    const pitch = this.pitch.angle;
    const roll = -this.roll.angle;
    if (this.failureActive) {
      this.failureElapsed += dt;
      const progress = clamp(this.failureElapsed / FAILURE_SPIN_SEC, 0, 1);
      const envelope = Math.sin(progress * Math.PI);
      this.boardTilt.rotation.y = failureSpinAngle(
        this.failureElapsed,
        FAILURE_SPIN_SEC
      );
      this.boardTilt.rotation.x =
        pitch + Math.sin(this.failureElapsed * 6.5) * 0.026 * envelope;
      this.boardTilt.rotation.z =
        roll + Math.sin(this.failureElapsed * 8) * 0.035 * envelope;
      return;
    }

    this.boardTilt.rotation.y +=
      (this.boardYaw - this.boardTilt.rotation.y) * Math.min(1, dt * 8);
    if (this.presentation === "menu") {
      const drift = this.clockTime;
      this.boardTilt.rotation.x = Math.sin(drift * 0.42) * 0.012;
      this.boardTilt.rotation.z = Math.sin(drift * 0.31 + 0.8) * 0.016;
      this.boardTilt.rotation.y = this.boardYaw + Math.sin(drift * 0.19) * 0.028;
    } else {
      this.boardTilt.rotation.x = pitch;
      this.boardTilt.rotation.z = roll;
    }

    if (this.handoffPhase === "exit") {
      this.boardRoot.scale.setScalar(
        1 - 0.035 * Math.min(1, this.clockTime % 1)
      );
    } else if (this.handoffPhase === "enter") {
      this.boardRoot.scale.x += (1 - this.boardRoot.scale.x) * Math.min(1, dt * 7);
      this.boardRoot.scale.setScalar(this.boardRoot.scale.x);
    }
  }

  updateBallVisuals(dt) {
    for (const ball of this.balls) {
      const bug = ball.simBug;
      const fallen = this.failureFallenBallIds.has(ball.id);
      if (ball.captured) {
        ball.captureFadeElapsed += dt;
        ball.visualOpacity = capturedBallOpacity(ball.captureFadeElapsed);
      } else if (fallen) {
        ball.failureFadeElapsed += dt;
        ball.visualOpacity = failureBallOpacity(ball.failureFadeElapsed);
      } else {
        ball.visualOpacity = 1;
      }
      ball.insect.update(dt, this.clockTime, bug);
      ball.insect.setOpacity?.(ball.visualOpacity);
      if ((ball.captured || fallen) && ball.visualOpacity <= 0.001) {
        ball.insect.group.visible = false;
      }
    }
  }

  update(dt) {
    // The ending cinematic owns the camera and the cast, so the regular
    // pipeline (which rewrites the camera every frame) stands down — but the
    // world keeps living behind the backdrop: leaves fall, motes drift, and
    // the final level's zone lighting stays exactly as the run left it.
    if (this.presentation === "ending" && this.ending) {
      this.clockTime += dt;
      this.ending.update(dt, this.clockTime);
      this.mossWorld.update(dt, this.clockTime, this.camera.position.y);
      this.storybookEnvironment?.update(this.clockTime, this.camera);
      this.mossLighting.update(dt, this.clockTime);
      this.mossEffects.update(dt, this.clockTime, this.camera.position);
      return;
    }
    // The title is a living preview: scene dressing and leaf animation keep
    // moving at a restrained pace while gameplay physics remains disabled.
    const visualDt = this.presentation === "menu" ? dt * 0.55 : dt;
    this.clockTime += visualDt;
    this.updatePresentation(visualDt);
    if (this.leafPlatform) {
      this.leafPlatform.setTilt(this.pitch.angle, -this.roll.angle);
      this.leafPlatform.update(
        visualDt,
        this.clockTime,
        this.sim?.bugs || []
      );
      // After the platform, never before: the props builder owns each seat
      // group's y every frame, and the snails only ever move children of it.
      this.boardSnails?.update(visualDt);
    }
    this.updateBallVisuals(visualDt);
    this.gameCamera.update(visualDt, this.clockTime);
    const focus = this.gameCamera.focusPoint();
    if (this.presentation === "menu") {
      // A slow title-only camera drift makes the live world legible as motion.
      // GameCamera rewrites its base pose every frame, so this never accumulates
      // and gameplay returns to the exact authored frame on the next update.
      this.camera.position.x += Math.sin(this.clockTime * 0.34) * 0.72;
      this.camera.position.y += Math.sin(this.clockTime * 0.24 + 0.8) * 0.24;
      this.camera.position.z += Math.cos(this.clockTime * 0.29) * 0.18;
      this.camera.lookAt(focus);
    }
    this.cameraDepth = focus.y;
    this.mossWorld.update(
      visualDt,
      this.clockTime,
      this.camera.position.y
    );
    this.storybookEnvironment?.update(this.clockTime, this.camera);
    this.mossLighting.update(visualDt, this.clockTime);
    this.mossEffects.update(
      visualDt,
      this.clockTime,
      this.camera.position
    );
  }

  render() {
    if (this.mossPostFX.enabled) {
      this.mossPostFX.render(this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  resize() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(
      calculateRenderPixelRatio(
        width,
        height,
        window.devicePixelRatio || 1
      )
    );
    this.renderer.setSize(width, height, false);
    const uiFit = String(width / 1280);
    document.documentElement.style.setProperty("--ui-fit", uiFit);
    document
      .querySelector("#ui-layer")
      ?.style.setProperty("--ui-fit", uiFit);
    this.mossEffects.setViewportHeight(
      height * this.renderer.getPixelRatio()
    );
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.mossPostFX.resize(width, height);
  }

  presentationViewportSnapshot() {
    const canvas = this.renderer.domElement;
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      hostWidth: this.host.clientWidth,
      hostHeight: this.host.clientHeight,
      canvasClientWidth: canvas.clientWidth,
      canvasClientHeight: canvas.clientHeight,
      canvasBackingWidth: canvas.width,
      canvasBackingHeight: canvas.height,
      renderPixelRatio: this.renderer.getPixelRatio(),
      postFXWidth: this.mossPostFX.enabled ? this.mossPostFX._w : canvas.width,
      postFXHeight: this.mossPostFX.enabled ? this.mossPostFX._h : canvas.height
    };
  }

  snapshot() {
    const fieldIdentity = {
      leafPlatform: this.leafPlatform?.field === this.field,
      leafSim: this.sim?.field === this.field,
      gameCamera: this.gameCamera?._fieldFor?.(this.runtimeLevel) === this.field
    };
    return {
      levelId: this.level?.id || null,
      levelName: this.level?.name || null,
      visualTheme: "mossfall",
      runtime: {
        nativeBoard: Boolean(this.runtimeLevel?.board?.shapes),
        fieldIdentity,
        singleField:
          fieldIdentity.leafPlatform &&
          fieldIdentity.leafSim &&
          fieldIdentity.gameCamera,
        sim: "TableTiltLeafSim",
        camera: "GameCamera"
      },
      mossfall: {
        world: Boolean(this.mossWorld?.ok),
        lighting: Boolean(this.mossLighting?.ok),
        effects: Boolean(this.mossEffects?.ok),
        postfx: Boolean(this.mossPostFX?.enabled),
        zone: this.runtimeLevel?.index || 0,
        localDressingCount: this.mossWorld?.local?.children.length || 0,
        leaf: {
          system: this.leafPlatform ? "LeafPlatform" : "",
          adaptive: false,
          buildFieldMesh: Boolean(this.leafPlatform?.blade),
          shaderOk: Boolean(this.leafPlatform?._shaderOk),
          bladeCount: this.leafPlatform?.blade ? 1 : 0,
          burrowFurnitureCount: this.leafPlatform?.furniture ? 1 : 0,
          burrowGlowCount: this.leafPlatform?.glow ? 1 : 0,
          contactShadowLayerCount: this.leafPlatform?.shadows ? 1 : 0,
          boardPropsCount: this.leafPlatform?.props ? 1 : 0,
          topVertices: this.leafStats.topVertices,
          triangles: this.leafStats.triangles,
          boundaryEdges: this.leafStats.boundaryEdges,
          heightRange: this.leafStats.heightRange,
          heightRms: this.leafStats.heightRms,
          thicknessRange: this.leafStats.thicknessRange,
          edgeVertexCount: this.leafStats.edgeVertexCount,
          veinVertexCount: this.leafStats.veinVertexCount,
          calm: Number(this.leafPlatform?.u?.uCalm?.value || 0),
          sagWeights: (this.leafPlatform?.u?.uBugs?.value || []).map(
            (entry) => entry.z
          ),
          pulseStrengths: (this.leafPlatform?.u?.uPulse?.value || []).map(
            (entry) => entry.w
          )
        },
        postfxExplicitClear: true
      },
      renderPixelRatio: this.renderer.getPixelRatio(),
      rollDeg: this.roll.angle / DEG,
      pitchDeg: this.pitch.angle / DEG,
      visualPitchDeg: this.boardTilt.rotation.x / DEG,
      visualRollDeg: this.boardTilt.rotation.z / DEG,
      failureActive: this.failureActive,
      failureDropActive: this.failureDropActive,
      boardYawDeg: this.boardYaw / DEG,
      visualYawDeg: this.boardTilt.rotation.y / DEG,
      handoffPhase: this.handoffPhase,
      boardVisible: this.boardRoot.visible,
      boardScale: this.boardRoot.scale.x,
      boardOffsetY: this.boardRoot.position.y - this.levelDepth,
      levelDepth: this.levelDepth,
      cameraDepth: this.cameraDepth,
      cameraPosition: this.camera.position.toArray(),
      cameraQuaternion: this.camera.quaternion.toArray(),
      retiredBoardCount: this.retiredBoards.length,
      fallenBallIds: [...this.failureFallenBallIds],
      balls: this.balls.map((ball, index) => {
        const bug = ball.simBug;
        const insect = ball.insect.snapshot();
        const shadowSlots = Math.floor(
          Number(
            this.leafPlatform?.shadows?.geometry?.getAttribute("position")
              ?.count || 0
          ) / 4
        );
        return {
          id: ball.id,
          color: bug.color,
          species: bug.species,
          captured: ball.captured,
          radius: ball.radius,
          visible: ball.insect.group.visible,
          opacity: ball.visualOpacity,
          insectScale: insect.visualScale,
          ballForm: insect.formBlend <= 0.001 ? "sphere" : "insect",
          formBlend: insect.formBlend,
          ownerCount: insect.ownerCount,
          shellCount: insect.shellCount,
          rigCount: insect.rigCount,
          shadowCount: index < shadowSlots ? 1 : 0,
          castShadowMeshCount: insect.castShadowMeshCount,
          protrudingFeatures: insect.formBlend > 0.001,
          insectLegs: insect.formBlend > 0.001,
          insectAntennae: insect.formBlend > 0.001,
          haloOpacity: 0,
          trailStrength: 0,
          trailVisibleCount: insect.trailCount,
          ghostCount: insect.ghostCount,
          restT: bug.restT,
          captureT: bug.captureT,
          captureHoldT: bug.captureHoldT || 0,
          position:
            bug.state === "captured"
              ? null
              : { x: bug.x, y: bug.y, z: bug.z }
        };
      }),
      holes: this.holes.map((hole) => ({
        ...(() => {
          const geometry = this.holeGeometryStats.get(hole.id);
          const minOffset = Number.isFinite(geometry?.minOffset)
            ? geometry.minOffset
            : 0;
          const maxOffset = Number.isFinite(geometry?.maxOffset)
            ? geometry.maxOffset
            : 0;
          return {
            lipVertexCount: geometry?.vertexCount || 0,
            lipMinOffset: minOffset,
            lipMaxOffset: maxOffset,
            throatCount: geometry?.throatCount || 0,
            floorCount: geometry?.floorCount || 0,
            funnelCount: geometry?.funnelCount || 0
          };
        })(),
        id: hole.id,
        style: hole.style,
        captureElapsed: hole.captureElapsed,
        glowStrength: hole.glowStrength,
        burstVisible: hole.burstVisible,
        burstOpacity: hole.burstOpacity,
        realOpening:
          this.field.sdf(hole.x, hole.z) < 0 &&
          this.field.visualSdf(hole.x, hole.z) > 0,
        thinLip:
          hole.style === "bite" &&
          (this.holeGeometryStats.get(hole.id)?.vertexCount || 0) > 0 &&
          (this.holeGeometryStats.get(hole.id)?.maxOffset || 0) -
            (this.holeGeometryStats.get(hole.id)?.minOffset || 0) <=
            0.04,
        lightConeCount: this.leafPlatform?.glow ? 1 : 0
      }))
    };
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.onWebglContextLost
    );
    this.renderer.domElement.removeEventListener(
      "webglcontextrestored",
      this.onWebglContextRestored
    );
    this.clearLevel();
    this.storybookEnvironment?.dispose();
    this.mossEffects.dispose();
    this.mossPostFX.dispose();
    this.mossWorld.dispose();
    this.mossLighting.dispose();
    this.gameCamera.dispose();
    this.runtimeEvents.clear();
    this.renderer.dispose();
    this.host.replaceChildren();
  }
}
