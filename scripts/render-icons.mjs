// Rasterizes icons/mark.svg into the PNGs Chrome asks for.
//
// This machine has no SVG rasterizer (no rsvg-convert, no ImageMagick, and
// QuickLook declines to thumbnail an SVG), so the browser does the drawing and
// this script does the writing. It serves the project, opens the renderer,
// takes the PNGs back over POST, and exits.
//
//     node scripts/render-icons.mjs        # serve, then open the printed URL
//
// icons/render.html can also be opened by hand off any static server; it has a
// "Download all" button that drops the same four files in ~/Downloads.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ICONS = join(ROOT, "icons");
const PORT = 8766;
const EXPECTED_SIZES = [16, 32, 48, 128];

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
};

async function save(payload, res) {
  const written = [];
  for (const size of EXPECTED_SIZES) {
    const base64 = payload[size];
    if (typeof base64 !== "string" || !base64) {
      res.writeHead(400).end(`missing PNG for ${size}px`);
      return null;
    }
    const file = join(ICONS, `icon-${size}.png`);
    await writeFile(file, Buffer.from(base64, "base64"));
    written.push(`icon-${size}.png`);
  }
  res.writeHead(200, { "content-type": "text/plain" }).end(written.join("\n"));
  return written;
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/save") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let written;
    try {
      written = await save(JSON.parse(Buffer.concat(chunks).toString()), res);
    } catch (err) {
      res.writeHead(400).end(String(err?.message || err));
      return;
    }
    if (written) {
      console.log(`Wrote ${written.length} icons to icons/:\n  ${written.join("\n  ")}`);
      server.close();
    }
    return;
  }

  // Static files, confined to the project directory.
  const requested = decodeURIComponent((req.url || "/").split("?")[0]);
  const path = join(ROOT, normalize(requested).replace(/^(\.\.[/\\])+/, ""));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": CONTENT_TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`Renderer at http://localhost:${PORT}/icons/render.html?save=1`);
});
