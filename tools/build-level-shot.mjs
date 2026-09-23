/**
 * 把关卡审片台打包成 dist/level-shot.html。
 *
 * 和 build-snail-shot.mjs 同理：审片工具，不是交付物，所以不进 scripts/build.mjs。
 * 注意 scripts/build.mjs 会 `rm -rf dist/`，要审片就在 build 之后补跑一次。
 *
 *   node scripts/build.mjs && node tools/build-level-shot.mjs
 *   node tools/shot-sink.mjs shots &
 *   http://127.0.0.1:4317/level-shot.html
 */

import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

const result = await build({
  entryPoints: [resolve(root, "tools", "level-shot.entry.js")],
  bundle: true,
  format: "esm",
  target: ["chrome96"],
  write: false,
  sourcemap: false
});
const js = result.outputFiles[0].text;

await writeFile(
  resolve(dist, "level-shot.html"),
  `<!doctype html>
<meta charset="utf-8">
<title>level shot — canon vs generated</title>
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
console.log("Built dist/level-shot.html");
