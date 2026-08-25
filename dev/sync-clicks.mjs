/**
 * npm run sync-clicks   - publish banner-click data to the live dashboard.
 *
 * Vercel cannot reach Trino: the host resolves to a private 10.x address that
 * only exists inside the corporate network. So this runs the query HERE, where
 * the network allows it, and writes the result to clicks-snapshot.json, which
 * is committed and served as a static file. The deployed dashboard reads that
 * file, so the Banner Clicks page works on Vercel.
 *
 * Run it whenever you want the live site refreshed:
 *     npm run sync-clicks           query + write the snapshot
 *     npm run publish-clicks        the above, then commit and push
 */

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "clicks-snapshot.json");

/* load .env.local so the Trino credentials never live in the repo */
for (const name of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(ROOT, name), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, "$1");
      }
    }
  } catch { /* file is optional */ }
}

const { trinoConfigured, trinoQuery, bannerClicksSql, bannerUsersByDaySql } =
  await import("../api/trino.js");

if (!trinoConfigured()) {
  console.error("\n  TRINO_URL / TRINO_USER are not set in .env.local — cannot query.\n");
  process.exit(1);
}

const days = Number(process.env.CLICKS_DAYS) || 90;
console.log(`\n  Querying Trino for the last ${days} days...`);

let rows, userRows;
try {
  [rows, userRows] = await Promise.all([
    trinoQuery(bannerClicksSql(days), { timeoutMs: 120000 }),
    trinoQuery(bannerUsersByDaySql(days), { timeoutMs: 120000 }),
  ]);
} catch (e) {
  console.error("\n  Query failed: " + e.message);
  console.error("  Are you on the corporate network / VPN?\n");
  process.exit(1);
}

/* Same shape the dashboard uses internally, so the client can drop it straight in. */
const clicks = [];
for (const r of rows) {
  const day = String(r.event_date || "").slice(0, 10);
  if (!day) continue;
  clicks.push({
    day,
    src: String(r.page_location || ""),
    dest: String(r.redirection_url || ""),
    clicks: Number(r.total_clicks) || 0,
    users: Number(r.distinct_users) || 0,
  });
}

/* distinct users per day - kept separate because distinct counts don't add up */
const dailyUsers = {};
for (const r of userRows || []) {
  const d = String(r.event_date || "").slice(0, 10);
  if (d) dailyUsers[d] = Number(r.distinct_users) || 0;
}

const total = clicks.reduce((a, c) => a + c.clicks, 0);
const userTotal = Object.values(dailyUsers).reduce((a, n) => a + n, 0);
const dates = clicks.map((c) => c.day).sort();

const snapshot = {
  generatedAt: new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }),
  windowDays: days,
  rowCount: clicks.length,
  totalClicks: total,
  from: dates[0] || null,
  to: dates[dates.length - 1] || null,
  rows: clicks,
  dailyUsers,
};

writeFileSync(OUT, JSON.stringify(snapshot, null, 0));

console.log(`  rows        : ${clicks.length}`);
console.log(`  total clicks: ${total.toLocaleString("en-IN")}`);
console.log(`  daily users : ${userTotal.toLocaleString("en-IN")} (summed across ${Object.keys(dailyUsers).length} days)`);
console.log(`  range       : ${snapshot.from} -> ${snapshot.to}`);
console.log(`  written     : clicks-snapshot.json`);
console.log(`\n  Now run "npm run deploy" to publish it (or use "npm run publish-clicks").\n`);
