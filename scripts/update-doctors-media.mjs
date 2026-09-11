// Update task (not create): one by one over success rows with drx_id.
// Per doctor (raw HTML parsed once, no AI):
//   1. Jina markdown -> saved to structure_md (reused, never re-fetch later)
//   2. photo: og:image -> body wp-post-image fallback (placeholders dr-male/
//      dr-female excluded; PATCH null clears a previously-set placeholder)
//   3. experienced_year: structured <li class="experience" title="Experiences">
//      ("15+ Years of Experience") — empty element means no data, skip honestly
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

const PLACEHOLDER = /dr-male|dr-female|doctor-bd|logo|icon|placeholder|default|banner|favicon/i;

async function jinaFetch(url) {
  const res = await fetch(`https://r.jina.ai/${url}`, { headers: { Authorization: `Bearer ${jinaKey}` } });
  if (!res.ok) throw new Error(`jina ${res.status}`);
  return res.text();
}

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
    });
    clearTimeout(t);
    if (!res.ok) return "";
    return await res.text();
  } catch { clearTimeout(t); return ""; }
}

function cleanImg(u) {
  const s = String(u || "").trim();
  if (!/^https?:\/\//i.test(s)) return "";
  if (PLACEHOLDER.test(s)) return "";
  return s;
}

// Photo: og:image first, then any body img with wp-post-image class (attr-order independent).
function parsePhoto(html) {
  const og = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html)?.[1] || "";
  const good = cleanImg(og);
  if (good) return { photo: good, cleared: false };
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/wp-post-image/i.test(tag)) continue;
    const src = /src="([^"]+)"/i.exec(tag)?.[1] || "";
    const c = cleanImg(src);
    if (c) return { photo: c, cleared: false };
  }
  // og was a placeholder (or missing) and no body photo: signal clearing.
  if (og) return { photo: "", cleared: true };
  return { photo: "", cleared: false };
}

// Structured experience line: <li class="experience" title="Experiences">...<strong>15+ Years of Experience</strong>
function parseYears(html) {
  const li = /<li[^>]*title="Experiences"[^>]*>([\s\S]{0,500}?)<\/li>/i.exec(html)?.[1] || "";
  const text = li.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const m = text.match(/(\d{1,2})\s*\+?\s*years?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 60 ? n : null;
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
const max = Number(process.env.MAX || 0);
const todo = rows.filter((r) => !done.has(r.id));
const run = max > 0 ? todo.slice(0, max) : todo;
console.log(`total: ${rows.length}, done: ${done.size}, todo: ${todo.length}, running: ${run.length}`);

let patched = 0, cleared = 0, mdSaved = 0, yearsSet = 0, failed = 0;
for (const row of run) {
  try {
    let md = row.structure_md;
    if (!md) {
      md = await jinaFetch(row.source_url);
      await pool.query("UPDATE doctor_queue SET structure_md=$2, updated_at=now() WHERE id=$1", [row.id, md]);
      mdSaved++;
    }
    const html = await fetchHtml(row.source_url);
    const payload = {};
    if (html) {
      const { photo, cleared: clr } = parsePhoto(html);
      if (photo) payload.photo = photo;
      else if (clr) { payload.photo = null; cleared++; }
      const years = parseYears(html);
      if (years) { payload.experienced_year = years; yearsSet++; }
    }
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
    console.log(`progress ${done.size}/${rows.length} patched=${patched} cleared=${cleared} mdSaved=${mdSaved} years=${yearsSet} failed=${failed}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
save();
console.log(`FINAL patched=${patched} cleared=${cleared} mdSaved=${mdSaved} years=${yearsSet} failed=${failed}`);
await pool.end();
