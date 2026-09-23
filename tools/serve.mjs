import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "dist");
const port = Number(process.env.PORT || process.argv[2] || 4317);
const host = process.env.HOST || process.argv[3] || "127.0.0.1";
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".wav": "audio/wav",
  ".webp": "image/webp"
};

createServer((request, response) => {
  const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
  console.log(`[REQ] ${request.socket.remoteAddress} ${request.method} ${request.url}`);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = normalize(join(root, relative));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    console.log(`[404] ${pathname}`);
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": mime[extname(file).toLowerCase()] || "application/octet-stream"
  });
  createReadStream(file).pipe(response);
}).listen(port, host, () => {
  console.log(`Moss Tilt: http://${host}:${port}/`);
});
