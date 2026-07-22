// Tiny static file server for fixtures. Serves both the new visual fixtures
// (tests/visual/fixtures) and the reused unit-test fixtures (tests/fixtures)
// over http://127.0.0.1:<port>/ so the content script (matches <all_urls>)
// runs on a real, deterministic origin.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export interface StaticServer {
  port: number;
  origin: string;
  close: () => Promise<void>;
}

/**
 * Start a static server rooted at `roots` (searched in order). Paths are
 * resolved relative to each root; the first file that exists wins.
 */
export async function startServer(roots: string[]): Promise<StaticServer> {
  const server = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const rel = urlPath.replace(/^\/+/, "");

    for (const root of roots) {
      const filePath = path.join(root, rel);
      // Contain within root — reject path traversal.
      if (!filePath.startsWith(root)) continue;
      try {
        const body = await readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
        res.end(body);
        return;
      } catch {
        // try next root
      }
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind server");
  const port = address.port;

  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
