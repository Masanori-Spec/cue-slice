import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve(process.argv[2] ?? "dist"),
  port = Number(process.env.PORT ?? 4173),
  basePath = process.env.BASE_PATH ?? "/";
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(basePath))
  throw Error("BASE_PATH must be / or /segment/.../");
const types = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
http
  .createServer(async (req, res) => {
    try {
      let path;
      try {
        path = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        );
      } catch {
        res.writeHead(400);
        return res.end("Bad URL");
      }
      if (!path.startsWith(basePath)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const relative = path.slice(basePath.length);
      const file = resolve(root, relative || "index.html");
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      if (!(await stat(file)).isFile()) throw Error();
      res.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`CueSlice: http://127.0.0.1:${port}${basePath}`),
  );
