import assert from "node:assert/strict";
import test from "node:test";

import {
  createDevelopmentHardwareHostProbe,
  isDevelopmentHardwareHostDescriptor,
  isHardwareMessagePort,
  randomUuid,
  sha256Bytes
} from "../src/hardware-host.js";

test("HTTP WebView SHA-256 and UUID fallbacks do not require secure context APIs", () => {
  const digest = Buffer.from(sha256Bytes(new TextEncoder().encode("abc"))).toString("hex");
  assert.equal(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const uuid = randomUuid({
    getRandomValues(bytes) {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    }
  });
  assert.equal(uuid, "00010203-0405-4607-8809-0a0b0c0d0e0f");
});

const HARDWARE_MODULE = encodeURIComponent(`
export class KiwiiHardwareClient {
  constructor(options) { this.options = options; }
}
`);
const CAPABILITY_MODULE = encodeURIComponent(`
export function validateCapabilityPayload() { return true; }
`);
const ADAPTER_MODULE = encodeURIComponent(`
export function createAndroidDevelopmentHardwareGameSdk(port, options) {
  return { port, options };
}
`);
const DUAL_PLATFORM_ADAPTER_MODULE = encodeURIComponent(`
export function createIosDevelopmentHardwareGameSdk(port, options) {
  return { port, options, factory: "ios" };
}
export function createAndroidDevelopmentHardwareGameSdk(port, options) {
  return { port, options, factory: "android" };
}
`);

function stubBrowserGlobals() {
  const listeners = [];
  const previousWindow = globalThis.window;
  const fakeWindow = {
    addEventListener(type, handler) {
      listeners.push({ type, handler });
    },
    removeEventListener() {}
  };
  globalThis.window = fakeWindow;
  return {
    listeners,
    restore() {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  };
}

function descriptor({
  adapterModule = ADAPTER_MODULE,
  hardwareModule = HARDWARE_MODULE,
  capabilityModule = CAPABILITY_MODULE
} = {}) {
  return {
    type: "KIWII_GAME_SDK_HARDWARE_PORT_V1",
    hardwareModuleUrl: `data:text/javascript,${hardwareModule}`,
    capabilityModuleUrl: `data:text/javascript,${capabilityModule}`,
    adapterModuleUrl: `data:text/javascript,${adapterModule}`
  };
}

function messagePort() {
  return {
    onmessage: null,
    postMessage() {},
    start() {},
    close() {}
  };
}

test("hardware admission rejects malformed descriptors and non-ports", () => {
  assert.equal(isDevelopmentHardwareHostDescriptor(descriptor()), true);
  assert.equal(
    isDevelopmentHardwareHostDescriptor({
      ...descriptor(),
      hardwareModuleUrl: " "
    }),
    false
  );
  assert.equal(
    isDevelopmentHardwareHostDescriptor({
      ...descriptor(),
      adapterModuleUrl: null
    }),
    false
  );
  assert.equal(isHardwareMessagePort(messagePort()), true);
  assert.equal(isHardwareMessagePort({ postMessage() {}, start() {} }), false);
  assert.equal(isHardwareMessagePort({}), false);
});

test("ordinary browser boot does not wait for a hardware Host", async () => {
  const { resolveHardwarePlatform } = await import("../src/hardware-host.js?case=browser");
  const browser = stubBrowserGlobals();
  try {
    const platform = { local: true };
    assert.strictEqual(await resolveHardwarePlatform(platform), platform);
    assert.equal(browser.listeners.length, 0);
  } finally {
    browser.restore();
  }
});

test("External Game boot acquires and binds the development hardware port", async () => {
  const { resolveHardwarePlatform } = await import("../src/hardware-host.js?case=external-acquire");
  const browser = stubBrowserGlobals();
  try {
    const pending = resolveHardwarePlatform({ externalGameTransport: {} });
    const listener = browser.listeners.find((entry) => entry.type === "message");
    assert.ok(listener, "hardware port listener is registered");
    const port = messagePort();
    listener.handler({ data: JSON.stringify(descriptor()), ports: [port] });
    const platform = await pending;
    assert.deepEqual(Object.keys(platform.hardwareClient.options).sort(), [
      "gameSdk",
      "idSource",
      "sha256"
    ]);
    assert.strictEqual(platform.hardwareClient.options.gameSdk.port, port);
    assert.equal(typeof platform.validateCapabilityPayload, "function");
    assert.deepEqual(platform.balanceCopSubscribeBody, {
      schemaVersion: "kiwii.game-sdk.invocation.subscribe.v1",
      capabilityId: "balance.cop.read"
    });
  } finally {
    browser.restore();
  }
});

test("missing required hardware Host keeps gameplay behind the Balance gate", async () => {
  const { resolveHardwarePlatform } = await import("../src/hardware-host.js?case=fallback");
  const browser = stubBrowserGlobals();
  try {
    const platform = await resolveHardwarePlatform({
      externalGameTransport: {},
      hardwareHostTimeoutMs: 20
    });
    assert.equal(platform.hardwareClient, undefined);
    assert.equal(platform.gameSdkEventSource, undefined);
    assert.equal(platform.hardwareRequired, true);
    assert.equal(platform.hardwareGateReason, "HARDWARE_HOST_UNAVAILABLE");
  } finally {
    browser.restore();
  }
});

test("iOS preinstalled hardware port is preserved as the hardware client owner", async () => {
  const { resolveHardwarePlatform } = await import("../src/hardware-host.js?case=ios");
  const browser = stubBrowserGlobals();
  const port = messagePort();
  globalThis.window.__kiwiiGameSdkHardwarePort = port;
  globalThis.window.__kiwiiGameSdkHardwareDescriptor = descriptor({
    adapterModule: DUAL_PLATFORM_ADAPTER_MODULE
  });
  try {
    const platform = await resolveHardwarePlatform({});
    assert.strictEqual(platform.hardwareClient.options.gameSdk.port, port);
    assert.equal(platform.hardwareClient.options.gameSdk.factory, "ios");
    assert.equal(platform.hardwareTransportKind, "IOS_PREINSTALLED_PORT");
    assert.deepEqual(Object.keys(platform.hardwareClient.options).sort(), [
      "gameSdk",
      "idSource",
      "sha256"
    ]);
  } finally {
    browser.restore();
  }
});

test("ordinary Android transferred-port admission remains independent of External Game", async () => {
  const browser = stubBrowserGlobals();
  try {
    const probe = createDevelopmentHardwareHostProbe({
      scope: globalThis.window,
      timeoutMs: 100
    });
    const listener = browser.listeners.find((entry) => entry.type === "message");
    assert.ok(listener, "ordinary Android hardware listener is registered");
    const port = messagePort();
    listener.handler({
      data: JSON.stringify(descriptor()),
      ports: [port]
    });
    const admitted = await probe.promise;
    assert.equal(admitted.transportKind, "ANDROID_TRANSFERRED_PORT");
    assert.strictEqual(admitted.port, port);
  } finally {
    browser.restore();
  }
});

test("invalid Host offers are ignored until a valid descriptor and MessagePort arrive", async () => {
  const browser = stubBrowserGlobals();
  try {
    const probe = createDevelopmentHardwareHostProbe({
      scope: globalThis.window,
      timeoutMs: 100
    });
    const listener = browser.listeners.find((entry) => entry.type === "message");
    listener.handler({
      data: JSON.stringify({
        ...descriptor(),
        capabilityModuleUrl: ""
      }),
      ports: [messagePort()]
    });
    listener.handler({
      data: JSON.stringify(descriptor()),
      ports: [{ postMessage() {}, start() {} }]
    });
    const port = messagePort();
    listener.handler({
      data: JSON.stringify(descriptor()),
      ports: [port]
    });
    assert.strictEqual((await probe.promise).port, port);
  } finally {
    browser.restore();
  }
});
