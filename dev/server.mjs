/**
 * Local preview server - `npm run dev` -> http://localhost:3000
 *
 * Serves index.html and implements /api/data by calling the SAME buildPayload()
 * that Vercel runs in production. No Vercel CLI or login needed.
 *
 * If the Google Sheet can't be read (most commonly: it is still private), the
 * server falls back to generated demo data and tags the response with
 * demo:true + demoReason, so the dashboard can show an honest banner instead of
 * an empty error screen.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { buildPayload } from "../api/data.js";
import { demoPayload } from "./demo-data.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/* Minimal .env loader - avoids a dependency just to read two lines.
   Existing process.env values win, so `SHEET_ID=x npm run dev` still overrides. */
function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    let text;
    try {
      text = readFileSync(join(ROOT, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim().replace(/^["'](.*)["']$/, "$1");
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}
loadEnv();
const PORT = Number(process.env.PORT) || 3000;
const USE_DEMO = process.argv.includes("--demo");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

let cache = null; // { at:number, body:string }
const CACHE_MS = 30000;

async function apiData() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.body;

  let payload;
  if (USE_DEMO) {
    payload = demoPayload();
    payload.demoReason = "Started with --demo, so the live Sheet was not contacted.";
  } else {
    try {
      payload = await buildPayload();
      const rows =
        payload.orders.length + payload.cancellations.length +
        payload.aging.length + payload.stock.length;
      if (rows === 0) {
        payload = demoPayload();
        payload.demoReason =
          "The Sheet was reachable but every tab came back empty. Check the tab names: " +
          "Orders_Raw / Cancellations_Raw / Aging_Raw / Stock_Raw.";
      }
    } catch (e) {
      payload = demoPayload();
      payload.demoReason =
        "Could not read the Google Sheet (" + (e.message || "unknown error") + "). " +
        "Share it as “Anyone with the link – Viewer” to see your real data here.";
    }
  }

  const body = JSON.stringify(payload);
  cache = { at: Date.now(), body };
  return body;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  try {
    if (path === "/api/data") {
      if (url.searchParams.has("fresh")) cache = null;
      const body = await apiData();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(body);
    }

    // static files, confined to the project folder
    const rel = path === "/" ? "index.html" : decodeURIComponent(path).replace(/^\/+/, "");
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    return res.end(data);
  } catch (e) {
    if (e && e.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found: " + path);
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: e.message }));
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error("");
    console.error("  Port " + PORT + " is already in use.");
    console.error("  Either the dashboard is already running at http://localhost:" + PORT);
    console.error("  or another app has the port. To use a different one:");
    console.error("");
    console.error("      PowerShell:  $env:PORT=3001; npm run dev");
    console.error("");
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  console.log("");
  console.log("  PrepMarket Intelligence Hub - local preview");
  console.log("  ->  http://localhost:" + PORT);
  console.log("");
  console.log("  Press Ctrl+C to stop.");
  console.log("");
});
