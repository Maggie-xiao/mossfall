import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createExternalGameCandidateClient,
  ExternalGameCandidateError
} from "@kiwii/game-sdk-external-game-candidate";
import { InputSystem } from "../src/input.js";
import {
  captureExternalGameCheckpoint,
  connectExternalGameRuntime,
  createGuardedExternalGameTransport,
  detectExternalGameTransport,
  gamepadTiltTarget,
  resolveGamepadAction,
  EXTERNAL_GAME_CHECKPOINT_MAX_BYTES,
  EXTERNAL_GAME_CHECKPOINT_SCHEMA_VERSION,
  EXTERNAL_GAME_PROFILE,
  externalGameLayoutMode,
  validateExternalGameCheckpoint,
  waitForStablePresentationViewport
} from "../src/external-game.js";

const SCHEMA_VERSION = "kiwii.external-game.candidate.v1";

/* ------------------------------------------------------------------ */
/* Game profile manifest                                              */
/* ------------------------------------------------------------------ */

test("the game-profile manifest matches the JS profile and the closed schema shape", async () => {
  const manifest = JSON.parse(await readFile(new URL("../game-profile.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest, EXTERNAL_GAME_PROFILE);
  assert.equal(manifest.profileVersion, "kiwii.external-game.profile.v1");
  assert.equal(manifest.topology, "EXTERNAL_GAME_PRESENTATION");
  assert.deepEqual(
    [...manifest.buttons].sort(),
    ["A", "B", "DOWN", "LEFT", "RIGHT", "UP", "X", "Y"]
  );
  assert.equal(manifest.buttons.length, new Set(manifest.buttons).size);
  const { viewportPolicy, lifecycleCapabilities } = manifest;
  assert.deepEqual(Object.keys(viewportPolicy).sort(), ["designHeight", "designWidth", "fit", "orientation"]);
  assert.equal(viewportPolicy.designWidth, 1920);
  assert.equal(viewportPolicy.designHeight, 1080);
  assert.equal(viewportPolicy.designWidth / viewportPolicy.designHeight, 16 / 9);
  assert.equal(viewportPolicy.fit, "ADAPTIVE_SAFE_FRAME");
  assert.equal(viewportPolicy.orientation, "ANY");
  assert.deepEqual(
    Object.keys(lifecycleCapabilities).sort(),
    ["checkpoint", "checkpointMaxBytes", "pauseAck", "viewportAck"]
  );
  assert.equal(lifecycleCapabilities.viewportAck, true);
  assert.equal(lifecycleCapabilities.pauseAck, true);
  assert.equal(lifecycleCapabilities.checkpoint, true);
  assert.ok(lifecycleCapabilities.checkpointMaxBytes >= 1);
  assert.ok(lifecycleCapabilities.checkpointMaxBytes <= 65536);
});

/* ------------------------------------------------------------------ */
/* Direction-button tilt mapping                                      */
/* ------------------------------------------------------------------ */

test("gamepad tilt targets follow the keyboard axis convention", () => {
  assert.deepEqual(gamepadTiltTarget(new Set(["UP"])), { x: 0, y: -1 });
  assert.deepEqual(gamepadTiltTarget(new Set(["DOWN"])), { x: 0, y: 1 });
  assert.deepEqual(gamepadTiltTarget(new Set(["LEFT"])), { x: -1, y: 0 });
  assert.deepEqual(gamepadTiltTarget(new Set(["RIGHT"])), { x: 1, y: 0 });
  assert.deepEqual(gamepadTiltTarget(new Set(["LEFT", "RIGHT"])), { x: 0, y: 0 });
  const diagonal = gamepadTiltTarget(new Set(["UP", "RIGHT"]));
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-9);
  assert.ok(diagonal.x > 0 && diagonal.y < 0);
});

function createInputForGamepad() {
  const input = Object.create(InputSystem.prototype);
  input.keys = new Set();
  input.keyboard = { x: 0, y: 0 };
  input.gamepadTiltButtons = new Set();
  input.gamepadTilt = { x: 0, y: 0 };
  input.touch = { active: false, x: 0, y: 0, pointerId: null };
  input.board = {
    available: false,
    reason: "WAITING_FOR_FIRST_SAMPLE",
    dataAgeMs: 0,
    lastSampleMs: -Infinity,
    sampleVersion: 0
  };
  input.hardwareRequired = false;
  input.localSampleVersion = 0;
  input.debugBoardDisconnected = false;
  input.qaInput = null;
  input.nowMs = () => 0;
  return input;
}

test("gamepad tilt buttons handle PRESSED, RELEASED, and CANCELLED phases", () => {
  const input = createInputForGamepad();

  assert.equal(input.setGamepadTiltButton("UP", "PRESSED"), true);
  assert.equal(input.gamepadTiltActive(), true);
  assert.equal(input.setGamepadTiltButton("UP", "PRESSED"), false); // idempotent hold
  for (let step = 0; step < 60; step += 1) input.updateGamepadTilt(1 / 60);
  const pressed = input.sample(1 / 60);
  assert.equal(pressed.source, "kiwii-gamepad");
  assert.equal(pressed.y, -1);

  assert.equal(input.setGamepadTiltButton("UP", "RELEASED"), true);
  assert.equal(input.gamepadTiltActive(), false);
  assert.equal(input.setGamepadTiltButton("UP", "RELEASED"), false);

  input.setGamepadTiltButton("LEFT", "PRESSED");
  input.setGamepadTiltButton("DOWN", "PRESSED");
  assert.equal(input.setGamepadTiltButton("DOWN", "CANCELLED"), true);
  assert.equal(input.setGamepadTiltButton("LEFT", "CANCELLED"), true);
  assert.equal(input.gamepadTiltActive(), false);

  // Non-direction buttons and unknown phases never enter tilt state.
  assert.equal(input.setGamepadTiltButton("A", "PRESSED"), false);
  assert.equal(input.setGamepadTiltButton("UP", "UNKNOWN"), false);
  assert.equal(input.gamepadTiltActive(), false);
});

test("released gamepad tilt decays to the neutral keyboard fallback", () => {
  const input = createInputForGamepad();
  input.setGamepadTiltButton("RIGHT", "PRESSED");
  input.setGamepadTiltButton("RIGHT", "CANCELLED");
  const sample = input.sample(1 / 60);
  assert.equal(sample.source, "keyboard");
  assert.equal(sample.x, 0);
});

/* ------------------------------------------------------------------ */
/* Action-button semantics                                            */
/* ------------------------------------------------------------------ */

test("action buttons resolve per-screen semantics only on PRESSED", () => {
  const cases = [
    [{ state: "MODE_SELECT", buttonId: "A", phase: "PRESSED" }, "begin-setup"],
    [{ state: "MODE_SELECT", buttonId: "A", phase: "RELEASED" }, null],
    [{ state: "MODE_SELECT", buttonId: "A", phase: "CANCELLED" }, null],
    [{ state: "MODE_SELECT", buttonId: "LEFT", phase: "PRESSED" }, "select-mode-beginner"],
    [{ state: "MODE_SELECT", buttonId: "RIGHT", phase: "PRESSED" }, "select-mode-advanced"],
    [{ state: "GAMEPLAY", buttonId: "B", phase: "PRESSED" }, "pause"],
    [{ state: "GAMEPLAY", buttonId: "A", phase: "PRESSED" }, null],
    [{ state: "PAUSE_MENU", buttonId: "UP", phase: "PRESSED" }, "select-menu-previous"],
    [{ state: "PAUSE_MENU", buttonId: "DOWN", phase: "PRESSED" }, "select-menu-next"],
    [{ state: "PAUSE_MENU", buttonId: "A", phase: "PRESSED" }, "activate-menu-selection"],
    [{ state: "PAUSE_MENU", buttonId: "B", phase: "PRESSED" }, "return-title"],
    [{ state: "PAUSE_MENU", buttonId: "X", phase: "PRESSED" }, "restart-run"],
    [{ state: "PAUSE_MENU", buttonId: "Y", phase: "PRESSED" }, "open-how-to"],
    [{ state: "HOW_TO_PLAY", buttonId: "A", phase: "PRESSED" }, "close-how-to"],
    [{ state: "HOW_TO_PLAY", buttonId: "B", phase: "PRESSED" }, "return-title"],
    [{ state: "HOW_TO_PLAY", buttonId: "Y", phase: "PRESSED" }, "close-how-to"],
    [{ state: "CONFIRM_QUIT", buttonId: "A", phase: "PRESSED" }, "activate-menu-selection"],
    [{ state: "CONFIRM_QUIT", buttonId: "B", phase: "PRESSED" }, "return-title"],
    [{ state: "RESULT_CALC", buttonId: "A", phase: "PRESSED", resultCanContinue: true }, "show-standing"],
    [{ state: "RESULT_CALC", buttonId: "B", phase: "PRESSED", resultCanContinue: true }, null],
    [{ state: "RESULT_CALC", buttonId: "X", phase: "PRESSED", resultCanContinue: true }, "show-standing"],
    [{ state: "RESULT_CALC", buttonId: "X", phase: "PRESSED", resultCanContinue: false }, null],
    [{ state: "GLOBAL_RANK", buttonId: "LEFT", phase: "PRESSED", resultCanContinue: true }, "select-menu-previous"],
    [{ state: "GLOBAL_RANK", buttonId: "RIGHT", phase: "PRESSED", resultCanContinue: true }, "select-menu-next"],
    [{ state: "GLOBAL_RANK", buttonId: "A", phase: "PRESSED", resultCanContinue: true }, "activate-menu-selection"],
    [{ state: "GLOBAL_RANK", buttonId: "B", phase: "PRESSED", resultCanContinue: true }, "return-title"],
    [{ state: "GLOBAL_RANK", buttonId: "X", phase: "PRESSED", resultCanContinue: true }, "restart-run"],
    [{ state: "GLOBAL_RANK", buttonId: "X", phase: "PRESSED", resultCanContinue: false }, null],
    [{ state: "GAMEPLAY", buttonId: "UP", phase: "PRESSED" }, null],
    [{ state: "ENDING", buttonId: "A", phase: "PRESSED" }, null],
    [{ state: "SETUP_WAIT", buttonId: "A", phase: "PRESSED" }, null]
  ];
  for (const [input, expected] of cases) {
    assert.equal(resolveGamepadAction(input), expected, JSON.stringify(input));
  }
});

/* ------------------------------------------------------------------ */
/* Checkpoint capture and validation                                  */
/* ------------------------------------------------------------------ */

test("run checkpoints capture closed run state inside the byte budget", () => {
  const snapshot = {
    state: "GAMEPLAY",
    mode: "advanced",
    level: 5,
    timeRemaining: 41.23,
    levelsCleared: 4,
    drops: 2,
    fps: 58.7,
    input: { irrelevant: true },
    scene: { balls: [] }
  };
  const checkpoint = captureExternalGameCheckpoint(snapshot);
  assert.deepEqual(checkpoint, {
    schemaVersion: EXTERNAL_GAME_CHECKPOINT_SCHEMA_VERSION,
    screen: "GAMEPLAY",
    mode: "advanced",
    level: 5,
    timeRemainingMs: 41230,
    levelsCleared: 4,
    drops: 2
  });
  const payload = JSON.stringify(checkpoint);
  assert.ok(payload.length <= EXTERNAL_GAME_CHECKPOINT_MAX_BYTES);
  assert.deepEqual(validateExternalGameCheckpoint(checkpoint), checkpoint);
  assert.equal(
    validateExternalGameCheckpoint(JSON.parse(payload)).level,
    5
  );
});

test("menu and result screens checkpoint to a fresh mode-select instance", () => {
  for (const state of ["MODE_SELECT", "SETUP_WAIT", "RESULT_CALC", "ENDING", "RUN_COMPLETE", "CONTEXT_LOST"]) {
    const checkpoint = captureExternalGameCheckpoint({ state, mode: "beginner", level: 3, timeRemaining: 20 });
    assert.deepEqual(checkpoint, {
      schemaVersion: EXTERNAL_GAME_CHECKPOINT_SCHEMA_VERSION,
      screen: "MODE_SELECT",
      mode: "beginner"
    });
  }
  // A paused run stays a run checkpoint.
  const paused = captureExternalGameCheckpoint({ state: "PAUSE_MENU", mode: "beginner", level: 2, timeRemaining: 12.5, levelsCleared: 1, drops: 0 });
  assert.equal(paused.screen, "PAUSE_MENU");
  assert.equal(paused.timeRemainingMs, 12500);
});

test("corrupted or alien checkpoints are rejected without defaults leaking", () => {
  assert.equal(validateExternalGameCheckpoint(null), null);
  assert.equal(validateExternalGameCheckpoint("GAMEPLAY"), null);
  assert.equal(
    validateExternalGameCheckpoint({ schemaVersion: "kiwii.other.v1", screen: "GAMEPLAY", mode: "beginner" }),
    null
  );
  assert.equal(
    validateExternalGameCheckpoint({
      schemaVersion: EXTERNAL_GAME_CHECKPOINT_SCHEMA_VERSION,
      screen: "GAMEPLAY",
      mode: "beginner",
      level: 9,
      timeRemainingMs: 1000,
      levelsCleared: 0,
      drops: 0
    }),
    null
  );
  assert.equal(
    validateExternalGameCheckpoint({
      schemaVersion: EXTERNAL_GAME_CHECKPOINT_SCHEMA_VERSION,
      screen: "GAMEPLAY",
      mode: "beginner",
      level: 1,
      timeRemainingMs: 1000,
      levelsCleared: 0,
      drops: 0,
      extra: true
    }),
    null
  );
});

/* ------------------------------------------------------------------ */
/* Topology layout mode                                               */
/* ------------------------------------------------------------------ */

test("layout modes follow presentationLocation and phone interaction mode", () => {
  assert.equal(
    externalGameLayoutMode({ presentationLocation: "PHONE", phoneInteractionMode: "FULL_GAME" }),
    "COMBINED"
  );
  assert.equal(
    externalGameLayoutMode({ presentationLocation: "EXTERNAL", phoneInteractionMode: "VIRTUAL_GAMEPAD" }),
    "EXTERNAL_GAME"
  );
  assert.equal(externalGameLayoutMode({ presentationLocation: "EXTERNAL" }), "EXTERNAL_GAME");
  assert.equal(externalGameLayoutMode({ presentationLocation: "PHONE" }), null);
  assert.equal(externalGameLayoutMode({}), null);
});

/* ------------------------------------------------------------------ */
/* Transport detection                                                */
/* ------------------------------------------------------------------ */

function fakeTransportShape() {
  return { request: async () => "", setReceiver: () => () => {} };
}

test("transport detection is inert outside the external-game host", () => {
  assert.equal(detectExternalGameTransport(null), null);
  assert.equal(detectExternalGameTransport({}), null);
  assert.equal(detectExternalGameTransport({ location: { search: "?qa=1" } }), null);

  const previousWindow = globalThis.window;
  try {
    globalThis.window = undefined;
    assert.equal(detectExternalGameTransport({ __kiwiiExternalGameTransport: fakeTransportShape() }), null);
    globalThis.window = { __kiwiiExternalGameTransport: fakeTransportShape() };
    const transport = detectExternalGameTransport(globalThis.window);
    assert.equal(transport, globalThis.window.__kiwiiExternalGameTransport);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

/* ------------------------------------------------------------------ */
/* End-to-end wiring against a schema-faithful fake host              */
/* ------------------------------------------------------------------ */

function createFakeHost() {
  const requests = [];
  let receiver = null;
  let sequence = 0;
  const host = {
    requests,
    respond(request) {
      switch (request.type) {
        case "EXTERNAL_GAME_READY":
          return {
            schemaVersion: SCHEMA_VERSION,
            requestId: request.requestId,
            type: "EXTERNAL_GAME_READY_ACK",
            accepted: "true",
            restoredCheckpoint: "false"
          };
        case "EXTERNAL_PRESENTATION_ACK":
          return {
            schemaVersion: SCHEMA_VERSION,
            requestId: request.requestId,
            type: "EXTERNAL_PRESENTATION_ACK_ACCEPTED",
            accepted: "true"
          };
        case "EXTERNAL_PRESENTATION_NACK":
          return {
            schemaVersion: SCHEMA_VERSION,
            requestId: request.requestId,
            type: "EXTERNAL_PRESENTATION_NACK_ACCEPTED",
            accepted: "true"
          };
        case "EXTERNAL_GAME_CHECKPOINT":
          return {
            schemaVersion: SCHEMA_VERSION,
            requestId: request.requestId,
            type: "EXTERNAL_GAME_CHECKPOINT_ACK",
            accepted: "true"
          };
        default:
          return {
            schemaVersion: SCHEMA_VERSION,
            requestId: request.requestId,
            type: "HOST_FAILURE",
            accepted: "false",
            reasonCode: "UNSUPPORTED_REQUEST"
          };
      }
    },
    transport: {
      request(raw) {
        const request = JSON.parse(raw);
        requests.push(request);
        return Promise.resolve(JSON.stringify(host.respond(request)));
      },
      setReceiver(next) {
        receiver = next;
        return () => {
          if (receiver === next) receiver = null;
        };
      }
    },
    emit(event) {
      if (!receiver) throw new Error("host has no receiver attached");
      sequence += 1;
      receiver(JSON.stringify({ ...event, schemaVersion: SCHEMA_VERSION }));
    },
    topology({ revision = "1", epoch = "1", phase = "ACTIVE", location = "PHONE", mode = "FULL_GAME", instance = "11111111-1111-4111-8111-111111111111" } = {}) {
      host.emit({
        type: "EXTERNAL_PRESENTATION_TOPOLOGY",
        topologyRevision: revision,
        authorityEpoch: epoch,
        phase,
        presentationLocation: location,
        phoneInteractionMode: mode,
        surfaceInstanceId: instance
      });
    },
    gamepad({ buttonId, phase, revision = "1" }) {
      sequence += 1;
      host.emit({
        type: "EXTERNAL_GAMEPAD_ACTION",
        sourceActionId:
          `22222222-2222-4222-8222-${String(sequence).padStart(12, "0")}`,
        buttonId,
        phase,
        sourceSequence: String(sequence),
        topologyRevision: revision
      });
    },
    async lifecycle(kind, requestCheckpoint) {
      host.emit({
        type: "EXTERNAL_GAME_LIFECYCLE",
        kind,
        reason: "test",
        requestCheckpoint: requestCheckpoint ? "true" : "false"
      });
      await Promise.resolve();
      await Promise.resolve();
    },
    restore(
      checkpoint,
      {
        epoch = "2",
        instance = "33333333-3333-4333-8333-333333333333"
      } = {}
    ) {
      host.emit({
        type: "EXTERNAL_GAME_RESTORE",
        authorityEpoch: epoch,
        surfaceInstanceId: instance,
        checkpointBase64: checkpoint
          ? Buffer.from(JSON.stringify(checkpoint), "utf8").toString("base64")
          : ""
      });
    }
  };
  return host;
}

function createStubController() {
  const controller = {
    state: "GAMEPLAY",
    visibilityPaused: false,
    destroyed: false,
    onRenderedFrame: null,
    framesRendered: 0,
    calls: { gamepad: [], actions: [], visibility: [], restore: [], releasedTilt: 0 },
    input: {
      setGamepadTiltButton(buttonId, phase) {
        controller.calls.gamepad.push({ buttonId, phase });
      },
      releaseGamepadTilt() {
        controller.calls.releasedTilt += 1;
      }
    },
    layoutModes: null,
    setVisibilityPaused(hidden, source) {
      controller.visibilityPaused = hidden;
      controller.calls.visibility.push({ hidden, source });
    },
    handleGamepadAction(buttonId, phase) {
      controller.calls.actions.push({ buttonId, phase });
    },
    restoreExternalGameCheckpoint(checkpoint) {
      controller.calls.restore.push(checkpoint);
    },
    snapshot() {
      return {
        state: controller.state,
        mode: "beginner",
        level: 3,
        timeRemaining: 30.5,
        levelsCleared: 2,
        drops: 1
      };
    },
    scene: {
      resize() {},
      presentationViewportSnapshot() {
        return {
          viewportWidth: 1920,
          viewportHeight: 1080,
          devicePixelRatio: 1,
          hostWidth: 1920,
          hostHeight: 1080,
          canvasClientWidth: 1920,
          canvasClientHeight: 1080,
          canvasBackingWidth: 1920,
          canvasBackingHeight: 1080,
          renderPixelRatio: 1,
          postFXWidth: 1920,
          postFXHeight: 1080
        };
      },
      render() {
        controller.framesRendered += 1;
      }
    }
  };
  return controller;
}

function waitForTestViewport(options) {
  return waitForStablePresentationViewport({
    ...options,
    waitFrame: async () => {},
    now: () => 0
  });
}

function flush(frames = 12) {
  let chain = Promise.resolve();
  for (let index = 0; index < frames; index += 1) {
    chain = chain.then(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
  return chain;
}

async function waitForRequest(host, type, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const request = host.requests.find((candidate) => candidate.type === type);
    if (request) return request;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return null;
}

test("external-game runtime drives ready, topology ACK, gamepad, lifecycle, and restore", async () => {
  const host = createFakeHost();
  const controller = createStubController();
  const inputOwner = controller.input;
  const layoutModes = [];
  const runtime = connectExternalGameRuntime({
    transport: host.transport,
    controller,
    layoutController: { updateMode: (mode) => layoutModes.push(mode) },
    waitForViewport: waitForTestViewport
  });

  const handshake = await runtime.ready();
  assert.deepEqual(handshake, { restoredCheckpoint: false });
  assert.deepEqual(host.requests[0], {
    schemaVersion: SCHEMA_VERSION,
    requestId: host.requests[0].requestId,
    type: "EXTERNAL_GAME_READY",
    buttons: ["UP", "DOWN", "LEFT", "RIGHT", "A", "B", "X", "Y"],
    capabilities: { viewportAck: true, pauseAck: true, checkpoint: true }
  });

  // Topology revision 1: phone full game. The ACK must wait for one
  // rendered frame in the new viewport.
  host.topology({
    revision: "1",
    phase: "PREPARING",
    location: "PHONE",
    mode: "FULL_GAME"
  });
  await flush();
  assert.deepEqual(layoutModes, ["COMBINED"]);
  assert.equal(
    host.requests.some((request) => request.type === "EXTERNAL_PRESENTATION_ACK"),
    false
  );
  assert.equal(typeof controller.onRenderedFrame, "function");
  controller.onRenderedFrame(1000);
  await flush();
  const ack = host.requests.find((request) => request.type === "EXTERNAL_PRESENTATION_ACK");
  assert.equal(ack?.topologyRevision, "1");
  assert.deepEqual(Object.keys(ack).sort(), [
    "requestId",
    "schemaVersion",
    "topologyRevision",
    "type"
  ]);

  // Move to the external display: same single document, layout switches,
  // and the PREPARING transaction ACK again waits for a rendered frame.
  host.topology({ revision: "2", phase: "PREPARING", location: "EXTERNAL", mode: "VIRTUAL_GAMEPAD" });
  await flush();
  assert.deepEqual(layoutModes, ["COMBINED", "EXTERNAL_GAME"]);
  controller.onRenderedFrame(2000);
  await flush();
  const acks = host.requests.filter((request) => request.type === "EXTERNAL_PRESENTATION_ACK");
  assert.deepEqual(acks.map((request) => request.topologyRevision), ["1", "2"]);
  host.topology({ revision: "2", phase: "ACTIVE", location: "EXTERNAL", mode: "VIRTUAL_GAMEPAD" });
  await flush();
  assert.deepEqual(layoutModes, ["COMBINED", "EXTERNAL_GAME", "EXTERNAL_GAME"]);
  assert.equal(
    host.requests.filter((request) => request.type === "EXTERNAL_PRESENTATION_ACK").length,
    2,
    "stable ACTIVE notifications do not start another viewport transaction"
  );
  assert.equal(controller.input, inputOwner, "topology changes preserve the hardware/input owner");

  // Gamepad: direction buttons reach both the held-tilt input and the
  // controller's screen-level semantics; RELEASED/CANCELLED phases flow
  // through so both owners can converge their state.
  host.gamepad({ buttonId: "UP", phase: "PRESSED", revision: "2" });
  host.gamepad({ buttonId: "UP", phase: "RELEASED", revision: "2" });
  host.gamepad({ buttonId: "B", phase: "PRESSED", revision: "2" });
  host.gamepad({ buttonId: "B", phase: "CANCELLED", revision: "2" });
  await flush();
  assert.deepEqual(controller.calls.gamepad, [
    { buttonId: "UP", phase: "PRESSED" },
    { buttonId: "UP", phase: "RELEASED" }
  ]);
  assert.deepEqual(controller.calls.actions, [
    { buttonId: "UP", phase: "PRESSED" },
    { buttonId: "UP", phase: "RELEASED" },
    { buttonId: "B", phase: "PRESSED" },
    { buttonId: "B", phase: "CANCELLED" }
  ]);

  // Pause with a checkpoint request: the sim freezes and the committed
  // payload is the captured checkpoint with a valid digest.
  await host.lifecycle("pause", true);
  await flush(50);
  assert.equal(
    controller.calls.releasedTilt,
    2,
    "surface migration releases held input before lifecycle pause does"
  );
  assert.deepEqual(controller.calls.visibility[0], { hidden: true, source: "external-game:test" });
  const checkpointRequest = await waitForRequest(
    host,
    "EXTERNAL_GAME_CHECKPOINT"
  );
  assert.ok(checkpointRequest, "checkpoint request was sent");
  const payload = Buffer.from(checkpointRequest.payloadBase64, "base64").toString("utf8");
  assert.deepEqual(JSON.parse(payload), {
    schemaVersion: EXTERNAL_GAME_CHECKPOINT_SCHEMA_VERSION,
    screen: "GAMEPLAY",
    mode: "beginner",
    level: 3,
    timeRemainingMs: 30500,
    levelsCleared: 2,
    drops: 1
  });
  const digest = createHash("sha256").update(payload, "utf8").digest("hex");
  assert.equal(checkpointRequest.digest, `sha256:${digest}`);

  await host.lifecycle("resume", false);
  await flush();
  assert.deepEqual(controller.calls.visibility[1], { hidden: false, source: "external-game:test" });

  // Restore in a recycled instance (new authority epoch): the validated
  // checkpoint is applied to the new document.
  host.restore({
    schemaVersion: EXTERNAL_GAME_CHECKPOINT_SCHEMA_VERSION,
    screen: "GAMEPLAY",
    mode: "beginner",
    level: 3,
    timeRemainingMs: 30500,
    levelsCleared: 2,
    drops: 1
  });
  await flush();
  assert.equal(controller.calls.restore.length, 1);
  assert.equal(controller.calls.restore[0].level, 3);

  // A corrupted checkpoint restores a fresh instance instead of garbage.
  host.restore(
    { schemaVersion: "kiwii.alien.v1" },
    {
      epoch: "3",
      instance: "44444444-4444-4444-8444-444444444444"
    }
  );
  await flush();
  assert.equal(controller.calls.restore.length, 2);
  assert.equal(controller.calls.restore[1], null);

  runtime.close();
  assert.equal(
    controller.calls.releasedTilt,
    5,
    "topology replacement, pause, repeated restore, and close release held input"
  );
});

test("guarded transport rejects stale authority, topology, identity, and gamepad deliveries", () => {
  let receiver = null;
  const delivered = [];
  const transport = {
    request: async () => "{}",
    setReceiver(next) {
      receiver = next;
      return () => {
        if (receiver === next) receiver = null;
      };
    }
  };
  const guarded = createGuardedExternalGameTransport(transport);
  guarded.setReceiver((raw) => delivered.push(JSON.parse(raw)));
  const emit = (event) =>
    receiver(JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...event }));
  const topology = ({
    revision,
    epoch = "1",
    instance = "11111111-1111-4111-8111-111111111111",
    location = "PHONE",
    mode = "FULL_GAME"
  }) => emit({
    type: "EXTERNAL_PRESENTATION_TOPOLOGY",
    topologyRevision: revision,
    authorityEpoch: epoch,
    phase: "PREPARING",
    presentationLocation: location,
    phoneInteractionMode: mode,
    surfaceInstanceId: instance
  });
  const gamepad = ({
    id,
    sequence,
    revision = "2",
    buttonId = "UP",
    phase = "PRESSED"
  }) => emit({
    type: "EXTERNAL_GAMEPAD_ACTION",
    sourceActionId: id,
    buttonId,
    phase,
    sourceSequence: sequence,
    topologyRevision: revision
  });

  topology({ revision: "2" });
  topology({ revision: "1" });
  topology({
    revision: "2",
    instance: "99999999-9999-4999-8999-999999999999"
  });
  topology({ revision: "3", epoch: "2" });
  gamepad({
    id: "22222222-2222-4222-8222-000000000001",
    sequence: "1"
  });
  gamepad({
    id: "22222222-2222-4222-8222-000000000001",
    sequence: "2",
    phase: "RELEASED"
  });
  gamepad({
    id: "22222222-2222-4222-8222-000000000003",
    sequence: "1"
  });
  gamepad({
    id: "22222222-2222-4222-8222-000000000004",
    sequence: "2",
    revision: "1"
  });
  gamepad({
    id: "22222222-2222-4222-8222-000000000005",
    sequence: "2",
    phase: "RELEASED"
  });
  emit({
    type: "EXTERNAL_GAME_RESTORE",
    authorityEpoch: "2",
    surfaceInstanceId: "33333333-3333-4333-8333-333333333333",
    checkpointBase64: ""
  });
  topology({
    revision: "2",
    epoch: "1",
    instance: "11111111-1111-4111-8111-111111111111"
  });
  topology({
    revision: "1",
    epoch: "2",
    instance: "33333333-3333-4333-8333-333333333333",
    location: "EXTERNAL",
    mode: "VIRTUAL_GAMEPAD"
  });
  gamepad({
    id: "44444444-4444-4444-8444-000000000001",
    sequence: "1",
    revision: "1"
  });

  assert.deepEqual(
    delivered.map((event) => event.type),
    [
      "EXTERNAL_PRESENTATION_TOPOLOGY",
      "EXTERNAL_GAMEPAD_ACTION",
      "EXTERNAL_GAMEPAD_ACTION",
      "EXTERNAL_GAME_RESTORE",
      "EXTERNAL_PRESENTATION_TOPOLOGY",
      "EXTERNAL_GAMEPAD_ACTION"
    ]
  );
  assert.deepEqual(guarded.snapshot(), {
    authorityEpoch: "2",
    surfaceInstanceId: "33333333-3333-4333-8333-333333333333",
    topologyRevision: "1",
    lastSourceSequence: "1",
    seenGamepadActionCount: 1,
    rejectionCounts: {
      "stale topology revision": 1,
      "changed surface identity": 1,
      "unrestored authority epoch": 1,
      "conflicting gamepad action": 1,
      "stale gamepad sequence": 1,
      "stale gamepad topology": 1,
      "stale authority epoch": 1
    }
  });
});

test("gamepad action IDs remain idempotent for the complete authority lifetime", () => {
  let receiver = null;
  const delivered = [];
  const transport = {
    request: async () => "{}",
    setReceiver(next) {
      receiver = next;
      return () => {
        if (receiver === next) receiver = null;
      };
    }
  };
  const guarded = createGuardedExternalGameTransport(transport);
  guarded.setReceiver((raw) => delivered.push(JSON.parse(raw)));
  const emit = (event) =>
    receiver(JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...event }));
  emit({
    type: "EXTERNAL_PRESENTATION_TOPOLOGY",
    topologyRevision: "1",
    authorityEpoch: "1",
    phase: "PREPARING",
    presentationLocation: "PHONE",
    phoneInteractionMode: "FULL_GAME",
    surfaceInstanceId: "11111111-1111-4111-8111-111111111111"
  });

  for (let index = 1; index <= 1025; index += 1) {
    emit({
      type: "EXTERNAL_GAMEPAD_ACTION",
      sourceActionId: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
      buttonId: "UP",
      phase: "PRESSED",
      sourceSequence: String(index),
      topologyRevision: "1"
    });
  }
  emit({
    type: "EXTERNAL_GAMEPAD_ACTION",
    sourceActionId: "22222222-2222-4222-8222-000000000001",
    buttonId: "UP",
    phase: "RELEASED",
    sourceSequence: "1026",
    topologyRevision: "1"
  });

  assert.equal(delivered.length, 1026, "the replayed action ID must be rejected");
  assert.equal(guarded.snapshot().seenGamepadActionCount, 1025);
  assert.equal(
    guarded.snapshot().rejectionCounts["conflicting gamepad action"],
    1
  );
});

test("the real Candidate rejects malformed sequence strings under failure injection", async () => {
  let receiver = null;
  const transport = {
    request: async () => "{}",
    setReceiver(next) {
      receiver = next;
      return () => {
        if (receiver === next) receiver = null;
      };
    }
  };
  const client = createExternalGameCandidateClient({
    transport,
    buttons: [...EXTERNAL_GAME_PROFILE.buttons],
    capabilities: { ...EXTERNAL_GAME_PROFILE.lifecycleCapabilities },
    sha256: async () => "0".repeat(64)
  });
  await assert.rejects(
    () =>
      receiver(JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        type: "EXTERNAL_GAMEPAD_ACTION",
        sourceActionId: "22222222-2222-4222-8222-000000000001",
        buttonId: "UP",
        phase: "PRESSED",
        sourceSequence: "01",
        topologyRevision: "1"
      })),
    (error) =>
      error instanceof ExternalGameCandidateError &&
      error.reasonCode === "EXTERNAL_GAME_MESSAGE_INVALID"
  );
  client.close();
});

test("the supplemental guard rejects malformed gamepad sequences before Candidate delivery", () => {
  let receiver = null;
  const delivered = [];
  const transport = {
    request: async () => "{}",
    setReceiver(next) {
      receiver = next;
      return () => {
        if (receiver === next) receiver = null;
      };
    }
  };
  const guarded = createGuardedExternalGameTransport(transport);
  guarded.setReceiver((raw) => delivered.push(JSON.parse(raw)));
  const emit = (event) =>
    receiver(JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...event }));
  emit({
    type: "EXTERNAL_PRESENTATION_TOPOLOGY",
    topologyRevision: "1",
    authorityEpoch: "1",
    phase: "PREPARING",
    presentationLocation: "PHONE",
    phoneInteractionMode: "FULL_GAME",
    surfaceInstanceId: "11111111-1111-4111-8111-111111111111"
  });
  emit({
    type: "EXTERNAL_GAMEPAD_ACTION",
    sourceActionId: "22222222-2222-4222-8222-000000000001",
    buttonId: "UP",
    phase: "PRESSED",
    sourceSequence: "01",
    topologyRevision: "1"
  });
  emit({
    type: "EXTERNAL_GAMEPAD_ACTION",
    sourceActionId: "22222222-2222-4222-8222-000000000002",
    buttonId: "UP",
    phase: "PRESSED",
    sourceSequence: "1",
    topologyRevision: 1
  });

  assert.equal(delivered.length, 1);
  assert.deepEqual(guarded.snapshot().rejectionCounts, {
    "malformed gamepad sequence": 1,
    "malformed gamepad topology": 1
  });
});

