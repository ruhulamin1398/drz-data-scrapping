// Doctor harvest (Sylhet pilot): node scripts/harvest-doctors-sylhet.mjs (reads .env.local)
// Fetches the 32 specialty pages via Jina, parses doctor cards (### [Name](profile-url)),
// dedupes by profile URL (merging specialty_slugs + department_ids), inserts pending rows.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const base = (process.env.DRX_API_BASE || "").replace(/\/$/, "");
const token = process.env.DRX_ADMIN_TOKEN || "";
if (!base || !token) throw new Error("DRX_API_BASE / DRX_ADMIN_TOKEN required");

// Jina keys from /settings (settings.jina_keys, one per line), env fallback.
const keyClient = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await keyClient.connect();
let jinaKeys = [];
try {
  const r = await keyClient.query("SELECT jina_keys FROM settings WHERE id=1");
  jinaKeys = String(r.rows[0]?.jina_keys ?? "").split("\n").map((s) => s.trim()).filter((s) => s.length > 10);
} catch { /* pre-migration: env only */ }
await keyClient.end().catch(() => {});
if (process.env.JINA_API_KEY && !jinaKeys.includes(process.env.JINA_API_KEY.trim())) jinaKeys.push(process.env.JINA_API_KEY.trim());
if (!jinaKeys.length) throw new Error("no Jina keys: add keys on /settings or set JINA_API_KEY");
let jinaIdx = 0;

async function jinaGet(url) {
  let last = 0;
  for (let i = 0; i < jinaKeys.length; i++) {
    const k = jinaKeys[(jinaIdx + i) % jinaKeys.length];
    const res = await fetch(`https://r.jina.ai/${url}`, { headers: { Authorization: `Bearer ${k}` } });
    if (res.ok) { jinaIdx = (jinaKeys.indexOf(k) + 1) % jinaKeys.length; return res; }
    last = res.status;
    if (res.status !== 429 && res.status !== 401 && res.status !== 402) break;
  }
  return { ok: false, status: last };
}

const SPECIALTIES = ["anesthesiologist","oncologist","cardiac-surgeon","cardiologist","chest-specialist","pediatrician","colorectal-surgeon","dentist","endocrinologist","otolaryngologist","homeopathic","ophthalmologist","gastroenterologist","general-surgeon","gynecologist","hematologist","infertility-specialist","nephrologist","hepatologist","medicine-specialist","neurologist","neurosurgeon","orthopedic-specialist","pediatric-surgeon","physical-medicine-specialist","plastic-surgeon","psychiatrist","rheumatologist","sexologist","dermatologist","urologist","vascular-surgeon"];

// slug -> department cuid, resolved live from the seeded taxonomy.
const deps = await (await fetch(`${base}/api/v1/departments?limit=100`, { headers: { Authorization: `Bearer ${token}` } })).json();
const depId = new Map((deps?.data?.items ?? []).map((d) => [d.slug, d.id]));
const missing = SPECIALTIES.filter((s) => !depId.has(s));
if (missing.length) throw new Error("departments missing for: " + missing.join(","));

const SKIP = new Set([...SPECIALTIES.map((s) => `${s}-sylhet`), "doctors-sylhet", "hospitals-sylhet"]);
function isProfile(url) {
  const m = url.match(/^https:\/\/www\.doctorbangladesh\.com\/([a-z0-9-]+)\/?$/);
  if (!m) return false;
  const slug = m[1];
  if (SKIP.has(slug)) return false;
  if (/^(doctors|hospitals)-/.test(slug)) return false;
  return true;
}

// url -> { name, card, slugs:Set }
const profiles = new Map();
let pagesOk = 0;
for (const spec of SPECIALTIES) {
  const pageUrl = `https://www.doctorbangladesh.com/${spec}-sylhet/`;
  const res = await jinaGet(pageUrl);
  if (!res.ok) { console.log(`WARN ${spec}: jina ${res.status}, skipped`); continue; }
  const md = await res.text();
  const lines = md.split("\n");
  let cur = null;
  const flush = () => {
    if (cur && isProfile(cur.url)) {
      const hit = profiles.get(cur.url);
      if (hit) { hit.slugs.add(spec); }
      else profiles.set(cur.url, { name: cur.name, card: cur.body.join("\n").slice(0, 2000), slugs: new Set([spec]) });
    }
    cur = null;
  };
  for (const line of lines) {
    const h = line.match(/^### \[(.+?)\]\((https:[^)]+)\)/);
    if (h) { flush(); cur = { name: h[1].trim(), url: h[2].trim(), body: [] }; continue; }
    if (/^#{1,3} /.test(line)) { flush(); continue; }
    if (cur) cur.body.push(line);
  }
  flush();
  pagesOk++;
  console.log(`${spec}: ${[...profiles.values()].filter((p) => p.slugs.has(spec)).length} cards`);
  await new Promise((r) => setTimeout(r, 500));
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let inserted = 0, existed = 0;
for (const [url, p] of profiles) {
  const slugs = [...p.slugs];
  const deptIds = slugs.map((s) => depId.get(s));
  const r = await c.query(
    `INSERT INTO doctor_queue (source_url, name, card_text, specialty_slug, specialty_slugs, department_ids, city, status)
     VALUES ($1,$2,$3,$4,$5,$6,'sylhet','pending') ON CONFLICT (source_url) DO NOTHING`,
    [url, p.name, p.card, slugs[0], slugs, deptIds]
  );
  if ((r.rowCount ?? 0) > 0) inserted++; else existed++;
}
const total = await c.query(`SELECT status, count(*) FROM doctor_queue GROUP BY status`);
await c.end();
console.log(`OK: pages=${pagesOk}/32 unique_profiles=${profiles.size} inserted=${inserted} existed=${existed}`);
console.log("queue:", JSON.stringify(total.rows));
