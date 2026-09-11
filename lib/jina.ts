import { db } from "./db";

// Single Jina key, managed from /settings (settings.jina_keys, first line),
// env JINA_API_KEY as fallback. No rotation — one key, cron-paced like the
// doctor scraping. Fetched pages are stored to structure_md for reuse.

export async function loadJinaKey(): Promise<string> {
  try {
    const r = await db().query("SELECT jina_keys FROM settings WHERE id=1");
    const first = String(r.rows[0]?.jina_keys ?? "")
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.length > 10);
    if (first) return first;
  } catch { /* pre-migration: env only */ }
  const envKey = (process.env.JINA_API_KEY || "").trim();
  if (envKey) return envKey;
  throw new Error("no Jina key: add one on /settings or set JINA_API_KEY");
}

export async function jinaFetch(url: string): Promise<string> {
  const target = url.startsWith("https://r.jina.ai/") ? url : `https://r.jina.ai/${url}`;
  const key = await loadJinaKey();
  const res = await fetch(target, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`fetch failed: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.text();
}
