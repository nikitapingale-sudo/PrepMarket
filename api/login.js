/**
 * Login capture - no password, no OTP. Records who opened the dashboard and why.
 *
 *   POST /api/login        { email, purpose }       -> { ok, admin:false }
 *   POST /api/login?check  { email, key }           -> { ok, admin }   (admin key check)
 *   GET  /api/login        x-admin-email, x-admin-key headers -> recent logins (admin only)
 *
 * One blob per login, so two people signing in at once can never overwrite
 * each other's entry the way appending to a single file could.
 */

import { randomBytes } from "node:crypto";
import { putJSON, listJSON } from "./_store.js";
import { isAdmin, bodyOf } from "./_auth.js";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      if (!isAdmin(req.headers["x-admin-email"], req.headers["x-admin-key"])) {
        return res.status(403).json({ error: "Admin only." });
      }
      return res.status(200).json({ logins: await listJSON("logins/", 2000) });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

    const b = bodyOf(req);
    const email = String(b.email || "").trim().toLowerCase();
    if (!EMAIL.test(email)) return res.status(400).json({ error: "Enter a valid email id." });

    if (b.key !== undefined) {
      // admin unlock: only answers yes/no, writes nothing
      return res.status(isAdmin(email, b.key) ? 200 : 403)
        .json({ ok: isAdmin(email, b.key), admin: isAdmin(email, b.key) });
    }

    const purpose = String(b.purpose || "").trim().replace(/\s+/g, " ").slice(0, 300);
    if (purpose.length < 3) return res.status(400).json({ error: "Tell us briefly why you are using the dashboard." });

    const at = new Date();
    const entry = {
      email, purpose,
      at: at.toISOString(),
      atIST: new Date(at.getTime() + 330 * 60000).toISOString().slice(0, 16).replace("T", " "),
      ua: String(req.headers["user-agent"] || "").slice(0, 160),
    };
    await putJSON(`logins/${at.getTime()}-${randomBytes(4).toString("hex")}.json`, entry);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Login failed." });
  }
}