test("unsatisfiable topology sends a NACK instead of an ACK", async () => {
  const host = createFakeHost();
  const controller = createStubController();
  const runtime = connectExternalGameRuntime({
    transport: host.transport,
    controller,
    layoutController: { updateMode: () => {} }
  });
  await runtime.ready();

  host.topology({ revision: "3", phase: "PREPARING", location: "PHONE", mode: "VIRTUAL_GAMEPAD" });
  await flush();
  const nack = host.requests.find((request) => request.type === "EXTERNAL_PRESENTATION_NACK");
  assert.equal(nack?.topologyRevision, "3");
  assert.equal(nack?.reasonCode, "VIEWPORT_UNSATISFIABLE");
  assert.equal(
    host.requests.some((request) => request.type === "EXTERNAL_PRESENTATION_ACK"),
    false
  );
  runtime.close();
});

test("stable ACTIVE topology applies layout without an acknowledgement transaction", async () => {
  const host = createFakeHost();
  const controller = createStubController();
  const layoutModes = [];
  const runtime = connectExternalGameRuntime({
    transport: host.transport,
    controller,
    layoutController: { updateMode: (mode) => layoutModes.push(mode) },
    waitForViewport: async () => {
      throw new Error("ACTIVE must not wait for viewport acknowledgement");
    }
  });
  await runtime.ready();

  host.topology({ revision: "3", phase: "ACTIVE", location: "EXTERNAL", mode: "VIRTUAL_GAMEPAD" });
  await flush();

  assert.deepEqual(layoutModes, ["EXTERNAL_GAME"]);
  assert.equal(
    host.requests.some((request) =>
      request.type === "EXTERNAL_PRESENTATION_ACK" ||
      request.type === "EXTERNAL_PRESENTATION_NACK"
    ),
    false
  );
  runtime.close();
});

