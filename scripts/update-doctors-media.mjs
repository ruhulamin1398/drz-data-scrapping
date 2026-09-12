// Update task (not create): concurrent workers over success rows with drx_id.
// Per doctor, from raw profile HTML only (no Jina, no AI):
//   1. photo: og:image -> body wp-post-image fallback (placeholders dr-male/
//      dr-female are not real photos: skipped, backend keeps whatever it has)
//   2. experienced_year: structured <li class="experience" title="Experiences">
//      ("15+ Years of Experience") — empty element means no data, skipped
// No real photo found -> row marked failed (fail_reason='photo not found') for later retry.
// Usage: CONC=5 node scripts/update-doctors-media.mjs (MAX=n for trial slice)
// Resume-safe: completed ids in /tmp/media-update-done.json
import fs from "fs";
import pg from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 30 });
const BASE = (process.env.DRX_API_BASE || "https://drx-backend.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.DRX_ADMIN_TOKEN || "";
if (!TOKEN) throw new Error("DRX_ADMIN_TOKEN required");

const DONE_FILE = "/tmp/media-update-done.json";
const done = new Set(fs.existsSync(DONE_FILE) ? JSON.parse(fs.readFileSync(DONE_FILE, "utf8")) : []);
const save = () => fs.writeFileSync(DONE_FILE, JSON.stringify([...done]));

// Department id -> name (one call) for rich photo titles:
// "Dr. X | Cardiologist | Sylhet".
let deptName = new Map();
try {
  const d = await (await fetch(`${BASE}/api/v1/departments?limit=100`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  for (const x of d?.data?.items ?? []) deptName.set(x.id, x.name);
} catch { /* titles fall back to slugs */ }

function photoTitle(row) {
  const depts = (row.department_ids || []).map((id) => deptName.get(id)).filter(Boolean);
  const spec = depts.length ? depts : (row.specialty_slugs || []);
  const city = row.city ? row.city.charAt(0).toUpperCase() + row.city.slice(1) : "";
  return [row.name || `doctor-${row.id}`, spec.join(", "), city].filter(Boolean).join(" | ");
}

const PLACEHOLDER = /dr-male|dr-female|doctor-bd|logo|icon|placeholder|default|banner|favicon/i;

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
// Returns "" when no real photo (placeholders excluded) — caller marks failed.
function parsePhoto(html) {
  const og = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html)?.[1] || "";
  const good = cleanImg(og);
  if (good) return good;
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/wp-post-image/i.test(tag)) continue;
    const src = /src="([^"]+)"/i.exec(tag)?.[1] || "";
    const c = cleanImg(src);
    if (c) return c;
  }
  return "";
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

// Backend-hosted photo via file manager (doctor `photoUrl` PATCH 500s, so we
// do its two steps manually): upload from URL -> PATCH the stored R2 URL.
async function uploadPhoto(imageUrl, title) {
  const r = await fetch(`${BASE}/api/v1/files/from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ url: imageUrl, title }),
  });
  if (!r.ok) throw new Error(`file upload ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  const url = j?.data?.url || "";
  if (!url) throw new Error("file upload returned no url");
  return url;
}

const { rows } = await pool.query(
  "SELECT id, source_url, drx_id, name, specialty_slugs, department_ids, city FROM doctor_queue WHERE status='success' AND drx_id IS NOT NULL ORDER BY id"
);
const max = Number(process.env.MAX || 0);
const CONC = Math.min(Math.max(1, Number(process.env.CONC || 5)), 30);
const todo = rows.filter((r) => !done.has(r.id));
const run = max > 0 ? todo.slice(0, max) : todo;
console.log(`total: ${rows.length}, done: ${done.size}, todo: ${todo.length}, running: ${run.length}, concurrency: ${CONC}`);

let patched = 0, yearsSet = 0, failed = 0;
async function worker(items) {
  for (const row of items) {
    try {
      const html = await fetchHtml(row.source_url);
      if (!html) throw new Error("profile html unreachable");
      const photo = parsePhoto(html);
      if (!photo) {
        await pool.query("UPDATE doctor_queue SET status='failed', fail_reason='photo not found', updated_at=now() WHERE id=$1", [row.id]);
        failed++;
      } else {
        // No female photos kept: check backend gender before uploading.
        const g = await (await fetch(`${BASE}/api/v1/doctors/${row.drx_id}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json().catch(() => null);
        const payload = {};
        if (g?.data?.gender !== "female") {
          payload.photo = await uploadPhoto(photo, photoTitle(row));
        }
        const years = parseYears(html);
        if (years) { payload.experienced_year = years; yearsSet++; }
        if (Object.keys(payload).length) {
          await patchDoctor(row.drx_id, payload);
          patched++;
        }
      }
    } catch (e) {
      failed++;
      console.log(`FAIL ${row.id} ${row.source_url}: ${String(e).slice(0, 120)}`);
    }
    done.add(row.id);
    if (done.size % 50 === 0) {
      save();
      console.log(`progress ${done.size}/${rows.length} patched=${patched} years=${yearsSet} failed=${failed}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
const shards = Array.from({ length: CONC }, (_, i) => run.filter((_, j) => j % CONC === i));
await Promise.all(shards.map(worker));
save();
console.log(`FINAL patched=${patched} years=${yearsSet} failed=${failed}`);
await pool.end();
