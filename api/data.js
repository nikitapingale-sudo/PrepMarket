/**
 * PrepMarket - Vercel serverless API
 * Reads the four raw tabs from the Google Sheet and returns normalized JSON.
 *
 * REQUIREMENT: the Google Sheet must be shared as
 *   Share > General access > "Anyone with the link" > Viewer
 * (otherwise Google returns an HTML login page instead of data).
 */

import { trinoConfigured, trinoQuery, bannerClicksSql } from "./trino.js";

/**
 * The Sheet ID is a secret in practice: the Sheet is shared "anyone with the
 * link", and its raw tabs carry customer names, phone numbers and addresses.
 * Keeping it in an env var is what lets this repo be public safely.
 *
 *   Vercel  : Project Settings > Environment Variables > SHEET_ID
 *   Local   : put SHEET_ID=... in .env.local (gitignored)
 *
 * Read lazily, not at import time, so the local dev server can load .env.local
 * before the first request without caring about ES module evaluation order.
 */
function getSheetId() {
  const id = (process.env.SHEET_ID || "").trim();
  if (!id) {
    throw new Error(
      "SHEET_ID is not set. Locally: copy .env.example to .env.local and fill it in. " +
      "On Vercel: add SHEET_ID under Project Settings > Environment Variables."
    );
  }
  return id;
}

const TABS = {
  orders: "Orders_Raw",
  cancellations: "Cancellations_Raw",
  aging: "Aging_Raw",
  stock: "Stock_Raw",
  returns: "Pending Returns report",
  clicks: "Banner_Clicks",
};

/* ---------- gviz fetch: returns [{header: value, ...}, ...] ---------- */
async function fetchTab(sheetName) {
  const url =
    `https://docs.google.com/spreadsheets/d/${getSheetId()}/gviz/tq` +
    `?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url, { redirect: "follow" });
  const text = await res.text();
  // gviz wraps JSON:  google.visualization.Query.setResponse({...});
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) {
    throw new Error(
      `Sheet tab "${sheetName}" not readable. Is the Sheet shared as "Anyone with the link - Viewer"?`
    );
  }
  const payload = JSON.parse(text.slice(start, end + 1));
  if (payload.status === "error") {
    throw new Error(
      `Google returned an error for tab "${sheetName}": ` +
        (payload.errors && payload.errors[0] ? payload.errors[0].detailed_message : "unknown")
    );
  }
  const table = payload.table;
  if (!table || !table.rows) return [];

  let headers = table.cols.map((c) => String(c.label || "").trim());
  let rows = table.rows;

  // If Google didn't detect a header row, the first data row IS the header.
  if (headers.every((h) => !h) && rows.length) {
    headers = rows[0].c.map((c) => (c && c.v != null ? String(c.v).trim() : ""));
    rows = rows.slice(1);
  }

  return rows
    .map((r) => {
      const o = {};
      (r.c || []).forEach((cell, i) => {
        if (!headers[i]) return;
        o[headers[i]] = cell ? cell.v : null;
      });
      return o;
    })
    .filter((o) => Object.values(o).some((v) => v !== null && v !== ""));
}

/* ---------- value helpers ---------- */
const strip = (v) => String(v == null ? "" : v).replace(/^`+/, "").trim();
const num = (v) => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  // tolerate "1,234.50", "Rs. 505", "₹505"
  const n = Number(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
};

/**
 * Tolerant column lookup. Sheet headers drift ("Selling Price" vs "selling_price"
 * vs "Selling  Price"), so match on a squashed lowercase key and accept the first
 * candidate that exists. Falls back to a substring match before giving up.
 */
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
function pick(row, candidates) {
  if (!row.__idx) {
    const idx = {};
    for (const k of Object.keys(row)) idx[squash(k)] = row[k];
    Object.defineProperty(row, "__idx", { value: idx, enumerable: false });
  }
  const idx = row.__idx;

  // Which of the named columns actually exist in this tab? Presence is decided
  // by the HEADER, never by whether one particular row happens to have a value.
  const present = candidates.map(squash).filter((k) => k in idx);

  if (present.length) {
    // First listed column that carries a value wins, so genuine synonyms still
    // chain (e.g. Handover At -> Manifested At for dispatch).
    for (const k of present) {
      if (idx[k] !== null && idx[k] !== "") return idx[k];
    }
    // The column exists but is empty for this row. That is a real answer -
    // "this order has no delivery date" - so stop here. Falling through to a
    // fuzzy match once turned "Expected Delivery Date" into a reported
    // delivery date for orders that had not been delivered.
    return null;
  }

  // Only when none of the named columns exist at all: allow a PREFIX match, so
  // "Order Date" still finds a header like "Order Date And Time". Deliberately
  // a prefix and not a substring - "Expected Delivery Date" must never satisfy
  // a request for "Delivery Date".
  for (const c of candidates) {
    const k = squash(c);
    for (const have of Object.keys(idx)) {
      if (have.startsWith(k) && idx[have] !== null && idx[have] !== "") return idx[have];
    }
  }
  return null;
}

