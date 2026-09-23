const SHA256_INITIAL = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]);
const SHA256_ROUND = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotateRight(value, count) {
  return (value >>> count) | (value << (32 - count));
}

export function sha256Bytes(input) {
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const state = [...SHA256_INITIAL];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + SHA256_ROUND[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temporary1) >>> 0;
      d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  const output = new Uint8Array(32);
  const outputView = new DataView(output.buffer);
  state.forEach((value, index) => outputView.setUint32(index * 4, value, false));
  return output;
}

export function randomUuid(cryptoProvider = globalThis.crypto) {
  const bytes = new Uint8Array(16);
  cryptoProvider.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function isDevelopmentHardwareHostDescriptor(descriptor) {
  return (
    descriptor !== null &&
    typeof descriptor === "object" &&
    !Array.isArray(descriptor) &&
    descriptor.type === "KIWII_GAME_SDK_HARDWARE_PORT_V1" &&
    isNonEmptyString(descriptor.hardwareModuleUrl) &&
    isNonEmptyString(descriptor.capabilityModuleUrl) &&
    isNonEmptyString(descriptor.adapterModuleUrl)
  );
}

export function isHardwareMessagePort(port) {
  return (
    port !== null &&
    typeof port === "object" &&
    typeof port.postMessage === "function" &&
    typeof port.start === "function" &&
    typeof port.close === "function"
  );
}

function parseAndroidDescriptor(data) {
  if (isDevelopmentHardwareHostDescriptor(data)) return data;
  try {
    return JSON.parse(String(data));
  } catch {
    return null;
  }
}

export function createDevelopmentHardwareHostProbe({
  timeoutMs = 15000,
  scope = typeof window === "undefined" ? null : window
} = {}) {
  let settled = false;
  let resolvePromise;
  let timeout = null;

  const cleanup = () => {
    if (timeout !== null) {
      globalThis.clearTimeout(timeout);
      timeout = null;
    }
    scope?.removeEventListener?.("message", onWindowMessage);
    scope?.removeEventListener?.(
      "kiwii-game-sdk-hardware-ready-v1",
      onIosHardwareReady
    );
  };
  const finish = (descriptor, port, transportKind) => {
    if (
      settled ||
      !isDevelopmentHardwareHostDescriptor(descriptor) ||
      !isHardwareMessagePort(port)
    ) {
      return false;
    }
    settled = true;
    cleanup();
    resolvePromise({
      port,
      transportKind,
      hardwareModuleUrl: descriptor.hardwareModuleUrl.trim(),
      capabilityModuleUrl: descriptor.capabilityModuleUrl.trim(),
      adapterModuleUrl: descriptor.adapterModuleUrl.trim()
    });
    return true;
  };
  const onWindowMessage = (event) => {
    const descriptor = parseAndroidDescriptor(event?.data);
    finish(
      descriptor,
      event?.ports?.length === 1 ? event.ports[0] : null,
      "ANDROID_TRANSFERRED_PORT"
    );
  };
  const onIosHardwareReady = (event) =>
    finish(
      event?.detail ||
        event?.data ||
        scope?.__kiwiiGameSdkHardwareDescriptor,
      scope?.__kiwiiGameSdkHardwarePort,
      "IOS_PREINSTALLED_PORT"
    );

  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
    if (!scope) {
      settled = true;
      resolve(null);
      return;
    }
    if (
      finish(
        scope.__kiwiiGameSdkHardwareDescriptor,
        scope.__kiwiiGameSdkHardwarePort,
        "IOS_PREINSTALLED_PORT"
      )
    ) {
      return;
    }
    scope.addEventListener("message", onWindowMessage);
    scope.addEventListener(
      "kiwii-game-sdk-hardware-ready-v1",
      onIosHardwareReady
    );
    timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    }, Math.max(0, Number(timeoutMs) || 0));
  });

  return {
    promise,
    close() {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(null);
    }
  };
}

export async function waitForDevelopmentHardwareHost(options) {
  const descriptor = await createDevelopmentHardwareHostProbe(options).promise;
  if (!descriptor) {
    throw new Error("Kiwii Game SDK hardware Host transport unavailable");
  }
  return descriptor;
}

export async function createHardwarePlatformFromDescriptor(
  platform,
  descriptor
) {
  const {
    port,
    transportKind,
    hardwareModuleUrl,
    capabilityModuleUrl,
    adapterModuleUrl
  } = descriptor;
  const [hardwareSdk, capabilities, developmentHost] = await Promise.all([
    import(hardwareModuleUrl), import(capabilityModuleUrl), import(adapterModuleUrl)
  ]);
  const createPlatformHardwareGameSdk =
    transportKind === "IOS_PREINSTALLED_PORT"
      ? developmentHost.createIosDevelopmentHardwareGameSdk ||
        developmentHost.createAndroidDevelopmentHardwareGameSdk
      : developmentHost.createAndroidDevelopmentHardwareGameSdk;
  if (
    typeof hardwareSdk.KiwiiHardwareClient !== "function" ||
    typeof createPlatformHardwareGameSdk !== "function" ||
    typeof capabilities.validateCapabilityPayload !== "function"
  ) {
    throw new TypeError("Host supplied an incompatible Kiwii Game SDK module");
  }
  const gameSdkEventSource = createPlatformHardwareGameSdk(port, {
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (timer) => clearTimeout(timer)
  });
  const hardwareClient = new hardwareSdk.KiwiiHardwareClient({
    gameSdk: gameSdkEventSource,
    sha256: async (bytes) => sha256Bytes(bytes),
    idSource: () => randomUuid()
  });
  console.log("[HW] Kiwii Game SDK hardware client ready");
  return {
    ...platform,
    hardwareRequired: true,
    hardwareGateReason: null,
    hardwareTransportKind: transportKind,
    hardwarePort: port,
    gameSdkEventSource,
    hardwareClient,
    validateCapabilityPayload: capabilities.validateCapabilityPayload,
    balanceCopSubscribeBody: {
      schemaVersion: "kiwii.game-sdk.invocation.subscribe.v1",
      capabilityId: "balance.cop.read"
    }
  };
}

export async function resolveHardwarePlatform(platform = {}) {
  if (platform.hardwareClient) {
    return {
      ...platform,
      hardwareRequired: true,
      hardwareGateReason: null
    };
  }
  const hasPreinstalledIosHardware = Boolean(
    typeof window !== "undefined" &&
      (window.__kiwiiGameSdkHardwareDescriptor ||
        window.__kiwiiGameSdkHardwarePort)
  );
  if (
    !platform.externalGameTransport &&
    !platform.hardwareHostExpected &&
    !hasPreinstalledIosHardware
  ) {
    return platform;
  }
  let descriptor;
  try {
    descriptor = await waitForDevelopmentHardwareHost(
      platform.hardwareHostTimeoutMs === undefined
        ? undefined
        : { timeoutMs: platform.hardwareHostTimeoutMs }
    );
  } catch (error) {
    console.warn(
      "[HW] Hardware Host unavailable; Balance hardware remains required",
      error?.message || error
    );
    return {
      ...platform,
      hardwareRequired: true,
      hardwareGateReason: "HARDWARE_HOST_UNAVAILABLE"
    };
  }
  return createHardwarePlatformFromDescriptor(platform, descriptor);
}
