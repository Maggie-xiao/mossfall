import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const src = resolve(root, "src");
const dist = resolve(root, "dist");
const audioSourceDir = resolve(src, "audio", "sfx");
const audioDistDir = resolve(dist, "audio", "sfx");
const bgmSourceDir = resolve(src, "audio", "bgm");
const bgmDistDir = resolve(dist, "audio", "bgm");
const imageSourceDir = resolve(src, "images");
const imageDistDir = resolve(dist, "images");
const BGM_FILES = [
  "balance-beam-loop.ogg",
  "precision-puzzle-loop.ogg",
  "endless-moss-descent-loop.ogg"
];
const contentRevision = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 8);
const audioMime = (file) => {
  if (file.endsWith(".mp3")) return "audio/mpeg";
  if (file.endsWith(".wav")) return "audio/wav";
  return "audio/ogg";
};

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "fonts"), { recursive: true });
await mkdir(audioDistDir, { recursive: true });
await mkdir(bgmDistDir, { recursive: true });
await mkdir(imageDistDir, { recursive: true });

await build({
  entryPoints: [resolve(src, "main.js")],
  outfile: resolve(dist, "app.js"),
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome96"],
  legalComments: "inline",
  sourcemap: false
});

/* 字体清单 · 加字重要同时加到这里，否则下次 build 会静默丢掉它。
   来源：control-plane assets/fonts（Bricolage Grotesque 显示体 + Space Grotesk 数字体）。
   Cormorant Garamond 斜体只给 K5 的签语用，来自 dunesong 的 oracle（SIL OFL，
   见 src/fonts/OFL-cormorant.txt）。
   Luminari 是谢幕叶子上签语的指定字体（用户上传）。注意它是 macOS 自带的系统字体，
   随包分发是授权问题，交给用户定夺；这里按用户要求先内联进来。 */
const FONTS = [
  "bricolage-grotesque-400.ttf",
  "bricolage-grotesque-600.ttf",
  "bricolage-grotesque-700.ttf",
  "bricolage-grotesque-800.ttf",
  "space-grotesk-500.ttf",
  "space-grotesk-600.ttf",
  "space-grotesk-700.ttf",
  "cormorant-garamond-italic-400.woff2",
  "luminari.ttf"
];

/* 内联时的 mime 按扩展名走——woff2 报成 ttf 的话浏览器会拒绝加载。 */
const FONT_MIME = { ".ttf": "font/ttf", ".woff2": "font/woff2" };

/* 图片清单 · 跟 FONTS 一样是显式的：加图要同时加到这里，否则 build 会静默丢掉它，
   dist 里只剩一个 404 的 url()。目前只有 K1 封面页在用。
   来源：docs/ui-catalog/table-tilt-ui-v3.html 的 K1 段。 */
const IMAGES = [
  ["motion02-countdown.webp", "image/webp"],
  ["world-background-gold.png", "image/png"],
  ["world-background-green.png", "image/png"],
  ["world-background-blue.png", "image/png"],
  ["world-background-night.png", "image/png"]
];

const audioManifest = JSON.parse(
  await readFile(resolve(audioSourceDir, "audio-sources.json"), "utf8")
);
const AUDIO_FILES = audioManifest.assets.map((asset) => asset.file);

await Promise.all([
  cp(resolve(src, "index.html"), resolve(dist, "index.html")),
  cp(resolve(src, "mechanics-showcase.html"), resolve(dist, "mechanics-showcase.html")),
  cp(resolve(src, "teachin", "assets"), resolve(dist, "src", "teachin", "assets"), { recursive: true }),
  cp(resolve(src, "styles.css"), resolve(dist, "styles.css")),
  cp(resolve(root, "game-profile.json"), resolve(dist, "game-profile.json")),
  ...FONTS.map((file) => cp(resolve(src, "fonts", file), resolve(dist, "fonts", file))),
  ...AUDIO_FILES.map((file) =>
    cp(resolve(audioSourceDir, file), resolve(audioDistDir, file))
  ),
  ...BGM_FILES.map((file) =>
    cp(resolve(bgmSourceDir, file), resolve(bgmDistDir, file))
  ),
  ...IMAGES.map(([file]) =>
    cp(resolve(imageSourceDir, file), resolve(imageDistDir, file))
  )
]);

const html = await readFile(resolve(dist, "index.html"), "utf8");
const css = await readFile(resolve(dist, "styles.css"), "utf8");
const js = await readFile(resolve(dist, "app.js"), "utf8");
const cssRevision = contentRevision(css);
const jsRevision = contentRevision(js);
const versionedHtml = html
  .replace("./styles.css", `./styles.css?v=${cssRevision}`)
  .replace("./app.js", `./app.js?v=${jsRevision}`);
if (versionedHtml === html) {
  throw new Error("Release entry resources were not content-versioned");
}
await writeFile(resolve(dist, "index.html"), versionedHtml, "utf8");

