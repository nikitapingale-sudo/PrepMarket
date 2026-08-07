/**
 * Demo data generator - LOCAL PREVIEW ONLY.
 * Used by dev/server.mjs when the real Google Sheet can't be read (e.g. it is
 * still private). Produces enough volume and variety that every KPI, chart,
 * table and insight on the dashboard has something real-looking to show.
 *
 * This file is never imported by api/data.js and never runs on Vercel.
 */

const PRODUCTS = [
  { sku: "8704617808007", product: "Advance Mathematics for JEE", category: "JEE", price: 505 },
  { sku: "8704617808014", product: "Physics Galaxy Mechanics", category: "JEE", price: 720 },
  { sku: "8704617808021", product: "Organic Chemistry Master", category: "JEE", price: 649 },
  { sku: "8704617808038", product: "NCERT Biology Companion", category: "NEET", price: 399 },
  { sku: "8704617808045", product: "NEET Previous Year Papers", category: "NEET", price: 549 },
  { sku: "8704617808052", product: "Human Physiology Notes", category: "NEET", price: 289 },
  { sku: "8704617808069", product: "UPSC Polity Handbook", category: "UPSC", price: 875 },
  { sku: "8704617808076", product: "Modern Indian History", category: "UPSC", price: 640 },
  { sku: "8704617808083", product: "CSAT Practice Set", category: "UPSC", price: 349 },
  { sku: "8704617808090", product: "Class 10 Science Bundle", category: "Foundation", price: 999 },
  { sku: "8704617808106", product: "Class 9 Maths Workbook", category: "Foundation", price: 299 },
  { sku: "8704617808113", product: "Banking Aptitude Drill", category: "Banking", price: 459 },
  { sku: "8704617808120", product: "SSC Reasoning Complete", category: "SSC", price: 379 },
  { sku: "8704617808137", product: "GATE CS Formula Book", category: "GATE", price: 720 },
];

const PLACES = [
  { city: "Noida", state: "Uttar Pradesh", w: 14 },
  { city: "Lucknow", state: "Uttar Pradesh", w: 9 },
  { city: "Aligarh", state: "Uttar Pradesh", w: 5 },
  { city: "Patna", state: "Bihar", w: 11 },
  { city: "Muzaffarpur", state: "Bihar", w: 4 },
  { city: "Delhi", state: "Delhi", w: 12 },
  { city: "Jaipur", state: "Rajasthan", w: 8 },
  { city: "Kota", state: "Rajasthan", w: 7 },
  { city: "Pune", state: "Maharashtra", w: 8 },
  { city: "Mumbai", state: "Maharashtra", w: 6 },
  { city: "Bengaluru", state: "Karnataka", w: 6 },
  { city: "Hyderabad", state: "Telangana", w: 5 },
  { city: "Bhopal", state: "Madhya Pradesh", w: 5 },
  { city: "Indore", state: "Madhya Pradesh", w: 4 },
  { city: "Ranchi", state: "Jharkhand", w: 4 },
  { city: "Kolkata", state: "West Bengal", w: 5 },
  { city: "Ahmedabad", state: "Gujarat", w: 4 },
  { city: "Chennai", state: "Tamil Nadu", w: 3 },
];

const CHANNELS = [
  { name: "Shopify", w: 46 },
  { name: "Amazon", w: 24 },
  { name: "Flipkart", w: 18 },
  { name: "Meesho", w: 7 },
  { name: "Direct", w: 5 },
];
const COURIERS = ["Delhivery", "Blue Dart", "Ecom Express", "XpressBees", "Shadowfax"];
const CANCEL_REASONS = [
  { r: "Customer changed mind", w: 26 },
  { r: "Out of stock", w: 21 },
  { r: "Address undeliverable", w: 15 },
  { r: "Duplicate order", w: 12 },
  { r: "Payment failed", w: 11 },
  { r: "Delivery delay", w: 9 },
  { r: "Price mismatch", w: 6 },
];
const SHIP_STATES = ["Awaiting picking", "Picked", "Packed", "On hold", "Manifested"];

/* deterministic PRNG so a page refresh doesn't reshuffle the whole dashboard.
   demoPayload() re-seeds on entry - without that, a second call in the same
   process continues the sequence and every number on screen changes. */
const SEED0 = 20260806;
let seed = SEED0;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pickOne = (arr) => arr[Math.floor(rnd() * arr.length)];
function weighted(arr, key = "w") {
  const total = arr.reduce((a, x) => a + x[key], 0);
  let t = rnd() * total;
  for (const x of arr) {
    t -= x[key];
    if (t <= 0) return x;
  }
  return arr[arr.length - 1];
}
/* format by LOCAL calendar parts - toISOString() would shift the day in any
   timezone ahead of UTC and every generated date would land a day early */
const iso = (d) =>
  d.getFullYear() + "-" +
  String(d.getMonth() + 1).padStart(2, "0") + "-" +
  String(d.getDate()).padStart(2, "0");

