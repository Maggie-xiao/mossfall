import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("WebView entry resources are local and do not require file access", async () => {
  const html = await readSource("src/index.html");
  const resourceUrls = [...html.matchAll(
    /<(?:script|link|img|audio|video|source)\b[^>]*(?:src|href)=["']([^"']+)["']/gi
  )].map((match) => match[1]);

  assert.ok(resourceUrls.includes("./styles.css"));
  assert.ok(resourceUrls.includes("./app.js"));
  assert.ok(
    resourceUrls.every(
      (url) =>
        url.startsWith("./") ||
        url.startsWith("data:")
    )
  );
  assert.doesNotMatch(html, /file:\/\/|content:\/\/|<base\b/i);
});

test("browser runtime makes no popup or cross-origin navigation assumptions", async () => {
  const sources = await Promise.all([
    "src/main.js",
    "src/controller.js",
    "src/input.js",
    "src/audio.js",
    "src/ui.js",
    "src/scene.js"
  ].map(readSource));
  const runtime = sources.join("\n");

  assert.doesNotMatch(
    runtime,
    /window\.open\(|location\.(?:assign|replace)\(|target\s*=\s*["']_blank["']/
  );
  assert.doesNotMatch(runtime, /file:\/\/|content:\/\//);
});

test("input lifecycle covers WebView cancellation, hide, restore, and cleanup", async () => {
  const source = await readSource("src/input.js");
  for (const eventName of [
    "pointercancel",
    "touchcancel",
    "lostpointercapture",
    "visibilitychange",
    "pagehide",
    "pageshow",
    "blur"
  ]) {
    assert.match(source, new RegExp(`["']${eventName}["']`));
  }
  assert.match(source, /stopPolling\(\)/);
  assert.match(source, /unbindTouch\(\)/);
  assert.match(source, /resetFallbackState\(\)/);
});

test("Canvas compatibility does not depend on roundRect", async () => {
  const sources = await Promise.all([
    "src/main.js",
    "src/controller.js",
    "src/ui.js",
    "src/scene.js",
    "src/mossfall/render/world.js",
    "src/mossfall/render/leaf.js"
  ].map(readSource));
  assert.doesNotMatch(sources.join("\n"), /\.roundRect\(/);
});

test("External Game activation is transport-bound and never inferred from URL, UA, or viewport", async () => {
  const [main, externalGame] = await Promise.all([
    readSource("src/main.js"),
    readSource("src/external-game.js")
  ]);
  assert.doesNotMatch(main, /params\.get\(["']surface["']\)/);
  assert.doesNotMatch(main, /userAgent|matchMedia/);
  assert.doesNotMatch(externalGame, /URLSearchParams|userAgent|matchMedia/);
  assert.match(externalGame, /__kiwiiExternalGameTransport/);
});

test("ordinary browser boot does not statically initialize the External Game candidate", async () => {
  const [main, controller, externalGame] = await Promise.all([
    readSource("src/main.js"),
    readSource("src/controller.js"),
    readSource("src/external-game.js")
  ]);
  assert.doesNotMatch(main, /from\s+["']\.\/external-game\.js["']/);
  assert.doesNotMatch(controller, /from\s+["']\.\/external-game\.js["']/);
  assert.match(main, /import\(["']\.\/external-game\.js["']\)/);
  assert.match(
    externalGame,
    /from\s+["']@kiwii\/game-sdk-external-game-candidate["']/
  );
});

test("External Game harness advances the authority epoch after restore", async () => {
  const source = await readSource("tools/serve-external-game-harness.mjs");
  const restoreIndex = source.indexOf("window.__harnessHost.emitRestore");
  const externalTopologyIndex = source.indexOf(
    'window.__harnessHost.emitTopology({\n          revision: "2"',
    restoreIndex
  );

  assert.ok(restoreIndex >= 0);
  assert.ok(externalTopologyIndex > restoreIndex);
  assert.match(
    source.slice(externalTopologyIndex, externalTopologyIndex + 240),
    /epoch:\s*"2"/
  );
  assert.match(
    source.slice(externalTopologyIndex, externalTopologyIndex + 320),
    /instance:\s*"33333333-3333-4333-8333-333333333333"/
  );
});

test("controller cancels its sole animation frame during cleanup", async () => {
  const source = await readSource("src/controller.js");
  assert.match(source, /this\.frameRequestId\s*=\s*requestAnimationFrame/);
  assert.match(source, /cancelAnimationFrame\(this\.frameRequestId\)/);
});

test("page exit invokes the one idempotent game-instance destroy path", async () => {
  const source = await readSource("src/main.js");
  assert.match(source, /bindPageLifecycleDestroy/);
  assert.match(source, /["']pagehide["']/);
  assert.match(source, /["']beforeunload["']/);
  assert.match(source, /await controller\.stopInputForDestroy\(\)/);
  assert.match(source, /closeHardwareTransport\(activePlatform\)/);
  assert.match(source, /externalGameRuntime\?\.close\(\)/);
  assert.ok(
    source.indexOf("await controller.stopInputForDestroy()") <
      source.indexOf("closeHardwareTransport(activePlatform)")
  );
  assert.doesNotMatch(source, /createDisplayRuntime|presentationEndpointId/);
});
