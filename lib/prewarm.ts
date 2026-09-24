// Pre-warm (ISR cache warming) core: sitemap load + single-URL visit.
// One visit = one plain GET; HTTP < 400 counts as warmed (success).
import { Pool } from "pg";

export const VISIT_TIMEOUT_MS = 30000;

export type VisitResult = { ok: boolean; code: number; durationMs: number };

// GET a page so its ISR cache generates. Throws on network/timeout;
// resolves with the status code otherwise (<400 = ok).
export async function visitUrl(url: string, timeoutMs = VISIT_TIMEOUT_MS): Promise<VisitResult> {
  if (!url) throw new Error("url required");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (DRZ prewarm)" },
    });
    // Drain the body so the page fully renders/caches upstream.
    await res.arrayBuffer().catch(() => {});
    const code = res.status;
    return { ok: code < 400, code, durationMs: Date.now() - started };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw new Error(`visit timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function fetchXml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), VISIT_TIMEOUT_MS);
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
