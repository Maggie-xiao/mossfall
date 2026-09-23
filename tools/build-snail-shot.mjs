/**
 * 把 A05 蜗牛取样台打包成 dist/snail-shot.html。
 *
 * 和 build-ending-shot.mjs 同理：审片工具，不是交付物，所以不进 scripts/build.mjs。
 * 注意 scripts/build.mjs 会 `rm -rf dist/`，要看蜗牛就在 build 之后补跑一次。
 *
 *   node tools/build-snail-shot.mjs
 *   http://127.0.0.1:4317/snail-shot.html
 */

import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

const result = await build({
  entryPoints: [resolve(root, "tools", "snail-shot.entry.js")],
  bundle: true,
  format: "esm",
  target: ["chrome96"],
  write: false,
  sourcemap: false,
});
const js = result.outputFiles[0].text;

await writeFile(
  resolve(dist, "snail-shot.html"),
  `<!doctype html>
<meta charset="utf-8">
<title>snail shot — A05</title>
<style>
html,body{margin:0;background:#000;overflow:hidden}
canvas{display:block}
</style>
<script type="module">
${js}
</script>
`,
  "utf8"
);
console.log("Built dist/snail-shot.html");
