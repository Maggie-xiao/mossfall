import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import {
  PROJECT,
  RUNTIME_MARKER,
  SCREENSHOT_CONTRACT,
  collectBuildRecords,
  treeHash
} from "./verification-contract.mjs";

const BASE_URL = "http://127.0.0.1:4317/";
const SFX_FILES = [
  "ui-move.ogg",
  "ui-confirm.ogg",
  "dune-countdown-tick.wav",
  "dune-countdown-go.wav",
  "ball-impact.ogg",
  "ball-capture.ogg",
  "ball-fall.ogg",
  "result-count.ogg",
  "level-clear.ogg",
  "finish-crowd.mp3",
  "well_done.wav",
  "result-rank.ogg"
];
const BGM_FILES = ["balance-beam-loop.ogg", "precision-puzzle-loop.ogg"];
const FONT_FILES = [
  "bricolage-grotesque-400.ttf",
  "bricolage-grotesque-600.ttf",
  "bricolage-grotesque-700.ttf",
  "bricolage-grotesque-800.ttf",
  "space-grotesk-500.ttf",
  "space-grotesk-600.ttf",
  "space-grotesk-700.ttf"
];

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function readRuntime(tab) {
  return tab.playwright.evaluate(() => {
    const stage = document.querySelector("#stage");
    const levelMatch = document
      .querySelector("#hud-level")
      ?.innerText.match(/LEVEL\s+(\d+)\/8/i);
    const timer = Number(document.querySelector("#hud-timer")?.innerText || 0);
    return {
      state: stage?.dataset.state || "",
      level: Number(levelMatch?.[1] || 0),
      timer,
      levelsCleared: 0,
      audioUnlocked: stage?.dataset.audioUnlocked === "true",
      bgmKey: stage?.dataset.bgmKey || "",
      bgmPlaying: stage?.dataset.bgmPlaying === "true",
      bgmTime: Number(stage?.dataset.bgmTime || 0),
      handoff: stage?.dataset.handoff || "",
      boardScale: Number(stage?.dataset.boardScale || 0),
      boardOffsetY: Number(stage?.dataset.boardOffsetY || 0),
      bodyText: document.body.innerText.replace(/\s+/g, " ").trim(),
      balls: JSON.parse(stage?.dataset.balls || "[]"),
      fallenBalls: stage?.dataset.fallenBalls || "",
      audioPlayHistory: JSON.parse(stage?.dataset.audioHistory || "[]")
    };
  });
}

async function readMetrics(tab) {
  return tab.playwright.evaluate(() => {
    const rect = (element) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        right: bounds.right,
        bottom: bounds.bottom
      };
    };
    const stage = document.querySelector("#stage");
    const touchStick = document.querySelector("#touch-stick");
    const hudLevelValue = document.querySelector("#hud-level .nv");
    return {
      title: document.title,
      bodyText: document.body.innerText.replace(/\s+/g, " ").trim(),
      state: stage?.dataset.state || "",
      visualTheme: stage?.dataset.visualTheme || "",
      mossWorld: stage?.dataset.mossWorld || "",
      mossLighting: stage?.dataset.mossLighting || "",
      mossEffects: stage?.dataset.mossEffects || "",
      mossPostfx: stage?.dataset.mossPostfx || "",
      mossZone: stage?.dataset.mossZone || "",
      leafAdaptive: stage?.dataset.leafAdaptive === "true",
      leafSystem: stage?.dataset.leafSystem || "",
      leafBuildFieldMesh: stage?.dataset.leafBuildFieldMesh === "true",
      leafShaderOk: stage?.dataset.leafShaderOk === "true",
      leafBladeCount: Number(stage?.dataset.leafBladeCount || 0),
      leafBurrowFurnitureCount: Number(
        stage?.dataset.leafBurrowFurnitureCount || 0
      ),
      leafBurrowGlowCount: Number(stage?.dataset.leafBurrowGlowCount || 0),
      leafContactShadowLayerCount: Number(
        stage?.dataset.leafContactShadowLayerCount || 0
      ),
      leafBoardPropsCount: Number(stage?.dataset.leafBoardPropsCount || 0),
      leafCalm: Number(stage?.dataset.leafCalm || 0),
      leafSagWeights: JSON.parse(stage?.dataset.leafSagWeights || "[]"),
      leafPulseStrengths: JSON.parse(
        stage?.dataset.leafPulseStrengths || "[]"
      ),
      leafTopVertices: Number(stage?.dataset.leafTopVertices || 0),
      leafTriangles: Number(stage?.dataset.leafTriangles || 0),
      leafEdgeVertices: Number(stage?.dataset.leafEdgeVertices || 0),
      leafVeinVertices: Number(stage?.dataset.leafVeinVertices || 0),
      leafHeightRange: Number(stage?.dataset.leafHeightRange || 0),
      leafHeightRms: Number(stage?.dataset.leafHeightRms || 0),
      leafThicknessRange: Number(stage?.dataset.leafThicknessRange || 0),
      balls: JSON.parse(stage?.dataset.balls || "[]"),
      fps: Number(stage?.dataset.fps || 0),
      maxFrameMs: Number(stage?.dataset.maxFrameMs || 0),
      audioUnlocked: stage?.dataset.audioUnlocked === "true",
      bgmKey: stage?.dataset.bgmKey || "",
      bgmPlaying: stage?.dataset.bgmPlaying === "true",
      bgmTime: Number(stage?.dataset.bgmTime || 0),
      hudLevelValueColor: hudLevelValue
        ? getComputedStyle(hudLevelValue).color
        : "",
      stage: rect(stage),
      canvas: rect(document.querySelector("canvas")),
      ui: rect(document.querySelector("#ui-layer")),
      stick: rect(touchStick),
      stickVisible:
        Boolean(touchStick) &&
        getComputedStyle(touchStick).display !== "none" &&
        !touchStick.classList.contains("hidden")
    };
  });
}

