import { GameAudio } from "./audio.js";
import { BALANCE_BOARD_CONFIG } from "./balance-board-config.js";
import { TableTiltController } from "./controller.js";
import { EXTERNAL_GAME_PROFILE } from "./external-game-contract.js";
import {
  createDevelopmentHardwareHostProbe,
  createHardwarePlatformFromDescriptor,
  resolveHardwarePlatform,
} from "./hardware-host.js";
import { BrowserInputAdapterSource, InputSystem } from "./input.js";
import { KiwiiCopSdkSource } from "./kiwii-cop-sdk.js";
import {
  applyMossTiltLayout,
  calculateMossTiltLayout,
  MossTiltLayoutController
} from "./layout.js";
import { TableTiltScene } from "./scene.js";
import { GameUI } from "./ui.js";
import { BrowserVibration } from "./vibration.js";

const GAME_AUTHORITY = Object.freeze({
  authority: "GAME_INSTANCE",
  executionInstanceCount: 1,
  hardwareOwnerCount: 1,
  authorityEpoch: null,
  topologyRevision: null
});

function createInputSource(platform) {
  if (platform.inputSource) return platform.inputSource;
  if (platform.hardwareClient) {
    return new KiwiiCopSdkSource({
      hardwareClient: platform.hardwareClient,
      gameSdkEventSource: platform.gameSdkEventSource,
      subscribeBody: platform.balanceCopSubscribeBody,
      validateCapabilityPayload: platform.validateCapabilityPayload,
      orientation: platform.canonicalOrientation || BALANCE_BOARD_CONFIG.canonicalOrientation,
      onReset: platform.onHardwareStreamReset
    });
  }
  return new BrowserInputAdapterSource();
}

export function bindPageLifecycleDestroy(destroy, target = window) {
  let listening = true;
  let destroyRequested = false;
  const remove = () => {
    if (!listening) return;
    listening = false;
    target.removeEventListener("pagehide", onExit);
    target.removeEventListener("beforeunload", onExit);
  };
  const onExit = (event) => {
    if (event?.type === "pagehide" && event.persisted) return;
    if (destroyRequested) return;
    destroyRequested = true;
    remove();
    destroy();
  };
  target.addEventListener("pagehide", onExit);
  target.addEventListener("beforeunload", onExit);
  return remove;
}

function installQaTelemetry(controller) {
  if (new URLSearchParams(location.search).get("qa") !== "1") return;
  let frames = 0;
  let intervalStart = 0;
  controller.onSimulatedFrame = (now) => {
    frames += 1;
    if (intervalStart === 0) intervalStart = now;
    if (now - intervalStart < 1000) return;
    const seconds = (now - intervalStart) / 1000;
    console.info(`[QA] frames=${frames} frameFps=${(frames / seconds).toFixed(1)}`);
    frames = 0;
    intervalStart = now;
  };
}

function applyQaRoute(controller) {
  const params = new URLSearchParams(location.search);
  if (params.get("qa") === "1" && params.get("resetpb") === "1") {
    controller.debugResetBest(params.get("mode") || "beginner");
  }
  const qaScreen = params.get("screen");
  if (!qaScreen) return;
  controller.debugGoto(qaScreen, {
    mode: params.get("mode") || undefined,
    level: Number(params.get("level")) || undefined,
    time: params.has("time") ? Number(params.get("time")) : undefined,
    cleared: params.has("cleared") ? Number(params.get("cleared")) : undefined,
    drops: params.has("drops") ? Number(params.get("drops")) : undefined,
    page: params.has("page") ? Number(params.get("page")) : undefined,
    beat: params.has("beat") ? Number(params.get("beat")) : undefined,
    from: params.get("from") || undefined,
    settled: params.has("settled")
  });
}

function closeHardwareTransport(platform) {
  if (typeof platform?.gameSdkEventSource?.close === "function") {
    platform.gameSdkEventSource.close();
    return;
  }
  platform?.hardwarePort?.close?.();
}

