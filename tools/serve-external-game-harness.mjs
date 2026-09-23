/* Development harness server for the external-game candidate integration.
 *
 * Serves the synced root preview build (index.html + app.js + assets) with a
 * fake Kiwii external-game Host injected before the bundle: a
 * `window.__kiwiiExternalGameTransport` implementation plus a
 * `window.__harnessHost` driver API (emitTopology / emitGamepad /
 * emitLifecycle / emitRestore / requests). It exists purely so the game's
 * external-game path can be exercised in an ordinary browser without the
 * iOS candidate Host; the released dist/ package is untouched.
 *
 * Usage: node tools/serve-external-game-harness.mjs [port] [host]
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.argv[2] || 4319);
const host = process.argv[3] || "127.0.0.1";
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

const harnessScript = `
<script>
(() => {
  const SCHEMA = "kiwii.external-game.candidate.v1";
  const params = new URLSearchParams(location.search);
  const requests = [];
  let receiver = null;
  let sequence = 0;
  let boardSequence = 0;
  let board = { xPct: "0", yPct: "0", forceKg: "72" };
  const hardwareSubscriptions = new Set();
  const emitBoardSample = (onData) => {
    boardSequence += 1;
    const capturedAtNs = String(BigInt(Date.now()) * 1000000n);
    onData({
      value: {
        schemaVersion: "kiwii.capability.balance-board-cop-frame.v1",
        capabilityId: "balance.cop.read",
        coordinateSpace: "FIRMWARE_RAW_PCT_KG",
        sourceSequence: String(boardSequence),
        flags: 0,
        copXPct: board.xPct,
        copYPct: board.yPct,
        forceKg: board.forceKg
      },
      metadata: {
        schemaVersion: "kiwii.game-sdk.data-delivery-metadata.v1",
        capturedAtNs,
        publishedAtNs: capturedAtNs,
        dataAgeMs: "0",
        freshnessState: "FRESH",
        deliveryPolicy: {},
        deliveryObservation: {}
      }
    });
  };
  const fakeHardwareClient = {
    async subscribeCapability({ capabilityId, onData }) {
      if (capabilityId !== "balance.cop.read" || typeof onData !== "function") {
        throw new Error("harness supports only balance.cop.read");
      }
      let active = true;
      const subscription = {
        result: {
          subscriptionId: "harness-balance-subscription",
          streamEpoch: "harness-balance-epoch",
          nextSequence: "1"
        },
        async close() {
          if (!active) return;
          active = false;
          clearInterval(timer);
          hardwareSubscriptions.delete(subscription);
        }
      };
      const timer = setInterval(() => {
        if (active) emitBoardSample(onData);
      }, 40);
      hardwareSubscriptions.add(subscription);
      emitBoardSample(onData);
      return subscription;
    }
  };
  const respond = (request) => {
    switch (request.type) {
      case "EXTERNAL_GAME_READY":
        return { schemaVersion: SCHEMA, requestId: request.requestId,
          type: "EXTERNAL_GAME_READY_ACK", accepted: "true", restoredCheckpoint: "false" };
      case "EXTERNAL_PRESENTATION_ACK":
        return { schemaVersion: SCHEMA, requestId: request.requestId,
          type: "EXTERNAL_PRESENTATION_ACK_ACCEPTED", accepted: "true" };
      case "EXTERNAL_PRESENTATION_NACK":
        return { schemaVersion: SCHEMA, requestId: request.requestId,
          type: "EXTERNAL_PRESENTATION_NACK_ACCEPTED", accepted: "true" };
      case "EXTERNAL_GAME_CHECKPOINT":
        return { schemaVersion: SCHEMA, requestId: request.requestId,
          type: "EXTERNAL_GAME_CHECKPOINT_ACK", accepted: "true" };
      default:
        return { schemaVersion: SCHEMA, requestId: request.requestId,
          type: "HOST_FAILURE", accepted: "false", reasonCode: "UNSUPPORTED_REQUEST" };
    }
  };
  window.__kiwiiExternalGameTransport = {
    request(raw) {
      const request = JSON.parse(raw);
      requests.push(request);
      return Promise.resolve(JSON.stringify(respond(request)));
    },
    setReceiver(next) {
      receiver = next;
      return () => { if (receiver === next) receiver = null; };
    }
  };
  const hardwareMissing = params.get("hardwareScenario") === "missing";
  window.__KIWII_MOSS_TILT_PLATFORM__ = Object.assign(
    {},
    window.__KIWII_MOSS_TILT_PLATFORM__,
    hardwareMissing
      ? { hardwareHostTimeoutMs: 50 }
      : {
          hardwareRequired: true,
          hardwareClient: fakeHardwareClient,
          gameSdkEventSource: {
            onEvent() { return () => {}; },
            close() {
              for (const subscription of [...hardwareSubscriptions]) {
                void subscription.close();
              }
            }
          },
          validateCapabilityPayload() {},
          balanceCopSubscribeBody: {
            schemaVersion: "kiwii.game-sdk.invocation.subscribe.v1",
            capabilityId: "balance.cop.read"
          }
        }
  );
  const emit = (event) => {
    if (!receiver) throw new Error("harness host has no receiver");
    receiver(JSON.stringify(Object.assign({ schemaVersion: SCHEMA }, event)));
  };
  window.__harnessHost = {
    requests,
    hardwareMissing,
    setBoard({ xPct = board.xPct, yPct = board.yPct, forceKg = board.forceKg } = {}) {
      board = { xPct: String(xPct), yPct: String(yPct), forceKg: String(forceKg) };
    },
    emitRaw(event) {
      emit(event);
    },
    emitTopology({ revision = "1", epoch = "1", phase = "ACTIVE",
      location = "PHONE", mode = "FULL_GAME",
      instance = "11111111-1111-4111-8111-111111111111" } = {}) {
      emit({ type: "EXTERNAL_PRESENTATION_TOPOLOGY", topologyRevision: revision,
        authorityEpoch: epoch, phase, presentationLocation: location,
        phoneInteractionMode: mode, surfaceInstanceId: instance });
    },
    emitGamepad({ buttonId, phase = "PRESSED", revision = "1" } = {}) {
      sequence += 1;
      emit({ type: "EXTERNAL_GAMEPAD_ACTION",
        sourceActionId: "22222222-2222-4222-8222-" + String(sequence).padStart(12, "0"),
        buttonId, phase, sourceSequence: String(sequence),
        topologyRevision: revision });
    },
    emitLifecycle(kind, requestCheckpoint) {
      emit({ type: "EXTERNAL_GAME_LIFECYCLE", kind, reason: "harness",
        requestCheckpoint: requestCheckpoint ? "true" : "false" });
    },
    emitRestore(checkpoint) {
      emit({ type: "EXTERNAL_GAME_RESTORE", authorityEpoch: "2",
        surfaceInstanceId: "33333333-3333-4333-8333-333333333333",
        checkpointBase64: checkpoint
          ? btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(checkpoint))))
          : "" });
    }
  };
  console.log("[HARNESS] external-game host transport injected");

  /* Self-driving acceptance scenario (?externalGameScenario=full). The driver runs
     inside the page so no external script injection is needed; progress is
     appended to document.body[data-harness-log] for locator reads. Pair it
     with the game's QA jump: ?qa=1&screen=GAMEPLAY&level=3&time=45 */
  if (params.get("externalGameScenario") === "full") {
    const log = [];
    const record = (entry) => {
      log.push(entry);
      document.body.setAttribute("data-harness-log", JSON.stringify(log));
      console.log("[HARNESS]", JSON.stringify(entry));
    };
    const waitFor = async (probe, label, timeoutMs = 10000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const value = probe();
          if (value) return value;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error("harness wait timed out: " + label);
    };
    const stage = () => document.querySelector("#stage");
    (async () => {
      try {
        await waitFor(
          () => window.__harnessHost.requests.some((r) => r.type === "EXTERNAL_GAME_READY"),
          "ready handshake",
          20000
        );
        const ready = window.__harnessHost.requests.find((r) => r.type === "EXTERNAL_GAME_READY");
        record({ step: "ready", buttons: ready.buttons.join(","), caps: JSON.stringify(ready.capabilities) });

        window.__harnessHost.emitTopology({ revision: "1", phase: "PREPARING", location: "PHONE", mode: "FULL_GAME" });
        await waitFor(
          () => window.__harnessHost.requests.some((r) => r.type === "EXTERNAL_PRESENTATION_ACK" && r.topologyRevision === "1"),
          "viewport ack rev1"
        );
        record({ step: "ack1", presentationMode: document.documentElement.dataset.presentationMode });

        await waitFor(
          () => stage()?.dataset.state === "GAMEPLAY",
          "gameplay via qa jump",
          15000
        );
        record({ step: "gameplay", levelId: stage().dataset.levelId });

        const pitchBefore = Number(stage().dataset.visualPitch);
        window.__harnessHost.emitGamepad({ buttonId: "UP", phase: "PRESSED", revision: "1" });
        await new Promise((resolve) => setTimeout(resolve, 300));
        const pitchAfterVirtual = Number(stage().dataset.visualPitch);
        window.__harnessHost.emitGamepad({ buttonId: "UP", phase: "RELEASED", revision: "1" });
        window.__harnessHost.setBoard({ yPct: "50" });
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const pitchAfterBoard = Number(stage().dataset.visualPitch);
        window.__harnessHost.setBoard({ yPct: "0" });
        record({
          step: "tilt",
          source: "balance.cop.read",
          pitchBefore,
          pitchAfterVirtual,
          pitchAfterBoard
        });

        window.__harnessHost.emitLifecycle("pause", true);
        const checkpoint = await waitFor(
          () => window.__harnessHost.requests.find((r) => r.type === "EXTERNAL_GAME_CHECKPOINT"),
          "checkpoint commit"
        );
        const payload = JSON.parse(atob(checkpoint.payloadBase64));
        record({
          step: "checkpoint",
          digestOk: /^sha256:[0-9a-f]{64}$/.test(checkpoint.digest),
          payload: JSON.stringify(payload)
        });

        window.__harnessHost.emitLifecycle("resume", false);
        await new Promise((resolve) => setTimeout(resolve, 300));
        record({ step: "resumed", state: stage().dataset.state });

        window.__harnessHost.emitRestore({
          schemaVersion: "kiwii.moss-tilt.external-game-checkpoint.v1",
          screen: "GAMEPLAY",
          mode: "beginner",
          level: 4,
          timeRemainingMs: 30000,
          levelsCleared: 3,
          drops: 1
        });
        record({ step: "restore-sent" });
        for (let probe = 0; probe < 10; probe += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          record({ step: "restore-poll", state: stage()?.dataset.state || null, index: probe });
          if (stage()?.dataset.state === "LEVEL_INTRO") break;
        }
        await waitFor(() => stage()?.dataset.state === "GAMEPLAY", "restored gameplay", 15000);
        const hudLevel = document.querySelector("#hud-level .nv")?.textContent || "";
        record({ step: "restored", state: stage().dataset.state, hudLevel: hudLevel.trim() });

        window.__harnessHost.emitTopology({
          revision: "2",
          epoch: "2",
          instance: "33333333-3333-4333-8333-333333333333",
          phase: "PREPARING",
          location: "EXTERNAL",
          mode: "VIRTUAL_GAMEPAD"
        });
        await waitFor(
          () => window.__harnessHost.requests.some((r) => r.type === "EXTERNAL_PRESENTATION_ACK" && r.topologyRevision === "2"),
          "viewport ack rev2"
        );
        record({ step: "external", presentationMode: document.documentElement.dataset.presentationMode });

        record({ step: "done", ok: true });
      } catch (error) {
        record({ step: "error", message: String(error && error.message || error) });
      }
    })();
  }
})();
</script>
`;

createServer(async (request, response) => {
  const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
  if (pathname === "/" || pathname === "/index.html") {
    const html = await readFile(join(root, "index.html"), "utf8");
    // The release build content-versions the bundle tag (./app.js?v=hash).
    const injected = html.replace(
      /<script src="\.\/app\.js[^"]*"><\/script>/,
      (tag) => `${harnessScript}${tag}`
    );
    if (injected === html) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Harness could not find the app.js script tag in index.html");
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8"
    });
    response.end(injected);
    return;
  }
  const relative = pathname.replace(/^\/+/, "");
  const file = normalize(join(root, relative));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": mime[extname(file).toLowerCase()] || "application/octet-stream"
  });
  createReadStream(file).pipe(response);
}).listen(port, host, () => {
  console.log(`Moss Tilt external-game harness: http://${host}:${port}/`);
});
