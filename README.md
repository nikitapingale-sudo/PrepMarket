# PrepMarket Orders Intelligence Hub

Live leadership dashboard for preponline.in.

| Data | Source |
|---|---|
| **Orders** (sales, cancellations, pendency) | Shopify orders export: `Desktop\Shopify Orders Report.xlsx` |
| Courier / AWB / dispatch & delivery dates | Google Sheet tab `Prepmarket Order Data` |
| Conversion | Google Sheet tab `Prepmarket_Conversion` |
| Inventory, bundles, lots | Inventory spreadsheets (`INVENTORY_SHEET_ID`, `LOT_SHEET_ID`) |
| Banner clicks, funnel | Trino (`clicks-snapshot.json` on Vercel) |

## See it on localhost

```bash
cp .env.example .env.local   # then fill in the Sheet IDs
npm run setup                # once: installs the Excel reader into dev/
npm run dev                  # -> http://localhost:3000
```

Locally the orders are read **live** from the Desktop Excel. Save a new export
over the same file and the next refresh (Refresh button, `R`, or the 2-minute
auto-refresh) shows it. If the Excel can't be read, the last published snapshot
is used and a banner says why.

```bash
npm run demo         # force sample data, never contacts the Sheet
$env:PORT=3001; npm run dev    # if port 3000 is taken (PowerShell)
```

## Daily routine

1. Export orders from Shopify (all orders, same columns) and save over
   `Desktop\Shopify Orders Report.xlsx`. Localhost picks it up on the next refresh.
2. To update the **live Vercel site**: `npm run publish-orders`. This writes
   `api/_data/orders-snapshot.json` (PII-free) and pushes only that file;
   Vercel rebuilds in about a minute. Vercel cannot read your Desktop, so this
   step is the only way new orders reach the live site.
3. `npm run deploy` also refreshes the snapshot before publishing code changes.

Different file? Set `ORDERS_EXCEL=C:/path/file.xlsx` in `.env.local` (forward slashes).

## Sign-in and admin upload

- Everyone signs in with an **email id + purpose** (no password, no OTP). It
  records who uses the dashboard; it is not access control.
- **Admin** (`nikita.pingale@pw.live`) also enters the **admin key** on the sign-in
  screen. That unlocks **Upload orders** (load a new Shopify export for everyone,
  no commands needed) and **Logins** (who signed in, when and why, with Excel export).
  The key is checked by the server on every admin request, so typing the admin
  email alone does nothing.
- The key lives in `ADMIN_KEY` (Vercel env vars + `.env.local`). With no key set,
  nobody is admin.
- Uploads and the sign-in log are stored in the private Vercel Blob store
  `prepmarket-dashboard-data` (`BLOB_READ_WRITE_TOKEN`). Locally without that
  token they go to `.local-store/`.
- Whichever orders file was **saved most recently** wins: an upload, the committed
  snapshot (`npm run publish-orders`), or the live Desktop Excel (local only).

## Shopify order rules

- One export row = one line item. Rows are grouped by `Name` (the order number);
  order-level fields take the first filled value across the order's rows.
- **Status** comes from `Tags`, in priority order: Cancelled -> RTO Delivered ->
  RTO In Transit -> Delivered -> In Transit -> Order Received. No status tag:
  `Shipped` if fulfilled, else `Pending`. `Cancelled at` is ignored (it is also
  stamped on RTO orders).
- **Status filter** is built from `Tags`: the status tag (lifecycle order, order
  counts), then the other tags as **flags** (Order Dispute, To be Refunded,
  Refund Initiated, Return Pending, Refunded). Ticking a flag narrows to orders
  carrying it, so Delivered + Order Dispute = delivered orders with a dispute.
  Cancelled / RTO are unticked by default so revenue reflects live business.
- **Warehouse** comes from `Tags`: `AAJ-01` -> AAJ, `Prep-02` -> PrepOnline. Both or
  neither: listed in the `Prepmarket Order Data` tab -> PrepOnline, else AAJ.
- **Payment**: `Shipping Method` "Cash on Delivery" -> COD, else PrePaid.
- **Revenue** per line = price x qty, scaled so an order's lines add up to its
  `Subtotal` (coupon spread across lines; shipping excluded).
- **Category**: Shopify has none. Known SKUs use `api/_categories.js` (seeded from
  EasyEcom); new SKUs are classified from the title.
- **Test orders** (tag "Test Orders") are excluded.
- **Cancellations** = orders tagged Cancelled. Shopify has no cancel reason or
  "cancelled by", so Operations shows the refund status (from Tags) and the
  payment mode in those slots.
- **Pendency** = unfulfilled, not cancelled / RTO. Age is counted to the date the
  export was saved.
