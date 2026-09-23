import {
  createDefaultSha256,
  createExternalGameCandidateClient,
  getHostBootstrapTransport
} from "@kiwii/game-sdk-external-game-candidate";
import {
  EXTERNAL_GAME_PROFILE,
  GAMEPAD_TILT_BUTTONS,
  gamepadTiltTarget,
  resolveGamepadAction
} from "./external-game-contract.js";

export {
  EXTERNAL_GAME_PROFILE,
  GAMEPAD_TILT_BUTTONS,
  gamepadTiltTarget,
  resolveGamepadAction
} from "./external-game-contract.js";

/* ======================================================================
 * Kiwii External Game Presentation candidate integration (ADR-0011,
 * `EXTERNAL_GAME_PRESENTATION`, app-private candidate
 * `@kiwii/game-sdk-external-game-candidate@0.2.0-private.1`).
 *
 * It activates only when the Host bootstrap transport
 * `window.__kiwiiExternalGameTransport` is present. Ordinary browsers stay
 * on the local single-instance path.
 *
 * Semantic truth for the wire envelope is the vendored candidate's
 * `message.schema.json` / `game-profile.schema.json` (closed schemas);
 * this module never invents fields or lenient parsing.
 * ==================================================================== */

export const EXTERNAL_GAME_CHECKPOINT_SCHEMA_VERSION =
  "kiwii.moss-tilt.external-game-checkpoint.v1";
export const EXTERNAL_GAME_CHECKPOINT_MAX_BYTES = 4096;
export const EXTERNAL_GAME_VIEWPORT_SETTLE_TIMEOUT_MS = 2800;

/* Screens whose run is live enough to survive a checkpoint. A restored
 * instance always re-enters through the level countdown of the captured
 * level: the new document never claims to be the original instance. */
const CHECKPOINT_RUN_SCREENS = new Set([
  "TEACH_IN",
  "LEVEL_INTRO",
  "GAMEPLAY",
  "BALL_FALL_DROP",
  "BALL_FALL_RESET",
  "LEVEL_CLEAR",
  "PAUSE_MENU",
  "HOW_TO_PLAY",
  "CONFIRM_QUIT"
]);

/* Direction buttons drive the table-tilt vector with the exact keyboard
 * axis convention (screen-up is negative y); action buttons are consumed
 * by controller.handleGamepadAction. */
function checkpointScreen(snapshot) {
  const screen = String(snapshot?.state || "");
  return CHECKPOINT_RUN_SCREENS.has(screen) ? snapshot.state : "MODE_SELECT";
}

function clampInteger(value, minimum, maximum, fallback) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

/* Serializes the run-level game state. The payload is a closed object well
 * under the 4 KiB recommendation; instance-identity data (performance
 * counters, stream metadata) is deliberately absent because a restored
 * instance is a new document. */
export function captureExternalGameCheckpoint(snapshot) {
  const mode = snapshot?.mode === "advanced" ? "advanced" : "beginner";
  const screen = checkpointScreen(snapshot);
  if (screen === "MODE_SELECT") {
    return {
      schemaVersion: EXTERNAL_GAME_CHECKPOINT_SCHEMA_VERSION,
      screen,
      mode
    };
  }
  return {
    schemaVersion: EXTERNAL_GAME_CHECKPOINT_SCHEMA_VERSION,
    screen,
    mode,
    level: clampInteger(snapshot?.level, 1, 8, 1),
    timeRemainingMs: clampInteger(
      Math.round(Number(snapshot?.timeRemaining || 0) * 1000),
      0,
      600_000,
      0
    ),
    levelsCleared: clampInteger(snapshot?.levelsCleared, 0, 8, 0),
    drops: clampInteger(snapshot?.drops, 0, 99, 0)
  };
}

const CHECKPOINT_RUN_KEYS = Object.freeze(
  ["drops", "level", "levelsCleared", "mode", "schemaVersion", "screen", "timeRemainingMs"]
);
const CHECKPOINT_MENU_KEYS = Object.freeze(["mode", "schemaVersion", "screen"]);

