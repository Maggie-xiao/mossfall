import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserVibration,
  DEFAULT_VIBRATION_INTENSITY,
  VIBRATION_INTENSITY_STORAGE_KEY,
  VIBRATION_STORAGE_KEY
} from "../src/vibration.js";

function storage(values = {}) {
  return {
    getItem(key) {
      return Object.hasOwn(values, key) ? values[key] : null;
    }
  };
}

test("first run defaults to enabled light when no vibration UI exists", () => {
  const vibration = new BrowserVibration({
    storage: storage(),
    navigatorObject: null
  });
  assert.equal(vibration.enabled, true);
  assert.equal(vibration.intensity, DEFAULT_VIBRATION_INTENSITY);
  assert.equal(vibration.intensity, "light");
});

test("valid persisted vibration choices override first-run defaults", () => {
  const disabledHeavy = new BrowserVibration({
    storage: storage({
      [VIBRATION_STORAGE_KEY]: "0",
      [VIBRATION_INTENSITY_STORAGE_KEY]: "heavy"
    }),
    navigatorObject: null
  });
  assert.equal(disabledHeavy.enabled, false);
  assert.equal(disabledHeavy.intensity, "heavy");

  const invalidIntensity = new BrowserVibration({
    storage: storage({
      [VIBRATION_STORAGE_KEY]: "1",
      [VIBRATION_INTENSITY_STORAGE_KEY]: "maximum"
    }),
    navigatorObject: null
  });
  assert.equal(invalidIntensity.enabled, true);
  assert.equal(invalidIntensity.intensity, "light");
});

test("only the authoritative game instance calls vibration and unsupported devices fail silently", () => {
  const calls = [];
  const navigatorObject = {
    vibrate(pattern) {
      calls.push(pattern);
      return true;
    }
  };
  const gameInstance = new BrowserVibration({
    storage: storage(),
    navigatorObject,
    authority: "GAME_INSTANCE"
  });
  const nonAuthoritative = new BrowserVibration({
    storage: storage(),
    navigatorObject,
    authority: "NON_AUTHORITATIVE"
  });

  assert.equal(gameInstance.play("catch"), true);
  assert.deepEqual(calls, [21]);
  assert.equal(nonAuthoritative.play("drop"), false);
  assert.deepEqual(calls, [21]);
  assert.equal(
    new BrowserVibration({
      storage: storage(),
      navigatorObject: {},
      authority: "GAME_INSTANCE"
    }).play("record"),
    false
  );
  assert.equal(
    new BrowserVibration({
      storage: storage(),
      navigatorObject: {
        vibrate() {
          throw new Error("unsupported");
        }
      },
      authority: "GAME_INSTANCE"
    }).play("record"),
    false
  );
});