- **Prepmarket Order Data tab** enriches only: courier, AWB, dispatch and delivery
  dates. Its tracking status is used only when Tags have no status; any
  disagreement is listed in the Data Explorer.
- **No PII** reaches the snapshot or the browser: no names, emails, phones or
  addresses; only city and state.

## Sheet access

The Sheets are shared as "Anyone with the link – Viewer" and read live. If one is
set back to private, Google returns a login page and that part of the dashboard
reports the error. Fix by re-sharing:

> Sheet → **Share** → General access → **"Anyone with the link"** → **Viewer**

## What's on the dashboard

Five tabs, all driven by one shared filter bar (date presets or a custom range,
channel, payment, state, category, status, and free-text search). Every tab is
deep-linkable: `/#sales`, `/#ops`, `/#inventory`, `/#explorer`.

| Tab | Contents |
|---|---|
| **Overview** | 12 KPI cards with sparklines and period-over-period deltas, auto-generated insights, orders/revenue trend (daily, cumulative or 7-day average, with optional previous-period overlay), channel / payment / category mix, status pipeline |
| **Sales & Demand** | 6 sales KPIs, revenue by day of week, orders by hour, day×hour demand heatmap, top SKUs / states / cities, channel and category performance |
| **Operations** | 6 ops KPIs, cancellations by day, cancelled-by split, cancellation-reason Pareto, order-aging histogram, courier split, reason detail, ageing orders |
| **Inventory** | 6 stock KPIs, lowest-stock SKUs, stock by category, stock alerts, full ledger with **days of cover** derived from the current sales rate |
| **Data Explorer** | Every order line item — sortable, paginated, searchable — plus a daily summary |

Interactions: click any doughnut slice or bar to filter the whole dashboard by
it; sort any table by clicking a header; active filters show as removable chips.
Keyboard: `R` refresh, `/` search, `E` export, `T` toggle light/dark theme.

## Excel export

- Every table has its own **⤓ EXCEL** button.
- **Export Excel** in the header builds one workbook containing all 11 tables,
  plus a "Report Info" sheet recording the filters that produced it.
- Exports contain raw values (numbers stay numbers), not display strings, so
  they pivot and sum correctly in Excel.
- If the SheetJS CDN is ever blocked, exports fall back to CSV automatically.

## Files

- `index.html` — the whole dashboard UI (Chart.js + SheetJS from CDN)
- `api/data.js` — Vercel serverless function; builds the JSON the UI reads
- `api/_shopify.js` — Shopify export -> order lines (pure, shared by API and sync)
- `api/_categories.js` — SKU -> category seed map
- `api/_data/orders-snapshot.json` — generated by `npm run sync-orders`; do not edit
- `dev/server.mjs` — local preview server (`npm run dev`), not deployed
- `dev/excel-orders.mjs`, `dev/sync-orders.mjs` — Excel reader and snapshot writer
- `dev/demo-data.mjs` — sample-data generator for preview mode, not deployed
- `vercel.json`, `package.json`, `.vercelignore` — config

## Deploy to Vercel

**GitHub (recommended):** push this folder to a repo, then vercel.com → Add New →
Project → Import → Deploy.

**CLI:**
```bash
npm i -g vercel
vercel          # preview deploy
vercel --prod   # production link
```

## Notes on the data layer

- Column matching is **tolerant**: headers are compared with casing, spaces and
  punctuation stripped, with a substring fallback. `Selling Price`,
  `selling_price` and `Selling  Price` all resolve. Renaming a column in the
  sheet won't silently blank a metric.
- All date maths runs in UTC. Building a local-midnight `Date` and reading it
  back with `toISOString()` shifts the day in any timezone ahead of UTC (in IST
  it moved every order back a day and broke the daily series) — don't reintroduce
  that pattern.
- The API response is edge-cached for 60s so many viewers don't hammer Google.
- Sharing the Sheet as "Anyone with link – Viewer" means the raw data is readable
  by anyone with the sheet link. The dashboard itself only exposes order ref,
  product, city/state and amounts — no customer names or phone numbers.

## Configuration

`SHEET_ID` is an **environment variable**, not a value in the code. That is
deliberate: this repo is public, the Sheet is shared "anyone with the link", and
its raw tabs contain customer names, phone numbers and addresses — so the ID
must not sit in version control.

| Where | How to set it |
|---|---|
| Local | `.env.local` (gitignored) — copy `.env.example` |
| Vercel | Project Settings → Environment Variables → `SHEET_ID` |

Without it the API returns a clear error telling you which one to set. The
`TABS` map (tab names) is still at the top of `api/data.js` — that isn't secret.

> **Note:** anyone with the deployed dashboard URL can read the data it serves.
> Keep the Vercel URL private, or put Vercel Authentication in front of it
> (Project Settings → Deployment Protection).