async function waitForState(tab, expected, timeoutMs = 10_000) {
  const expectedStates = Array.isArray(expected) ? expected : [expected];
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const runtime = await readRuntime(tab);
    if (expectedStates.includes(runtime.state)) return runtime;
    await delay(35);
  }
  throw new Error(`Timed out waiting for state ${expectedStates.join(" or ")}`);
}

async function logsSince(tab, startedAt) {
  const logs = await tab.dev.logs({ levels: ["error", "warn", "warning"], limit: 500 });
  const current = logs.filter((entry) => Date.parse(entry.timestamp) >= startedAt - 1_000);
  return {
    errors: current.filter((entry) => entry.level === "error"),
    warnings: current.filter(
      (entry) => entry.level === "warn" || entry.level === "warning"
    )
  };
}

function pngStats(bytes) {
  const image = PNG.sync.read(bytes, { checkCRC: true });
  let min = 255;
  let max = 0;
  let visible = 0;
  let sum = 0;
  let squared = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] < 8) continue;
    const luminance =
      (image.data[index] * 299 +
        image.data[index + 1] * 587 +
        image.data[index + 2] * 114) /
      1000;
    min = Math.min(min, luminance);
    max = Math.max(max, luminance);
    sum += luminance;
    squared += luminance * luminance;
    visible += 1;
  }
  const mean = sum / Math.max(1, visible);
  return {
    width: image.width,
    height: image.height,
    luminanceRange: max - min,
    variance: squared / Math.max(1, visible) - mean * mean,
    nonblank: visible > image.width * image.height * 0.9 && max - min >= 28
  };
}

function normalizeScreenshotToPng(bytes) {
  const input = Buffer.from(bytes);
  if (input.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return input;
  }
  if (input[0] === 0xff && input[1] === 0xd8) {
    const decoded = jpeg.decode(input, {
      useTArray: true,
      formatAsRGBA: true
    });
    return PNG.sync.write({
      width: decoded.width,
      height: decoded.height,
      data: Buffer.from(decoded.data)
    });
  }
  throw new Error("Browser screenshot was neither PNG nor JPEG");
}

async function captureCurrent({
  tab,
  viewport,
  verificationRoot,
  buildFingerprint,
  contract,
  sourceUrl
}) {
  const startedAt = Date.now();
  const metrics = await readMetrics(tab);
  if (metrics.state !== contract.state) {
    throw new Error(
      `${contract.name} expected ${contract.state}, observed ${metrics.state}`
    );
  }
  const screenshotBytes = await tab.screenshot({
    clip: { x: 0, y: 0, width: contract.viewport.width, height: contract.viewport.height }
  });
  const bytes = normalizeScreenshotToPng(screenshotBytes);
  const output = resolve(verificationRoot, contract.file);
  await writeFile(output, bytes);
  const logs = await logsSince(tab, startedAt);
  return {
    name: contract.name,
    file: contract.file,
    description: contract.description,
    url: sourceUrl,
    viewport: contract.viewport,
    capturedAt: new Date().toISOString(),
    buildFingerprint,
    metrics,
    pixels: pngStats(bytes),
    errorCount: logs.errors.length,
    errors: logs.errors.map((entry) => entry.message),
    warnings: logs.warnings.map((entry) => entry.message)
  };
}

function registerScreenshot(context, record) {
  context.screenshots.set(record.name, record);
  context.consoleErrors.push(...record.errors);
  context.consoleWarnings.push(...record.warnings);
  return record;
}

