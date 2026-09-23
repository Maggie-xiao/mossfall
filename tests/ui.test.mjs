import test from "node:test";
import assert from "node:assert/strict";
import {
  GameUI,
  RESULT_TO_RANK_DWELL_MS,
  resultToRankTimeline
} from "../src/ui.js";

test("result holds exactly three seconds after its final data appears", () => {
  const timeline = resultToRankTimeline(2400);

  assert.equal(RESULT_TO_RANK_DWELL_MS, 3000);
  assert.equal(
    timeline.advanceAtMs - timeline.contentCompleteAtMs,
    RESULT_TO_RANK_DWELL_MS
  );
  assert.equal(timeline.contentCompleteAtMs - timeline.recordRevealAtMs, 350);
  assert.ok(timeline.readyAtMs < timeline.advanceAtMs);
});

/* GameUI 的构造函数要真 DOM，这里跟 controller 的测试同一套路子：
   直接挂原型，只喂被测方法真正碰到的那几个字段。 */
function makeNoteUI() {
  const timers = new Map();
  let nextId = 1;
  const previousWindow = globalThis.window;
  globalThis.window = {
    setTimeout(fn, ms) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };

  const note = { textContent: "" };
  const ui = Object.create(GameUI.prototype);
  Object.assign(ui, {
    connectionNote: note,
    connectionNoteText: "",
    connectionNoteTimer: 0
  });

  return {
    ui,
    note,
    /* 把已排的定时器全部立刻跑掉，代替真实的等待 */
    flush() {
      for (const [id, entry] of [...timers]) {
        timers.delete(id);
        entry.fn();
      }
    },
    pendingDelays: () => [...timers.values()].map((entry) => entry.ms),
    restore() {
      globalThis.window = previousWindow;
    }
  };
}

test("connection note appears immediately and is not rewritten every frame", () => {
  const harness = makeNoteUI();
  try {
    harness.ui.showConnectionNote("Board disconnected");
    assert.equal(harness.note.textContent, "Board disconnected");
    assert.deepEqual(harness.pendingDelays(), []);

    /* 局内每帧都会调用，同文案必须早退，不能反复写 DOM 或重排定时器 */
    harness.note.textContent = "sentinel";
    harness.ui.showConnectionNote("Board disconnected");
    assert.equal(harness.note.textContent, "sentinel");
    assert.deepEqual(harness.pendingDelays(), []);
  } finally {
    harness.restore();
  }
});

/* 板子接上的同一帧就把提示抹掉，玩家看不见「问题被自己修好了」这件事，
   只会看见一行字凭空消失。留半拍。 */
test("connection note holds for half a beat before it clears", () => {
  const harness = makeNoteUI();
  try {
    harness.ui.showConnectionNote("Board disconnected");
    harness.ui.showConnectionNote("");

    assert.equal(harness.note.textContent, "Board disconnected");
    assert.deepEqual(harness.pendingDelays(), [450]);

    harness.flush();
    assert.equal(harness.note.textContent, "");
    assert.equal(harness.ui.connectionNoteTimer, 0);
  } finally {
    harness.restore();
  }
});

test("a new problem during the hold cancels it and shows straight away", () => {
  const harness = makeNoteUI();
  try {
    harness.ui.showConnectionNote("Board disconnected");
    harness.ui.showConnectionNote("");
    harness.ui.showConnectionNote("Step back on the board");

    assert.equal(harness.note.textContent, "Step back on the board");
    /* 待清空的那个定时器必须被取消，否则半拍后它会把新提示一起抹掉 */
    assert.deepEqual(harness.pendingDelays(), []);

    harness.flush();
    assert.equal(harness.note.textContent, "Step back on the board");
  } finally {
    harness.restore();
  }
});

test("hiding the HUD drops the note and its pending hold", () => {
  const harness = makeNoteUI();
  try {
    Object.assign(harness.ui, {
      hud: { classList: { add() {}, remove() {} } },
      touchStick: null,
      touchKnob: null,
      timeBonus: { classList: { add() {}, remove() {} } }
    });

    harness.ui.showConnectionNote("Board disconnected");
    harness.ui.showConnectionNote("");
    harness.ui.hideHud();

    assert.equal(harness.note.textContent, "");
    assert.equal(harness.ui.connectionNoteText, "");
    assert.deepEqual(harness.pendingDelays(), []);
  } finally {
    harness.restore();
  }
});

test("gameplay touch fallback never reveals the legacy CoP visual", () => {
  const classList = (...initial) => {
    const values = new Set(initial);
    return {
      add: (...names) => names.forEach((name) => values.add(name)),
      remove: (...names) => names.forEach((name) => values.delete(name)),
      toggle(name, force) {
        if (force) values.add(name);
        else values.delete(name);
      },
      contains: (name) => values.has(name)
    };
  };
  const touchStick = {
    classList: classList("hidden"),
    setAttribute(name, value) {
      this[name] = value;
    }
  };
  const touchSurface = { classList: classList() };
  const ui = Object.create(GameUI.prototype);
  Object.assign(ui, {
    clearScreen() {},
    hud: { classList: classList("hidden") },
    touchStick,
    touchSurface,
    setLevel() {},
    setTimer() {},
    connectionNote: { textContent: "" },
    levelFlash: { classList: classList() },
    eventFlash: { classList: classList() }
  });

  ui.beginGameplay({ level: 1, timer: 60, touch: true });
  assert.equal(touchStick.classList.contains("hidden"), true);
  assert.equal(touchStick.classList.contains("interactive"), false);
  assert.equal(touchStick["aria-hidden"], "true");
  assert.equal(touchSurface.classList.contains("interactive"), true);

  ui.beginGameplay({ level: 1, timer: 60, touch: false });
  assert.equal(touchStick.classList.contains("hidden"), true);
  assert.equal(touchSurface.classList.contains("interactive"), false);
});
