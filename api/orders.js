/**
 * Admin upload of a fresh Shopify orders export.
 *
 *   POST /api/orders  { email, key, file, modified, rows }
 *
 * The browser parses the Excel and sends only the columns the dashboard reads
 * (no names, emails, phones or addresses ever leave the admin's PC). The rows
 * are normalised here with the same code as the Desktop path, checked, and
 * saved as the live snapshot - every viewer sees it on their next refresh.
 */

import { normalizeShopify } from "./_shopify.js";
import { putJSON } from "./_store.js";
import { isAdmin, bodyOf } from "./_auth.js";

export const UPLOAD_PATH = "orders/snapshot.json";

const ist = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 16).replace("T", " ");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  try {
    const b = bodyOf(req);
    if (!isAdmin(b.email, b.key)) return res.status(403).json({ error: "Only the admin can upload orders." });
    /* compact form {headers, data:[[...]]} keeps big exports under Vercel's
       4.5 MB request limit; plain row objects are accepted too */
    const rows = Array.isArray(b.headers) && Array.isArray(b.data)
      ? b.data.map((a) => Object.fromEntries(b.headers.map((h, i) => [h, a[i] ?? null])))
      : b.rows;
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: "The file has no rows." });

    const res1 = normalizeShopify(rows);
    const missing = res1.warnings.filter((w) => /^Missing column/.test(w));
    if (missing.length) {
      return res.status(400).json({ error: "This does not look like a Shopify orders export: " + missing.join(", ") });
    }
    if (!res1.lines.length) return res.status(400).json({ error: "No orders could be read from this file." });

    const now = new Date();
    const modified = b.modified ? new Date(b.modified) : now;
    const snap = {
      generatedAt: ist(now),
      source: String(b.file || "upload.xlsx").slice(0, 120),
      sourceModified: ist(isNaN(modified) ? now : modified),
      uploadedBy: String(b.email).toLowerCase(),
      ...res1,
    };
    await putJSON(UPLOAD_PATH, snap);
    globalThis.__ordersUploadedAt = Date.now();   // data.js drops its cached copy
    const days = snap.lines.map((l) => l.day).sort();
    return res.status(200).json({
      ok: true, orders: snap.orderCount, lines: snap.lines.length,
      from: days[0], to: days[days.length - 1], warnings: snap.warnings,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Upload failed." });
  }
}