test("paused PREPARING acknowledgement renders one direct frame", async () => {
  const host = createFakeHost();
  const controller = createStubController();
  controller.visibilityPaused = true;
  const runtime = connectExternalGameRuntime({
    transport: host.transport,
    controller,
    layoutController: { updateMode: () => {} },
    waitForViewport: waitForTestViewport
  });
  await runtime.ready();
  host.topology({ revision: "1", phase: "PREPARING", location: "EXTERNAL", mode: "VIRTUAL_GAMEPAD" });
  await flush();
  const ack = host.requests.find((request) => request.type === "EXTERNAL_PRESENTATION_ACK");
  assert.equal(ack?.topologyRevision, "1");
  assert.equal(controller.framesRendered, 1);
  runtime.close();
});

test("viewport readiness waits for two stable resized frames and one rendered frame", async () => {
  const controller = createStubController();
  controller.visibilityPaused = true;
  const unstable = {
    ...controller.scene.presentationViewportSnapshot(),
    hostWidth: 3840,
    hostHeight: 2160
  };
  const stable = controller.scene.presentationViewportSnapshot();
  const snapshots = [unstable, unstable, stable, stable, stable];
  let sample = 0;
  controller.scene.presentationViewportSnapshot = () =>
    snapshots[Math.min(sample, snapshots.length - 1)];

  const result = await waitForStablePresentationViewport({
    controller,
    layoutController: { update() {} },
    waitFrame: async () => { sample += 1; },
    now: () => sample * 16
  });
  assert.equal(result.status, "ready");
  assert.ok(sample >= 3);
  assert.equal(controller.framesRendered, 1);
});

