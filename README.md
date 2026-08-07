# PrepMarket Orders Intelligence Hub

Live leadership dashboard for preponline.in. Data source: the Google Sheet where
EasyEcom exports are pasted daily into 4 tabs:
`Orders_Raw`, `Cancellations_Raw`, `Aging_Raw`, `Stock_Raw`.

## See it on localhost

```bash
cp .env.example .env.local   # then put your Sheet ID in it
npm run dev                  # -> http://localhost:3000
```

No Vercel CLI, no login, no dependencies to install. If the Google Sheet can't be
read, the dashboard still loads with generated sample data and shows an amber
PREVIEW MODE banner explaining why — so the UI is always previewable.

```bash
npm run demo         # force sample data, never contacts the Sheet
$env:PORT=3001; npm run dev    # if port 3000 is taken (PowerShell)
```

## Sheet access

The Sheet is shared as "Anyone with the link – Viewer" and the dashboard reads it
live. If it is ever set back to private, Google returns a login page, the API
fails, and the local server falls back to sample data with an amber PREVIEW MODE
banner explaining why. Fix by re-sharing:

> Sheet → **Share** → General access → **"Anyone with the link"** → **Viewer**

### Derived money figures

Three columns the dashboard wants don't exist in the EasyEcom exports:

| Missing | Where | Filled from |
|---|---|---|
| cancelled order value | `Cancellations_Raw` | avg unit selling price of that SKU in `Orders_Raw` |
| backlog order value | `Aging_Raw` | same |
| MRP for stock valuation | `Stock_Raw` | `MRP` / selling price of that SKU in `Orders_Raw` |

The API flags whatever it had to derive (`estimated` in the JSON) and the KPI
cards say "est. from SKU price" instead of presenting derived numbers as
reported ones. Add a real value column to those tabs and the estimates switch
off automatically.

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
- `api/data.js` — Vercel serverless function; reads the Sheet, returns JSON
- `dev/server.mjs` — local preview server (`npm run dev`), not deployed
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

## Daily routine

Paste fresh EasyEcom exports into the Sheet's raw tabs (data rows only, below the
headers). The dashboard auto-refreshes every 2 minutes; leaders can also press
Refresh. Nothing to redeploy.

## Notes on the data layer

- Column matching is **tolerant**: headers are compared with casing, spaces and
  punctuation stripped, with a substring fallback. `Selling Price`,
  `selling_price` and `Selling  Price` all resolve. Renaming a column in the
  sheet won't silently blank a metric.
- Orders and cancellations are de-duplicated by suborder number, so pasting
  overlapping date ranges never double counts.
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
