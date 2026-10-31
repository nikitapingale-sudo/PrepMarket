/**
 * Reads the Shopify orders export from the Desktop and normalises it.
 * Local only - Vercel cannot see this machine's Desktop, which is why
 * `npm run sync-orders` turns the result into api/_data/orders-snapshot.json.
 *
 * Override the path with ORDERS_EXCEL in .env.local (forward slashes).
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import XLSX from "xlsx";
import { normalizeShopify } from "../api/_shopify.js";

export function ordersExcelPath() {
  return (process.env.ORDERS_EXCEL || "").trim() ||
    join(homedir(), "Desktop", "Shopify Orders Report.xlsx");
}

/** IST wall-clock "YYYY-MM-DD HH:mm" for a Date. */
function istStamp(d) {
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Returns the same object the snapshot holds, so the API treats a live read
 * and a snapshot identically. Throws with a readable message when the file is
 * missing or open mid-save.
 */
export function readOrdersExcel(path = ordersExcelPath()) {
  let buf, st;
  try {
    st = statSync(path);
    buf = readFileSync(path);
  } catch (e) {
    throw new Error(`Shopify export not found at ${path} (${e.code || e.message}).`);
  }
  const wb = XLSX.read(buf);
  // prefer the sheet whose A1 is "Name" (a Shopify export); else the first
  const name = wb.SheetNames.find((n) => {
    const a1 = wb.Sheets[n]["A1"];
    return a1 && String(a1.v).trim().toLowerCase() === "name";
  }) || wb.SheetNames[0];
  const ws = wb.Sheets[name];
  // formula-error cells (#REF! ...) read as blank rather than as text
  for (const k of Object.keys(ws)) if (k[0] !== "!" && ws[k] && ws[k].t === "e") delete ws[k];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  const res = normalizeShopify(rows);
  return {
    generatedAt: istStamp(new Date()),
    source: basename(path),
    sourceModified: istStamp(st.mtime),
    ...res,
  };
}
