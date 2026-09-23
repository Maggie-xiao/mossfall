import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BGM_RAMP_MS,
  BGM_TRACK,
  BGM_TRACKS,
  GameAudio,
  SFX_DEFINITIONS
} from "../src/audio.js";

const EXPECTED_KEYS = [
  "ui-move",
  "ui-confirm",
  "ui-start",
  "countdown-beat",
  "countdown-go",
  "ball-impact",
  "ball-capture",
  "ball-fall",
  "ending-paper-bonk",
  "ending-paper-crumple",
  "ending-fortune-appear",
  "ending-fortune-vanish",
  "level-clear",
  "finish-crowd",
  "well-done",
  "result-count",
  "result-rank"
];

test("audio map uses semantic local audio references", () => {
  assert.equal(BGM_TRACK.url, "./audio/bgm/balance-beam-loop.ogg");
  assert.equal(BGM_TRACK.decision, "replace");
  assert.equal(
    BGM_TRACKS.advanced.url,
    "./audio/bgm/precision-puzzle-loop.ogg"
  );
  assert.deepEqual(Object.keys(SFX_DEFINITIONS), EXPECTED_KEYS);
  assert.equal(
    SFX_DEFINITIONS["countdown-beat"].url,
    "./audio/sfx/dune-countdown-tick.wav"
  );
  assert.equal(
    SFX_DEFINITIONS["countdown-go"].url,
    "./audio/sfx/dune-countdown-go.wav"
  );
  for (const [key, definition] of Object.entries(SFX_DEFINITIONS)) {
    assert.match(definition.url, /^\.\/audio\/sfx\/[a-z0-9_-]+\.(ogg|mp3|wav)$/);
    assert.ok(definition.volume > 0 && definition.volume <= 1);
    assert.ok(["add", "layer", "replace"].includes(definition.decision));
    assert.ok(Number.isInteger(definition.maxVoices));
  }
});