export function validateExternalGameCheckpoint(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const keys = Object.keys(value).sort();
  const isRunShape =
    keys.length === CHECKPOINT_RUN_KEYS.length &&
    keys.every((key, index) => key === CHECKPOINT_RUN_KEYS[index]);
  const isMenuShape =
    keys.length === CHECKPOINT_MENU_KEYS.length &&
    keys.every((key, index) => key === CHECKPOINT_MENU_KEYS[index]);
  if (!isRunShape && !isMenuShape) return null;
  if (value.schemaVersion !== EXTERNAL_GAME_CHECKPOINT_SCHEMA_VERSION) return null;
  if (value.mode !== "beginner" && value.mode !== "advanced") return null;
  if (!CHECKPOINT_RUN_SCREENS.has(value.screen) && value.screen !== "MODE_SELECT") {
    return null;
  }
  if (isMenuShape) return { ...value };
  if (!Number.isSafeInteger(value.level) || value.level < 1 || value.level > 8) {
    return null;
  }
  if (!Number.isSafeInteger(value.timeRemainingMs) || value.timeRemainingMs < 0) {
    return null;
  }
  if (
    !Number.isSafeInteger(value.levelsCleared) ||
    value.levelsCleared < 0 ||
    value.levelsCleared > 8
  ) {
    return null;
  }
  if (!Number.isSafeInteger(value.drops) || value.drops < 0) return null;
  return { ...value };
}

/* Layout authority for topology snapshots: the single document renders
 * the full game either on the phone or on the external display, and the
 * Host owns the phone virtual gamepad. The game never draws its own. */
export function externalGameLayoutMode(topology) {
  if (topology?.presentationLocation === "EXTERNAL") return "EXTERNAL_GAME";
  if (
    topology?.presentationLocation === "PHONE" &&
    topology?.phoneInteractionMode === "FULL_GAME"
  ) {
    return "COMBINED";
  }
  return null;
}

/* Probes the Host bootstrap channel. Returns the transport only inside
 * the External Game Host; every other environment gets null and keeps the
 * local single-instance boot path. */
export function detectExternalGameTransport(scope = globalThis) {
  if (!scope || scope.__kiwiiExternalGameTransport === undefined) return null;
  try {
    return getHostBootstrapTransport();
  } catch {
    return null;
  }
}

export function createMossTiltExternalGameClient({
  transport,
  sha256 = createDefaultSha256(),
  logger = () => {}
} = {}) {
  return createExternalGameCandidateClient({
    transport,
    buttons: [...EXTERNAL_GAME_PROFILE.buttons],
    capabilities: { ...EXTERNAL_GAME_PROFILE.lifecycleCapabilities },
    sha256,
    logger
  });
}

const EXTERNAL_GAME_SEQUENCE_PATTERN = /^(0|[1-9][0-9]*)$/;

