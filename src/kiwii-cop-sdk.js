import { clamp } from "./core.js";
import { BALANCE_BOARD_CONFIG } from "./balance-board-config.js";

export const BALANCE_COP_CAPABILITY_ID = "balance.cop.read";
export const CANONICAL_COP_SCHEMA_VERSION =
  "kiwii.capability.balance-board-cop-frame.v1";
export const CANONICAL_COP_COORDINATE_SPACE = "FIRMWARE_RAW_PCT_KG";

const UINT64_MAX = 18446744073709551615n;
const UINT64_PATTERN = /^(0|[1-9][0-9]{0,19})$/;
const DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const NONNEGATIVE_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const CANONICAL_KEYS = Object.freeze([
  "schemaVersion",
  "capabilityId",
  "coordinateSpace",
  "sourceSequence",
  "flags",
  "copXPct",
  "copYPct",
  "forceKg"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireClosedRecord(value, keys, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} must use its closed schema`);
  }
  return value;
}

export function parseUInt64(value, label = "UInt64") {
  if (typeof value !== "string" || !UINT64_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a UInt64 decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT64_MAX) {
    throw new TypeError(`${label} exceeds UInt64`);
  }
  return parsed;
}

function parseDecimal(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} must be a decimal string`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be finite`);
  }
  return parsed;
}

export function validateCanonicalCopPayload(
  value,
  validateCapabilityPayload
) {
  if (validateCapabilityPayload !== undefined) {
    if (typeof validateCapabilityPayload !== "function") {
      throw new TypeError("validateCapabilityPayload must be a function");
    }
    validateCapabilityPayload(BALANCE_COP_CAPABILITY_ID, value);
  }

  const payload = requireClosedRecord(
    value,
    CANONICAL_KEYS,
    "balance.cop.read payload"
  );
  if (payload.schemaVersion !== CANONICAL_COP_SCHEMA_VERSION) {
    throw new TypeError("balance.cop.read schemaVersion is invalid");
  }
  if (payload.capabilityId !== BALANCE_COP_CAPABILITY_ID) {
    throw new TypeError("balance.cop.read capabilityId is invalid");
  }
  if (payload.coordinateSpace !== CANONICAL_COP_COORDINATE_SPACE) {
    throw new TypeError("balance.cop.read coordinateSpace is invalid");
  }
  parseUInt64(payload.sourceSequence, "sourceSequence");
  if (
    !Number.isInteger(payload.flags) ||
    payload.flags < 0 ||
    payload.flags > 255
  ) {
    throw new TypeError("flags must be an unsigned byte");
  }
  parseDecimal(payload.copXPct, DECIMAL_PATTERN, "copXPct");
  parseDecimal(payload.copYPct, DECIMAL_PATTERN, "copYPct");
  parseDecimal(payload.forceKg, NONNEGATIVE_DECIMAL_PATTERN, "forceKg");
  return payload;
}

function requireSign(value, label) {
  if (value !== 1 && value !== -1) {
    throw new TypeError(
      `canonical orientation requires explicit rightSign and forwardSign; ${label} must be 1 or -1`
    );
  }
  return value;
}

export function mapCanonicalCopToGame(
  payload,
  orientation
) {
  const value = validateCanonicalCopPayload(payload);
  const rightSign = requireSign(orientation?.rightSign, "rightSign");
  const forwardSign = requireSign(orientation?.forwardSign, "forwardSign");

  const right =
    clamp(
      parseDecimal(value.copXPct, DECIMAL_PATTERN, "copXPct") / 100,
      -1,
      1
    ) * rightSign;
  const forward =
    clamp(
      parseDecimal(value.copYPct, DECIMAL_PATTERN, "copYPct") / 100,
      -1,
      1
    ) * forwardSign;
  return {
    x: right,
    // The game models screen Y: forward is visually upward and therefore negative.
    y: -forward,
    forceKg: parseDecimal(
      value.forceKg,
      NONNEGATIVE_DECIMAL_PATTERN,
      "forceKg"
    )
  };
}

export function validateDataDeliveryMetadata(
  value,
  maxDataAgeMs = BALANCE_BOARD_CONFIG.maxDataAgeMs
) {
  if (!isRecord(value)) {
    throw new TypeError("DataDeliveryMetadata must be an object");
  }
  const required = [
    "schemaVersion",
    "capturedAtNs",
    "publishedAtNs",
    "dataAgeMs",
    "freshnessState",
    "deliveryPolicy",
    "deliveryObservation"
  ];
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`DataDeliveryMetadata is missing ${key}`);
    }
  }
  const allowed = new Set([...required, "staleReasonCode"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`DataDeliveryMetadata contains unknown ${key}`);
    }
  }
  if (
    value.schemaVersion !==
    "kiwii.game-sdk.data-delivery-metadata.v1"
  ) {
    throw new TypeError("DataDeliveryMetadata schemaVersion is invalid");
  }
  parseUInt64(value.capturedAtNs, "capturedAtNs");
  parseUInt64(value.publishedAtNs, "publishedAtNs");
  const dataAge = parseUInt64(value.dataAgeMs, "dataAgeMs");
  if (value.freshnessState === "STALE") {
    throw new TypeError(
      `HOST_STALE:${String(value.staleReasonCode || "UNSPECIFIED")}`
    );
  }
  if (value.freshnessState !== "FRESH") {
    throw new TypeError("freshnessState is invalid");
  }
  if (Object.hasOwn(value, "staleReasonCode")) {
    throw new TypeError("fresh metadata cannot contain staleReasonCode");
  }
  if (!isRecord(value.deliveryPolicy)) {
    throw new TypeError("deliveryPolicy must be an object");
  }
  if (!isRecord(value.deliveryObservation)) {
    throw new TypeError("deliveryObservation must be an object");
  }
  const ageLimit = BigInt(Math.max(0, Math.floor(maxDataAgeMs)));
  if (dataAge > ageLimit) {
    throw new TypeError("PROJECT_STALE");
  }
  return {
    dataAgeMs: Number(dataAge),
    capturedAtNs: value.capturedAtNs,
    publishedAtNs: value.publishedAtNs,
    deliveryPolicy: value.deliveryPolicy,
    deliveryObservation: value.deliveryObservation
  };
}

function rejected(reason) {
  return { available: false, reason };
}

function reasonFrom(error) {
  const message = String(error?.message || "");
  if (message.startsWith("HOST_STALE:")) return "HOST_STALE";
  if (message === "PROJECT_STALE") return "PROJECT_STALE";
  return "MALFORMED_CANONICAL_SAMPLE";
}

export class CanonicalCopStream {
  constructor({
    orientation,
    maxDataAgeMs = BALANCE_BOARD_CONFIG.maxDataAgeMs,
    validateCapabilityPayload,
    onReset
  }) {
    requireSign(orientation?.rightSign, "rightSign");
    requireSign(orientation?.forwardSign, "forwardSign");
    this.orientation = orientation;
    this.maxDataAgeMs = maxDataAgeMs;
    this.validateCapabilityPayload = validateCapabilityPayload;
    this.onReset = onReset;
    this.subscriptionId = null;
    this.streamEpoch = null;
    this.nextEventSequence = null;
    this.lastEventSequence = null;
    this.lastSourceSequence = null;
  }

  replaceSubscription({
    subscriptionId,
    streamEpoch,
    nextEventSequence = null,
    reason = "SUBSCRIPTION_EPOCH_REPLACED"
  }) {
    if (typeof subscriptionId !== "string" || subscriptionId === "") {
      throw new TypeError("subscriptionId is required");
    }
    if (typeof streamEpoch !== "string" || streamEpoch === "") {
      throw new TypeError("streamEpoch is required");
    }
    if (nextEventSequence !== null) {
      parseUInt64(nextEventSequence, "nextEventSequence");
    }
    this.subscriptionId = subscriptionId;
    this.streamEpoch = streamEpoch;
    this.nextEventSequence = nextEventSequence;
    this.lastEventSequence = null;
    this.lastSourceSequence = null;
    this.onReset?.({
      reason,
      subscriptionId,
      streamEpoch
    });
  }

  reset(reason = "STREAM_RESET") {
    this.subscriptionId = null;
    this.streamEpoch = null;
    this.nextEventSequence = null;
    this.lastEventSequence = null;
    this.lastSourceSequence = null;
    this.onReset?.({ reason });
  }

  hasAcceptedSample({ subscriptionId, streamEpoch }) {
    return (
      this.subscriptionId === subscriptionId &&
      this.streamEpoch === streamEpoch &&
      this.lastSourceSequence !== null
    );
  }

  accept({
    subscriptionId,
    streamEpoch,
    eventSequence,
    value,
    metadata,
    sdkValidatedEventOrder = false
  }) {
    if (subscriptionId !== this.subscriptionId) {
      return rejected("OLD_SUBSCRIPTION");
    }
    if (streamEpoch !== this.streamEpoch) {
      return rejected("OLD_STREAM_EPOCH");
    }

    let parsedEventSequence = null;
    if (!sdkValidatedEventOrder) {
      try {
        parsedEventSequence = parseUInt64(eventSequence, "eventSequence");
      } catch {
        return rejected("MALFORMED_EVENT_SEQUENCE");
      }
      if (
        this.nextEventSequence !== null &&
        parsedEventSequence < BigInt(this.nextEventSequence)
      ) {
        return rejected("OUT_OF_ORDER_EVENT_SEQUENCE");
      }
      if (this.lastEventSequence !== null) {
        if (parsedEventSequence === this.lastEventSequence) {
          return rejected("DUPLICATE_EVENT_SEQUENCE");
        }
        if (parsedEventSequence < this.lastEventSequence) {
          return rejected("OUT_OF_ORDER_EVENT_SEQUENCE");
        }
      }
    }

    let payload;
    let delivery;
    try {
      payload = validateCanonicalCopPayload(
        value,
        this.validateCapabilityPayload
      );
      delivery = validateDataDeliveryMetadata(
        metadata,
        this.maxDataAgeMs
      );
    } catch (error) {
      return rejected(reasonFrom(error));
    }

    const sourceSequence = parseUInt64(
      payload.sourceSequence,
      "sourceSequence"
    );
    if (this.lastSourceSequence !== null) {
      if (sourceSequence === this.lastSourceSequence) {
        return rejected("DUPLICATE_SOURCE_SEQUENCE");
      }
      if (sourceSequence < this.lastSourceSequence) {
        return rejected("OUT_OF_ORDER_SOURCE_SEQUENCE");
      }
    }

    const mapped = mapCanonicalCopToGame(
      payload,
      this.orientation
    );
    if (parsedEventSequence !== null) {
      this.lastEventSequence = parsedEventSequence;
    }
    this.lastSourceSequence = sourceSequence;
    return {
      available: true,
      sourceKind: "KIWII_GAME_SDK",
      subscriptionId,
      streamEpoch,
      eventSequence:
        parsedEventSequence === null ? null : String(parsedEventSequence),
      eventOrderAuthority: sdkValidatedEventOrder
        ? "KIWII_HARDWARE_CLIENT"
        : "HOST_EVENT_ENVELOPE",
      sourceSequence: payload.sourceSequence,
      flags: payload.flags,
      copX: Number(payload.copXPct),
      copY: Number(payload.copYPct),
      force: mapped.forceKg,
      x: mapped.x,
      y: mapped.y,
      capturedAtNs: delivery.capturedAtNs,
      publishedAtNs: delivery.publishedAtNs,
      dataAgeMs: delivery.dataAgeMs,
      deliveryPolicy: delivery.deliveryPolicy,
      deliveryObservation: delivery.deliveryObservation
    };
  }
}

export class KiwiiHardwareSourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KiwiiHardwareSourceError";
    this.code = code;
  }
}

export class KiwiiCopSdkSource {
  constructor({
    hardwareClient,
    gameSdkEventSource,
    subscribeBody,
    validateCapabilityPayload,
    orientation,
    maxDataAgeMs,
    onReset
  }) {
    this.hardwareClient = hardwareClient;
    this.gameSdkEventSource = gameSdkEventSource;
    this.subscribeBody = subscribeBody;
    this.listener = null;
    this.subscription = null;
    this.startPromise = null;
    this.removeHardwareEventListener = null;
    this.resetListener = onReset;
    this.stream = new CanonicalCopStream({
      orientation,
      maxDataAgeMs,
      validateCapabilityPayload,
      onReset: (event) => this.resetListener?.(event)
    });
  }

  setResetListener(listener) {
    this.resetListener = listener;
  }

  async start(listener) {
    if (this.subscription) return;
    if (this.startPromise) return this.startPromise;
    if (
      !this.hardwareClient ||
      typeof this.hardwareClient.subscribeCapability !== "function"
    ) {
      throw new KiwiiHardwareSourceError(
        "HARDWARE_CLIENT_UNAVAILABLE",
        "KiwiiHardwareClient is required"
      );
    }
    if (typeof listener !== "function") {
      throw new TypeError("sample listener is required");
    }
    this.listener = listener;
    this.startPromise = this.hardwareClient
      .subscribeCapability({
        capabilityId: BALANCE_COP_CAPABILITY_ID,
        body: this.subscribeBody,
        onData: (delivery) => this.handleDelivery(delivery)
      })
      .then((subscription) => {
        const result = subscription?.result;
        if (
          !result ||
          typeof result.subscriptionId !== "string" ||
          typeof result.streamEpoch !== "string"
        ) {
          throw new KiwiiHardwareSourceError(
            "INVALID_SUBSCRIPTION_RESULT",
            "KiwiiHardwareClient returned an invalid subscription"
          );
        }
        this.subscription = subscription;
        this.stream.replaceSubscription({
          subscriptionId: result.subscriptionId,
          streamEpoch: result.streamEpoch,
          nextEventSequence: result.nextSequence ?? null
        });
        if (
          this.gameSdkEventSource &&
          typeof this.gameSdkEventSource.onEvent === "function"
        ) {
          this.removeHardwareEventListener =
            this.gameSdkEventSource.onEvent((event) =>
              this.handleHardwareEvent(event)
            );
        }
      })
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  handleDelivery(delivery) {
    if (!this.subscription) return;
    const result = this.subscription.result;
    const sample = this.stream.accept({
      subscriptionId: result.subscriptionId,
      streamEpoch: result.streamEpoch,
      eventSequence: null,
      value: delivery?.value,
      metadata: delivery?.metadata,
      // KiwiiHardwareClient validates the hidden SDK event envelope before
      // invoking onData, but currently does not expose its sequence.
      sdkValidatedEventOrder: true
    });
    this.listener?.(sample);
  }

  handleHardwareEvent(event) {
    const payload = event?.payload;
    const body = payload?.body;
    const result = this.subscription?.result;
    if (
      !result ||
      body?.subscriptionId !== result.subscriptionId
    ) {
      return;
    }
    if (
      typeof payload.streamEpoch === "string" &&
      payload.streamEpoch !== result.streamEpoch
    ) {
      return;
    }

    let reason = null;
    let canContinue = false;
    if (payload.eventType === "DEVICE_STATE") {
      if (body.state === "CONNECTED") {
        if (this.stream.hasAcceptedSample({
          subscriptionId: result.subscriptionId,
          streamEpoch: result.streamEpoch
        })) {
          return;
        }
        reason = "WAITING_FOR_FIRST_SAMPLE";
        canContinue = true;
      } else if (
        body.state === "DISCONNECTED" ||
        body.state === "DEGRADED" ||
        body.state === "REPLACED"
      ) {
        reason =
          body.reasonCode ||
          (body.state === "REPLACED"
            ? "DEVICE_REPLACED"
            : "DISCONNECTED");
        canContinue = body.state === "REPLACED";
      }
    } else if (
      payload.eventType === "SUBSCRIPTION_STATE" &&
      (body.state === "CLOSED" || body.state === "FAILED")
    ) {
      reason = body.reasonCode || "SUBSCRIPTION_FAILED";
    } else if (payload.eventType === "CAPABILITY_STATE") {
      reason = body.reasonCode || body.observedState || "CAPABILITY_SUSPENDED";
    }
    if (!reason) return;

    if (canContinue) {
      this.stream.replaceSubscription({
        subscriptionId: result.subscriptionId,
        streamEpoch: result.streamEpoch,
        nextEventSequence: result.nextSequence ?? null,
        reason
      });
    } else {
      this.stream.reset(reason);
    }
    this.listener?.({ available: false, reason });
  }

  async stop() {
    const subscription = this.subscription;
    this.subscription = null;
    this.listener = null;
    this.removeHardwareEventListener?.();
    this.removeHardwareEventListener = null;
    this.stream.reset("SOURCE_STOPPED");
    if (subscription) await subscription.close();
  }
}