test("viewport readiness accepts a stable WebKit layout viewport distinct from the canvas host", async () => {
  const controller = createStubController();
  controller.visibilityPaused = true;
  const phone = {
    ...controller.scene.presentationViewportSnapshot(),
    viewportWidth: 750,
    viewportHeight: 232,
    hostWidth: 412,
    hostHeight: 232,
    canvasClientWidth: 412,
    canvasClientHeight: 232,
    canvasBackingWidth: 618,
    canvasBackingHeight: 348,
    postFXWidth: 618,
    postFXHeight: 348
  };
  controller.scene.presentationViewportSnapshot = () => phone;

  const result = await waitForStablePresentationViewport({
    controller,
    layoutController: { update() {} },
    waitFrame: async () => {},
    now: (() => {
      let elapsed = 0;
      return () => (elapsed += 16);
    })()
  });
  assert.equal(result.status, "ready");
  assert.equal(controller.framesRendered, 1);
});

test("viewport readiness times out and reports an unsatisfiable transaction", async () => {
  const controller = createStubController();
  const invalid = {
    ...controller.scene.presentationViewportSnapshot(),
    canvasBackingWidth: 3840,
    canvasBackingHeight: 2160,
    postFXWidth: 3840,
    postFXHeight: 2160
  };
  controller.scene.presentationViewportSnapshot = () => invalid;
  let elapsed = 0;
  const result = await waitForStablePresentationViewport({
    controller,
    waitFrame: async () => { elapsed += 20; },
    now: () => elapsed,
    timeoutMs: 60
  });
  assert.equal(result.status, "timeout");
  assert.equal(controller.framesRendered, 0);
});

