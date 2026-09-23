import assert from "node:assert/strict";
import test from "node:test";

import {
  CanonicalCopStream,
  KiwiiCopSdkSource,
  mapCanonicalCopToGame,
  validateCanonicalCopPayload,
  validateDataDeliveryMetadata
} from "../src/kiwii-cop-sdk.js";

function canonicalFrame(overrides = {}) {
  return {
    schemaVersion: "kiwii.capability.balance-board-cop-frame.v1",
    capabilityId: "balance.cop.read",
    coordinateSpace: "FIRMWARE_RAW_PCT_KG",
    sourceSequence: "42",
    flags: 0,
    copXPct: "-12.5",
    copYPct: "35",
    forceKg: "71.2",
    ...overrides
  };
}

function deliveryMetadata(overrides = {}) {
  return {
    schemaVersion: "kiwii.game-sdk.data-delivery-metadata.v1",
    capturedAtNs: "1700000000000000000",
    publishedAtNs: "1700000000010000000",
    dataAgeMs: "10",
    freshnessState: "FRESH",
    deliveryPolicy: {
      schemaVersion: "kiwii.game-sdk.subscription-delivery-policy.v1",
      mode: "LATEST_ONLY",
      maxDataAgeMs: "500",
      overflowPolicy: "REPLACE_LATEST"
    },
    deliveryObservation: {
      schemaVersion: "kiwii.game-sdk.delivery-observation.v1",
      queueDepth: 0,
      droppedSincePrevious: "0",
      totalDropped: "0",
      coalesced: false,
      backpressureState: "NORMAL"
    },
    ...overrides
  };
}

test("canonical CoP accepts the exact decimal-string closed schema", () => {
  assert.deepEqual(validateCanonicalCopPayload(canonicalFrame()), canonicalFrame());
});

test("canonical CoP rejects JSON numbers, malformed values, and unknown fields", () => {
  for (const payload of [
    canonicalFrame({ sourceSequence: 42 }),
    canonicalFrame({ copXPct: -12.5 }),
    canonicalFrame({ copYPct: 35 }),
    canonicalFrame({ forceKg: 71.2 }),
    canonicalFrame({ sourceSequence: "18446744073709551616" }),
    canonicalFrame({ copXPct: "01.25" }),
    canonicalFrame({ forceKg: "-1" }),
    canonicalFrame({ historicalAxisHint: "FORWARD" })
  ]) {
    assert.throws(() => validateCanonicalCopPayload(payload), TypeError);
  }
});

test("canonical mapping requires explicit device orientation authority", () => {
  assert.throws(
    () => mapCanonicalCopToGame(canonicalFrame(), {}),
    /rightSign.*forwardSign/
  );
  assert.deepEqual(
    mapCanonicalCopToGame(
      canonicalFrame({ copXPct: "50", copYPct: "50" }),
      {
        rightSign: 1,
        forwardSign: 1
      }
    ),
    { x: 0.5, y: -0.5, forceKg: 71.2 }
  );
  assert.deepEqual(
    mapCanonicalCopToGame(
      canonicalFrame({ copXPct: "140", copYPct: "-130" }),
      {
        rightSign: -1,
        forwardSign: -1
      }
    ),
    { x: -1, y: -1, forceKg: 71.2 }
  );
});

test("delivery metadata rejects stale and malformed host freshness", () => {
  assert.equal(validateDataDeliveryMetadata(deliveryMetadata()).dataAgeMs, 10);
  assert.equal(
    validateDataDeliveryMetadata(deliveryMetadata({ dataAgeMs: "420" }))
      .dataAgeMs,
    420
  );
  assert.throws(
    () =>
      validateDataDeliveryMetadata(
        deliveryMetadata({ dataAgeMs: "501" })
      ),
    /PROJECT_STALE/
  );
  assert.throws(
    () =>
      validateDataDeliveryMetadata(
        deliveryMetadata({
          freshnessState: "STALE",
          staleReasonCode: "DEVICE_STALE"
        })
      ),
    /HOST_STALE/
  );
  assert.throws(
    () => validateDataDeliveryMetadata(deliveryMetadata({ dataAgeMs: 10 })),
    TypeError
  );
});

