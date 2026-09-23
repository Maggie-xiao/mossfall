import assert from "node:assert/strict";
import test from "node:test";

const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
const previousLocation = globalThis.location;

globalThis.window = {
  __KIWII_MOSS_TILT_PLATFORM__: { autoBoot: false }
};
globalThis.document = {};
globalThis.location = {};

const { bindPageLifecycleDestroy } = await import("../src/main.js");

globalThis.window = previousWindow;
globalThis.document = previousDocument;
globalThis.location = previousLocation;

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener({ type, ...event });
    }
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

test("page-exit destroy removes both lifecycle listeners exactly once", () => {
  const target = new FakeEventTarget();
  let destroyCalls = 0;
  let cleanup = () => {};
  cleanup = bindPageLifecycleDestroy(() => {
    destroyCalls += 1;
    cleanup();
  }, target);

  assert.equal(target.listenerCount("pagehide"), 1);
  assert.equal(target.listenerCount("beforeunload"), 1);

  target.dispatch("beforeunload");

  assert.equal(destroyCalls, 1);
  assert.equal(target.listenerCount("pagehide"), 0);
  assert.equal(target.listenerCount("beforeunload"), 0);

  target.dispatch("pagehide");
  cleanup();
  cleanup();
  assert.equal(destroyCalls, 1);
});

test("BFCache pagehide does not destroy the single game instance", () => {
  const target = new FakeEventTarget();
  let destroyCalls = 0;
  const cleanup = bindPageLifecycleDestroy(() => {
    destroyCalls += 1;
  }, target);

  target.dispatch("pagehide", { persisted: true });
  assert.equal(destroyCalls, 0);
  assert.equal(target.listenerCount("pagehide"), 1);

  target.dispatch("pagehide", { persisted: false });
  assert.equal(destroyCalls, 1);
  cleanup();
});
