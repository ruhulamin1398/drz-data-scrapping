import { db } from "./db";

// Jina key pool: keys live in settings.jina_keys (one per line, managed from
// /settings), env JINA_API_KEY is the fallback. Rotation is automatic:
// - 429 (per-minute limit) → cool that key down 65s, continue with next key
// - 402 (balance) / 401 (invalid) → skip key for the rest of the session
// The rotation cursor persists in settings.jina_key_idx so every host
// (Vercel, Render, local scripts) shares the load evenly.

export function parseKeys(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

const cooldownUntil = new Map<string, number>();
const deadKeys = new Set<string>();
let memIdx = 0;

export async function loadJinaKeys(): Promise<string[]> {
  let rows: { jina_keys?: string; jina_key_idx?: number } | undefined;
  try {
    const r = await db().query("SELECT jina_keys, jina_key_idx FROM settings WHERE id=1");
    rows = r.rows[0];
    if (typeof rows?.jina_key_idx === "number") memIdx = rows.jina_key_idx;
  } catch { /* settings table may predate columns — fall through to env */ }
  const keys = parseKeys(rows?.jina_keys);
  const envKey = (process.env.JINA_API_KEY || "").trim();
  if (envKey && !keys.includes(envKey)) keys.push(envKey);
  return keys;
}

async function saveIdx(pool: { query: (t: string, v?: unknown[]) => Promise<unknown> }, idx: number): Promise<void> {
  try {
    await pool.query("UPDATE settings SET jina_key_idx=$1, updated_at=now() WHERE id=1", [idx]);
  } catch { /* ignore */ }
}

export async function jinaFetch(url: string): Promise<string> {
  const target = url.startsWith("https://r.jina.ai/") ? url : `https://r.jina.ai/${url}`;
  const keys = await loadJinaKeys();
  if (!keys.length) throw new Error("no Jina keys: add keys on /settings or set JINA_API_KEY");
  const now = Date.now();
  const live = keys.filter((k) => !deadKeys.has(k) && (cooldownUntil.get(k) ?? 0) <= now);
  const order = live.length ? live : keys.filter((k) => !deadKeys.has(k));
  if (!order.length) throw new Error("all Jina keys exhausted (balance/invalid)");
  const startPos = memIdx % order.length;
  let lastErr = "";
  for (let i = 0; i < order.length; i++) {
    const key = order[(startPos + i) % order.length];
    if ((cooldownUntil.get(key) ?? 0) > Date.now()) continue;
    const res = await fetch(target, { headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) {
      memIdx = (keys.indexOf(key) + 1) % keys.length;
      await saveIdx(db(), memIdx).catch(() => {});
      return res.text();
    }
    const t = await res.text().catch(() => "");
    lastErr = `fetch failed: ${res.status} ${t.slice(0, 200)}`;
    if (res.status === 429) {
      cooldownUntil.set(key, Date.now() + 65000); // per-minute limit: rest this key
      continue; // next key serves meanwhile
    }
    if (res.status === 402 || res.status === 401) {
      deadKeys.add(key); // balance gone / invalid: stop trying it this session
      continue;
    }
    throw new Error(lastErr); // other errors (5xx etc.) fail fast, same as before
  }
  throw new Error(lastErr || "all Jina keys cooling down — retry shortly");
}
