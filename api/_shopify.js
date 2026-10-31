/**
 * Shopify "Orders" export -> the order-line shape the dashboard already uses.
 *
 * Pure and dependency-free: the local server runs it over the Desktop Excel on
 * every refresh, and `npm run sync-orders` runs the same code to write the
 * PII-free snapshot Vercel serves. One function, so the two can never disagree.
 *
 * The underscore keeps Vercel from deploying this file as an endpoint.
 */

import { CATEGORY_BY_SKU } from "./_categories.js";

const ERR = /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|SPILL!|CALC!)$/i;
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function clean(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return !t || ERR.test(t) ? null : t;
  }
  if (typeof v === "number" && !isFinite(v)) return null;
  return v;
}
/** The export writes a literal 0 for "empty" in many text columns. */
function text(v) {
  const c = clean(v);
  if (c == null) return "";
  const s = String(c).trim();
  return s === "0" ? "" : s;
}
function num(v) {
  const c = clean(v);
  if (c == null) return 0;
  const n = typeof c === "number" ? c : Number(String(c).replace(/[,₹\s]/g, ""));
  return isFinite(n) ? n : 0;
}

const pad = (n) => String(n).padStart(2, "0");
/**
 * Shopify writes "2026-10-27 12:18:58 +0530". The wall-clock part is already
 * IST, so it is read as written - converting through a Date would move late
 * orders onto the next or previous day depending on the machine's timezone.
 */
function parseTs(v) {
  const c = clean(v);
  if (c == null) return null;
  if (typeof c === "number") {
    if (c < 20000 || c > 80000) return null;          // not an Excel date serial
    const d = new Date(Math.round((c - 25569) * 86400000));
    return {
      day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      hour: d.getUTCHours(),
    };
  }
  const s = String(c);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return { day: `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`, hour: m[4] != null ? +m[4] : null };
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);   // DD/MM/YYYY
  if (m) return { day: `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`, hour: m[4] != null ? +m[4] : null };
  return null;
}

