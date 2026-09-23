import assert from "node:assert/strict";
import test from "node:test";

import { TableTiltController } from "../src/controller.js";

function installBrowserShims() {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame
  };
  const scheduled = new Map();
  const cancelled = [];
  let nextFrameId = 1;

  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    clearTimeout
  };
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; }
  };
  globalThis.location = { search: "" };
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrameId++;
    scheduled.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    cancelled.push(id);
    scheduled.delete(id);
  };

  return {
    scheduled,
    cancelled,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    }
  };
}

function createController() {
  const audioVisibility = [];
  const scene = {
    onEvent: null,
    setTimingScale() {},
    loadLevel() {},
    setSimulationEnabled() {},
    setInputEnabled() {},
    setPresentation() {},
    render() {},
    update() {},
    destroy() {}
  };
  const input = {
    sample: () => ({ connected: false, presenceValid: false, x: 0, y: 0 }),
    snapshot: () => ({ board: {} }),
    destroy: async () => {}
  };
  const audio = {
    setPhase() {},
    setMode() {},
    handleVisibility(hidden) { audioVisibility.push(hidden); },
    destroy() {}
  };
  const ui = {
    setReady() {},
    renderTitle() {},
    hideConnectionRequired() {},
    destroy() {}
  };
  return {
    controller: new TableTiltController({ scene, input, audio, ui }),
    audioVisibility
  };
}

test("external pause, page visibility, and BFCache compose independently", () => {
  const browser = installBrowserShims();
  const { controller, audioVisibility } = createController();
  try {
    assert.equal(browser.scheduled.size, 1);

    controller.setExternalPaused(true, "host");
    controller.setPageHidden(true);
    controller.setBfcachePaused(true);
    assert.equal(controller.visibilityPaused, true);
    assert.equal(browser.scheduled.size, 0, "freezing cancels the normal RAF");

    controller.setExternalPaused(false, "host");
    controller.setPageHidden(false);
    assert.equal(
      controller.visibilityPaused,
      true,
      "BFCache remains an independent freeze owner"
    );
    assert.equal(browser.scheduled.size, 0);

    controller.setBfcachePaused(false);
    assert.equal(controller.visibilityPaused, false);
    assert.equal(browser.scheduled.size, 1, "the last release restores one RAF");

    controller.setBfcachePaused(false);
    controller.setPageHidden(false);
    controller.setExternalPaused(false, "host");
    assert.equal(browser.scheduled.size, 1, "redundant releases do not fork RAF");
    assert.deepEqual(audioVisibility, [true, false]);
  } finally {
    controller.beginDestroy();
    browser.restore();
  }
});

test("a Host resume is not gated by board activity, presence, or CoP", () => {
  const browser = installBrowserShims();
  const { controller } = createController();
  try {
    controller.input.board = {
      active: false,
      presenceValid: false,
      copX: Number.NaN,
      copY: Number.NaN
    };
    controller.setExternalPaused(true, "host");
    controller.setExternalPaused(false, "host");

    assert.equal(controller.externalPaused, false);
    assert.equal(controller.visibilityPaused, false);
    assert.equal(browser.scheduled.size, 1);
  } finally {
    controller.beginDestroy();
    browser.restore();
  }
});
