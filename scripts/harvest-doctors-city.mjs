// Per-city doctor harvest: node scripts/harvest-doctors-city.mjs <city> <hub-slug>
// e.g. node scripts/harvest-doctors-city.mjs dhaka doctors-dhaka
// Parses the city hub for specialty links (slug + EN/BN titles), ensures every
// specialty exists as a department (seeds missing), then harvests doctor cards
// from each specialty page. Cross-city profiles merge (union of slugs + dept ids,
// earliest city kept). Idempotent: re-runs only fill gaps.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const city = process.argv[2];
const hub = process.argv[3];
if (!city || !hub) throw new Error("usage: node scripts/harvest-doctors-city.mjs <city> <hub-slug>");
const cityName = city.charAt(0).toUpperCase() + city.slice(1);

const base = (process.env.DRX_API_BASE || "").replace(/\/$/, "");
const token = process.env.DRX_ADMIN_TOKEN || "";
if (!base || !token) throw new Error("DRX_API_BASE / DRX_ADMIN_TOKEN required");
const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

// Single Jina key from /settings (settings.jina_keys, first line), env fallback.
const keyClient = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await keyClient.connect();
let jinaKey = "";
try {
  const r = await keyClient.query("SELECT jina_keys FROM settings WHERE id=1");
  jinaKey = String(r.rows[0]?.jina_keys ?? "").split("\n").map((s) => s.trim()).find((s) => s.length > 10) || "";
} catch { /* pre-migration: env only */ }
await keyClient.end().catch(() => {});
if (!jinaKey) jinaKey = (process.env.JINA_API_KEY || "").trim();
if (!jinaKey) throw new Error("no Jina key: add one on /settings or set JINA_API_KEY");

async function jina(url) {
  const key = "/tmp/jina-cache-" + Buffer.from(url).toString("base64url") + ".txt";
  try {
    const hit = fs.readFileSync(key, "utf8");
    if (hit.length > 500) return hit;
  } catch { /* miss */ }
  const res = await fetch(`https://r.jina.ai/${url}`, { headers: { Authorization: `Bearer ${jinaKey}` } });
  if (!res.ok) throw new Error(`jina ${res.status} for ${url}`);
  const text = await res.text();
  try { fs.writeFileSync(key, text); } catch { /* ignore */ }
  return text;
}

async function dbRetry(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { last = e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
  throw last;
}

// 1. Hub -> specialties (any *-city link, filtered by our city suffix).
const hubMd = await jina(`https://www.doctorbangladesh.com/${hub}/`);
const re = /\[!\[[^\n]*?\]\(https:[^)]+\)([^\n\]]+?)\]\(https:\/\/www\.doctorbangladesh\.com\/([a-z0-9-]+)\/\)/g;
const specs = [];
let m;
for (; (m = re.exec(hubMd)) !== null;) {
  const slug = m[2];
  if (!slug.endsWith("-" + city)) continue;
  const spec = slug.slice(0, -(city.length + 1));
  if (/^(doctors|hospitals)-/.test(spec) || !spec) continue;
  let title = m[1].replace(/^[^A-Za-z]*/, "").replace(/\s+in\s+\S+\s*/i, "").trim();
  const parts = title.split(/([\u0980-\u09FF].*)/);
  specs.push({ slug: spec, name: (parts[0] || "").trim() || spec, nameBn: (parts[1] || "").trim() });
}
console.log(`${city}: ${specs.length} specialties on hub`);

// 2. Ensure departments.
const deps = await (await fetch(`${base}/api/v1/departments?limit=100`, { headers: { Authorization: `Bearer ${token}` } })).json();
const depId = new Map((deps?.data?.items ?? []).map((d) => [d.slug, d.id]));
let maxSort = Math.max(0, ...(deps?.data?.items ?? []).map((d) => d.sortOrder ?? 0));
for (const s of specs) {
  if (depId.has(s.slug)) continue;
  const res = await fetch(`${base}/api/v1/departments`, {
    method: "POST", headers: H,
    body: JSON.stringify({ slug: s.slug, name: s.name, nameBn: s.nameBn || undefined, tagline: `${s.name} in ${cityName}`, isPublished: true, sortOrder: ++maxSort }),
  });
  if (!res.ok) { console.log(`WARN dept ${s.slug}: ${(await res.text()).slice(0, 120)}`); continue; }
  const j = await res.json();
  depId.set(s.slug, j.data.id);
  console.log(`dept created: ${s.slug}`);
}
const missing = specs.filter((s) => !depId.has(s.slug));
if (missing.length) throw new Error("departments missing for: " + missing.map((s) => s.slug).join(","));

// 3. Specialty pages -> cards.
const SKIP = new Set([...specs.map((s) => `${s.slug}-${city}`), `${hub}`, hub.replace(/^doctors-/, "") + "-" + city]);
function isProfile(url) {
  const mm = url.match(/^https:\/\/www\.doctorbangladesh\.com\/([a-z0-9-]+)\/?$/);
  if (!mm) return false;
  if (SKIP.has(mm[1])) return false;
  if (/^(doctors|hospitals)-/.test(mm[1])) return false;
  return true;
}
const profiles = new Map();
let pagesOk = 0;
for (const spec of specs) {
  const pageUrl = `https://www.doctorbangladesh.com/${spec.slug}-${city}/`;
  let md;
  try { md = await jina(pageUrl); }
  catch (e) { console.log(`WARN ${spec.slug}: ${e.message}, skipped`); continue; }
  const lines = md.split("\n");
  let cur = null;
  const flush = () => {
    if (cur && isProfile(cur.url)) {
      const hit = profiles.get(cur.url);
      if (hit) { hit.slugs.add(spec.slug); }
      else profiles.set(cur.url, { name: cur.name, card: cur.body.join("\n").slice(0, 2000), slugs: new Set([spec.slug]) });
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
  await new Promise((r) => setTimeout(r, 500));
}

// 4. Upsert (merge cross-city dupes).
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let inserted = 0, merged = 0;
for (const [url, p] of profiles) {
  const slugs = [...p.slugs];
  const deptIds = slugs.map((s) => depId.get(s));
  const r = await dbRetry(() => c.query(
    `INSERT INTO doctor_queue (source_url, name, card_text, specialty_slug, specialty_slugs, department_ids, city, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
     ON CONFLICT (source_url) DO UPDATE SET
       specialty_slugs = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(doctor_queue.specialty_slugs || $5) x)),
       department_ids = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(doctor_queue.department_ids || $6) x)),
       updated_at = now()`,
    [url, p.name, p.card, slugs[0], slugs, deptIds, city]
  ));
  if ((r.rowCount ?? 0) > 0) {
    const check = await c.query(`SELECT created_at = updated_at AS fresh FROM doctor_queue WHERE source_url=$1`, [url]);
    if (check.rows[0]?.fresh) inserted++; else merged++;
  }
}
const total = await c.query(`SELECT city, status, count(*) FROM doctor_queue GROUP BY city, status ORDER BY city, status`);
await c.end();
console.log(`OK ${city}: pages=${pagesOk}/${specs.length} unique=${profiles.size} inserted=${inserted} merged=${merged}`);
console.log(JSON.stringify(total.rows));
