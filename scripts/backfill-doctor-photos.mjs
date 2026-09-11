// Backfill doctor profile photos: og:image from raw profile HTML -> PATCH photo.
// Usage: node scripts/backfill-doctor-photos.mjs [concurrency]
// Resume-safe: tracks completed source_urls in /tmp/photo-backfill-done.json
import pg from "pg";
import fs from "fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").trim().split("\n")
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const BASE = (env.DRX_API_BASE || "https://drx-backend.vercel.app").replace(/\/$/, "");
const TOKEN = env.DRX_ADMIN_TOKEN;
const CONC = Number(process.argv[2] || 3);
const DONE_FILE = "/tmp/photo-backfill-done.json";

const done = new Set(fs.existsSync(DONE_FILE) ? JSON.parse(fs.readFileSync(DONE_FILE, "utf8")) : []);
const save = () => fs.writeFileSync(DONE_FILE, JSON.stringify([...done]));

async function fetchPhoto(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
    });
    clearTimeout(t);
    if (!res.ok) return { photo: "", why: `html ${res.status}` };
    const html = await res.text();
    const m = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html);
    const img = (m?.[1] ?? "").trim();
    if (!img || !/^https?:\/\//i.test(img)) return { photo: "", why: "no og:image" };
    if (/logo|icon|placeholder|default|banner|favicon/i.test(img)) return { photo: "", why: "site asset" };
    return { photo: img, why: "" };
  } catch (e) {
    return { photo: "", why: String(e).slice(0, 60) };
  }
}

async function patchPhoto(drxId, photo) {
  const r = await fetch(`${BASE}/api/v1/doctors/${drxId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ photo }),
  });
  return r.ok;
}

const { rows } = await pool.query(
  "SELECT source_url, drx_id, name FROM doctor_queue WHERE status='success' AND drx_id IS NOT NULL ORDER BY id"
);
const todo = rows.filter((r) => !done.has(r.source_url));
console.log(`total success: ${rows.length}, already done: ${done.size}, todo: ${todo.length}, concurrency: ${CONC}`);

let ok = 0, skip = 0, fail = 0;
const skipReasons = {};
async function worker(items) {
  for (const row of items) {
    const { photo, why } = await fetchPhoto(row.source_url);
    if (!photo) {
      skip++;
      skipReasons[why] = (skipReasons[why] || 0) + 1;
    } else {
      try {
        if (await patchPhoto(row.drx_id, photo)) ok++;
        else { fail++; skipReasons["patch failed"] = (skipReasons["patch failed"] || 0) + 1; }
      } catch { fail++; }
    }
    done.add(row.source_url);
    if (done.size % 100 === 0) {
      save();
      console.log(`progress ${done.size}/${rows.length} ok=${ok} skip=${skip} fail=${fail}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}
const shards = Array.from({ length: CONC }, (_, i) => todo.filter((_, j) => j % CONC === i));
await Promise.all(shards.map(worker));
save();
console.log(`FINAL ok=${ok} skip=${skip} fail=${fail}`, JSON.stringify(skipReasons));
await pool.end();