test("stream rejects duplicate, out-of-order, stale, and old-epoch samples", () => {
  const stream = new CanonicalCopStream({
    orientation: { rightSign: 1, forwardSign: 1 },
    maxDataAgeMs: 500
  });
  stream.replaceSubscription({
    subscriptionId: "sub-a",
    streamEpoch: "7",
    nextEventSequence: "100"
  });

  assert.equal(
    stream.accept({
      subscriptionId: "sub-a",
      streamEpoch: "7",
      eventSequence: "100",
      value: canonicalFrame({ sourceSequence: "9" }),
      metadata: deliveryMetadata()
    }).available,
    true
  );
  assert.equal(
    stream.accept({
      subscriptionId: "sub-a",
      streamEpoch: "7",
      eventSequence: "101",
      value: canonicalFrame({ sourceSequence: "9" }),
      metadata: deliveryMetadata()
    }).reason,
    "DUPLICATE_SOURCE_SEQUENCE"
  );
  assert.equal(
    stream.accept({
      subscriptionId: "sub-a",
      streamEpoch: "7",
      eventSequence: "99",
      value: canonicalFrame({ sourceSequence: "10" }),
      metadata: deliveryMetadata()
    }).reason,
    "OUT_OF_ORDER_EVENT_SEQUENCE"
  );
  assert.equal(
    stream.accept({
      subscriptionId: "sub-a",
      streamEpoch: "6",
      eventSequence: "102",
      value: canonicalFrame({ sourceSequence: "10" }),
      metadata: deliveryMetadata()
    }).reason,
    "OLD_STREAM_EPOCH"
  );
  assert.equal(
    stream.accept({
      subscriptionId: "sub-a",
      streamEpoch: "7",
      eventSequence: "102",
      value: canonicalFrame({ sourceSequence: "10" }),
      metadata: deliveryMetadata({ dataAgeMs: "501" })
    }).reason,
    "PROJECT_STALE"
  );
});

test("subscription and stream epoch replacement reset ordering and accepted input", () => {
  let resets = 0;
  const stream = new CanonicalCopStream({
    orientation: { rightSign: 1, forwardSign: 1 },
    onReset: () => {
      resets += 1;
    }
  });
  stream.replaceSubscription({
    subscriptionId: "sub-a",
    streamEpoch: "7",
    nextEventSequence: "100"
  });
  stream.accept({
    subscriptionId: "sub-a",
    streamEpoch: "7",
    eventSequence: "100",
    value: canonicalFrame({ sourceSequence: "800" }),
    metadata: deliveryMetadata()
  });
  stream.replaceSubscription({
    subscriptionId: "sub-b",
    streamEpoch: "1",
    nextEventSequence: "1"
  });

  assert.equal(resets, 2);
  assert.equal(
    stream.accept({
      subscriptionId: "sub-b",
      streamEpoch: "1",
      eventSequence: "1",
      value: canonicalFrame({ sourceSequence: "1" }),
      metadata: deliveryMetadata()
    }).available,
    true
  );
});

test("SDK source subscribes only to balance.cop.read and cleans up", async () => {
  const calls = [];
  let delivered;
  let closes = 0;
  const source = new KiwiiCopSdkSource({
    hardwareClient: {
      async subscribeCapability(options) {
        calls.push(options);
        delivered = options.onData;
        return {
          result: {
            subscriptionId: "sub-a",
            streamEpoch: "7",
            nextSequence: "100"
          },
          async close() {
            closes += 1;
          }
        };
      }
    },
    subscribeBody: {
      schemaVersion: "kiwii.game-sdk.invocation.subscribe.v1",
      subscriptionId: "sub-a",
      grantId: "grant-a",
      topic: "CAPABILITY_DATA",
      requestedDeliveryPolicy: {
        schemaVersion: "kiwii.game-sdk.subscription-delivery-policy.v1",
        mode: "LATEST_ONLY",
        maxDataAgeMs: "500",
        overflowPolicy: "REPLACE_LATEST"
      }
    },
    validateCapabilityPayload(capabilityId, value) {
      assert.equal(capabilityId, "balance.cop.read");
      return validateCanonicalCopPayload(value);
    },
    orientation: { rightSign: 1, forwardSign: 1 }
  });
  const samples = [];
  await source.start((sample) => samples.push(sample));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].capabilityId, "balance.cop.read");

  delivered({ value: canonicalFrame(), metadata: deliveryMetadata() });
  assert.equal(samples.at(-1).available, true);
  assert.equal(samples.at(-1).streamEpoch, "7");

  await source.stop();
  await source.stop();
  assert.equal(closes, 1);
});