test("a newer topology supersedes an unfinished viewport transaction", async () => {
  const host = createFakeHost();
  const controller = createStubController();
  let finishFirst;
  const runtime = connectExternalGameRuntime({
    transport: host.transport,
    controller,
    layoutController: { updateMode() {} },
    waitForViewport: ({ isCurrent }) => {
      if (!finishFirst) {
        return new Promise((resolve) => {
          finishFirst = () => resolve({ status: isCurrent() ? "ready" : "superseded" });
        });
      }
      return Promise.resolve({ status: "ready" });
    }
  });
  await runtime.ready();
  host.topology({ revision: "1", phase: "PREPARING", location: "PHONE", mode: "FULL_GAME" });
  await flush();
  host.topology({ revision: "2", phase: "PREPARING", location: "EXTERNAL", mode: "VIRTUAL_GAMEPAD" });
  await flush();
  finishFirst();
  await flush();

  const requests = host.requests.filter((request) => request.type === "EXTERNAL_PRESENTATION_ACK");
  assert.deepEqual(requests.map((request) => request.topologyRevision), ["2"]);
  runtime.close();
});

test("a superseded proof waiter cannot remove the newer rendered-frame hook", async () => {
  const controller = createStubController();
  let generation = 1;
  const originalHook = controller.onRenderedFrame;
  const waitOptions = {
    controller,
    layoutController: { update() {} },
    waitFrame: async () => {},
    now: Date.now,
    timeoutMs: 500
  };

  const first = waitForStablePresentationViewport({
    ...waitOptions,
    isCurrent: () => generation === 1
  });
  await flush();
  const firstHook = controller.onRenderedFrame;
  assert.equal(typeof firstHook, "function");

  generation = 2;
  const second = waitForStablePresentationViewport({
    ...waitOptions,
    isCurrent: () => generation === 2
  });
  await flush();
  const secondHook = controller.onRenderedFrame;
  assert.equal(typeof secondHook, "function");
  assert.notEqual(secondHook, firstHook);

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(
    controller.onRenderedFrame,
    secondHook,
    "the superseded waiter must not remove the current transaction hook"
  );

  secondHook(123);
  assert.equal((await first).status, "superseded");
  assert.equal((await second).status, "ready");
  assert.equal(controller.onRenderedFrame, originalHook);
});

