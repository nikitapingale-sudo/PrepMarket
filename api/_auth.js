/**
 * Admin check for actions that change data (uploading orders, reading the
 * login log).
 *
 * The login screen asks only for an email - anyone can TYPE the admin's email
 * - so the email alone cannot be what grants admin rights. Admin requests must
 * also carry ADMIN_KEY, a secret set in Vercel's environment variables and
 * known only to the admin. The email is checked too, so a leaked key alone is
 * not enough either.
 */

import { timingSafeEqual } from "node:crypto";

export const ADMIN_EMAIL = "nikita.pingale@pw.live";

export function isAdmin(email, key) {
  const want = String(process.env.ADMIN_KEY || "");
  if (!want) return false;                       // no key configured -> nobody is admin
  if (String(email || "").trim().toLowerCase() !== ADMIN_EMAIL) return false;
  const a = Buffer.from(String(key || "")), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vercel parses JSON bodies; the local server hands over a parsed object too. */
export function bodyOf(req) {
  const b = req.body;
  if (b && typeof b === "object") return b;
  try { return JSON.parse(b || "{}"); } catch { return {}; }
}
