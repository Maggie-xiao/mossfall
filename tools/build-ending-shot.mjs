/**
 * 把谢幕取样台打包成 dist/ending-shot.html。
 *
 * 单独一个脚本、不进 scripts/build.mjs：它是审片工具，不是交付物，不该跟着每次
 * build 一起产出。注意 scripts/build.mjs 会 `rm -rf dist/`，所以要看谢幕就在
 * build 之后补跑一次这个。
 *
 *   node tools/build-ending-shot.mjs
 *   http://127.0.0.1:4317/ending-shot.html
 */

import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

const result = await build({
  entryPoints: [resolve(root, "tools", "ending-shot.entry.js")],
  bundle: true,
  format: "esm",
  target: ["chrome96"],
  write: false,
  sourcemap: false,
});
const js = result.outputFiles[0].text;

/* 字体和游戏里同一份：签语的字号是按度量倒推的，取样台用 fallback 的话
   看到的行宽和线上不是一回事。 */
const css = await readFile(resolve(root, "src", "styles.css"), "utf8");
const face = css.match(/@font-face\s*\{[^}]*Luminari[^}]*\}/s)?.[0] ?? "";

await writeFile(
  resolve(dist, "ending-shot.html"),
  `<!doctype html>
<meta charset="utf-8">
<title>ending shot</title>
<style>
${face}
html,body{margin:0;background:#000;overflow:hidden}
canvas{display:block;width:100%;height:auto}
</style>
<script type="module">
${js}
</script>
`,
  "utf8"
);
console.log("Built dist/ending-shot.html");
