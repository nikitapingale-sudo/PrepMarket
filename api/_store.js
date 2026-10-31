/**
 * Tiny JSON store for what the dashboard writes itself: the admin-uploaded
 * orders snapshot and the login log.
 *
 * On Vercel it is a PRIVATE Vercel Blob store (BLOB_READ_WRITE_TOKEN is set
 * when the store is connected to the project) - nothing in it is reachable
 * without the token, which matters because the login log holds email ids.
 * On a PC without the token it falls back to the .local-store/ folder, so
 * `npm run dev` works offline.
 */

import { put, get, list } from "@vercel/blob";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";

const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const LOCAL = join(process.cwd(), ".local-store");

function noStore() {
  return new Error("Storage is not configured: connect a Vercel Blob store to the project " +
                   "(it sets BLOB_READ_WRITE_TOKEN).");
}

export async function putJSON(pathname, obj) {
  const body = JSON.stringify(obj);
  if (useBlob()) {
    await put(pathname, body, {
      access: "private", addRandomSuffix: false, allowOverwrite: true,
      contentType: "application/json", cacheControlMaxAge: 60,
    });
    return;
  }
  if (process.env.VERCEL) throw noStore();
  const f = join(LOCAL, pathname);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, body);
}

export async function getJSON(pathname) {
  if (useBlob()) {
    const r = await get(pathname, { access: "private", useCache: false });
    if (!r || !r.stream) return null;
    return JSON.parse(await new Response(r.stream).text());
  }
  if (process.env.VERCEL) return null;
  try { return JSON.parse(await readFile(join(LOCAL, pathname), "utf8")); }
  catch { return null; }
}

/** Every JSON under a prefix, newest first. */
export async function listJSON(prefix, limit = 1000) {
  if (useBlob()) {
    const out = [];
    let cursor;
    do {
      const page = await list({ prefix, cursor, limit: Math.min(1000, limit - out.length) });
      out.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : null;
    } while (cursor && out.length < limit);
    out.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    return Promise.all(out.map(async (b) => {
      const r = await get(b.pathname, { access: "private" });
      return r && r.stream ? JSON.parse(await new Response(r.stream).text()) : null;
    })).then((a) => a.filter(Boolean));
  }
  if (process.env.VERCEL) return [];
  const dir = join(LOCAL, prefix);
  let names = [];
  try { names = await readdir(dir); } catch { return []; }
  const rows = await Promise.all(names.map(async (n) => {
    const f = join(dir, n);
    return { t: (await stat(f)).mtimeMs, v: JSON.parse(await readFile(f, "utf8")) };
  }));
  return rows.sort((a, b) => b.t - a.t).slice(0, limit).map((r) => r.v);
}
