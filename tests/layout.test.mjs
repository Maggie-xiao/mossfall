import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMossTiltLayout,
  calculateMossTiltLayout,
  MossTiltLayoutController
} from "../src/layout.js";

test("phone presentation keeps a centered 16:9 safe frame", () => {
  const layout = calculateMossTiltLayout({
    mode: "COMBINED",
    viewport: { width: 393, height: 852 }
  });

  assert.equal(layout.mode, "COMBINED");
  assert.equal(layout.orientation, "PORTRAIT");
  assert.equal(layout.safeFrame.width / layout.safeFrame.height, 16 / 9);
  assert.equal(layout.safeFrame.height, 393 * 9 / 16);
  assert.equal(layout.safeFrame.x, 0);
  assert.equal(layout.safeFrame.y, (852 - layout.safeFrame.height) / 2);
});

test("external presentation fills a native 16:9 viewport", () => {
  const layout = calculateMossTiltLayout({
    mode: "EXTERNAL_GAME",
    viewport: { width: 3840, height: 2160 }
  });

  assert.equal(layout.mode, "EXTERNAL_GAME");
  assert.equal(layout.orientation, "LANDSCAPE");
  assert.deepEqual(layout.safeFrame, { x: 0, y: 0, width: 3840, height: 2160 });
  assert.equal(layout.safeFrameScale, 2);
});

test("layout rejects missing or non-positive viewport dimensions", () => {
  for (const viewport of [
    {},
    { width: 0, height: 1080 },
    { width: 1920, height: -1 },
    { width: Number.NaN, height: 1080 }
  ]) {
    assert.throws(
      () => calculateMossTiltLayout({ mode: "COMBINED", viewport }),
      /viewport width and height must be positive/
    );
  }
});

test("layout controller changes presentation without replacing its viewport owner", () => {
  const properties = new Map();
  const root = {
    style: { setProperty: (name, value) => properties.set(name, value) },
    dataset: {}
  };
  const viewportSource = {
    current: () => ({ width: 1920, height: 1080 }),
    addEventListener() {},
    removeEventListener() {}
  };
  const controller = new MossTiltLayoutController({
    mode: "COMBINED",
    viewportSource,
    root
  });

  controller.connect();
  const first = controller.current;
  controller.updateMode("EXTERNAL_GAME");

  assert.notStrictEqual(controller.current, first);
  assert.equal(controller.current.mode, "EXTERNAL_GAME");
  assert.equal(root.dataset.presentationMode, "EXTERNAL_GAME");
  assert.equal(root.dataset.presentationOrientation, "LANDSCAPE");
  assert.equal(properties.get("--safe-width"), "1920px");
  assert.equal(properties.get("--safe-height"), "1080px");
  controller.close();
});
