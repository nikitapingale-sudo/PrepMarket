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

const { trinoConfigured, trinoQuery, bannerClicksSql, bannerUsersByDaySql, funnelSql, widgetProductSql } =
  await import("../api/trino.js");

if (!trinoConfigured()) {
  console.error("\n  TRINO_URL / TRINO_USER are not set in .env.local — cannot query.\n");
  process.exit(1);
}

const days = Number(process.env.CLICKS_DAYS) || 90;
console.log(`\n  Querying Trino for the last ${days} days...`);

const funnelDays = Number(process.env.FUNNEL_DAYS) || 30;
let rows, userRows, funnelRows, wpRows;
try {
  [rows, userRows, funnelRows, wpRows] = await Promise.all([
    trinoQuery(bannerClicksSql(days), { timeoutMs: 120000 }),
    trinoQuery(bannerUsersByDaySql(days), { timeoutMs: 120000 }),
    trinoQuery(funnelSql(funnelDays), { timeoutMs: 150000 }),
    trinoQuery(widgetProductSql(funnelDays), { timeoutMs: 150000 }),
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
    visitors: Number(r.distinct_visitors) || 0,
  });
}

/* per-day audience - kept separate because distinct counts don't add up */
const dailyUsers = {}, dailyVisitors = {};
for (const r of userRows || []) {
  const d = String(r.event_date || "").slice(0, 10);
  if (!d) continue;
  dailyUsers[d] = Number(r.distinct_users) || 0;
  dailyVisitors[d] = Number(r.distinct_visitors) || 0;
}

const total = clicks.reduce((a, c) => a + c.clicks, 0);
const userTotal = Object.values(dailyUsers).reduce((a, n) => a + n, 0);
const visitorTotal = Object.values(dailyVisitors).reduce((a, n) => a + n, 0);
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
  dailyVisitors,
  funnel: (funnelRows || []).map((r) => ({
    day: String(r.event_date || "").slice(0, 10),
    plp: Number(r.plp_viewed) || 0,
    banner: Number(r.banner_clicks) || 0,
    wView: Number(r.widget_viewed) || 0,
    wClick: Number(r.widget_clicks) || 0,
  })).filter((r) => r.day),
  widgetProducts: (wpRows || []).map((r) => ({
    day: String(r.event_date || "").slice(0, 10),
    product: String(r.product_name || ""),
    views: Number(r.viewed_users) || 0,
    clicks: Number(r.clicked_users) || 0,
  })).filter((r) => r.day && r.product),
};

writeFileSync(OUT, JSON.stringify(snapshot, null, 0));

console.log(`  rows        : ${clicks.length}`);
console.log(`  total clicks: ${total.toLocaleString("en-IN")}`);
console.log(`  signed-in   : ${userTotal.toLocaleString("en-IN")} (daily uniques, ${Object.keys(dailyUsers).length} days)`);
console.log(`  visitors    : ${visitorTotal.toLocaleString("en-IN")} (daily uniques, incl. logged-out)`);
console.log(`  funnel rows : ${(funnelRows || []).length} days of ingress data`);
console.log(`  widget prod : ${(wpRows || []).length} product-day rows`);
console.log(`  range       : ${snapshot.from} -> ${snapshot.to}`);
console.log(`  written     : clicks-snapshot.json`);
console.log(`\n  Now run "npm run deploy" to publish it (or use "npm run publish-clicks").\n`);