/* standalone 版把字体内联成 base64——离线包不能依赖外部文件 */
let standaloneCss = css;
let standaloneHtml = html;
let standaloneJs = js;
for (const file of FONTS) {
  const bytes = await readFile(resolve(dist, "fonts", file));
  const mime = FONT_MIME[file.slice(file.lastIndexOf("."))] || "font/ttf";
  standaloneCss = standaloneCss.replace(
    new RegExp(`url\\(["']?fonts/${file.replace(/[.]/g, "\\.")}["']?\\)`, "g"),
    `url(data:${mime};base64,${bytes.toString("base64")})`
  );
}
if (standaloneCss.includes("url(fonts/") || standaloneCss.includes('url("fonts/')) {
  throw new Error("Standalone release still references an external font file");
}

/* 封面图同理内联——离线包不能依赖外部文件。走的是和字体一模一样的 url() 替换，
   因为 K1 有意用 CSS background 而不是 <img src>，就为了能复用这一段。 */
for (const [file, mime] of IMAGES) {
  const bytes = await readFile(resolve(src, "images", file));
  standaloneCss = standaloneCss.replace(
    new RegExp(`url\\(["']?images/${file.replace(/[.]/g, "\\.")}["']?\\)`, "g"),
    `url(data:${mime};base64,${bytes.toString("base64")})`
  );
  standaloneHtml = standaloneHtml
    .split(`./images/${file}`)
    .join(`data:${mime};base64,${bytes.toString("base64")}`);
  standaloneJs = standaloneJs
    .split(`./images/${file}`)
    .join(`data:${mime};base64,${bytes.toString("base64")}`);
}
if (/url\(["']?images\//.test(standaloneCss)) {
  throw new Error("Standalone release still references an external image file");
}
if (standaloneHtml.includes("./images/")) {
  throw new Error("Standalone release still references an external HTML image file");
}
if (standaloneJs.includes("./images/")) {
  throw new Error("Standalone release still references an external JavaScript image file");
}
for (const file of AUDIO_FILES) {
  const bytes = await readFile(resolve(audioSourceDir, file));
  const relativeUrl = `./audio/sfx/${file}`;
  const dataUrl = `data:${audioMime(file)};base64,${bytes.toString("base64")}`;
  standaloneJs = standaloneJs.split(relativeUrl).join(dataUrl);
}
for (const file of BGM_FILES) {
  const bgmBytes = await readFile(resolve(bgmSourceDir, file));
  standaloneJs = standaloneJs
    .split(`./audio/bgm/${file}`)
    .join(`data:audio/ogg;base64,${bgmBytes.toString("base64")}`);
}
if (standaloneJs.includes("./audio/sfx/")) {
  throw new Error("Standalone release still references an external audio file");
}
if (standaloneJs.includes("./audio/bgm/")) {
  throw new Error("Standalone release still references an external BGM file");
}

// Preserve the existing offline artifact by embedding every shipped frame atlas.
const teachinEmbedded = {};
const teachinAssets = resolve(src, "teachin", "assets");
for (const action of await readdir(teachinAssets, { withFileTypes: true })) {
  if (!action.isDirectory()) continue;
  for (const name of await readdir(resolve(teachinAssets, action.name))) {
    if (!name.endsWith(".webp")) continue;
    const key = `src/teachin/assets/${action.name}/${name}`;
    const bytes = await readFile(resolve(teachinAssets, action.name, name));
    teachinEmbedded[key] = `data:image/webp;base64,${bytes.toString("base64")}`;
  }
}

const standalone = standaloneHtml
  .replace(
    '<link rel="stylesheet" href="./styles.css">',
    () => `<style>${standaloneCss}</style>`
  )
  .replace(
    '<script src="./app.js"></script>',
    () => `<script>globalThis.KiwiiTeachinEmbedded=${JSON.stringify(teachinEmbedded)};</script><script>${standaloneJs}</script>`
  );

if (standalone.includes('<script src="./app.js"></script>')) {
  throw new Error("Standalone release still references the external app bundle");
}

await writeFile(resolve(dist, "table-tilt-standalone.html"), standalone, "utf8");

for (const forbidden of ["references/keyframes", "contact_sheets", "source.mp4"]) {
  if (standalone.includes(forbidden)) {
    throw new Error(`Release contains forbidden reference path: ${forbidden}`);
  }
}

await Promise.all([
  cp(resolve(dist, "index.html"), resolve(root, "index.html")),
  cp(resolve(dist, "styles.css"), resolve(root, "styles.css")),
  cp(resolve(dist, "app.js"), resolve(root, "app.js")),
  cp(resolve(dist, "audio"), resolve(root, "audio"), { recursive: true }),
  cp(resolve(dist, "fonts"), resolve(root, "fonts"), { recursive: true }),
  cp(resolve(dist, "images"), resolve(root, "images"), { recursive: true }),
  cp(
    resolve(dist, "table-tilt-standalone.html"),
    resolve(root, "table-tilt-standalone.html")
  )
]);

console.log(
  "Built dist/index.html and dist/table-tilt-standalone.html; synced root preview files"
);
