// Tiny dependency-free static server shared by the bundler playgrounds.
// Each playground's `dev` script builds to `dist/` in watch mode and serves the
// playground dir with this — open the printed URL to see the auto-imported
// component render in the browser.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

export function serve(root = process.cwd(), port = Number(process.env.PORT) || 8000) {
  createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (path.endsWith("/")) path += "index.html";
    try {
      const data = await readFile(join(root, path));
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }).listen(port, () => console.log(`\n  ▶ open http://localhost:${port}/\n`));
}

// Allow `node ../serve.mjs` standalone (used by the CLI-based playgrounds).
if (import.meta.url === `file://${process.argv[1]}`) serve();
