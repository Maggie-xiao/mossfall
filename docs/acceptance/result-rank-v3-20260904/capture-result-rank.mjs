/*
 * V3 结算 / 全球榜验收截图
 *
 * 四个星级各拍两张：结算板（RESULT_CALC）与全球榜（GLOBAL_RANK）。
 * 走的是真实状态机——用 main.js 里的 QA 路由 ?screen=... 直接把一局的成绩
 * 摆好再进屏，而不是塞一份假 DOM 进去。假 DOM 拍出来的图只能证明我会写
 * HTML，证明不了游戏跑起来长这样。
 *
 * 星级来自 src/ui.js 的 scoreStars(score, drops, totalLevels)，TOTAL_LEVELS = 8：
 *   1★ cleared < 4
 *   2★ cleared >= 4
 *   3★ cleared >= 8 且 drops > 0
 *   4★ cleared >= 8 且 drops === 0
 *
 * 用法：node docs/acceptance/result-rank-v3-20260904/capture-result-rank.mjs
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
/* playwright-core 只在大厅仓装了一份，各游戏仓不重复装浏览器驱动。 */
const { chromium } = require("D:/KiwiiGit/Kiwii-AI/kiwii-lan-game-lobby/node_modules/playwright-core");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const ROOT = path.join(REPO, "dist");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav"
};

/* 四个档位。time 只影响分数（timePoints = floor(time)），不影响星级，
   但四张图分数各不相同，全球榜那屏才看得出差别。 */
const TIERS = [
  { stars: 1, cleared: 2, time: 11, drops: 4 },
  { stars: 2, cleared: 5, time: 23, drops: 2 },
  { stars: 3, cleared: 8, time: 34, drops: 1 },
  { stars: 4, cleared: 8, time: 52, drops: 0 }
];

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let file = path.join(ROOT, decodeURIComponent(url.pathname));
      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        file = path.join(file, "index.html");
        info = await stat(file).catch(() => null);
      }
      if (!info?.isFile() || !path.resolve(file).startsWith(path.resolve(ROOT))) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store"
      });
      createReadStream(file).pipe(res);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` })
    );
  });
}

async function main() {
  await mkdir(HERE, { recursive: true });
  const { server, base } = await startServer();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-angle=swiftshader",
      "--autoplay-policy=no-user-gesture-required"
    ]
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: "en-US"
  });
  const failures = [];
  context.on("weberror", (error) => failures.push(String(error.error())));

  try {
    for (const tier of TIERS) {
      const query = `mode=beginner&cleared=${tier.cleared}&time=${tier.time}&drops=${tier.drops}`;

      /* 结算板：settled 直接落到揭晓动画的终态，四行都印出来再拍。 */
      const result = await context.newPage();
      await result.goto(`${base}/index.html?screen=RESULT_CALC&${query}&settled=1`, {
        waitUntil: "load"
      });
      await result.waitForSelector('[data-screen="RESULT_CALC"] #result-next:not(.hidden)', {
        timeout: 20000
      });
      /* 星级由页面自己算，这里核对一次——参数写错了就该在这里炸，
         而不是等我肉眼数图上有几颗星。 */
      const litStars = await result.$$eval(
        '#result-stars .st use',
        (nodes) => nodes.filter((n) => n.getAttribute("href") === "#starC").length
      );
      if (litStars !== tier.stars) {
        throw new Error(`星级对不上：期望 ${tier.stars}★，页面渲染 ${litStars}★（${query}）`);
      }
      await result.waitForTimeout(400);
      await result.screenshot({ path: path.join(HERE, `star-${tier.stars}-result.png`) });
      await result.close();

      /* 全球榜：没有 settled 开关，等揭晓走完（1900ms 那一拍把按钮放出来）。 */
      const rank = await context.newPage();
      await rank.goto(`${base}/index.html?screen=GLOBAL_RANK&${query}`, { waitUntil: "load" });
      await rank.waitForSelector('[data-screen="GLOBAL_RANK"] #grank-action:not(.hidden)', {
        timeout: 20000
      });
      await rank.waitForTimeout(600);
      await rank.screenshot({ path: path.join(HERE, `star-${tier.stars}-rank.png`) });
      await rank.close();
    }
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures.length) {
    throw new Error(`页面报错：\n${failures.join("\n")}`);
  }

  /* 索引：文件名 + 尺寸 + SHA-256。下一次再跑，哪张图变了一眼就知道。 */
  const names = (await readdir(HERE)).filter((n) => n.endsWith(".png")).sort();
  const index = [];
  for (const name of names) {
    const buffer = await readFile(path.join(HERE, name));
    index.push({
      file: name,
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex")
    });
  }
  await writeFile(
    path.join(HERE, "index.json"),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), viewport: "1280x720", tiers: TIERS, shots: index }, null, 2)}\n`
  );
  console.log(index.map((s) => `${s.file}  ${s.width}x${s.height}  ${s.sha256.slice(0, 12)}`).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