export function demoPayload(today = new Date()) {
  seed = SEED0;
  const orders = [];
  const cancellations = [];
  const DAYS = 75;
  let refSeq = 41200;

  for (let back = DAYS - 1; back >= 0; back--) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    const day = iso(d);
    const dow = d.getDay();

    // weekly rhythm: weekends dip, Mon/Tue peak; plus a gentle growth trend
    const dowFactor = [0.72, 1.18, 1.12, 1.0, 0.98, 0.94, 0.68][dow];
    const growth = 1 + (DAYS - back) / DAYS * 0.45;
    const noise = 0.8 + rnd() * 0.45;
    const nOrders = Math.max(3, Math.round(11 * dowFactor * growth * noise));

    for (let i = 0; i < nOrders; i++) {
      const ref = "PM" + refSeq++;
      const place = weighted(PLACES);
      const channel = weighted(CHANNELS).name;
      const pay = rnd() < 0.58 ? "COD" : rnd() < 0.6 ? "Prepaid" : "UPI";
      const lines = rnd() < 0.24 ? 2 : 1;
      const hour = 8 + Math.floor(rnd() * 15);

      // age-dependent lifecycle: old orders are delivered, fresh ones still moving
      let status, deliveredAt = null, shippedAt = null;
      if (back > 9) {
        status = rnd() < 0.93 ? "Delivered" : "Returned";
        const shipD = new Date(d); shipD.setDate(shipD.getDate() + 1);
        const delD = new Date(d); delD.setDate(delD.getDate() + 2 + Math.floor(rnd() * 4));
        shippedAt = iso(shipD);
        if (status === "Delivered") deliveredAt = iso(delD);
      } else if (back > 4) {
        const roll = rnd();
        status = roll < 0.55 ? "Delivered" : roll < 0.85 ? "Shipped" : "Processing";
        const shipD = new Date(d); shipD.setDate(shipD.getDate() + 1);
        if (status !== "Processing") shippedAt = iso(shipD);
        if (status === "Delivered") {
          const delD = new Date(d); delD.setDate(delD.getDate() + 3);
          deliveredAt = iso(delD);
        }
      } else {
        const roll = rnd();
        status = roll < 0.42 ? "Pending" : roll < 0.75 ? "Processing" : "Shipped";
        if (status === "Shipped") {
          const shipD = new Date(d); shipD.setDate(shipD.getDate() + 1);
          shippedAt = iso(shipD);
        }
      }

      for (let L = 0; L < lines; L++) {
        const p = weighted(PRODUCTS.map((x, idx) => ({ ...x, w: 14 - idx * 0.7 })));
        const qty = rnd() < 0.85 ? 1 : 2;
        orders.push({
          ref,
          sub: ref + "-" + (L + 1),
          day,
          hour,
          status,
          qty,
          sku: p.sku,
          product: p.product,
          category: p.category,
          pay,
          price: Math.round(p.price * qty * (rnd() < 0.3 ? 0.9 : 1)),
          city: place.city,
          state: place.state,
          channel,
          delivered: deliveredAt,
          shipped: shippedAt,
          courier: pickOne(COURIERS),
        });
      }
    }

    // cancellations run ~6% of order volume
    const nCanc = Math.round(nOrders * (0.04 + rnd() * 0.05));
    for (let i = 0; i < nCanc; i++) {
      const p = pickOne(PRODUCTS);
      cancellations.push({
        order: "PM" + (39000 + Math.floor(rnd() * 4000)),
        day,
        sku: p.sku,
        product: p.product,
        qty: 1,
        value: p.price,
        by: rnd() < 0.62 ? "Customer" : rnd() < 0.5 ? "Seller" : "System",
        reason: weighted(CANCEL_REASONS, "w").r,
        channel: weighted(CHANNELS).name,
      });
    }
  }

  // aging: every order still open, with its true age in days
  const todayStr = iso(today);
  const aging = [];
  const openSeen = new Set();
  for (const o of orders) {
    if (["Delivered", "Returned", "Cancelled"].includes(o.status)) continue;
    if (openSeen.has(o.ref)) continue;
    openSeen.add(o.ref);
    const age = Math.round((new Date(todayStr) - new Date(o.day)) / 86400000);
    aging.push({
      order: o.ref,
      day: o.day,
      age,
      status: o.status === "Shipped" ? "In Transit" : "Pending",
      ship: pickOne(SHIP_STATES),
      product: o.product,
      sku: o.sku,
      state: o.state,
      value: o.price,
    });
  }
  // a handful of genuinely stuck old orders, so the aging alert has teeth
  for (let i = 0; i < 6; i++) {
    const p = pickOne(PRODUCTS);
    const place = pickOne(PLACES);
    const age = 9 + Math.floor(rnd() * 14);
    const d = new Date(today); d.setDate(d.getDate() - age);
    aging.push({
      order: "PM" + (38000 + i),
      day: iso(d),
      age,
      status: "Pending",
      ship: "On hold",
      product: p.product,
      sku: p.sku,
      state: place.state,
      value: p.price,
    });
  }

  // stock: mix of healthy, low and out-of-stock SKUs
  const stock = PRODUCTS.map((p, i) => {
    const bucket = i % 4;
    const available = bucket === 0 ? Math.floor(rnd() * 6)
      : bucket === 1 ? 6 + Math.floor(rnd() * 14)
      : 40 + Math.floor(rnd() * 180);
    return {
      sku: p.sku,
      product: p.product,
      category: p.category,
      available,
      reserved: Math.floor(rnd() * 12),
      toReceive: rnd() < 0.4 ? Math.floor(rnd() * 120) : 0,
      damaged: rnd() < 0.3 ? Math.floor(rnd() * 5) : 0,
      mrp: p.price,
    };
  });

  return {
    orders,
    cancellations,
    aging,
    stock,
    generatedAt: today.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }),
    demo: true,
  };
}