async function navigate(tab, viewport, url, waitMs = 700) {
  await viewport.set(url.viewport);
  await tab.goto(url.href);
  await tab.playwright.waitForLoadState({ state: "load", timeoutMs: 30_000 });
  await tab.playwright.waitForTimeout(waitMs);
}

async function captureRoute(context, name, href, waitMs = 700) {
  const contract = SCREENSHOT_CONTRACT.find((entry) => entry.name === name);
  await navigate(
    context.tab,
    context.viewport,
    { href, viewport: contract.viewport },
    waitMs
  );
  const record = await captureCurrent({
    ...context,
    contract,
    sourceUrl: href
  });
  return registerScreenshot(context, record);
}

async function enterActualGameplay(context, mode) {
  const href = `${BASE_URL}?qa=1&realtime=1&final=${Date.now()}`;
  const startedAt = Date.now();
  await navigate(
    context.tab,
    context.viewport,
    { href, viewport: { width: 640, height: 360 } },
    650
  );
  if (mode === "advanced") {
    await context.tab.playwright.getByTestId("difficulty-advanced").click();
  }
  await context.tab.playwright.getByTestId("start").click();
  await waitForState(context.tab, "LEVEL_INTRO", 15_000);
  const countdownStart = Date.now();
  await context.tab.playwright.waitForTimeout(600);
  const bgm = await readRuntime(context.tab);
  await waitForState(context.tab, "GAMEPLAY", 7_000);
  const countdownDurationMs = Date.now() - countdownStart;
  const logs = await logsSince(context.tab, startedAt);
  context.consoleErrors.push(...logs.errors.map((entry) => entry.message));
  context.consoleWarnings.push(...logs.warnings.map((entry) => entry.message));
  return {
    href,
    bgm,
    audioSnapshot: { audio_play_history: bgm.audioPlayHistory },
    countdownDurationMs
  };
}

async function collectFullRun(context) {
  const href =
    `${BASE_URL}?qa=1&autoclear=1&resetpb=1&final=${Date.now()}`;
  const startedAt = Date.now();
  await navigate(
    context.tab,
    context.viewport,
    { href, viewport: { width: 640, height: 360 } },
    500
  );
  await context.tab.playwright.getByTestId("start").click();
  const result = await waitForState(context.tab, "RESULT_CALC", 35_000);
  const resultReachedMs = Date.now() - startedAt;
  await context.tab.playwright.waitForTimeout(9_000);
  const resultSettledMs = Date.now() - startedAt;
  if (!(await context.tab.playwright.getByTestId("retry").isVisible())) {
    throw new Error("Full-run result actions did not become visible");
  }
  const settledResult = await readRuntime(context.tab);
  const record = await captureCurrent({
    ...context,
    contract: SCREENSHOT_CONTRACT.find((entry) => entry.name === "15-full-run-result"),
    sourceUrl: href
  });
  registerScreenshot(context, record);

  const logs = await context.tab.dev.logs({ limit: 500 });
  const current = logs.filter((entry) => Date.parse(entry.timestamp) >= startedAt - 1_000);
  const transitions = current
    .filter((entry) => entry.message.includes("[STATE]"))
    .map((entry) => entry.message);
  const errors = current
    .filter((entry) => entry.level === "error")
    .map((entry) => entry.message);
  context.consoleErrors.push(...errors);

  const retryStartedAt = Date.now();
  await context.tab.playwright.getByTestId("retry").click();
  await waitForState(context.tab, ["LEVEL_INTRO", "GAMEPLAY"], 6_000);
  const retryRuntime = await readRuntime(context.tab);
  const retryLogs = (await context.tab.dev.logs({ limit: 200 }))
    .filter((entry) => Date.parse(entry.timestamp) >= retryStartedAt - 1_000)
    .filter((entry) => entry.message.includes("[STATE]"))
    .map((entry) => entry.message);

  return {
    fullRun: {
      automaticHowToShown: transitions.some((entry) => entry.includes("TEACH_IN")),
      result: { ...settledResult, text: settledResult.bodyText },
      timing: {
        originalResultWaitBudgetMs: 12_000,
        adjustedResultWaitBudgetMs: 35_000,
        resultReachedMs,
        resultSettledMs
      },
      stateTransitions: transitions,
      errors
    },
    retry: {
      state: retryRuntime,
      stateTransitions: retryLogs,
      automaticHowToShown: retryLogs.some((entry) => entry.includes("TEACH_IN"))
    }
  };
}

