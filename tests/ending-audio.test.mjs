import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as THREE from "three";

import { EndingDirector } from "../src/ending.js";

test("leaf-stem impact fires its dedicated ending cue at contact", async () => {
  const source = await readFile(new URL("../src/ending.js", import.meta.url), "utf8");
  const start = source.indexOf("if (u >= 1)");
  const end = source.indexOf("} else {", start);
  const arrival = source.slice(start, end);

  assert.ok(start >= 0 && end > start, "arrival beat is present");
  assert.match(arrival, /bug\.arrived = true/);
  assert.match(arrival, /this\._bonked = true/);
  assert.match(arrival, /this\.callbacks\.onPaperBonk\?\.\(\)/);
  assert.doesNotMatch(arrival, /onImpact/);
});

test("fortune reveal and dissolve cues fire once at their visual onsets", () => {
  const calls = [];
  const revealValues = [];
  const dissolveValues = [];
  const director = Object.create(EndingDirector.prototype);
  director.callbacks = {
    onFortuneAppear() {
      calls.push("appear");
    },
    onFortuneVanish() {
      calls.push("vanish");
    }
  };
  director.floorY = 0;
  director.vanishAt = 6.5;
  director._propPush = 0;
  director.fwd = new THREE.Vector3(0, 0, -1);
  director.camera = { quaternion: new THREE.Quaternion() };
  director._placeLeaf = (position, x, y) => position.set(x, y, 0);
  director.leaf = {
    opacity: 1,
    group: {
      visible: false,
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion()
    },
    setOpacity(value) {
      this.opacity = value;
    },
    setUnfurl() {},
    setDissolve(value) {
      dissolveValues.push(value);
    },
    setHaloGain() {},
    update() {}
  };
  director.words = {
    place() {},
    setOpacity() {},
    setReveal(value) {
      revealValues.push(value);
    }
  };

  director._leafBeat(5.59, 1 / 60);
  assert.deepEqual(calls, []);

  director._leafBeat(5.61, 1 / 60);
  director._leafBeat(5.9, 1 / 60);
  assert.deepEqual(calls, ["appear"]);
  assert.ok(revealValues.length >= 2);

  director._leafBeat(6.5, 1 / 60);
  director._leafBeat(6.8, 1 / 60);
  assert.deepEqual(calls, ["appear", "vanish"]);
  assert.ok(dissolveValues.length >= 2);
});