test("a restore opens a new viewport transaction window for reused revisions", async () => {
  const host = createFakeHost();
  const controller = createStubController();
  const runtime = connectExternalGameRuntime({
    transport: host.transport,
    controller,
    layoutController: { updateMode() {} },
    waitForViewport: async () => ({ status: "ready" })
  });
  await runtime.ready();

  host.topology({ revision: "1", epoch: "1", phase: "PREPARING" });
  await flush();
  host.restore(null, { epoch: "2" });
  await flush();
  host.topology({
    revision: "1",
    epoch: "2",
    phase: "PREPARING",
    location: "EXTERNAL",
    mode: "VIRTUAL_GAMEPAD",
    instance: "33333333-3333-4333-8333-333333333333"
  });
  await flush();

  assert.deepEqual(
    host.requests
      .filter((request) => request.type === "EXTERNAL_PRESENTATION_ACK")
      .map((request) => request.topologyRevision),
    ["1", "1"]
  );
  runtime.close();
});

test("a settled viewport failure sends NACK instead of a guessed ACK", async () => {
  const host = createFakeHost();
  const runtime = connectExternalGameRuntime({
    transport: host.transport,
    controller: createStubController(),
    layoutController: { updateMode() {} },
    waitForViewport: async () => ({ status: "timeout" })
  });
  await runtime.ready();
  host.topology({ revision: "4", phase: "PREPARING", location: "EXTERNAL", mode: "VIRTUAL_GAMEPAD" });
  await flush();
  assert.equal(
    host.requests.find((request) => request.type === "EXTERNAL_PRESENTATION_NACK")?.topologyRevision,
    "4"
  );
  assert.equal(host.requests.some((request) => request.type === "EXTERNAL_PRESENTATION_ACK"), false);
  runtime.close();
});