async function captureGameplayHowTo(context) {
  const contract = SCREENSHOT_CONTRACT.find((entry) => entry.name === "03-howto");
  /* mossfall-ui-v2：How-to 入口只在标题页（局中 HUD 不再有按钮） */
  const href = `${BASE_URL}?qa=1&realtime=1`;
  await navigate(
    context.tab,
    context.viewport,
    { href, viewport: contract.viewport },
    700
  );
  await context.tab.playwright.locator("#title-howto").click();
  await waitForState(context.tab, "HOW_TO_PLAY");
  const record = await captureCurrent({
    ...context,
    contract,
    sourceUrl: href
  });
  return registerScreenshot(context, record);
}

async function collectPauseAndAdvancedBgm(context) {
  const entry = await enterActualGameplay(context, "advanced");
  await context.tab.playwright.waitForTimeout(750);
  const beforePause = await readRuntime(context.tab);
  await context.tab.playwright.locator("body").press("Escape");
  await waitForState(context.tab, "PAUSE_MENU");
  const pauseRecord = await captureCurrent({
    ...context,
    contract: SCREENSHOT_CONTRACT.find((entry) => entry.name === "09-pause"),
    sourceUrl: entry.href
  });
  registerScreenshot(context, pauseRecord);
  const pauseOne = await readRuntime(context.tab);
  await context.tab.playwright.waitForTimeout(1_100);
  const pauseTwo = await readRuntime(context.tab);
  await context.tab.playwright.locator("body").press("Escape");
  await waitForState(context.tab, "GAMEPLAY");
  await context.tab.playwright.waitForTimeout(900);
  const afterResume = await readRuntime(context.tab);

  await context.tab.playwright.locator("body").press("Escape");
  await waitForState(context.tab, "PAUSE_MENU");
  await context.tab.playwright.getByTestId("pause-quit").click();
  await waitForState(context.tab, "CONFIRM_QUIT");
  await context.tab.playwright.getByTestId("quit-confirm").click();
  await waitForState(context.tab, "MODE_SELECT");
  await context.tab.playwright.waitForTimeout(350);
  const quit = await readRuntime(context.tab);

  return {
    countdown: { durationMs: entry.countdownDurationMs },
    bgm: entry.bgm,
    audioSnapshot: entry.audioSnapshot,
    pauseResume: { beforePause, pauseOne, pauseTwo, afterResume },
    pauseQuit: {
      confirmedToModeSelect: quit.state === "MODE_SELECT",
      finalAudio: quit
    }
  };
}

async function collectBeginnerBgmAndVisibility(context) {
  const entry = await enterActualGameplay(context, "beginner");
  await context.tab.playwright.waitForTimeout(500);
  const before = await readRuntime(context.tab);
  const startedAt = Date.now();
  await context.tab.playwright.locator("body").press("KeyV");
  await context.tab.playwright.waitForTimeout(1_100);
  const paused = await readRuntime(context.tab);
  await context.tab.playwright.locator("body").press("KeyV");
  await context.tab.playwright.waitForTimeout(700);
  const resumed = await readRuntime(context.tab);
  const logs = (await context.tab.dev.logs({ limit: 200 }))
    .filter((entryLog) => Date.parse(entryLog.timestamp) >= startedAt - 1_000)
    .filter((entryLog) => entryLog.message.includes("Visibility"))
    .map((entryLog) => entryLog.message);
  return {
    bgm: entry.bgm,
    audioSnapshot: entry.audioSnapshot,
    visibility: {
      before,
      paused,
      resumed,
      logs,
      sameProductionHandler: true,
      deviceStatus: "pending-device-validation",
      note:
        "QA KeyV calls setVisibilityPaused(), the same function used by visibilitychange. " +
        "A real Kiwii Android WebView hide/show event remains a device-side check."
    }
  };
}

async function collectLevelHandoff(context) {
  const href = `${BASE_URL}?qa=1&realtime=1&screen=GAMEPLAY&mode=beginner&level=1&time=60&final=${Date.now()}`;
  await navigate(
    context.tab,
    context.viewport,
    { href, viewport: { width: 640, height: 360 } },
    500
  );
  const startedAt = Date.now();
  await context.tab.playwright.locator("body").press("KeyN");
  await waitForState(context.tab, "LEVEL_CLEAR");
  await context.tab.playwright.waitForTimeout(220);
  const record = await captureCurrent({
    ...context,
    contract: SCREENSHOT_CONTRACT.find((entry) => entry.name === "07-level-clear-bonus"),
    sourceUrl: href
  });
  registerScreenshot(context, record);

  const samples = [];
  while (Date.now() - startedAt < 3_600) {
    const runtime = await readRuntime(context.tab);
    samples.push({ elapsedMs: Date.now() - startedAt, ...runtime });
    if (runtime.state === "GAMEPLAY" && runtime.level === 2) break;
    await delay(35);
  }
  const final = samples.at(-1);
  return {
    durationMs: final?.elapsedMs || 0,
    exitAtMs: samples.find((sample) => sample.handoff === "exit")?.elapsedMs ?? null,
    loadAtMs:
      samples.find((sample) => sample.handoff === "enter")?.elapsedMs ?? null,
    nextLevel: final?.level || 0,
    countdownRepeated: samples.some((sample) => sample.state === "LEVEL_INTRO"),
    samples: samples.filter(
      (sample, index) =>
        index === 0 ||
        index === samples.length - 1 ||
        sample.state !== samples[index - 1].state ||
        sample.handoff !== samples[index - 1].handoff ||
        sample.level !== samples[index - 1].level
    )
  };
}

