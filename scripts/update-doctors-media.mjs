// Update task (not create): one by one over success rows with drx_id.
// Per doctor:
//   1. Jina markdown -> saved to structure_md (reused, never re-fetch later)
//   2. profile og:image -> PATCH { photo }
//   3. years of experience: regex from MD first, nex-router model if needed -> PATCH { experienced_year }
// Usage: node scripts/update-doctors-media.mjs
// Resume-safe: completed ids in /tmp/media-update-done.json
import fs from "fs";
import pg from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const BASE = (process.env.DRX_API_BASE || "https://drx-backend.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.DRX_ADMIN_TOKEN || "";
if (!TOKEN) throw new Error("DRX_ADMIN_TOKEN required");
const NEX_URL = process.env.NEX_ROUTER_URL || "https://nex-router.onrender.com/api/v1/chat/completions";
const NEX_MODEL = process.env.NEX_MODEL || "gemini";

// Single Jina key from /settings, env fallback.
let jinaKey = "";
try {
  const r = await pool.query("SELECT jina_keys FROM settings WHERE id=1");
  jinaKey = String(r.rows[0]?.jina_keys ?? "").split("\n").map((s) => s.trim()).find((s) => s.length > 10) || "";
} catch { /* pre-migration */ }
if (!jinaKey) jinaKey = (process.env.JINA_API_KEY || "").trim();
if (!jinaKey) throw new Error("no Jina key: add one on /settings or set JINA_API_KEY");

const DONE_FILE = "/tmp/media-update-done.json";
const done = new Set(fs.existsSync(DONE_FILE) ? JSON.parse(fs.readFileSync(DONE_FILE, "utf8")) : []);
const save = () => fs.writeFileSync(DONE_FILE, JSON.stringify([...done]));

async function jinaFetch(url) {
  const res = await fetch(`https://r.jina.ai/${url}`, { headers: { Authorization: `Bearer ${jinaKey}` } });
  if (!res.ok) throw new Error(`jina ${res.status}`);
  return res.text();
}

async function fetchPhoto(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
    });
    clearTimeout(t);
    if (!res.ok) return "";
    const html = await res.text();
    const m = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html);
    const img = (m?.[1] ?? "").trim();
    if (!/^https?:\/\//i.test(img)) return "";
    if (/logo|icon|placeholder|default|banner|favicon|doctor-bd/i.test(img)) return "";
    return img;
  } catch { return ""; }
}

// Regex first: "15 years of experience", "experience of over 20 years", "15+ years ...".
function regexYears(md) {
  const pats = [
    /(\d{1,2})\s*\+\s*years?/i,
    /(\d{1,2})\s*years?\s*(of\s*)?(experience|experienced|practice|practicing|service|serving)/i,
    /experien\w*\s*(of|over|:)?\s*(over|more than|about|around|nearly|almost)?\s*(\d{1,2})\s*years?/i,
    /(over|more than)\s*(\d{1,2})\s*years?/i,
  ];
  for (const p of pats) {
    const m = p.exec(md);
    if (m) {
      const n = Number(m.slice(1).reverse().find((x) => /^\d+$/.test(x || "")));
      if (n >= 0 && n <= 60) return n;
    }
  }
  return null;
}

async function modelYears(md) {
  const prompt = `From the doctor profile text below, output ONLY the integer number of years of professional experience (e.g. 15). If the text states no years of experience, output ONLY 0. No words, no explanation.\n\n${md.slice(0, 3000)}`;
  const res = await fetch(NEX_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: NEX_MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 20, temperature: 0.0, stream: false }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const n = Number(String(data?.choices?.[0]?.message?.content ?? "").trim().match(/\d+/)?.[0]);
  return Number.isFinite(n) && n >= 0 && n <= 60 ? n : null;
}

async function patchDoctor(drxId, payload) {
  const r = await fetch(`${BASE}/api/v1/doctors/${drxId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`patch ${r.status}: ${(await r.text()).slice(0, 120)}`);
}

const { rows } = await pool.query(
  "SELECT id, source_url, drx_id, name, structure_md FROM doctor_queue WHERE status='success' AND drx_id IS NOT NULL ORDER BY id"
);
const todo = rows.filter((r) => !done.has(r.id));
const max = Number(process.env.MAX || 0);
const run = max > 0 ? todo.slice(0, max) : todo;
console.log(`total: ${rows.length}, done: ${done.size}, todo: ${todo.length}, running: ${run.length}`);

let patched = 0, mdSaved = 0, noPhoto = 0, noYears = 0, modelCalls = 0, failed = 0;
for (const row of run) {
  try {
    let md = row.structure_md;
    if (!md) {
      md = await jinaFetch(row.source_url);
      await pool.query("UPDATE doctor_queue SET structure_md=$2, updated_at=now() WHERE id=$1", [row.id, md]);
      mdSaved++;
    }
    const photo = await fetchPhoto(row.source_url);
    let years = regexYears(md);
    if (years === null && /experien/i.test(md)) {
      modelCalls++;
      years = await modelYears(md);
    }
    const payload = {};
    if (photo) payload.photo = photo; else noPhoto++;
    if (years) payload.experienced_year = years; else noYears++;
    if (Object.keys(payload).length) {
      await patchDoctor(row.drx_id, payload);
      patched++;
    }
  } catch (e) {
    failed++;
    console.log(`FAIL ${row.id} ${row.source_url}: ${String(e).slice(0, 120)}`);
  }
  done.add(row.id);
  if (done.size % 50 === 0) {
    save();
    console.log(`progress ${done.size}/${rows.length} patched=${patched} mdSaved=${mdSaved} noPhoto=${noPhoto} noYears=${noYears} model=${modelCalls} failed=${failed}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
save();
console.log(`FINAL patched=${patched} mdSaved=${mdSaved} noPhoto=${noPhoto} noYears=${noYears} model=${modelCalls} failed=${failed}`);
await pool.end();