test("a rejected PREPARING waiter sends exactly one NACK", async () => {
  const host = createFakeHost();
  const runtime = connectExternalGameRuntime({
    transport: host.transport,
    controller: createStubController(),
    layoutController: { updateMode() {} },
    waitForViewport: async () => {
      throw new Error("renderer unavailable");
    }
  });
  await runtime.ready();

  host.topology({ revision: "9", phase: "PREPARING", location: "EXTERNAL", mode: "VIRTUAL_GAMEPAD" });
  await flush();
  host.topology({ revision: "9", phase: "PREPARING", location: "EXTERNAL", mode: "VIRTUAL_GAMEPAD" });
  await flush();

  assert.equal(
    host.requests.filter((request) =>
      request.type === "EXTERNAL_PRESENTATION_NACK" &&
      request.topologyRevision === "9"
    ).length,
    1
  );
  assert.equal(
    host.requests.some((request) => request.type === "EXTERNAL_PRESENTATION_ACK"),
    false
  );
  runtime.close();
});

test("a failed direct proof render NACKs instead of acknowledging", async () => {
  const host = createFakeHost();
  const controller = createStubController();
  controller.visibilityPaused = true;
  controller.scene.render = () => {
    throw new Error("WebGL context unavailable");
  };
  const runtime = connectExternalGameRuntime({
    transport: host.transport,
    controller,
    layoutController: { updateMode() {}, update() {} },
    waitForViewport: (options) => waitForStablePresentationViewport({
      ...options,
      waitFrame: async () => {},
      now: (() => {
        let elapsed = 0;
        return () => (elapsed += 16);
      })()
    })
  });
  await runtime.ready();

  host.topology({ revision: "11", phase: "PREPARING", location: "EXTERNAL", mode: "VIRTUAL_GAMEPAD" });
  await flush();

  assert.equal(
    host.requests.filter((request) =>
      request.type === "EXTERNAL_PRESENTATION_NACK" &&
      request.topologyRevision === "11"
    ).length,
    1
  );
  assert.equal(
    host.requests.some((request) => request.type === "EXTERNAL_PRESENTATION_ACK"),
    false
  );
  runtime.close();
});

test("the real PREPARING defaults NACK once when animation frames never arrive", async () => {
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  const host = createFakeHost();
  const runtime = connectExternalGameRuntime({
    transport: host.transport,
    controller: createStubController(),
    layoutController: { updateMode() {}, update() {} }
  });
  try {
    await runtime.ready();
    host.topology({ revision: "10", phase: "PREPARING", location: "EXTERNAL", mode: "VIRTUAL_GAMEPAD" });

    let waiting = true;
    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 3400)),
      (async () => {
        while (waiting && !host.requests.some((request) =>
          request.type === "EXTERNAL_PRESENTATION_NACK" &&
          request.topologyRevision === "10"
        )) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      })()
    ]);
    waiting = false;

    assert.equal(
      host.requests.filter((request) =>
        request.type === "EXTERNAL_PRESENTATION_NACK" &&
        request.topologyRevision === "10"
      ).length,
      1
    );
    assert.equal(
      host.requests.some((request) => request.type === "EXTERNAL_PRESENTATION_ACK"),
      false
    );
  } finally {
    runtime.close();
    if (previousRequestAnimationFrame === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    }
  }
});