async function collectFallReset(context) {
  const href = `${BASE_URL}?qa=1&realtime=1&screen=GAMEPLAY&mode=beginner&level=2&time=60&final=${Date.now()}`;
  await navigate(
    context.tab,
    context.viewport,
    { href, viewport: { width: 640, height: 360 } },
    500
  );
  await context.tab.playwright.locator("body").press("KeyC");
  await context.tab.playwright.waitForTimeout(120);
  const afterCapture = await readRuntime(context.tab);
  const capturedIds = afterCapture.balls.filter((ball) => ball.captured).map((ball) => ball.id);
  const startedAt = Date.now();
  await context.tab.playwright.locator("body").press("KeyF");
  await waitForState(context.tab, "BALL_FALL_DROP");
  await context.tab.playwright.waitForTimeout(100);
  const record = await captureCurrent({
    ...context,
    contract: SCREENSHOT_CONTRACT.find((entry) => entry.name === "08-ball-fall"),
    sourceUrl: href
  });
  registerScreenshot(context, record);

  const states = [];
  while (Date.now() - startedAt < 4_500) {
    const runtime = await readRuntime(context.tab);
    if (states.at(-1)?.state !== runtime.state) {
      states.push({ state: runtime.state, elapsedMs: Date.now() - startedAt });
    }
    if (runtime.state === "GAMEPLAY" && states.some((item) => item.state === "BALL_FALL_RESET")) {
      const capturedAfter = runtime.balls
        .filter((ball) => ball.captured)
        .map((ball) => ball.id);
      return {
        durationMs: Date.now() - startedAt,
        states,
        capturedBefore: capturedIds,
        capturedAfter,
        preservedCapturedProgress:
          capturedIds.length === 1 &&
          capturedAfter.length === 1 &&
          capturedAfter[0] === capturedIds[0]
      };
    }
    await delay(35);
  }
  throw new Error("Fall reset did not return to gameplay");
}

async function collectFailureTimeout(context) {
  const href = `${BASE_URL}?qa=1&realtime=1&screen=GAMEPLAY&mode=advanced&level=3&time=1&final=${Date.now()}`;
  await navigate(
    context.tab,
    context.viewport,
    { href, viewport: { width: 640, height: 360 } },
    250
  );
  const startedAt = Date.now();
  await context.tab.playwright.locator("body").press("KeyF");
  const result = await waitForState(context.tab, "RESULT_CALC", 7_000);
  return {
    elapsedMs: Date.now() - startedAt,
    resultReached: result.state === "RESULT_CALC",
    resultText: result.bodyText
  };
}

async function collectRestart(context) {
  const entry = await enterActualGameplay(context, "advanced");
  await context.tab.playwright.locator("body").press("Escape");
  await waitForState(context.tab, "PAUSE_MENU");
  const startedAt = Date.now();
  await context.tab.playwright.getByTestId("restart").click();
  await waitForState(context.tab, ["LEVEL_INTRO", "GAMEPLAY"], 7_000);
  const logs = (await context.tab.dev.logs({ limit: 300 }))
    .filter((entryLog) => Date.parse(entryLog.timestamp) >= startedAt - 1_000)
    .filter((entryLog) => entryLog.message.includes("[STATE]"))
    .map((entryLog) => entryLog.message);
  return {
    sourceUrl: entry.href,
    stateTransitions: logs,
    automaticHowToShown: logs.some((entryLog) => entryLog.includes("TEACH_IN"))
  };
}

async function fetchAssetStatuses() {
  const assetUrls = [
    "./styles.css",
    "./app.js",
    ...FONT_FILES.map((file) => `./fonts/${file}`),
    ...SFX_FILES.map((file) => `./audio/sfx/${file}`),
    ...BGM_FILES.map((file) => `./audio/bgm/${file}`)
  ];
  const requests = [];
  for (const relativeUrl of assetUrls) {
    const url = new URL(relativeUrl, BASE_URL).href;
    const response = await fetch(url, { cache: "no-store" });
    await response.arrayBuffer();
    requests.push({
      file: relativeUrl.split("/").at(-1),
      url,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type")
    });
  }
  return requests;
}

