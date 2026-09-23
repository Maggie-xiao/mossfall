/* 一次性的截图落盘服务：浏览器把 canvas 的 dataURL POST 过来，这边写成文件。
   Browser pane 不显示的时候 preview_screenshot 拿不到帧，只能页面自己截。 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(process.argv[2] || "shots");
mkdirSync(DIR, { recursive: true });

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.end();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const { name, data } = JSON.parse(body);
      const base64 = data.slice(data.indexOf(",") + 1);
      const file = resolve(DIR, name.replace(/[^\w.-]/g, "_"));
      writeFileSync(file, Buffer.from(base64, "base64"));
      console.log("wrote", file, Math.round(base64.length / 1365), "KB");
      res.end("ok");
    } catch (err) {
      console.error(err.message);
      res.statusCode = 400;
      res.end("bad");
    }
  });
}).listen(4318, () => console.log("shot sink -> " + DIR + " (port 4318)"));
