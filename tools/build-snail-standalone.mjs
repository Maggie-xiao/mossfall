#!/usr/bin/env node
/**
 * Bakes `tools/snail-standalone.template.html` plus the three.js CommonJS build
 * into one self-contained `dist/snail-standalone.html`.
 *
 * The file has to open by double-click from a mail attachment, and Chrome blocks
 * ES modules on `file://`, so three is injected as a classic script behind a
 * two-line CommonJS shim rather than imported. `three.cjs` pulls nothing in and
 * contains no `</script` sequence, so inlining it verbatim is safe.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = resolve(root, "tools/snail-standalone.template.html");
const THREE_CJS = resolve(root, "node_modules/three/build/three.cjs");
const OUT = resolve(root, "dist/snail-standalone.html");
const TOKEN = "/*__THREE__*/";

const template = readFileSync(TEMPLATE, "utf8");
const three = readFileSync(THREE_CJS, "utf8");

if (!template.includes(TOKEN)) {
  throw new Error(`template is missing the ${TOKEN} placeholder`);
}
// A stray `</script` inside the payload would close the tag early.
if (/<\/script/i.test(three)) {
  throw new Error("three.cjs contains a </script sequence and cannot be inlined");
}
// require() would be undefined in the browser; three's own bundle must not need it.
if (/\brequire\s*\(/.test(three)) {
  throw new Error("three.cjs calls require() — the CommonJS shim is not enough");
}

const shim = [
  "// three.js r" + (three.match(/REVISION\s*=\s*['\"]([^'\"]+)/)?.[1] ?? "?") +
    " (CommonJS build, inlined so this file runs straight off the disk)",
  "(function () {",
  "var module = { exports: {} }; var exports = module.exports;",
  three,
  "window.THREE = module.exports;",
  "})();",
].join("\n");

const html = template.replace(TOKEN, () => shim);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(`snail-standalone -> ${OUT}`);
console.log(`  three ${kb(three.length)} + page ${kb(template.length)} = ${kb(html.length)}`);