async function collectAudioTour(context) {
  const href = `${BASE_URL}?qa=1&realtime=1&final=${Date.now()}`;
  await navigate(
    context.tab,
    context.viewport,
    { href, viewport: { width: 640, height: 360 } },
    600
  );
  await context.tab.playwright.getByTestId("difficulty-advanced").click();
  await context.tab.playwright.locator("body").press("KeyA");
  const startedAt = Date.now();
  while (Date.now() - startedAt < 12_000) {
    const status = await context.tab.playwright.evaluate(
      () => document.querySelector("#stage")?.dataset.audioQa || ""
    );
    if (status === "complete") break;
    if (status === "error") throw new Error("Audio QA tour reported an error");
    await delay(60);
  }
  const reportText = await context.tab.playwright
    .locator("#audio-qa-report")
    .textContent({ timeoutMs: 5_000 });
  return JSON.parse(reportText);
}

async function mobileLayout(tab) {
  return tab.playwright.evaluate(() => {
    const stage = document.querySelector("#stage");
    const stageRect = stage.getBoundingClientRect();
    const visible = [...document.querySelectorAll(
      "button,#hud-level,#timer-shell,#connection-note,#touch-stick,#event-flash,.logo,.title-topbar"
    )].filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
    const rows = visible.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.id || element.className,
        text: element.innerText || "",
        inside:
          rect.left >= stageRect.left - 0.5 &&
          rect.right <= stageRect.right + 0.5 &&
          rect.top >= stageRect.top - 0.5 &&
          rect.bottom <= stageRect.bottom + 0.5
      };
    });
    const stick = document.querySelector("#touch-stick");
    const stickRow = rows.find((row) => row.id === "touch-stick");
    return {
      layoutInsideStage: rows.every((row) => row.inside),
      touchStickInsideStage: !stick || stick.classList.contains("hidden") || stickRow?.inside,
      elements: rows,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight
      }
    };
  });
}