export function createGameRuntime({
  platform,
  layoutController,
  externalGameModule = null,
  hardwareProbe = null
}) {
  let activePlatform = platform;
  const ui = new GameUI();
  const audio = new GameAudio();
  const input = new InputSystem(document.querySelector("#touch-surface"), {
    inputSource: createInputSource(platform),
    hardwareRequired: Boolean(
      platform.hardwareRequired || platform.hardwareClient
    )
  });
  const scene = new TableTiltScene(document.querySelector("#webgl-host"), () => {});
  const vibration = new BrowserVibration();
  const controller = new TableTiltController({
    scene,
    input,
    audio,
    ui,
    vibration,
    deferRAF: Boolean(platform.externalGameTransport && externalGameModule)
  });
  const externalGameRuntime =
    platform.externalGameTransport && externalGameModule
      ? externalGameModule.connectExternalGameRuntime({
        transport: platform.externalGameTransport,
        controller,
        layoutController
      })
      : null;
  installQaTelemetry(controller);

  let destroyed = false;
  let destroyPromise = null;
  let removePageLifecycle = () => {};
  const destroy = () => {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    removePageLifecycle();
    hardwareProbe?.close();
    controller.beginDestroy();
    destroyPromise = (async () => {
      await controller.stopInputForDestroy();
      closeHardwareTransport(activePlatform);
      externalGameRuntime?.close();
      layoutController.close();
      controller.finishDestroy();
    })();
    return destroyPromise;
  };
  removePageLifecycle = bindPageLifecycleDestroy(destroy);

  const externalReadyPromise = externalGameRuntime
    ? externalGameRuntime.ready()
      .then((handshake) => {
        controller.startRAF();
        return handshake;
      })
      .catch(async (error) => {
        console.error(
          "[EXTERNAL_GAME] readiness rejected",
          error?.reasonCode || error
        );
        await destroy();
        throw error;
      })
    : null;

  const adoptHardwareDescriptor = async (descriptor) => {
    if (!descriptor || activePlatform.hardwareClient) return false;
    if (destroyed) {
      descriptor.port?.close?.();
      return false;
    }
    let hardwarePlatform;
    try {
      hardwarePlatform = await createHardwarePlatformFromDescriptor(
        activePlatform,
        descriptor
      );
    } catch (error) {
      descriptor.port?.close?.();
      throw error;
    }
    activePlatform = hardwarePlatform;
    const adopted = await controller.input.replaceInputSource(
      createInputSource(hardwarePlatform),
      { hardwareRequired: true }
    );
    if (!adopted && destroyed) {
      closeHardwareTransport(hardwarePlatform);
    }
    return adopted;
  };

  window.__TABLE_TILT__ = {
    version: "1.0.0",
    authority: GAME_AUTHORITY,
    profile: EXTERNAL_GAME_PROFILE,
    controller,
    snapshot: () => controller.snapshot(),
    runtimeSnapshot: () => scene.snapshot().runtime,
    audioSnapshot: () => audio.snapshot(),
    vibrationSnapshot: () => vibration.snapshot(),
    preloadAudio: () => audio.preloadAll(),
    debugClearLevel: () => controller.debugClearLevel(),
    debugDropBall: () => controller.debugDropBall(),
    debugGoto: (screen, options) => controller.debugGoto(screen, options),
    scoreRun: (cleared, time) => {
      controller.debugGoto("RESULT_CALC", { cleared, time });
      return controller.snapshot().score;
    },
    adoptHardwareDescriptor,
    destroy
  };
  if (externalGameRuntime) window.__TABLE_TILT__.externalGame = externalGameRuntime;
  applyQaRoute(controller);
  console.log("[GAME] Moss Tilt ready");
  return {
    kind: "game",
    controller,
    externalReadyPromise,
    adoptHardwareDescriptor,
    destroy
  };
}

export async function bootMossTilt(platform = window.__KIWII_MOSS_TILT_PLATFORM__ || {}) {
  const scope = typeof window === "undefined" ? null : window;
  const externalGameAdmitted =
    scope?.__kiwiiExternalGameTransport !== undefined;
  const externalGameModule = externalGameAdmitted
    ? await import("./external-game.js")
    : null;
  const externalGameTransport = externalGameModule?.detectExternalGameTransport(
    scope
  );
  const hardwareProbe = createDevelopmentHardwareHostProbe({
    timeoutMs: platform.hardwareHostTimeoutMs ?? 15000,
    scope
  });
  const shouldAwaitHardware = Boolean(
    externalGameTransport ||
      platform.hardwareHostExpected ||
      scope?.__kiwiiGameSdkHardwareDescriptor ||
      scope?.__kiwiiGameSdkHardwarePort
  );
  let hostPlatform = {
    ...platform,
    hardwareRequired: Boolean(
      platform.hardwareRequired || shouldAwaitHardware
    ),
    ...(externalGameTransport ? { externalGameTransport } : {})
  };
  let initialHardwareDescriptor = null;
  if (shouldAwaitHardware && !hostPlatform.hardwareClient) {
    initialHardwareDescriptor = await hardwareProbe.promise;
    if (initialHardwareDescriptor) {
      hostPlatform = await createHardwarePlatformFromDescriptor(
        hostPlatform,
        initialHardwareDescriptor
      );
    } else {
      console.warn(
        "[HW] Hardware Host unavailable; gameplay remains behind the Balance connection gate"
      );
      hostPlatform.hardwareGateReason = "HARDWARE_HOST_UNAVAILABLE";
    }
  } else {
    hostPlatform = await resolveHardwarePlatform(hostPlatform);
  }
  const layoutController = new MossTiltLayoutController({ mode: "COMBINED" });
  layoutController.connect();
  const runtime = createGameRuntime({
    platform: hostPlatform,
    layoutController,
    externalGameModule,
    hardwareProbe
  });
  await runtime.externalReadyPromise;
  if (!initialHardwareDescriptor && !hostPlatform.hardwareClient) {
    void hardwareProbe.promise
      .then((descriptor) => runtime.adoptHardwareDescriptor(descriptor))
      .catch((error) => {
        console.warn(
          "[HW] Late hardware Host admission failed",
          error?.message || error
        );
      });
  }
  return runtime;
}

window.__MOSS_TILT_PLATFORM_API__ = Object.freeze({
  profile: EXTERNAL_GAME_PROFILE,
  boot: bootMossTilt,
  calculateLayout: calculateMossTiltLayout,
  applyLayout: applyMossTiltLayout
});

if (window.__KIWII_MOSS_TILT_PLATFORM__?.autoBoot !== false) {
  bootMossTilt().catch((error) => {
    console.error("[GAME] Boot failed", error);
    const fallback = document.querySelector("#boot-fallback");
    if (fallback) fallback.textContent = "Moss Tilt could not start.";
  });
}