function parseExternalGameSequence(value) {
  if (
    typeof value !== "string" ||
    !EXTERNAL_GAME_SEQUENCE_PATTERN.test(value)
  ) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function sameTopologySurface(left, right) {
  return (
    left.surfaceInstanceId === right.surfaceInstanceId &&
    left.presentationLocation === right.presentationLocation &&
    left.phoneInteractionMode === right.phoneInteractionMode
  );
}

/** Keeps stale Host callbacks from mutating the candidate client's current
 * authority and ordering state. The iOS Host already applies the same rules;
 * this guard makes delayed or replayed transport delivery inert game-side. */
export function createGuardedExternalGameTransport(
  transport,
  logger = () => {}
) {
  if (
    !transport ||
    typeof transport.request !== "function" ||
    typeof transport.setReceiver !== "function"
  ) {
    return transport;
  }

  let authorityEpoch = null;
  let surfaceInstanceId = null;
  let topologyRevision = null;
  let topologySnapshot = null;
  let lastSourceSequence = null;
  const seenGamepadActions = new Map();
  const rejectionCounts = new Map();

  const reject = (reason, event) => {
    rejectionCounts.set(reason, (rejectionCounts.get(reason) || 0) + 1);
    logger(`ignored ${reason}`, event);
    return false;
  };

  const admitTopology = (event) => {
    const nextEpoch = parseExternalGameSequence(event.authorityEpoch);
    const nextRevision = parseExternalGameSequence(event.topologyRevision);
    if (nextEpoch === null) {
      return reject("malformed authority epoch", event);
    }
    if (nextRevision === null) {
      return reject("malformed topology revision", event);
    }
    if (authorityEpoch === null) {
      authorityEpoch = nextEpoch;
      surfaceInstanceId = event.surfaceInstanceId;
      topologyRevision = nextRevision;
      topologySnapshot = event;
      return true;
    }
    if (nextEpoch < authorityEpoch) {
      return reject("stale authority epoch", event);
    }
    if (nextEpoch > authorityEpoch) {
      return reject("unrestored authority epoch", event);
    }
    if (
      surfaceInstanceId !== null &&
      event.surfaceInstanceId !== surfaceInstanceId
    ) {
      return reject("changed surface identity", event);
    }
    if (topologyRevision !== null && nextRevision < topologyRevision) {
      return reject("stale topology revision", event);
    }
    if (
      topologyRevision !== null &&
      nextRevision === topologyRevision &&
      topologySnapshot &&
      !sameTopologySurface(topologySnapshot, event)
    ) {
      return reject("conflicting topology revision", event);
    }
    topologyRevision = nextRevision;
    topologySnapshot = event;
    return true;
  };

  const admitRestore = (event) => {
    const nextEpoch = parseExternalGameSequence(event.authorityEpoch);
    if (nextEpoch === null) {
      return reject("malformed restore authority", event);
    }
    if (authorityEpoch !== null && nextEpoch <= authorityEpoch) {
      return reject("stale restore authority", event);
    }
    authorityEpoch = nextEpoch;
    surfaceInstanceId = event.surfaceInstanceId;
    topologyRevision = null;
    topologySnapshot = null;
    lastSourceSequence = null;
    seenGamepadActions.clear();
    return true;
  };

  const admitGamepad = (event) => {
    const eventRevision = parseExternalGameSequence(event.topologyRevision);
    const sourceSequence = parseExternalGameSequence(event.sourceSequence);
    if (eventRevision === null) {
      return reject("malformed gamepad topology", event);
    }
    if (sourceSequence === null) {
      return reject("malformed gamepad sequence", event);
    }
    if (
      topologyRevision !== null &&
      eventRevision !== topologyRevision
    ) {
      return reject("stale gamepad topology", event);
    }
    const actionId = String(event.sourceActionId || "");
    const fingerprint = [
      event.buttonId,
      event.phase,
      event.sourceSequence,
      event.topologyRevision
    ].join("|");
    if (seenGamepadActions.has(actionId)) {
      const reason =
        seenGamepadActions.get(actionId) === fingerprint
          ? "duplicate gamepad action"
          : "conflicting gamepad action";
      return reject(reason, event);
    }
    if (lastSourceSequence !== null && sourceSequence <= lastSourceSequence) {
      return reject("stale gamepad sequence", event);
    }
    if (actionId) seenGamepadActions.set(actionId, fingerprint);
    lastSourceSequence = sourceSequence;
    return true;
  };

  const admit = (raw) => {
    let event;
    try {
      event = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return true;
    }
    if (!event || typeof event !== "object") return true;
    if (event.type === "EXTERNAL_PRESENTATION_TOPOLOGY") {
      return admitTopology(event);
    }
    if (event.type === "EXTERNAL_GAME_RESTORE") {
      return admitRestore(event);
    }
    if (event.type === "EXTERNAL_GAMEPAD_ACTION") {
      return admitGamepad(event);
    }
    return true;
  };

  return {
    request(raw) {
      return transport.request(raw);
    },
    setReceiver(receiver) {
      return transport.setReceiver((raw) => {
        if (admit(raw)) return receiver(raw);
        return undefined;
      });
    },
    snapshot() {
      return {
        authorityEpoch:
          authorityEpoch === null ? null : authorityEpoch.toString(),
        surfaceInstanceId,
        topologyRevision:
          topologyRevision === null ? null : topologyRevision.toString(),
        lastSourceSequence:
          lastSourceSequence === null ? null : lastSourceSequence.toString(),
        seenGamepadActionCount: seenGamepadActions.size,
        rejectionCounts: Object.fromEntries(rejectionCounts)
      };
    }
  };
}

const RENDERED_FRAME_HOOK_STATE = Symbol("mossTiltRenderedFrameHookState");

function activeRenderedFrameHook(hook) {
  let current = hook;
  while (typeof current === "function") {
    const state = current[RENDERED_FRAME_HOOK_STATE];
    if (!state || state.active) break;
    current = state.previous;
  }
  return current;
}

function afterRenderedFrame(controller, { deadline, now, isCurrent }) {
  return new Promise((resolve, reject) => {
    if (typeof controller?.scene?.render !== "function") {
      reject(new Error("no render owner available for proof render"));
      return;
    }
    const renderOnce = () => {
      try {
        controller.scene.render();
      } catch (error) {
        reject(error);
        return;
      }
      resolve({ status: "rendered" });
    };
    const hookSupported = Boolean(controller) && "onRenderedFrame" in controller;
    if (
      !hookSupported ||
      controller.destroyed ||
      controller.visibilityPaused
    ) {
      // A paused or destroyed loop never reaches scene.render(); layout
      // readiness is proven with one direct frame instead.
      renderOnce();
      return;
    }
    const previous = controller.onRenderedFrame;
    let settled = false;
    let pollTimer = null;
    const hookState = { active: true, previous };
    const renderedFrameHook = (timestamp) => {
      settle({ status: "rendered", timestamp });
    };
    Object.defineProperty(renderedFrameHook, RENDERED_FRAME_HOOK_STATE, {
      value: hookState
    });
    const settle = (result) => {
      if (settled) return;
      settled = true;
      hookState.active = false;
      if (controller.onRenderedFrame === renderedFrameHook) {
        controller.onRenderedFrame = activeRenderedFrameHook(previous);
      }
      if (pollTimer !== null) clearTimeout(pollTimer);
      resolve(result);
    };
    controller.onRenderedFrame = renderedFrameHook;
    const poll = () => {
      if (!isCurrent()) {
        settle({ status: "superseded" });
        return;
      }
      if (now() >= deadline) {
        settle({ status: "timeout" });
        return;
      }
      pollTimer = setTimeout(poll, Math.min(16, Math.max(1, deadline - now())));
    };
    poll();
  });
}

function viewportSnapshotIsReady(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const numericKeys = [
    "viewportWidth",
    "viewportHeight",
    "devicePixelRatio",
    "hostWidth",
    "hostHeight",
    "canvasClientWidth",
    "canvasClientHeight",
    "canvasBackingWidth",
    "canvasBackingHeight",
    "renderPixelRatio",
    "postFXWidth",
    "postFXHeight"
  ];
  if (numericKeys.some((key) => !Number.isFinite(snapshot[key]) || snapshot[key] <= 0)) {
    return false;
  }
  const close = (left, right) => Math.abs(left - right) <= 1;
  return (
    close(snapshot.hostWidth, snapshot.canvasClientWidth) &&
    close(snapshot.hostHeight, snapshot.canvasClientHeight) &&
    snapshot.canvasBackingWidth * snapshot.canvasBackingHeight <= 1920 * 1080 + 1 &&
    close(snapshot.postFXWidth, snapshot.canvasBackingWidth) &&
    close(snapshot.postFXHeight, snapshot.canvasBackingHeight)
  );
}

function sameViewportSnapshot(left, right) {
  if (!left || !right) return false;
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function waitForFrameBeforeDeadline(waitFrame, deadline, now) {
  return new Promise((resolve, reject) => {
    const remaining = Math.max(0, deadline - now());
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, remaining);
    Promise.resolve()
      .then(() => waitFrame())
      .then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

/** Waits for the actual container, Canvas backing and postFX target to remain
 * unchanged across two animation frames, then proves one frame rendered at
 * that exact settled size. The Host still owns native output-mode selection. */
export async function waitForStablePresentationViewport({
  controller,
  layoutController,
  isCurrent = () => true,
  waitFrame = nextAnimationFrame,
  now = () => performance.now(),
  timeoutMs = EXTERNAL_GAME_VIEWPORT_SETTLE_TIMEOUT_MS,
  logger = () => {}
} = {}) {
  const deadline = now() + timeoutMs;
  let previous = null;
  let stableFrames = 0;

  while (now() < deadline) {
    const frameFired = await waitForFrameBeforeDeadline(waitFrame, deadline, now);
    if (!isCurrent()) return { status: "superseded" };
    if (!frameFired) return { status: "timeout" };
    try {
      layoutController?.update?.();
      controller?.scene?.resize?.();
    } catch (error) {
      logger("viewport resize failed", error);
      return { status: "unsatisfiable" };
    }
    const snapshot = controller?.scene?.presentationViewportSnapshot?.();
    if (
      viewportSnapshotIsReady(snapshot) &&
      sameViewportSnapshot(previous, snapshot)
    ) {
      stableFrames += 1;
    } else {
      stableFrames = viewportSnapshotIsReady(snapshot) ? 1 : 0;
    }
    previous = snapshot;
    if (stableFrames < 2) continue;

    const proof = await afterRenderedFrame(controller, {
      deadline,
      now,
      isCurrent
    });
    if (proof.status === "superseded" || !isCurrent()) {
      return { status: "superseded" };
    }
    if (proof.status === "timeout") return { status: "timeout" };
    const renderedSnapshot = controller?.scene?.presentationViewportSnapshot?.();
    if (
      viewportSnapshotIsReady(renderedSnapshot) &&
      sameViewportSnapshot(previous, renderedSnapshot)
    ) {
      return { status: "ready", snapshot: renderedSnapshot };
    }
    previous = renderedSnapshot;
    stableFrames = viewportSnapshotIsReady(renderedSnapshot) ? 1 : 0;
  }
  return { status: "timeout" };
}

/* Wires the game runtime to the candidate client. Handlers are registered
 * at client construction, before the ready handshake, so no Host event can
 * race the wiring. The runtime owns exactly one client connection. */
export function connectExternalGameRuntime({
  transport,
  controller,
  layoutController,
  captureSnapshot = () => controller?.snapshot?.(),
  sha256,
  waitForViewport = waitForStablePresentationViewport,
  logger = (...args) => console.warn("[EXTERNAL_GAME]", ...args)
} = {}) {
  let closed = false;
  let acknowledgedRevision = null;
  let terminalRevision = null;
  let topologyGeneration = 0;
  let currentTopology = null;
  const guardedTransport = createGuardedExternalGameTransport(
    transport,
    logger
  );

  async function acknowledgeTopology(topology) {
    const generation = ++topologyGeneration;
    const isCurrent = () => !closed && generation === topologyGeneration;
    const acknowledgementRequired = topology?.phase === "PREPARING";
    let nackSent = false;
    const nackOnce = async () => {
      if (nackSent || !isCurrent() || terminalRevision === topology.topologyRevision) {
        return;
      }
      nackSent = true;
      terminalRevision = topology.topologyRevision;
      await client
        .nackViewport(topology.topologyRevision, "VIEWPORT_UNSATISFIABLE")
        .catch((error) => logger("viewport NACK failed", error));
    };
    try {
      if (closed) return;
      const authorityChanged =
        currentTopology !== null &&
        (
          currentTopology.topologyRevision !== topology.topologyRevision ||
          currentTopology.authorityEpoch !== topology.authorityEpoch ||
          currentTopology.surfaceInstanceId !== topology.surfaceInstanceId
        );
      if (authorityChanged) {
        controller?.input?.releaseGamepadTilt?.();
      }
      currentTopology = topology;
      const mode = externalGameLayoutMode(topology);
      if (mode === null) {
        logger("unsupported topology", topology);
        if (acknowledgementRequired) await nackOnce();
        return;
      }
      try {
        layoutController?.updateMode?.(mode);
      } catch (error) {
        logger("layout update failed", error);
        if (acknowledgementRequired) await nackOnce();
        return;
      }
      if (!acknowledgementRequired) return;
      if (
        acknowledgedRevision === topology.topologyRevision ||
        terminalRevision === topology.topologyRevision ||
        !isCurrent()
      ) return;
      const settled = await waitForViewport({
        controller,
        layoutController,
        isCurrent,
        logger
      });
      if (!isCurrent() || settled.status === "superseded") return;
      if (settled.status !== "ready") {
        await nackOnce();
        return;
      }
      await client.ackViewport(topology.topologyRevision);
      acknowledgedRevision = topology.topologyRevision;
      terminalRevision = topology.topologyRevision;
    } catch (error) {
      logger("viewport transaction failed", error);
      if (acknowledgementRequired) await nackOnce();
    }
  }

  function onGamepadAction(action) {
    if (closed || controller?.destroyed) return;
    if (GAMEPAD_TILT_BUTTONS.has(action.buttonId)) {
      controller?.input?.setGamepadTiltButton?.(action.buttonId, action.phase);
    }
    controller?.handleGamepadAction?.(action.buttonId, action.phase);
  }

  async function onLifecycle(lifecycle) {
    if (closed || !controller) return;
    if (lifecycle.kind === "pause") {
      controller.input?.releaseGamepadTilt?.();
      if (typeof controller.setExternalPaused === "function") {
        controller.setExternalPaused(true, `external-game:${lifecycle.reason}`);
      } else {
        controller.setVisibilityPaused?.(true, `external-game:${lifecycle.reason}`);
      }
      if (lifecycle.requestCheckpoint) {
        try {
          const payload = JSON.stringify(
            captureExternalGameCheckpoint(captureSnapshot())
          );
          if (payload.length > EXTERNAL_GAME_CHECKPOINT_MAX_BYTES) {
            logger(`checkpoint payload ${payload.length}B exceeds budget`);
          }
          await client.commitCheckpoint(payload);
        } catch (error) {
          logger("checkpoint commit failed", error);
        }
      }
      return;
    }
    if (lifecycle.kind === "resume") {
      if (typeof controller.setExternalPaused === "function") {
        controller.setExternalPaused(false, `external-game:${lifecycle.reason}`);
      } else {
        controller.setVisibilityPaused?.(false, `external-game:${lifecycle.reason}`);
      }
    }
  }

  function onRestore(restore) {
    if (closed || !controller) return;
    controller.input?.releaseGamepadTilt?.();
    topologyGeneration += 1;
    acknowledgedRevision = null;
    terminalRevision = null;
    currentTopology = null;
    let checkpoint = null;
    if (typeof restore?.checkpoint === "string" && restore.checkpoint.length > 0) {
      try {
        checkpoint = validateExternalGameCheckpoint(JSON.parse(restore.checkpoint));
      } catch {
        checkpoint = null;
      }
      if (checkpoint === null) {
        logger("checkpoint rejected; starting a fresh instance");
      }
    }
    try {
      controller.restoreExternalGameCheckpoint?.(checkpoint);
    } catch (error) {
      logger("checkpoint restore failed", error);
      controller.enterState?.("MODE_SELECT");
    }
  }

  const client = createExternalGameCandidateClient({
    transport: guardedTransport,
    buttons: [...EXTERNAL_GAME_PROFILE.buttons],
    capabilities: { ...EXTERNAL_GAME_PROFILE.lifecycleCapabilities },
    sha256: sha256 || createDefaultSha256(),
    logger,
    onTopology: (topology) => {
      void acknowledgeTopology(topology);
    },
    onGamepadAction,
    onLifecycle,
    onRestore
  });

  return {
    client,
    guardSnapshot: () => guardedTransport?.snapshot?.() || null,
    acknowledgeTopology,
    async ready() {
      const handshake = await client.ready();
      console.log("[EXTERNAL_GAME] ready handshake accepted");
      return handshake;
    },
    close() {
      if (closed) return;
      closed = true;
      topologyGeneration += 1;
      controller?.input?.releaseGamepadTilt?.();
      client.close();
    }
  };
}
