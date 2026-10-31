/**
 * Desktop Shopify export -> api/_data/orders-snapshot.json   (npm run sync-orders)
 *
 * The deployed site reads orders from this snapshot, because Vercel cannot
 * reach the Desktop. It holds no names, emails, phones or street addresses.
 *
 * --soft: if the Excel is missing, keep the existing snapshot and exit 0, so
 * `npm run deploy` still publishes code changes from a machine without the file.
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readOrdersExcel, ordersExcelPath } from "./excel-orders.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "api", "_data", "orders-snapshot.json");
const SOFT = process.argv.includes("--soft");

// same minimal .env.local reader as server.mjs, for ORDERS_EXCEL
try {
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, "$1");
  }
} catch {}

let snap;
try {
  snap = readOrdersExcel();
} catch (e) {
  console.error("  " + e.message);
  if (SOFT) { console.error("  keeping the existing orders snapshot."); process.exit(0); }
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(snap));
const days = snap.lines.map((l) => l.day).sort();
console.log("");
console.log(`  source      : ${ordersExcelPath()} (saved ${snap.sourceModified})`);
console.log(`  orders      : ${snap.orderCount} orders, ${snap.lines.length} lines from ${snap.rowCount} rows`);
console.log(`  date range  : ${days[0]} -> ${days[days.length - 1]}`);
for (const w of snap.warnings) console.log(`  note        : ${w}`);
console.log(`  written     : api/_data/orders-snapshot.json`);
console.log("");