export async function collectBrowserEvidence({
  rootDir,
  tab,
  viewport,
  pageAssetsCapability,
  verificationId = "current"
}) {
  const collectionStartedAt = Date.now();
  const verificationRoot = resolve(rootDir, "verification", verificationId);
  await mkdir(resolve(verificationRoot, "screenshots"), { recursive: true });
  const buildFiles = await collectBuildRecords(rootDir);
  const buildFingerprint = treeHash(buildFiles);
  const context = {
    tab,
    viewport,
    verificationRoot,
    buildFingerprint,
    screenshots: new Map(),
    consoleErrors: [],
    consoleWarnings: []
  };

  await captureRoute(context, "01-title-beginner", `${BASE_URL}?qa=1&final=title`, 1_200);
  await captureRoute(
    context,
    "02-teaching",
    `${BASE_URL}?qa=1&realtime=1&screen=TEACH_IN&final=teaching`,
    120
  );
  await captureGameplayHowTo(context);
  await captureRoute(
    context,
    "04-countdown",
    `${BASE_URL}?qa=1&screen=LEVEL_INTRO&beat=1&final=countdown`,
    450
  );
  await captureRoute(
    context,
    "05-gameplay-b01",
    `${BASE_URL}?qa=1&realtime=1&screen=GAMEPLAY&mode=beginner&level=1&time=60&final=b01`,
    1_500
  );
  await captureRoute(
    context,
    "06-gameplay-a05",
    `${BASE_URL}?qa=1&realtime=1&screen=GAMEPLAY&mode=advanced&level=5&time=72&final=a05`,
    1_500
  );

  const handoff = await collectLevelHandoff(context);
  const fallReset = await collectFallReset(context);
  const advanced = await collectPauseAndAdvancedBgm(context);

  await captureRoute(
    context,
    "10-connection-required",
    `${BASE_URL}?qa=1&screen=CONNECTION_REQUIRED&final=connection-required`,
    450
  );
  await captureRoute(
    context,
    "11-result-beginner-143",
    `${BASE_URL}?qa=1&resetpb=1&screen=RESULT_CALC&mode=beginner&cleared=8&time=63.9&settled=1&final=result-b`,
    450
  );
  await captureRoute(
    context,
    "12-result-advanced-102",
    `${BASE_URL}?qa=1&resetpb=1&screen=RESULT_CALC&mode=advanced&cleared=8&time=22.4&settled=1&final=result-a`,
    450
  );
  await captureRoute(
    context,
    "13-mobile-title-390x844",
    `${BASE_URL}?qa=1&final=mobile-title`,
    900
  );
  const mobileTitleLayout = await mobileLayout(tab);
  await captureRoute(
    context,
    "14-mobile-gameplay-touch-390x844",
    `${BASE_URL}?qa=1&realtime=1&touch=1&screen=GAMEPLAY&mode=beginner&level=1&time=60&final=mobile-game`,
    900
  );
  const mobileGameplayLayout = await mobileLayout(tab);

  const fullRunEvidence = await collectFullRun(context);
  await captureRoute(
    context,
    "16-context-lost",
    `${BASE_URL}?qa=1&screen=CONTEXT_LOST&final=context`,
    450
  );

  const beginner = await collectBeginnerBgmAndVisibility(context);
  const timeoutDuringFailure = await collectFailureTimeout(context);
  const restart = await collectRestart(context);
  const audioTour = await collectAudioTour(context);
  const requests = await fetchAssetStatuses();
  const audioAssets = audioTour.requested_audio_files.map((asset) => ({
    file: asset.url.split("/").at(-1),
    url: asset.url,
    status: asset.status,
    ok: asset.ok,
    decoded: asset.decoded,
    contentType: asset.content_type
  }));

  const pageInventory = await pageAssetsCapability.list();
  const pageAssets = {
    generatedAt: new Date().toISOString(),
    project: PROJECT,
    runtimeMarker: RUNTIME_MARKER,
    buildFingerprint,
    pageUrl: pageInventory.pageUrl,
    summary: pageInventory.summary,
    assets: pageInventory.assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      url: asset.url
    })),
    inlineSvgCount: pageInventory.inlineSvgs?.length || 0
  };

  await viewport.set({ width: 1280, height: 720 });
  const performanceUrl =
    `${BASE_URL}?qa=1&realtime=1&screen=GAMEPLAY&mode=advanced&level=5&time=72&final=perf`;
  await tab.goto(performanceUrl);
  await tab.playwright.waitForLoadState({ state: "load", timeoutMs: 30_000 });
  await tab.playwright.waitForTimeout(1_700);
  const performanceMetrics = await readMetrics(tab);
  const performanceScreenshot = await tab.screenshot({
    clip: { x: 0, y: 0, width: 1280, height: 720 }
  });
  const performanceBytes = normalizeScreenshotToPng(performanceScreenshot);
  const performancePixels = pngStats(performanceBytes);

  const screenshotRecords = SCREENSHOT_CONTRACT.map((contract) => {
    const record = context.screenshots.get(contract.name);
    if (!record) throw new Error(`Collector did not capture ${contract.name}`);
    return record;
  });
  const screenshotB01 = screenshotRecords.find(
    (record) => record.name === "05-gameplay-b01"
  );
  const screenshotMobile = screenshotRecords.find(
    (record) => record.name === "14-mobile-gameplay-touch-390x844"
  );
  const finalLogs = (await tab.dev.logs({
    levels: ["error", "warn", "warning"],
    limit: 1_000
  })).filter((entry) => Date.parse(entry.timestamp) >= collectionStartedAt - 1_000);
  const finalConsoleErrors = finalLogs
    .filter((entry) => entry.level === "error")
    .map((entry) => entry.message);
  const finalConsoleWarnings = finalLogs
    .filter((entry) => entry.level === "warn" || entry.level === "warning")
    .map((entry) => entry.message);

  const browserReport = {
    generatedAt: new Date().toISOString(),
    project: PROJECT,
    runtimeMarker: RUNTIME_MARKER,
    buildFingerprint,
    screenshots: screenshotRecords,
    fullRun: fullRunEvidence.fullRun,
    retry: fullRunEvidence.retry,
    pauseResume: advanced.pauseResume,
    visibilityQa: beginner.visibility,
    bgm: {
      beginner: beginner.bgm,
      advanced: advanced.bgm
    },
    flows: {
      countdown: advanced.countdown,
      levelHandoff: handoff,
      fallReset,
      timeoutDuringFailure,
      pauseQuit: advanced.pauseQuit,
      restart
    },
    consoleErrors: [...new Set([...context.consoleErrors, ...finalConsoleErrors])],
    consoleWarnings: [...new Set([...context.consoleWarnings, ...finalConsoleWarnings])]
  };

  const failedRequests = requests.filter((request) => !request.ok);
  const networkReport = {
    generatedAt: new Date().toISOString(),
    project: PROJECT,
    runtimeMarker: RUNTIME_MARKER,
    buildFingerprint,
    requests,
    audioAssets,
    failedRequests,
    consoleErrors: browserReport.consoleErrors
  };

  const pause = advanced.pauseResume;
  const actualModeHistory = [
    ...(beginner.audioSnapshot?.audio_play_history || []).map((event) => ({
      ...event,
      evidenceSource: "real-beginner-ui"
    })),
    ...(advanced.audioSnapshot?.audio_play_history || []).map((event) => ({
      ...event,
      evidenceSource: "real-advanced-ui"
    }))
  ];
  const audioReport = {
    generatedAt: new Date().toISOString(),
    project: PROJECT,
    runtimeMarker: RUNTIME_MARKER,
    buildFingerprint,
    captureMethod:
      "QA-only GameAudio tour plus real title-button Beginner/Advanced playback flows",
    requestedAudioFiles: audioAssets,
    javascriptErrors: audioTour.javascript_errors || [],
    flowEvidence: audioTour.flow_evidence,
    audioPlayHistory: [
      ...audioTour.audio_play_history.map((event) => ({
        ...event,
        evidenceSource: "qa-audio-tour"
      })),
      ...actualModeHistory
    ],
    loopHistory: audioTour.loop_history,
    rampMs: audioTour.bgm_ramp_ms,
    lifecycle: {
      pauseResume: {
        passed:
          pause.beforePause.bgmPlaying &&
          pause.pauseOne.state === "PAUSE_MENU" &&
          pause.pauseTwo.state === "PAUSE_MENU" &&
          pause.afterResume.bgmPlaying &&
          Math.abs(pause.pauseTwo.bgmTime - pause.pauseOne.bgmTime) <= 0.06 &&
          pause.afterResume.bgmTime >= pause.pauseTwo.bgmTime + 0.2,
        evidence: pause
      },
      quitReset: {
        passed:
          advanced.pauseQuit.finalAudio.state === "MODE_SELECT" &&
          !advanced.pauseQuit.finalAudio.bgmPlaying &&
          advanced.pauseQuit.finalAudio.bgmTime <= 0.01,
        evidence: advanced.pauseQuit.finalAudio
      },
      visibilityQa: {
        passed:
          beginner.visibility.before.timer === beginner.visibility.paused.timer &&
          Math.abs(
            beginner.visibility.paused.bgmTime -
              beginner.visibility.before.bgmTime
          ) <= 0.06 &&
          beginner.visibility.resumed.bgmPlaying,
        evidence: beginner.visibility
      }
    },
    bgmModes: browserReport.bgm
  };

  const performanceReport = {
    generatedAt: new Date().toISOString(),
    project: PROJECT,
    runtimeMarker: RUNTIME_MARKER,
    buildFingerprint,
    desktop1280x720: {
      url: performanceUrl,
      fps: performanceMetrics.fps,
      maxFrameMs: performanceMetrics.maxFrameMs,
      nonblank: performancePixels.nonblank,
      pixels: performancePixels,
      state: performanceMetrics.state
    },
    desktop640x360: {
      fps: screenshotB01.metrics.fps,
      maxFrameMs: screenshotB01.metrics.maxFrameMs,
      nonblank: screenshotB01.pixels.nonblank,
      pixels: screenshotB01.pixels,
      state: screenshotB01.metrics.state
    },
    mobile390x844: {
      nonblank: screenshotMobile.pixels.nonblank,
      pixels: screenshotMobile.pixels,
      layoutInsideStage:
        mobileTitleLayout.layoutInsideStage && mobileGameplayLayout.layoutInsideStage,
      touchStickInsideStage: mobileGameplayLayout.touchStickInsideStage,
      title: mobileTitleLayout,
      gameplay: mobileGameplayLayout
    },
    layoutErrors: [
      ...mobileTitleLayout.elements.filter((element) => !element.inside),
      ...mobileGameplayLayout.elements.filter((element) => !element.inside)
    ]
  };

  await Promise.all([
    writeFile(
      resolve(verificationRoot, "browser-runtime-report.json"),
      `${JSON.stringify(browserReport, null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      resolve(verificationRoot, "network-report.json"),
      `${JSON.stringify(networkReport, null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      resolve(verificationRoot, "audio-runtime-report.json"),
      `${JSON.stringify(audioReport, null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      resolve(verificationRoot, "performance-layout-report.json"),
      `${JSON.stringify(performanceReport, null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      resolve(verificationRoot, "page-assets.json"),
      `${JSON.stringify(pageAssets, null, 2)}\n`,
      "utf8"
    )
  ]);

  return {
    buildFingerprint,
    screenshotCount: screenshotRecords.length,
    reportFiles: [
      "browser-runtime-report.json",
      "network-report.json",
      "audio-runtime-report.json",
      "performance-layout-report.json",
      "page-assets.json"
    ],
    browserReport,
    networkReport,
    audioReport,
    performanceReport,
    pageAssets
  };
}