test("SDK source stop awaits subscription closure before transport teardown", async () => {
  const order = [];
  let releaseSubscription;
  const source = new KiwiiCopSdkSource({
    hardwareClient: {
      async subscribeCapability() {
        return {
          result: {
            subscriptionId: "sub-a",
            streamEpoch: "7",
            nextSequence: "1"
          },
          close() {
            order.push("subscription:close:start");
            return new Promise((resolve) => {
              releaseSubscription = () => {
                order.push("subscription:close:end");
                resolve();
              };
            });
          }
        };
      }
    },
    subscribeBody: {},
    validateCapabilityPayload: (_capabilityId, value) =>
      validateCanonicalCopPayload(value),
    orientation: { rightSign: 1, forwardSign: 1 }
  });
  await source.start(() => {});

  const stopPromise = source.stop().then(() => {
    order.push("input:stopped");
  });
  await Promise.resolve();
  assert.deepEqual(order, ["subscription:close:start"]);

  releaseSubscription();
  await stopPromise;
  order.push("transport:close");
  assert.deepEqual(order, [
    "subscription:close:start",
    "subscription:close:end",
    "input:stopped",
    "transport:close"
  ]);
});

test("replayed CONNECTED state cannot invalidate an already accepted iOS sample", async () => {
  let hardwareEvent;
  let delivered;
  const samples = [];
  const resets = [];
  const source = new KiwiiCopSdkSource({
    hardwareClient: {
      async subscribeCapability(options) {
        delivered = options.onData;
        return {
          result: {
            subscriptionId: "sub-a",
            streamEpoch: "7",
            nextSequence: "1"
          },
          async close() {}
        };
      }
    },
    gameSdkEventSource: {
      onEvent(listener) {
        hardwareEvent = listener;
        return () => {};
      }
    },
    subscribeBody: {},
    validateCapabilityPayload: (_capabilityId, value) =>
      validateCanonicalCopPayload(value),
    orientation: { rightSign: 1, forwardSign: 1 },
    onReset: (event) => resets.push(event.reason)
  });
  await source.start((sample) => samples.push(sample));
  delivered({
    value: canonicalFrame({ sourceSequence: "80" }),
    metadata: deliveryMetadata()
  });
  const resetCountAfterSample = resets.length;

  hardwareEvent({
    payload: {
      eventType: "DEVICE_STATE",
      streamEpoch: "7",
      body: {
        subscriptionId: "sub-a",
        state: "CONNECTED",
        reasonCode: "SAMPLE_AVAILABLE"
      }
    }
  });

  assert.equal(samples.length, 1);
  assert.equal(samples.at(-1).available, true);
  assert.equal(samples.at(-1).sourceSequence, "80");
  assert.equal(resets.length, resetCountAfterSample);
});

test("SDK device replacement and subscription failure reset stream identity", async () => {
  let hardwareEvent;
  let removed = 0;
  let delivered;
  const samples = [];
  const resets = [];
  const source = new KiwiiCopSdkSource({
    hardwareClient: {
      async subscribeCapability(options) {
        delivered = options.onData;
        return {
          result: {
            subscriptionId: "sub-a",
            streamEpoch: "7",
            nextSequence: "100"
          },
          async close() {}
        };
      }
    },
    gameSdkEventSource: {
      onEvent(listener) {
        hardwareEvent = listener;
        return () => {
          removed += 1;
        };
      }
    },
    subscribeBody: {},
    validateCapabilityPayload: (_capabilityId, value) =>
      validateCanonicalCopPayload(value),
    orientation: { rightSign: 1, forwardSign: 1 },
    onReset: (event) => resets.push(event.reason)
  });
  await source.start((sample) => samples.push(sample));
  delivered({
    value: canonicalFrame({ sourceSequence: "80" }),
    metadata: deliveryMetadata()
  });
  assert.equal(samples.at(-1).available, true);

  hardwareEvent({
    payload: {
      eventType: "DEVICE_STATE",
      streamEpoch: "7",
      body: {
        subscriptionId: "sub-a",
        state: "REPLACED",
        reasonCode: "DEVICE_REPLACED"
      }
    }
  });
  assert.equal(samples.at(-1).reason, "DEVICE_REPLACED");
  delivered({
    value: canonicalFrame({ sourceSequence: "1" }),
    metadata: deliveryMetadata()
  });
  assert.equal(samples.at(-1).available, true);

  hardwareEvent({
    payload: {
      eventType: "SUBSCRIPTION_STATE",
      streamEpoch: "7",
      body: {
        subscriptionId: "sub-a",
        state: "FAILED",
        reasonCode: "DEVICE_LOST"
      }
    }
  });
  assert.equal(samples.at(-1).reason, "DEVICE_LOST");
  assert.ok(resets.includes("DEVICE_REPLACED"));
  assert.ok(resets.includes("DEVICE_LOST"));

  await source.stop();
  assert.equal(removed, 1);
});