test("every SFX and BGM request uses its content revision", async () => {
  const definitions = [
    ...Object.values(BGM_TRACKS),
    ...Object.values(SFX_DEFINITIONS)
  ];
  for (const definition of definitions) {
    const bytes = await readFile(
      new URL(`../src/${definition.url.slice(2)}`, import.meta.url)
    );
    const revision = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    assert.equal(definition.cacheVersion, revision, definition.url);
  }

  const previousFetch = globalThis.fetch;
  const requests = [];
  const decoded = { duration: 0.52 };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      url,
      headers: {
        get: () => "audio/ogg"
      },
      arrayBuffer: async () => new ArrayBuffer(8)
    };
  };

  try {
    const audio = new GameAudio();
    audio.context = {
      decodeAudioData: async () => decoded
    };

    for (const key of EXPECTED_KEYS) {
      assert.equal(await audio.loadBuffer(key), decoded);
    }
    assert.deepEqual(
      requests,
      EXPECTED_KEYS.map((key) => ({
        url: `${SFX_DEFINITIONS[key].url}?v=${SFX_DEFINITIONS[key].cacheVersion}`,
        options: { cache: "no-cache" }
      }))
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("ending paper crumple holds longer before its 200 millisecond fade", async () => {
  const bytes = await readFile(
    new URL("../src/audio/sfx/ending-paper-crumple.ogg", import.meta.url)
  );
  const vorbisId = Buffer.from([1, 118, 111, 114, 98, 105, 115]);
  const idOffset = bytes.indexOf(vorbisId);
  const lastPage = bytes.lastIndexOf(Buffer.from("OggS"));

  assert.ok(idOffset >= 0, "Vorbis identification header is present");
  assert.ok(lastPage >= 0, "final Ogg page is present");

  const sampleRate = bytes.readUInt32LE(idOffset + 12);
  const finalGranule = Number(bytes.readBigUInt64LE(lastPage + 6));
  assert.equal(finalGranule / sampleRate, 1.9);

  const manifest = JSON.parse(
    await readFile(
      new URL("../src/audio/sfx/audio-sources.json", import.meta.url),
      "utf8"
    )
  );
  const asset = manifest.assets.find(
    ({ key }) => key === "ending-paper-crumple"
  );

  assert.ok(asset);
  assert.equal(asset.duration_seconds, 1.9);
  assert.deepEqual(asset.processing.selected_segment_seconds, [0.75, 2.65]);
  assert.equal(asset.processing.full_level_extension_ms, 200);
  assert.equal(asset.processing.edge_fade_out_ms, 200);
  assert.equal(asset.processing.runtime_delay_ms, 600);
});

test("BGM playback URLs carry the same content revisions", () => {
  const previousAudio = globalThis.Audio;
  const requests = [];
  globalThis.Audio = class FakeAudio {
    constructor(url) {
      requests.push(url);
      this.volume = 0;
    }

    addEventListener() {}

    load() {}
  };

  try {
    for (const mode of ["beginner", "advanced", "endless", "rogue"]) {
      const audio = new GameAudio();
      audio.setMode(mode);
      audio.ensureBgm();
    }
  } finally {
    globalThis.Audio = previousAudio;
  }

  assert.deepEqual(
    requests,
    Object.values(BGM_TRACKS).map(
      (track) => `${track.url}?v=${track.cacheVersion}`
    )
  );
});

test("advanced mode selects the precision puzzle BGM", () => {
  const audio = new GameAudio();
  audio.setMode("advanced");
  assert.equal(audio.snapshot().bgm.key, "bgm-precision-puzzle");
  assert.equal(
    audio.snapshot().bgm.url,
    "./audio/bgm/precision-puzzle-loop.ogg"
  );

  audio.setMode("beginner");
  assert.equal(audio.snapshot().bgm.key, "bgm-balance-beam");
});

test("endless mode selects the moss descent BGM", () => {
  const audio = new GameAudio();
  audio.setMode("endless");
  assert.equal(audio.snapshot().bgm.key, "bgm-endless-moss-descent");
  assert.equal(
    audio.snapshot().bgm.url,
    "./audio/bgm/endless-moss-descent-loop.ogg"
  );
});

test("BGM lifecycle ramps are exported by the production audio snapshot", () => {
  assert.deepEqual(BGM_RAMP_MS, {
    start: 480,
    resume: 220,
    stop: 900
  });
  assert.deepEqual(new GameAudio().snapshot().ramp_ms, BGM_RAMP_MS);
});

test("unlock reports real AudioContext readiness and preserves resume errors", async () => {
  const audio = new GameAudio();
  audio.ensureBgm = () => null;
  audio.preloadAll = () => Promise.resolve([]);
  audio.context = {
    state: "suspended",
    resume: async () => {
      throw new Error("activation required");
    }
  };

  assert.equal(await audio.unlock(), false);
  assert.equal(audio.snapshot().unlock_requested, true);
  assert.equal(audio.snapshot().unlocked, false);
  assert.match(audio.snapshot().latest_resume_error, /activation required/);

  audio.context.resume = async () => {
    audio.context.state = "running";
  };

  assert.equal(await audio.unlock(), true);
  assert.equal(audio.snapshot().unlocked, true);
  assert.equal(audio.snapshot().context_state, "running");
  assert.equal(audio.snapshot().latest_resume_error, "");
});

test("audio telemetry reports one owner until the manager is destroyed", () => {
  const audio = new GameAudio();
  assert.equal(audio.snapshot().owner_count, 1);
  audio.destroy();
  assert.equal(audio.snapshot().owner_count, 0);
});

test("destroy unloads and releases the owned BGM media element idempotently", () => {
  const audio = new GameAudio();
  const calls = [];
  const errorHandler = () => {
    calls.push("late-error");
  };
  const listeners = new Map([["error", new Set([errorHandler])]]);
  const bgm = {
    currentTime: 12.5,
    duration: 60,
    volume: BGM_TRACK.volume,
    paused: false,
    src: "./audio/bgm/balance-beam-loop.ogg",
    pause() {
      calls.push("pause");
      this.paused = true;
    },
    removeEventListener(type, listener) {
      calls.push(`remove:${type}`);
      listeners.get(type)?.delete(listener);
    },
    removeAttribute(name) {
      calls.push(`remove-attribute:${name}`);
      if (name === "src") this.src = "";
    },
    load() {
      calls.push("load");
    }
  };
  audio.bgm = bgm;
  audio.bgmErrorHandler = errorHandler;
  audio.bgmSessionActive = true;
  audio.bgmStartedAt = 1;

  audio.destroy();
  audio.destroy();

  for (const listener of listeners.get("error")) listener();

  assert.equal(audio.bgm, null);
  assert.equal(audio.bgmErrorHandler, null);
  assert.equal(bgm.paused, true);
  assert.equal(bgm.currentTime, 0);
  assert.equal(bgm.src, "");
  assert.deepEqual(calls, [
    "pause",
    "remove:error",
    "remove-attribute:src",
    "load"
  ]);
});

test("External Game input retries rejected BGM at the preserved media position", async () => {
  const audio = new GameAudio();
  let playCalls = 0;
  const bgm = {
    currentTime: 12.5,
    duration: 60,
    volume: 0,
    paused: true,
    play() {
      playCalls += 1;
      if (playCalls === 1) {
        return Promise.reject(new Error("NotAllowedError: activation required"));
      }
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    }
  };
  audio.bgm = bgm;
  audio.phase = "TEACH_IN";
  audio.wasUnlocked = true;
  audio.preloadAll = () => Promise.resolve([]);
  audio.context = {
    state: "running",
    resume: async () => {
      audio.context.state = "running";
    }
  };

  audio.startBgm();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(playCalls, 1);
  assert.equal(audio.snapshot().bgm.failed, false);
  assert.match(
    audio.snapshot().bgm.latest_play_error,
    /NotAllowedError: activation required/
  );
  assert.equal(audio.snapshot().bgm.current_time, 12.5);

  audio.context.state = "interrupted";
  assert.equal(await audio.prepareExternalInput("beginner"), true);
  await Promise.resolve();

  assert.equal(playCalls, 2);
  assert.equal(audio.context.state, "running");
  assert.equal(audio.snapshot().bgm.playing, true);
  assert.equal(audio.snapshot().bgm.latest_play_error, "");
  assert.equal(audio.snapshot().bgm.current_time, 12.5);
  assert.equal(audio.bgm, bgm);
  audio.destroy();
});

test("lifecycle resume retries a transiently rejected BGM", async () => {
  const audio = new GameAudio();
  let playCalls = 0;
  audio.bgm = {
    currentTime: 8.25,
    duration: 60,
    volume: 0,
    paused: true,
    play() {
      playCalls += 1;
      if (playCalls === 1) {
        return Promise.reject(new Error("NotAllowedError: backgrounded"));
      }
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    }
  };
  audio.phase = "GAMEPLAY";
  audio.wasUnlocked = true;
  audio.unlockRequested = true;
  audio.preloadAll = () => Promise.resolve([]);
  audio.context = {
    state: "running",
    resume: async () => {
      audio.context.state = "running";
    }
  };

  audio.startBgm();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(playCalls, 1);
  assert.equal(audio.snapshot().bgm.playing, false);

  audio.context.state = "interrupted";
  audio.handleVisibility(false);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(playCalls, 2);
  assert.equal(audio.snapshot().bgm.playing, true);
  assert.equal(audio.snapshot().bgm.current_time, 8.25);
  assert.equal(audio.snapshot().bgm.latest_play_error, "");
  audio.destroy();
});

test("critical ending cue waits for first decode and then plays once", async () => {
  const audio = new GameAudio();
  const starts = [];
  let resolveLoad;
  audio.phase = "ENDING";
  audio.unlock = async () => true;
  audio.context = {
    state: "running",
    currentTime: 7,
    createBufferSource: () => ({
      playbackRate: { value: 1 },
      connect() {},
      start(time) {
        starts.push(time);
      }
    }),
    createGain: () => ({
      gain: { value: 0 },
      connect() {}
    })
  };
  audio.master = {};
  audio.loadBuffer = () =>
    new Promise((resolve) => {
      resolveLoad = resolve;
    });

  audio.endingFortuneAppear();

  assert.deepEqual(audio.snapshot().pending_cue_keys, [
    "ending-fortune-appear"
  ]);
  assert.equal(starts.length, 0);

  const buffer = { duration: 0.8 };
  audio.buffers.set("ending-fortune-appear", buffer);
  resolveLoad(buffer);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(starts.length, 1);
  assert.deepEqual(audio.snapshot().pending_cue_keys, []);
  assert.equal(
    audio.snapshot().audio_play_history.at(-1).key,
    "ending-fortune-appear"
  );
  audio.destroy();
});

test("pending ending cues are discarded when their state is no longer valid", async () => {
  const audio = new GameAudio();
  let resolveLoad;
  let starts = 0;
  audio.phase = "ENDING";
  audio.unlock = async () => true;
  audio.context = {
    state: "running",
    currentTime: 2,
    createBufferSource: () => ({
      playbackRate: { value: 1 },
      connect() {},
      start() {
        starts += 1;
      }
    }),
    createGain: () => ({
      gain: { value: 0 },
      connect() {}
    })
  };
  audio.master = {};
  audio.loadBuffer = () =>
    new Promise((resolve) => {
      resolveLoad = resolve;
    });

  audio.endingFortuneVanish();
  assert.equal(audio.snapshot().pending_cue_count, 1);

  audio.setPhase("RESULT_CALC");
  assert.equal(audio.snapshot().pending_cue_count, 0);

  const buffer = { duration: 0.8 };
  audio.buffers.set("ending-fortune-vanish", buffer);
  resolveLoad(buffer);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(starts, 0);
  audio.destroy();
});

test("cancelled interrupted victory cannot be revived by stale decode callbacks", async () => {
  const audio = new GameAudio();
  const resolvers = [];
  let starts = 0;
  audio.phase = "RESULT_CALC";
  audio.unlock = async () => false;
  audio.context = {
    state: "interrupted",
    currentTime: 2,
    createBufferSource: () => ({
      playbackRate: { value: 1 },
      connect() {},
      start() {
        starts += 1;
      }
    }),
    createGain: () => ({
      gain: {
        value: 0,
        setValueAtTime() {},
        linearRampToValueAtTime() {}
      },
      connect() {}
    })
  };
  audio.master = {};
  audio.loadBuffer = (key) =>
    new Promise((resolve) => {
      resolvers.push({ key, resolve });
    });

  audio.victory();
  assert.deepEqual(audio.snapshot().pending_cue_keys, [
    "finish-crowd",
    "well-done"
  ]);

  audio.stopVictory();
  audio.setPhase("MODE_SELECT");
  assert.equal(audio.snapshot().pending_cue_count, 0);
  assert.equal(audio.snapshot().active_victory_voice_count, 0);

  audio.context.state = "running";
  for (const pending of resolvers) {
    const buffer = { duration: 0.8 };
    audio.buffers.set(pending.key, buffer);
    pending.resolve(buffer);
  }
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(starts, 0);
  assert.equal(audio.snapshot().pending_cue_count, 0);
  audio.destroy();
});

test("result count pending playback coalesces repeated ticks by key", async () => {
  const audio = new GameAudio();
  let resolveLoad;
  let starts = 0;
  audio.phase = "RESULT_CALC";
  audio.unlock = async () => true;
  audio.context = {
    state: "running",
    currentTime: 4,
    createBufferSource: () => ({
      playbackRate: { value: 1 },
      connect() {},
      start() {
        starts += 1;
      }
    }),
    createGain: () => ({
      gain: { value: 0 },
      connect() {}
    })
  };
  audio.master = {};
  audio.loadBuffer = () =>
    new Promise((resolve) => {
      resolveLoad = resolve;
    });

  audio.resultTick();
  audio.resultTick();

  assert.equal(audio.snapshot().pending_cue_count, 1);
  assert.deepEqual(audio.snapshot().pending_cue_keys, ["result-count"]);

  const buffer = { duration: 0.08 };
  audio.buffers.set("result-count", buffer);
  resolveLoad(buffer);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(starts, 1);
  audio.destroy();
});

test("paused audio keeps a valid critical cue pending until resume", () => {
  const audio = new GameAudio();
  let starts = 0;
  audio.phase = "ENDING";
  audio.bgmPausedByVisibility = true;
  audio.unlock = async () => true;
  audio.context = {
    state: "running",
    currentTime: 5,
    createBufferSource: () => ({
      playbackRate: { value: 1 },
      connect() {},
      start() {
        starts += 1;
      }
    }),
    createGain: () => ({
      gain: { value: 0 },
      connect() {}
    })
  };
  audio.master = {};
  audio.buffers.set("ending-fortune-appear", { duration: 0.8 });

  audio.endingFortuneAppear();
  assert.equal(starts, 0);
  assert.deepEqual(audio.snapshot().pending_cue_keys, [
    "ending-fortune-appear"
  ]);

  audio.bgmPausedByVisibility = false;
  audio.flushPendingCues();

  assert.equal(starts, 1);
  assert.equal(audio.snapshot().pending_cue_count, 0);
  audio.destroy();
});

test("visibility pause suspends the single audio timeline without destroying voices", () => {
  const audio = new GameAudio();
  let stopped = 0;
  let suspended = 0;
  audio.voices = [
    {
      key: "finish-crowd",
      group: "victory",
      source: {
        stop() {
          stopped += 1;
        }
      }
    }
  ];
  audio.context = {
    state: "running",
    suspend: async () => {
      suspended += 1;
      audio.context.state = "suspended";
    }
  };

  audio.handleVisibility(true);

  assert.equal(stopped, 0);
  assert.equal(audio.voices.length, 1);
  assert.equal(suspended, 1);
  audio.destroy();
});

test("expired critical cues are discarded instead of playing late", () => {
  const audio = new GameAudio();
  let starts = 0;
  audio.phase = "RESULT_CALC";
  audio.bgmPausedByVisibility = true;
  audio.unlock = async () => true;
  audio.context = {
    state: "running",
    currentTime: 5,
    createBufferSource: () => ({
      playbackRate: { value: 1 },
      connect() {},
      start() {
        starts += 1;
      }
    }),
    createGain: () => ({
      gain: { value: 0 },
      connect() {}
    })
  };
  audio.master = {};
  audio.buffers.set("result-rank", { duration: 0.5 });

  audio.rank();
  audio.pendingCues.get("result-rank").expiresAtMs = -Infinity;
  audio.bgmPausedByVisibility = false;
  audio.flushPendingCues();

  assert.equal(starts, 0);
  assert.equal(audio.snapshot().pending_cue_count, 0);
  audio.destroy();
});

test("paper crumple retains its 600 millisecond visual target while pending", () => {
  const audio = new GameAudio();
  audio.phase = "ENDING";
  audio.unlock = async () => true;
  audio.loadBuffer = async () => null;

  audio.endingPaperBonk();

  const bonk = audio.pendingCues.get("ending-paper-bonk");
  const crumple = audio.pendingCues.get("ending-paper-crumple");
  assert.ok(bonk);
  assert.ok(crumple);
  assert.ok(
    Math.abs(
      crumple.targetAtMs -
        crumple.requestedAtMs -
        600
    ) < 1
  );
  audio.destroy();
});

test("ending group-blink rank cue uses the ending state boundary", () => {
  const audio = new GameAudio();
  audio.phase = "ENDING";
  audio.unlock = async () => true;
  audio.loadBuffer = async () => null;

  audio.rank({ validPhases: ["ENDING"] });

  assert.deepEqual(audio.snapshot().pending_cue_keys, ["result-rank"]);
  audio.setPhase("RESULT_CALC");
  assert.equal(audio.snapshot().pending_cue_count, 0);
  audio.destroy();
});

test("result settlement immediately silences the run BGM", () => {
  const audio = new GameAudio();
  const stops = [];
  audio.bgmSessionActive = true;
  audio.stopBgm = (options) => stops.push(options);

  audio.setPhase("RESULT_CALC");

  assert.deepEqual(stops, [{ fadeMs: 0 }]);
});

test("semantic methods route through the manager with audited keys", () => {
  const audio = new GameAudio();
  const calls = [];
  audio.playCue = (key, options = {}) => {
    calls.push({
      key,
      layer: options.layer === true,
      delay: options.delay || 0,
      volume: options.volume ?? 1,
      loop: options.loop === true,
      direct: options.direct === true
    });
    return true;
  };

  audio.move();
  audio.confirm();
  audio.start();
  audio.countdownBeat();
  audio.countdownGo();
  audio.hit(0.7);
  audio.capture();
  audio.fall();
  audio.endingPaperBonk();
  audio.endingFortuneAppear();
  audio.endingFortuneVanish();
  audio.clear();
  audio.victory();
  audio.resultTick();
  audio.rank();

  for (const key of [
    "ui-move",
    "ui-confirm",
    "ui-start",
    "countdown-beat",
    "countdown-go",
    "ball-impact",
    "ball-capture",
    "ball-fall",
    "ending-paper-bonk",
    "ending-paper-crumple",
    "ending-fortune-appear",
    "ending-fortune-vanish",
    "level-clear",
    "finish-crowd",
    "well-done",
    "result-count",
    "result-rank"
  ]) {
    assert.ok(calls.some((call) => call.key === key), key);
  }
  assert.equal(calls.filter((call) => call.key === "ui-confirm").length, 2);
  assert.equal(calls.find((call) => call.key === "ball-capture").layer, true);
  assert.deepEqual(
    calls
      .filter((call) =>
        ["ending-paper-bonk", "ending-paper-crumple"].includes(call.key)
      )
      .map(({ key, delay }) => ({ key, delay })),
    [
      { key: "ending-paper-bonk", delay: 0 },
      { key: "ending-paper-crumple", delay: 0.6 }
    ]
  );
  assert.deepEqual(
    calls
      .filter((call) => ["finish-crowd", "well-done"].includes(call.key))
      .map(({ key, delay, volume, loop, direct }) => ({
        key,
        delay,
        volume,
        loop,
        direct
      })),
    [
      {
        key: "finish-crowd",
        delay: 0,
        volume: 1.05,
        loop: false,
        direct: true
      },
      {
        key: "well-done",
        delay: 0,
        volume: 0.98,
        loop: false,
        direct: true
      }
    ]
  );
});

test("sample delays are scheduled on the audio context timeline", () => {
  const audio = new GameAudio();
  let scheduledAt = null;
  const source = {
    playbackRate: { value: 1 },
    connect() {},
    start(time) {
      scheduledAt = time;
    }
  };
  audio.unlock = () => {};
  audio.context = {
    currentTime: 3,
    createBufferSource: () => source,
    createGain: () => ({
      gain: { value: 0 },
      connect() {}
    })
  };
  audio.master = {};
  audio.buffers.set("finish-crowd", {});

  assert.equal(audio.playSample("finish-crowd", { delay: 0.18 }), true);
  assert.equal(scheduledAt, 3.18);
  assert.equal(audio.voices[0].startedAt, 3.18);
});

test("level clear multiplier yeah fades over its final 70 milliseconds", () => {
  const audio = new GameAudio();
  const automation = [];
  const source = {
    playbackRate: { value: 1 },
    connect() {},
    start() {}
  };
  audio.unlock = () => {};
  audio.context = {
    currentTime: 4,
    createBufferSource: () => source,
    createGain: () => ({
      gain: {
        value: 0,
        setValueAtTime(value, time) {
          automation.push(["set", value, time]);
        },
        linearRampToValueAtTime(value, time) {
          automation.push(["ramp", value, time]);
        }
      },
      connect() {}
    })
  };
  audio.master = {};
  audio.buffers.set("level-clear", { duration: 0.52 });

  assert.equal(audio.playSample("level-clear"), true);
  assert.equal(SFX_DEFINITIONS["level-clear"].fadeOutMs, 70);
  assert.deepEqual(
    automation.map(([method, value, time]) => [method, value, Math.round(time * 1000) / 1000]),
    [
    ["set", 0.4, 4],
    ["set", 0.4, 4.45],
    ["ramp", 0.0001, 4.52]
    ]
  );
});

test("Dune finish cues bypass the Mossfall master attenuation", () => {
  const audio = new GameAudio();
  const connections = [];
  const source = {
    playbackRate: { value: 1 },
    connect(node) {
      connections.push(["source", node]);
    },
    start() {}
  };
  const gain = {
    gain: { value: 0 },
    connect(node) {
      connections.push(["gain", node]);
    }
  };
  const destination = {};
  audio.unlock = () => {};
  audio.context = {
    currentTime: 2,
    destination,
    createBufferSource: () => source,
    createGain: () => gain
  };
  audio.master = {};
  audio.buffers.set("finish-crowd", { duration: 4.44 });

  assert.equal(audio.playSample("finish-crowd", {
    volume: 1.05,
    direct: true
  }), true);
  assert.equal(gain.gain.value, 0.72 * 1.05);
  assert.equal(connections.at(-1)[1], destination);
});

test("result exit stops every active victory voice", () => {
  const audio = new GameAudio();
  let stopped = 0;
  audio.voices = [
    {
      key: "finish-crowd",
      group: "victory",
      source: { stop: () => (stopped += 1) }
    },
    {
      key: "well-done",
      group: "victory",
      source: { stop: () => (stopped += 1) }
    },
    {
      key: "result-count",
      group: null,
      source: { stop: () => (stopped += 100) }
    }
  ];

  audio.stopVictory();

  assert.equal(stopped, 2);
  assert.deepEqual(audio.voices.map((voice) => voice.key), ["result-count"]);
  assert.equal(audio.snapshot().active_victory_voice_count, 0);
  assert.deepEqual(audio.snapshot().active_victory_keys, []);
});

test("debug history is copied and bounded", () => {
  const audio = new GameAudio();
  audio.setPhase("GAMEPLAY");
  for (let index = 0; index < 260; index += 1) {
    audio.recordPlay("ball-impact", "sample", false);
  }
  const snapshot = audio.snapshot();
  assert.equal(snapshot.audio_play_history.length, 240);
  assert.equal(snapshot.audio_play_history[0].phase, "GAMEPLAY");
  snapshot.audio_play_history[0].phase = "mutated";
  assert.equal(audio.snapshot().audio_play_history[0].phase, "GAMEPLAY");
});

test("restart cleanup preserves the active confirmation voice", () => {
  const audio = new GameAudio();
  let confirmStopped = false;
  let impactStopped = false;
  audio.voices = [
    {
      key: "ui-confirm",
      source: { stop: () => (confirmStopped = true) }
    },
    {
      key: "ball-impact",
      source: { stop: () => (impactStopped = true) }
    }
  ];

  audio.reset({ preserveKeys: ["ui-confirm"] });

  assert.equal(confirmStopped, false);
  assert.equal(impactStopped, true);
  assert.deepEqual(audio.voices.map((voice) => voice.key), ["ui-confirm"]);
});

test("run BGM begins with teaching and continues through gameplay", async () => {
  const audio = new GameAudio();
  let playCalls = 0;
  let pauseCalls = 0;
  let fadeDuration = 0;
  audio.wasUnlocked = true;
  audio.bgm = {
    currentTime: 12.5,
    duration: 60,
    volume: 0,
    paused: true,
    play() {
      playCalls += 1;
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      pauseCalls += 1;
      this.paused = true;
    }
  };
  audio.rampBgm = (target, duration, onComplete) => {
    audio.bgm.volume = target;
    fadeDuration = duration;
    onComplete?.();
  };

  audio.setPhase("TEACH_IN");
  assert.equal(audio.bgmSessionActive, true);
  assert.equal(playCalls, 1);
  await Promise.resolve();
  await Promise.resolve();

  audio.setPhase("LEVEL_INTRO");
  audio.setPhase("GAMEPLAY");

  assert.equal(fadeDuration, 480);
  assert.equal(audio.bgmSessionActive, true);
  assert.equal(audio.bgm.currentTime, 12.5);
  assert.equal(pauseCalls, 0);
  assert.equal(playCalls, 1);
});

test("result-page victory keeps BGM silent until both finish layers end", async () => {
  const audio = new GameAudio();
  const sources = [];
  let bgmPlayCalls = 0;
  let bgmPauseCalls = 0;

  audio.wasUnlocked = true;
  audio.phase = "LEVEL_CLEAR";
  audio.bgmSessionActive = true;
  audio.bgmStartedAt = 1;
  audio.bgm = {
    currentTime: 12.5,
    duration: 60,
    volume: BGM_TRACK.volume,
    paused: false,
    play() {
      bgmPlayCalls += 1;
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      bgmPauseCalls += 1;
      this.paused = true;
    }
  };
  audio.rampBgm = (target, _duration, onComplete) => {
    audio.bgm.volume = target;
    onComplete?.();
  };
  audio.ensureBgm = () => audio.bgm;
  audio.preloadAll = () => Promise.resolve([]);
  audio.context = {
    state: "running",
    currentTime: 5,
    destination: {},
    createBufferSource() {
      const source = {
        playbackRate: { value: 1 },
        connect() {},
        start() {},
        stop() {}
      };
      sources.push(source);
      return source;
    },
    createGain: () => ({
      gain: { value: 0 },
      connect() {}
    })
  };
  audio.master = {};
  audio.buffers.set("finish-crowd", { duration: 4.44 });
  audio.buffers.set("well-done", { duration: 1.2 });

  audio.victory();

  assert.equal(bgmPauseCalls, 0);
  assert.equal(bgmPlayCalls, 0);
  assert.equal(audio.bgm.volume, 0);
  assert.deepEqual(audio.snapshot().active_victory_keys, [
    "finish-crowd",
    "well-done"
  ]);

  sources[1].onended();
  assert.equal(bgmPlayCalls, 0);
  assert.deepEqual(audio.snapshot().active_victory_keys, ["finish-crowd"]);

  sources[0].onended();
  await Promise.resolve();

  assert.equal(bgmPlayCalls, 0);
  assert.equal(audio.bgmSessionActive, true);
  assert.equal(audio.bgm.volume, BGM_TRACK.volume);
  assert.deepEqual(audio.snapshot().active_victory_keys, []);
});

test("interrupted result-page victory keeps the media session warm until cues recover", () => {
  const audio = new GameAudio();
  const sources = [];
  let bgmPlayCalls = 0;
  let bgmPauseCalls = 0;

  audio.wasUnlocked = true;
  audio.phase = "RESULT_CALC";
  audio.bgmSessionActive = true;
  audio.bgmStartedAt = 1;
  audio.bgm = {
    currentTime: 12.5,
    duration: 60,
    volume: BGM_TRACK.volume,
    paused: false,
    play() {
      bgmPlayCalls += 1;
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      bgmPauseCalls += 1;
      this.paused = true;
    }
  };
  audio.ensureBgm = () => audio.bgm;
  audio.preloadAll = () => Promise.resolve([]);
  audio.unlock = async () => false;
  audio.context = {
    state: "interrupted",
    currentTime: 5,
    destination: {},
    createBufferSource() {
      const source = {
        playbackRate: { value: 1 },
        connect() {},
        start() {},
        stop() {}
      };
      sources.push(source);
      return source;
    },
    createGain: () => ({
      gain: {
        value: 0,
        setValueAtTime() {},
        linearRampToValueAtTime() {}
      },
      connect() {}
    })
  };
  audio.master = {};
  audio.buffers.set("finish-crowd", { duration: 4.44 });
  audio.buffers.set("well-done", { duration: 1.2 });

  try {
    audio.victory();
    assert.equal(bgmPauseCalls, 0);
    assert.equal(bgmPlayCalls, 0);
    assert.equal(audio.bgm.currentTime, 12.5);
    assert.equal(audio.bgm.volume, 0);
    assert.deepEqual(audio.snapshot().pending_cue_keys, [
      "finish-crowd",
      "well-done"
    ]);

    for (const cue of audio.pendingCues.values()) {
      cue.expiresAtMs = -Infinity;
    }
    audio.flushPendingCues();

    assert.equal(bgmPlayCalls, 0);
    assert.equal(audio.snapshot().victory_bgm_hold, true);
    assert.deepEqual(audio.snapshot().pending_cue_keys, [
      "finish-crowd",
      "well-done"
    ]);

    audio.context.state = "running";
    audio.flushPendingCues();

    assert.deepEqual(audio.snapshot().pending_cue_keys, []);
    assert.deepEqual(audio.snapshot().active_victory_keys, [
      "finish-crowd",
      "well-done"
    ]);
    assert.equal(sources.length, 2);
    assert.equal(bgmPlayCalls, 0);
  } finally {
    audio.destroy();
  }
});

/* 全球榜（K6）接在结算板后面。计分音的 validPhases 原本只写了 RESULT_CALC，
   于是那一屏的 cue 会被当成过期的丢掉 —— 整屏是哑的，而且不报错。 */
test("standing screen keeps the result cues alive across the phase change", () => {
  const audio = new GameAudio();
  audio.unlock = async () => true;

  audio.phase = "GLOBAL_RANK";
  audio.resultTick();
  audio.rank();
  const queued = audio.snapshot().pending_cue_count;
  assert.ok(
    queued > 0,
    "result cues must survive the GLOBAL_RANK phase, not be discarded"
  );

  /* 切到一个无关阶段才该丢 */
  audio.setPhase("MODE_SELECT");
  assert.equal(audio.snapshot().pending_cue_count, 0);
  audio.destroy();
});