/** gviz dates arrive as "Date(2026,7,3,16,51,35)" strings (month 0-based). */
function toDayStr(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const m = v.match(/^Date\((\d+),(\d+),(\d+)/);
    if (m) {
      const y = +m[1], mo = +m[2] + 1, d = +m[3];
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    // dd/mm/yyyy is the EasyEcom default, so try it BEFORE native Date parsing
    // (native would read 03/08/2026 as 3 August in some runtimes and 8 March in others).
    const m2 = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (m2)
      return `${m2[3]}-${String(+m2[2]).padStart(2, "0")}-${String(+m2[1]).padStart(2, "0")}`;
    const m3 = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`;
    const d1 = new Date(v);
    // read back LOCAL parts: toISOString() would shift the day in any timezone
    // ahead of UTC, moving an order to the previous calendar day
    if (!isNaN(d1)) return localDay(d1);
    return null;
  }
  if (typeof v === "number" && v > 20000 && v < 60000) {
    // Excel serial: already an absolute UTC instant, so read UTC parts
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  return null;
}
function localDay(d) {
  return (
    d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/** Pull "HH" out of a gviz Date(...) or a "dd/mm/yyyy hh:mm" string. Null if absent. */
function toHour(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const m = v.match(/^Date\(\d+,\d+,\d+,(\d+)/);
    if (m) return +m[1];
    const m2 = v.match(/\s(\d{1,2}):(\d{2})/);
    if (m2) return +m2[1];
  }
  return null;
}

/* ---------- normalizers ---------- */
function normalizeOrders(raw) {
  const seen = new Set();
  const out = [];
  for (const o of raw) {
    const rawDate = pick(o, ["Order Date", "order_date", "Order Date Time", "Ordered On"]);
    const day = toDayStr(rawDate);
    if (!day) continue;
    const sub = strip(pick(o, ["Suborder No", "SubOrder No.", "Suborder Number"]));
    const ref = strip(pick(o, ["Reference Code", "Order No.", "Order Number", "order_id"]));
    const sku = strip(pick(o, ["SKU", "sku", "Product SKU"]));
    const key = sub || ref + "|" + sku;
    if (seen.has(key)) continue;
    seen.add(key);

    /**
     * "Units" means saleable units, so it comes from Suborder Quantity.
     * Item Quantity counts the individual books INSIDE a bundle - one "Physics
     * Combo" is 1 unit sold but 6 items - so using it inflated unit counts and
     * made units-per-order look far higher than it is. Item Quantity is kept
     * separately as itemQty for anyone who wants the pack-out view.
     */
    const qty = num(pick(o, ["Suborder Quantity", "Item Quantity", "Quantity", "Qty"])) || 1;
    const itemQty = num(pick(o, ["Item Quantity", "Quantity", "Qty"])) || qty;
    const price = num(pick(o, ["Selling Price", "Total Amount", "Item Total", "Amount"]));
    out.push({
      ref,
      sub,
      day,
      hour: toHour(rawDate),
      status: strip(pick(o, ["Order Status", "order_status", "Status"])) || "Unknown",
      qty,
      itemQty,
      sku,
      ean: strip(pick(o, ["EAN"])),
      /**
       * Grouping key. The SKU column arrives as a NUMBER, and Google Sheets has
       * rounded it to scientific notation (8704683638919 -> 8.70E+12), so many
       * different products collapse onto one value. EAN is stored as text and
       * survives intact, so it is the reliable identifier; fall back to SKU and
       * then the product name if EAN is ever missing.
       */
      pid: strip(pick(o, ["EAN"])) || sku ||
           strip(pick(o, ["Product Name", "product_name", "Item Name"])),
      product: strip(pick(o, ["Product Name", "product_name", "Item Name"])),
      category: strip(pick(o, ["Category", "Product Category"])) || "Uncategorized",
      pay: strip(pick(o, ["Payment Mode", "Payment Method", "payment_mode"])) || "Unknown",
      price,
      city: strip(pick(o, ["Shipping City", "City", "shipping_city"])),
      state: strip(pick(o, ["Shipping State", "State", "shipping_state"])),
      channel: strip(pick(o, ["MP Name", "Marketplace", "Channel", "Sales Channel"])) || "Direct",
      mrp: num(pick(o, ["MRP"])),
      // Only ACTUAL delivery stamps. "Delivery Date" is deliberately excluded:
      // it is ambiguous, and EasyEcom also ships "Expected Delivery Date" and
      // "Delivery Appointment Date", which are promises, not facts.
      delivered: toDayStr(pick(o, ["Delivered At", "delivered_at", "Delivered On"])),
      // EasyEcom has no "Shipped At"; handover/manifest is the real dispatch stamp
      shipped: toDayStr(
        pick(o, ["Handover At", "Manifested At", "Shipped At", "Dispatch Date", "shipped_at"])
      ),
      courier: strip(pick(o, ["Courier", "Carrier", "Shipping Partner"])),
    });
  }
  return out;
}

function normalizeCanc(raw) {
  const seen = new Set();
  const out = [];
  for (const o of raw) {
    const day = toDayStr(pick(o, ["Cancel Date", "Cancelled Date", "cancel_date"]));
    if (!day) continue;
    const sub = strip(pick(o, ["SubOrder No.", "Suborder No", "Suborder Number"]));
    const order = strip(pick(o, ["Order No.", "Order Number", "Reference Code"]));
    const sku = strip(pick(o, ["SKU", "sku"]));
    const key = sub || order + "|" + sku;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      order,
      day,
      sku,
      product: strip(pick(o, ["Product Name", "Item Name"])),
      qty: num(pick(o, ["Quantity", "Qty", "Item Quantity"])) || 1,
      value: num(pick(o, ["Selling Price", "Amount", "Total Amount"])),
      by: strip(pick(o, ["Cancelled By", "Cancel By"])) || "Unknown",
      reason: strip(pick(o, ["Cancel Reason", "Reason", "Cancellation Reason"])) || "Not given",
      channel: strip(pick(o, ["Marketplace", "MP Name", "Channel"])) || "Direct",
    });
  }
  return out;
}

function normalizeAging(raw) {
  const out = [];
  for (const o of raw) {
    const order = strip(pick(o, ["order_id", "Order No.", "Order Number", "Reference Code"]));
    if (!order) continue;
    out.push({
      order,
      day: toDayStr(pick(o, ["order_date", "Order Date"])),
      age: num(pick(o, ["order_age", "Order Age", "Aging", "Age"])),
      status: strip(pick(o, ["order_status", "Order Status", "Status"])) || "Unknown",
      ship: strip(pick(o, ["shipment_processing_status", "Shipment Status", "Processing Status"])),
      product: strip(pick(o, ["product_name", "Product Name"])),
      sku: strip(pick(o, ["SKU", "sku"])),
      qty: num(pick(o, ["item_quantity", "Item Quantity", "Quantity"])) || 1,
      state: strip(pick(o, ["shipping_state", "Shipping State", "State"])),
      value: num(pick(o, ["Selling Price", "Amount", "Total Amount"])),
    });
  }
  return out;
}

/** "Pending Returns report" - reverse logistics still in flight. */
function normalizeReturns(raw) {
  const seen = new Set();
  const out = [];
  for (const o of raw) {
    const order = strip(pick(o, ["Order_Number", "Order Number", "Order No."]));
    const itemId = strip(pick(o, ["Order_Item_ID", "Order Item ID"]));
    const sku = strip(pick(o, ["sku", "SKU"]));
    if (!order && !itemId) continue;
    const key = itemId || order + "|" + sku;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      order,
      itemId,
      // the return is dated by when it was raised, so it lands in the right
      // reporting period regardless of when the original order was placed
      day: toDayStr(pick(o, ["Return_Initiated_Date"])),
      orderDay: toDayStr(pick(o, ["Order_Date"])),
      deliveredDay: toDayStr(pick(o, ["MP_Delivered_Date"])),
      gateDay: toDayStr(pick(o, ["Gate_Entry_Shipment_Received_Date"])),
      sku,
      product: strip(pick(o, ["Product_Name", "Product Name"])),
      qty: num(pick(o, ["Return_Quantity"])) || 1,
      status: strip(pick(o, ["Return_Status"])) || "Unknown",
      type: strip(pick(o, ["Return_Type"])) || "Unknown",
      reason: strip(pick(o, ["Channel_return_reason"])) || "Not given",
      carrier: strip(pick(o, ["Reverse_Carrier_Name", "Reverse_Carrier_Aggregator"])),
      marketplace: strip(pick(o, ["Marketplace", "Party"])) || "Direct",
      mpStatus: strip(pick(o, ["MP_Status"])),
      awb: strip(pick(o, ["Reverse_AWB_Number"])),
      warehouse: strip(pick(o, ["Returned_to_warehouse"])),
      invoice: strip(pick(o, ["Invoice_Number"])),
      comments: strip(pick(o, ["Comments"])),
      value: num(pick(o, ["Packet_Amount"])),
    });
  }
  return out;
}

/**
 * "Banner_Clicks" - category banner click-throughs, exported from BigQuery
 * (silver_dbt_category_banner_click) and pasted in with the query's own column
 * names: event_date, page_location, redirection_url, total_clicks.
 *
 * gviz answers with a fallback sheet when a tab name does not match, so rows
 * that carry none of the expected columns are dropped rather than ingested as
 * if they were click data.
 */
function normalizeClicks(raw) {
  const out = [];
  for (const o of raw) {
    const day = toDayStr(pick(o, ["event_date", "Event Date", "date", "day"]));
    const dest = strip(pick(o, ["redirection_url", "Redirection URL", "destination_url"]));
    const src = strip(pick(o, ["page_location", "Page Location", "source_url"]));
    const clicks = num(pick(o, ["total_clicks", "Total Clicks", "clicks", "click_count"]));
    if (!day || (!dest && !src)) continue;
    out.push({ day, src, dest, clicks: clicks || 0 });
  }
  return out;
}

/**
 * Banner clicks come from the warehouse when Trino is configured, and from the
 * Banner_Clicks sheet tab otherwise. Returns {rows, source, error} so the UI can
 * say which path produced the numbers, and why the live one failed if it did.
 */
async function loadClicks() {
  if (trinoConfigured()) {
    try {
      const raw = await trinoQuery(bannerClicksSql(Number(process.env.CLICKS_DAYS) || 90));
      return { rows: normalizeClicks(raw), source: "trino", error: null };
    } catch (e) {
      // fall through to the sheet rather than losing the page entirely
      const sheetRows = normalizeClicks(await fetchTab(TABS.clicks).catch(() => []));
      return { rows: sheetRows, source: sheetRows.length ? "sheet" : "none", error: e.message };
    }
  }
  const sheetRows = normalizeClicks(await fetchTab(TABS.clicks).catch(() => []));
  return { rows: sheetRows, source: sheetRows.length ? "sheet" : "none", error: null };
}

/**
 * Cancellations_Raw and Aging_Raw carry no money column, and Stock_Raw carries
 * no MRP, so those figures would all render as zero. Orders_Raw does have both
 * MRP and Selling Price, so fill the gaps from a SKU price map built off orders
 * and flag the filled rows - the UI labels them as estimates rather than
 * passing derived numbers off as reported ones.
 */
function fillFromOrders(orders, cancellations, aging, stock, returns) {
  const bySku = {};
  for (const o of orders) {
    if (!o.sku) continue;
    const p = bySku[o.sku] || (bySku[o.sku] = { sum: 0, n: 0, mrp: 0 });
    if (o.price > 0 && o.qty > 0) { p.sum += o.price / o.qty; p.n++; }
    if (o.mrp > 0) p.mrp = o.mrp;
  }
  const unitPrice = (sku) => {
    const p = bySku[sku];
    if (!p) return 0;
    return p.n ? p.sum / p.n : p.mrp;
  };

  let cancEstimated = false, stockEstimated = false, agingEstimated = false,
      returnsEstimated = false;
  for (const t of returns || []) {
    if (t.value > 0) continue;
    const v = unitPrice(t.sku) * (t.qty || 1);
    if (v > 0) { t.value = Math.round(v); t.valueEstimated = true; returnsEstimated = true; }
  }
  for (const c of cancellations) {
    if (c.value > 0) continue;
    const v = unitPrice(c.sku) * (c.qty || 1);
    if (v > 0) { c.value = Math.round(v); c.valueEstimated = true; cancEstimated = true; }
  }
  for (const a of aging) {
    if (a.value > 0) continue;
    const v = unitPrice(a.sku) * (a.qty || 1);
    if (v > 0) { a.value = Math.round(v); a.valueEstimated = true; agingEstimated = true; }
  }
  for (const s of stock) {
    if (s.mrp > 0) continue;
    const v = unitPrice(s.sku);
    if (v > 0) { s.mrp = Math.round(v); s.mrpEstimated = true; stockEstimated = true; }
  }
  return { cancEstimated, stockEstimated, agingEstimated, returnsEstimated };
}

function normalizeStock(raw) {
  const out = [];
  for (const o of raw) {
    const sku = strip(pick(o, ["SKU", "sku", "Product SKU"]));
    if (!sku) continue;
    const available = num(pick(o, ["Available Quantity", "Available", "Qty Available"]));
    const reserved =
      num(pick(o, ["Reserved (Not Picked)", "Reserved Not Picked"])) +
      num(pick(o, ["Reserved (Picked)", "Reserved Picked"]));
    out.push({
      sku,
      product: strip(pick(o, ["Product Name", "product_name"])),
      category: strip(pick(o, ["Category", "Product Category"])) || "Uncategorized",
      available,
      reserved,
      toReceive: num(pick(o, ["To Receive", "Incoming", "On Order"])),
      damaged: num(pick(o, ["Damaged", "Damaged Quantity"])),
      mrp: num(pick(o, ["MRP", "Price", "Selling Price"])),
    });
  }
  return out;
}

/* ---------- handler ---------- */
export async function buildPayload() {
  const [ordersRaw, cancRaw, agingRaw, stockRaw, returnsRaw, clicksResult] = await Promise.all([
    fetchTab(TABS.orders),
    fetchTab(TABS.cancellations),
    fetchTab(TABS.aging),
    fetchTab(TABS.stock),
    // optional sources: a missing one must not take the whole dashboard down
    fetchTab(TABS.returns).catch(() => []),
    loadClicks(),
  ]);

  const now = new Date();
  const generatedAt = now.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const orders = normalizeOrders(ordersRaw);
  const cancellations = normalizeCanc(cancRaw);
  const aging = normalizeAging(agingRaw);
  const stock = normalizeStock(stockRaw);
  const returns = normalizeReturns(returnsRaw);
  const estimated = fillFromOrders(orders, cancellations, aging, stock, returns);

  /* Flag the rounded-SKU problem so the dashboard can warn rather than quietly
     reporting merged products as if they were one. */
  const skuToPid = {};
  for (const o of orders) {
    if (!o.sku || !o.pid) continue;
    (skuToPid[o.sku] = skuToPid[o.sku] || new Set()).add(o.pid);
  }
  const collidedSkus = Object.keys(skuToPid).filter((s) => skuToPid[s].size > 1);
  const dataIssues = {
    skuCollisions: collidedSkus.length,
    productsMerged: collidedSkus.reduce((a, s) => a + skuToPid[s].size, 0),
  };

  return {
    orders, cancellations, aging, stock, returns,
    clicks: clicksResult.rows,
    clicksSource: clicksResult.source,
    clicksError: clicksResult.error,
    estimated, dataIssues, generatedAt,
  };
}

export default async function handler(req, res) {
  try {
    const payload = await buildPayload();
    res.setHeader("Access-Control-Allow-Origin", "*");
    // cache at Vercel's edge for 60s so leaders' reloads don't hammer Google
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json(payload);
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({ error: e.message || "Failed to read the Google Sheet." });
  }
}
