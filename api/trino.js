/**
 * Minimal Trino/Presto client over the REST protocol - no dependencies.
 *
 * Used to read banner-click data straight from the warehouse instead of via a
 * pasted Google Sheet tab. Activates only when TRINO_URL is configured; without
 * it the dashboard falls back to the Banner_Clicks sheet tab, so nothing breaks
 * if the credentials are missing.
 *
 * Environment variables (set in Vercel > Project Settings > Environment Variables):
 *   TRINO_URL       required, e.g. https://trino.yourcompany.com
 *   TRINO_USER      required, the query user
 *   TRINO_PASSWORD  optional, enables HTTP Basic auth
 *   TRINO_TOKEN     optional, enables Bearer auth (use instead of password)
 *   TRINO_CATALOG   optional, default catalog
 *   TRINO_SCHEMA    optional, default schema
 *
 * Trino's protocol is a poll loop: POST the SQL, then follow `nextUri` until it
 * stops coming back, accumulating `data` as you go.
 */

const MAX_POLLS = 60;      // safety net so a stuck query cannot spin forever
const POLL_PAUSE_MS = 250;

/**
 * Whole-operation budget. This must stay well under the serverless function
 * limit (10s on Vercel Hobby): the Trino host resolves to a private 10.x
 * address, so from outside the corporate network the connection HANGS rather
 * than refusing. Without a hard abort that would stall /api/data and take the
 * entire dashboard down, not just this one page.
 */
const DEFAULT_BUDGET_MS = Number(process.env.TRINO_TIMEOUT_MS) || 8000;

async function fetchWithTimeout(url, opts, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(500, ms));
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error(
        `Trino did not respond within ${Math.round(ms / 1000)}s. The host resolves to a private ` +
        `address, so it is only reachable from inside the corporate network.`
      );
    }
    throw new Error(`Cannot reach Trino: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export function trinoConfigured() {
  return Boolean(process.env.TRINO_URL && process.env.TRINO_USER);
}

function authHeaders() {
  const h = {
    "X-Trino-User": process.env.TRINO_USER,
    "X-Trino-Source": "prepmarket-dashboard",
    "User-Agent": "prepmarket-dashboard",
  };
  if (process.env.TRINO_CATALOG) h["X-Trino-Catalog"] = process.env.TRINO_CATALOG;
  if (process.env.TRINO_SCHEMA) h["X-Trino-Schema"] = process.env.TRINO_SCHEMA;

  if (process.env.TRINO_TOKEN) {
    h.Authorization = "Bearer " + process.env.TRINO_TOKEN;
  } else if (process.env.TRINO_PASSWORD) {
    const raw = `${process.env.TRINO_USER}:${process.env.TRINO_PASSWORD}`;
    h.Authorization = "Basic " + Buffer.from(raw).toString("base64");
  }
  return h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs SQL and returns [{column: value, ...}, ...].
 * Throws with a readable message so the dashboard can surface the real reason.
 */
export async function trinoQuery(sql, { timeoutMs = DEFAULT_BUDGET_MS } = {}) {
  if (!trinoConfigured()) throw new Error("Trino is not configured (TRINO_URL / TRINO_USER unset).");

  const base = String(process.env.TRINO_URL).replace(/\/+$/, "");
  const started = Date.now();
  const left = () => timeoutMs - (Date.now() - started);

  let res = await fetchWithTimeout(base + "/v1/statement", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "text/plain" },
    body: sql,
  }, left());
  if (!res.ok) {
    throw new Error(`Trino rejected the query (HTTP ${res.status}). Check TRINO_URL and credentials.`);
  }

  let payload = await res.json();
  let columns = payload.columns || null;
  const rows = [];

  for (let i = 0; i < MAX_POLLS; i++) {
    if (payload.error) {
      const e = payload.error;
      throw new Error(`Trino error: ${e.message || e.errorName || "unknown"}`);
    }
    if (payload.columns) columns = payload.columns;
    if (payload.data) rows.push(...payload.data);

    if (!payload.nextUri) break;
    if (left() <= 0) {
      throw new Error(`Trino query exceeded ${Math.round(timeoutMs / 1000)}s. Narrow the date range.`);
    }

    // QUEUED/RUNNING states come back with no data; pause so we don't hammer it
    if (!payload.data) await sleep(POLL_PAUSE_MS);

    const next = await fetchWithTimeout(payload.nextUri, { headers: authHeaders() }, left());
    if (!next.ok) throw new Error(`Trino polling failed (HTTP ${next.status}).`);
    payload = await next.json();
  }

  if (!columns) return [];
  const names = columns.map((c) => c.name);
  return rows.map((r) => {
    const o = {};
    names.forEach((n, i) => { o[n] = r[i]; });
    return o;
  });
}

const WHERE = (days) => `
WHERE event_datetime >= current_timestamp - INTERVAL '${Number(days) || 90}' DAY
  AND lower(element_at(event_params, 'redirection_url').string_value) LIKE 'https://prepmarket.live/%'`;

/** Their banner-click query, with a rolling window so it stays current. */
export function bannerClicksSql(days = 90) {
  return `
SELECT
    date(event_datetime)                                     AS event_date,
    element_at(event_params, 'page_location').string_value   AS page_location,
    element_at(event_params, 'redirection_url').string_value AS redirection_url,
    count(*)                                                 AS total_clicks,
    count(distinct user_id)                                  AS distinct_users
FROM pw_bq.silver_dbt_category_banner_click${WHERE(days)}
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC`.trim();
}

/**
 * Distinct users per DAY, queried separately because distinct counts cannot be
 * added up. Summing the per-row user counts from the query above would count
 * one person once per banner they clicked. This gives an accurate figure for
 * each day, which the dashboard sums with that caveat stated on screen.
 */
export function bannerUsersByDaySql(days = 90) {
  return `
SELECT
    date(event_datetime)    AS event_date,
    count(distinct user_id) AS distinct_users
FROM pw_bq.silver_dbt_category_banner_click${WHERE(days)}
GROUP BY 1
ORDER BY 1 DESC`.trim();
}
