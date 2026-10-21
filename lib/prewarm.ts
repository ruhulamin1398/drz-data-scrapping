// Pre-warm (ISR cache warming) core: sitemap load + single-URL revalidate.
// One call = one POST to the frontend admin revalidate-page endpoint, which
// marks the page stale, cold-renders it (prewarm) and stamps the sitemap store.
// warmed=true (<400 render) counts as warmed (success).
import { Pool } from "pg";
import { env } from "./env";

export const REVALIDATE_TIMEOUT_MS = 30000;

export type RevalidateResult = { ok: boolean; code: number; durationMs: number; reason?: string };

// Flatten undici's AggregateError/`cause` chain (e.g. ECONNRESET, ENETUNREACH,
// certificate errors) so a bare "fetch failed" becomes actionable.
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const any = e as Error & { code?: string; cause?: unknown; errors?: unknown[] };
  const parts = [any.message];
  if (any.code) parts.push(any.code);
  if (Array.isArray(any.errors)) for (const x of any.errors) parts.push(describeError(x));
  else if (any.cause) parts.push(describeError(any.cause));
  return [...new Set(parts)].join(" | ");
}

type RevalidateResponse = {
  revalidated?: boolean;
  invalid?: string[];
  store?: { validated?: number; missing?: string[]; error?: string };
  warmed?: { path?: string; warmed?: boolean; status?: number; error?: string }[];
} | null;

// POST one page path ("/doctors/x"; origin stripped, query/fragment rejected)
// to the base URL configured on /prewarm (settings.revalidate_base_url — not an
// env var, editable at any time). Throws on network/timeout; resolves with the
// outcome otherwise. Success = HTTP 2xx and warmed[0].warmed === true;
// store.missing / store.error are informational, not failures. Failures keep
// the complete API response body in `reason` (no truncation).
export async function revalidateUrl(url: string, baseUrl: string, timeoutMs = REVALIDATE_TIMEOUT_MS): Promise<RevalidateResult> {
  if (!url) throw new Error("url required");
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("revalidate base URL not configured (set it on /prewarm)");
  if (!/^https?:\/\//i.test(base)) throw new Error(`invalid revalidate base URL: ${baseUrl}`);
  let path: string;
  try {
    path = new URL(url.trim()).pathname;
  } catch {
    throw new Error(`invalid url: ${url}`);
  }
  const secret = env("REVALIDATE_SECRET");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/admin/revalidate-page`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ url: path }),
    });
    const raw = await res.text().catch(() => "");
    let data: RevalidateResponse = null;
    try { data = raw ? JSON.parse(raw) as RevalidateResponse : null; } catch { /* non-JSON body */ }
    const w = data?.warmed?.[0];
    const ok = res.ok && w?.warmed === true;
    // Explain *why* it failed (the API can answer 200 while the cold render
    // failed) and keep the entire response body for investigation.
    let reason: string | undefined;
    if (!ok) {
      const body = raw.trim() || "(empty body)";
      const missing = data?.store?.missing?.includes(path) === true;
      if (!res.ok) reason = `revalidate api http ${res.status}: ${body}`;
      else if (data?.invalid?.includes(path)) reason = `invalid path: ${body}`;
      else if (!w) reason = `not warmed: no warmed entry in response: ${body}`;
      else if (w.error) reason = `not warmed: ${w.error}${missing ? " (not in store)" : ""} · response: ${body}`;
      else if (w.status != null) reason = `not warmed: http ${w.status}${missing ? " (not in store)" : ""} · response: ${body}`;
      else reason = `not warmed: no status in response: ${body}`;
    }
    return { ok, code: w?.status ?? res.status, durationMs: Date.now() - started, reason };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw new Error(`revalidate timeout after ${timeoutMs}ms`);
    throw new Error(`revalidate request to ${base}/api/admin/revalidate-page failed: ${describeError(e)}`);
  } finally {
    clearTimeout(t);
  }
}

const SITEMAP_TIMEOUT_MS = 30000;

async function fetchXml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SITEMAP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (DRZ prewarm)" },
    });
    if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

const locRe = /<loc>\s*([^<>\s]+)\s*<\/loc>/gi;

// Load every page URL from a sitemap (follows sitemapindex nesting, depth ≤ 3).
// Returns deduped absolute URLs.
export async function loadSitemapUrls(sitemapUrl: string, depth = 0): Promise<string[]> {
  if (!/^https?:\/\//i.test(sitemapUrl)) throw new Error("sitemapUrl must be http(s)");
  if (depth > 3) return [];
  const xml = await fetchXml(sitemapUrl);
  const out = new Set<string>();
  if (/<sitemapindex[\s>]/i.test(xml)) {
    const kids: string[] = [];
    for (const m of xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)) {
      locRe.lastIndex = 0;
      const l = locRe.exec(m[1]);
      if (l?.[1]) {
        try { kids.push(new URL(l[1].trim(), sitemapUrl).toString()); } catch { /* skip bad */ }
      }
    }
    for (const kid of kids) {
      for (const u of await loadSitemapUrls(kid, depth + 1)) out.add(u);
    }
    return [...out];
  }
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    locRe.lastIndex = 0;
    const l = locRe.exec(m[1]);
    if (l?.[1]) {
      try { out.add(new URL(l[1].trim(), sitemapUrl).toString()); } catch { /* skip bad */ }
    }
  }
  return [...out];
}

// Upsert discovered URLs as pending (existing rows keep their status).
export async function upsertPrewarmUrls(pool: Pool, urls: string[]): Promise<{ discovered: number; inserted: number }> {
  const uniq = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  if (!uniq.length) return { discovered: 0, inserted: 0 };
  let inserted = 0;
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500);
    const vals: string[] = [];
    const ph = chunk.map((u, j) => { vals.push(u); return `($${j + 1}, 'pending')`; }).join(", ");
    const r = await pool.query(
      `INSERT INTO prewarm_queue (source_url, status) VALUES ${ph}
       ON CONFLICT (source_url) DO NOTHING`,
      vals
    ).catch(() => null);
    inserted += r?.rowCount ?? 0;
  }
  return { discovered: uniq.length, inserted };
}