function titleCase(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/(^|[\s(-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

/**
 * Delivery status lives in Tags, not in a status column - "Cancelled at" is
 * filled on RTO'd orders too, so it cannot be trusted on its own. Checked in
 * priority order: "Delivered, IN-TRANSIT" is a parcel that has arrived.
 *
 * Labels use the vocabulary the dashboard's regexes already understand
 * (/\brto\b/ for returns-to-origin, /^delivered$/ for delivered, ...).
 */
function stageFromTags(tags) {
  const t = tags.toLowerCase();
  if (/cancel/.test(t)) return "Cancelled";
  if (/rto delivered/.test(t)) return "RTO Delivered";
  if (/rto in-?transit/.test(t)) return "RTO In Transit";
  if (/(^|,\s*)delivered/.test(t)) return "Delivered";
  if (/in-?transit/.test(t)) return "In Transit";
  if (/received/.test(t)) return "Order Received";
  return "";
}

/**
 * Every tag that is NOT a status or a warehouse code: Order Dispute, To be
 * Refunded, Refund Initiated, Return Pending, REFUNDED... They can sit beside
 * any status, so they are kept as a list and filtered separately.
 */
const STATUS_TAG = /^(delivered|in-?transit|rto in-?transit|rto delivered|received|cancell?ed)$/i;
function flagsFromTags(tags) {
  const out = [];
  for (const raw of tags.split(",")) {
    const t = raw.trim();
    if (!t || STATUS_TAG.test(t) || /^[A-Za-z]{3,5}-\d{2}$/.test(t) || /test order/i.test(t)) continue;
    const label = /^[A-Z\s-]+$/.test(t) ? titleCase(t) : t;   // "REFUNDED" -> "Refunded"
    if (out.indexOf(label) < 0) out.push(label);
  }
  return out;
}

/** Coarse order status, the EasyEcom "Order Status" equivalent. */
function orderStatus(stage, fulfillment) {
  if (stage === "Cancelled") return "Cancelled";
  if (/\brto\b/i.test(stage)) return "Returned";
  if (stage === "Delivered") return "Delivered";
  if (fulfillment === "fulfilled") return "Shipped";
  return "Pending";
}

/** AAJ-01 / Prep-02 style tags. Both can appear on one order. */
function warehousesFromTags(tags) {
  const codes = tags.split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z]{3,5}-\d{2}$/.test(s));
  return {
    aaj: codes.some((c) => /^aaj/i.test(c)),
    prep: codes.some((c) => /^prep/i.test(c)),
  };
}

/**
 * Shopify carries no category. Known SKUs use the map seeded from EasyEcom;
 * anything new is classified from its title, with the same category names, so
 * a new launch shows up under a sensible heading instead of "Uncategorized".
 */
function categoryOf(sku, name) {
  if (CATEGORY_BY_SKU[sku]) return CATEGORY_BY_SKU[sku];
  const n = name.toLowerCase();
  if (/\bjee\b|neet|physics|chemistry|mathematics|\bmaths?\b|cengage/.test(n)) return "JEE";
  if (/upsc|\bias\b|civil services|\bpsc\b|polity|laxmikanth/.test(n)) return "UPSC";
  if (/\bssc\b|\bcgl\b|\bchsl\b/.test(n)) return "SSC";
  if (/\bnda\b|\bcds\b|defence|afcat|agniveer/.test(n)) return "Defence";
  if (/\bcat\b|\bmba\b|arun sharma/.test(n)) return "MBA";
  if (/class\s?\d|cbse|ncert|school/.test(n)) return "School Prep";
  return "Uncategorized";
}

/** header -> getter that tolerates casing / spacing drift in the export. */
function getter(headers) {
  const map = new Map(headers.map((h) => [squash(h), h]));
  return (row, name) => {
    const h = map.get(squash(name));
    return h == null ? undefined : row[h];
  };
}

/**
 * rows: objects keyed by header, one per LINE ITEM (sheet_to_json output).
 * Returns { lines, warnings, rowCount, orderCount, testExcluded }.
 *
 * Order-level columns (Total, Tags, Shipping Method...) repeat on every line of
 * an order and are sometimes blank on the follow-on lines, so each order takes
 * the first filled value across its lines.
 *
 * No PII leaves this function: names, emails, phones and street addresses are
 * never copied. Only city and state are kept.
 */
export function normalizeShopify(rows) {
  const warnings = [];
  const headers = rows.length ? Object.keys(Object.assign({}, ...rows.slice(0, 50))) : [];
  const g = getter(headers);
  for (const req of ["Name", "Created at", "Lineitem name", "Lineitem price", "Tags"]) {
    if (!headers.some((h) => squash(h) === squash(req))) warnings.push(`Missing column "${req}"`);
  }

  const groups = new Map();
  let noId = 0;
  for (const r of rows) {
    const id = text(g(r, "Name"));
    if (!id) { noId++; continue; }
    const arr = groups.get(id);
    if (arr) arr.push(r); else groups.set(id, [r]);
  }
  if (noId) warnings.push(`${noId} row(s) without an order number were skipped`);

  const lines = [];
  let badDates = 0, testExcluded = 0;
  for (const [ref, rs] of groups) {
    const first = (col) => {
      for (const r of rs) { const v = clean(g(r, col)); if (v != null && text(v) !== "") return v; }
      return null;
    };
    const created = parseTs(first("Created at"));
    if (!created) { badDates++; continue; }
    const tags = text(first("Tags"));
    if (/test order/i.test(tags)) { testExcluded++; continue; }

    const fulfillment = (text(first("Fulfillment Status")) || "unfulfilled").toLowerCase();
    const fulfilled = fulfillment === "fulfilled" ? parseTs(first("Fulfilled at")) : null;
    const cancelledAt = parseTs(first("Cancelled at"));
    const tagStage = stageFromTags(tags);
    // no status tag yet: fall back to what Shopify itself knows, labelled so the
    // Status filter shows these came from fulfilment, not from Tags
    const stage = tagStage || (fulfillment === "fulfilled" ? "Shipped (no tag)" : "Pending (no tag)");
    const shipMethod = text(first("Shipping Method"));
    const gateway = text(first("Payment Method"));
    const cod = /cash on delivery|\bcod\b/i.test(shipMethod) ||
      (!shipMethod && /cash on delivery|\bcod\b/i.test(gateway));
    const wh = warehousesFromTags(tags);
    const city = text(first("Shipping City")) || text(first("Billing City"));

    const items = rs.map((r) => {
      const name = text(g(r, "Lineitem name"));
      const qty = num(g(r, "Lineitem quantity")) || 1;
      const unit = num(g(r, "Lineitem price"));
      const cmp = num(g(r, "Lineitem compare at price"));
      const sku = text(g(r, "Lineitem sku"));
      return { name, qty, unit, mrp: cmp > 0 ? cmp : unit, sku,
               lineStatus: (text(g(r, "Lineitem fulfillment status")) || "pending").toLowerCase() };
    }).filter((i) => i.name);

    /**
     * Line value AFTER the order-level coupon. GET10 is applied to the order,
     * not the line, so price x qty overstates revenue on every couponed order;
     * spreading Subtotal across lines in proportion fixes that. Shipping is
     * excluded, matching EasyEcom's Selling Price.
     */
    const subtotal = num(first("Subtotal"));
    const gross = items.reduce((s, i) => s + i.unit * i.qty, 0);
    const ratio = gross > 0 && subtotal > 0 ? subtotal / gross : 1;

    items.forEach((it, i) => {
      lines.push({
        ref,
        sub: `${ref}#${i + 1}`,
        day: created.day,
        hour: created.hour,
        status: orderStatus(stage, fulfillment),
        stage,
        tagStage,                                  // blank = Tags had no status
        shipStatus: titleCase(it.lineStatus === "pending" ? "unfulfilled" : it.lineStatus),
        qty: it.qty,
        itemQty: it.qty,
        sku: it.sku,
        ean: it.sku,
        pid: it.sku || it.name,
        product: it.name,
        category: categoryOf(it.sku, it.name),
        pay: cod ? "COD" : "PrePaid",
        gateway: gateway || "Unknown",
        price: Math.round(it.unit * it.qty * ratio * 100) / 100,
        mrp: it.mrp,
        // "Select" is the storefront's unpicked dropdown, not a city
        city: /^select$/i.test(city) ? "" : titleCase(city),
        state: text(first("Shipping Province Name")) || text(first("Billing Province Name")) ||
               text(first("Shipping Province")),
        channel: "Shopify",
        warehouse: wh.prep && !wh.aaj ? "PrepOnline Warehouse"
                 : wh.aaj && !wh.prep ? "AAJ Warehouse"
                 : wh.aaj && wh.prep ? "both" : "",   // resolved against the PM tab later
        delivered: null,                           // Shopify has no delivery stamp
        shipped: fulfilled ? fulfilled.day : null,
        packed: fulfilled ? fulfilled.day : null,  // fulfilment = packed & handed over
        invoiced: null,
        courier: "",
        cancelledOn: stage === "Cancelled" && cancelledAt ? cancelledAt.day : null,
        financial: titleCase((text(first("Financial Status")) || "unknown").replace(/_/g, " ")),
        coupon: text(first("Discount Code")).toUpperCase() || "No coupon",
        risk: text(first("Risk Level")) || "Unknown",
        marketing: /^yes$/i.test(text(first("Accepts Marketing"))) ? "Opted in" : "Not opted in",
        refundTag: /refunded\b/i.test(tags) && !/to be refunded/i.test(tags) ? "Refunded"
                 : /refund initiated/i.test(tags) ? "Refund initiated"
                 : /to be refunded/i.test(tags) ? "To be refunded" : "",
        dispute: /dispute/i.test(tags),
        returnPending: /return pending/i.test(tags),
        flags: flagsFromTags(tags),
      });
    });
  }
  if (badDates) warnings.push(`${badDates} order(s) had no readable "Created at" date and were skipped`);
  if (testExcluded) warnings.push(`${testExcluded} test order(s) excluded`);

  return { lines, warnings, rowCount: rows.length, orderCount: groups.size - badDates - testExcluded,
           testExcluded };
}

/* ---------- derived tabs: Shopify replaces Cancellations_Raw and Aging_Raw ---------- */

const dayMs = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

/**
 * Shopify records no cancel reason or who cancelled, so the slots the
 * Operations page charts are filled with what it does know: the refund state
 * and the payment mode. The UI labels them that way rather than as reasons.
 */
export function deriveCancellations(lines) {
  return lines.filter((o) => o.stage === "Cancelled").map((o) => ({
    order: o.ref,
    day: o.cancelledOn || o.day,
    sku: o.sku,
    product: o.product,
    qty: o.qty,
    value: o.price,
    by: o.pay,
    reason: o.refundTag ||
      (/refunded/i.test(o.financial) ? "Refunded" : o.pay === "COD" ? "COD - nothing to refund" : "Refund not tagged"),
    channel: o.channel,
    warehouse: o.warehouse,
  }));
}

/**
 * Pendency = not yet fulfilled and still alive. Age is counted to the date the
 * export was taken, not to today: a week-old file would otherwise show every
 * pending order a week older than it was when the data was true.
 */
export function deriveAging(lines, asOfDay) {
  return lines
    .filter((o) => !/^fulfilled$|^restocked$/i.test(o.shipStatus) && !/cancel|\brto\b/i.test(o.stage))
    .map((o) => ({
      order: o.ref,
      day: o.day,
      age: Math.max(0, Math.round((dayMs(asOfDay) - dayMs(o.day)) / 86400000)),
      status: o.stage,
      ship: o.courier || "",
      product: o.product,
      sku: o.sku,
      qty: o.qty,
      state: o.state,
      value: o.price,
      warehouse: o.warehouse,
      stage: o.stage,
    }));
}
