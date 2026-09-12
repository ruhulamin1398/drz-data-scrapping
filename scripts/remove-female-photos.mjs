// Remove photos of all female doctors: PATCH { photo: null }.
// Usage: CONC=10 node scripts/remove-female-photos.mjs (MAX=n for trial)
// Resume-safe: completed ids in /tmp/female-photo-done.json
import fs from "fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const BASE = (process.env.DRX_API_BASE || "https://drx-backend.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.DRX_ADMIN_TOKEN || "";
if (!TOKEN) throw new Error("DRX_ADMIN_TOKEN required");
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const CONC = Math.min(Math.max(1, Number(process.env.CONC || 10)), 30);
const max = Number(process.env.MAX || 0);

const DONE_FILE = "/tmp/female-photo-done.json";
const done = new Set(fs.existsSync(DONE_FILE) ? JSON.parse(fs.readFileSync(DONE_FILE, "utf8")) : []);
const save = () => fs.writeFileSync(DONE_FILE, JSON.stringify([...done]));

// Collect female doctors that currently have a photo.
const targets = [];
let page = 1;
for (;;) {
  const r = await fetch(`${BASE}/api/v1/doctors?gender=female&limit=100&page=${page}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`list ${r.status}`);
  const j = await r.json();
  const items = j?.data?.items ?? [];
  for (const d of items) if (d.photo) targets.push({ id: d.id, name: d.name });
  const meta = j?.data?.meta;
  console.log(`page ${page}: ${items.length} female, ${targets.length} with photo so far (total ${meta?.totalItems})`);
  if (!meta?.hasNextPage || !items.length) break;
  page++;
}
console.log(`female with photo: ${targets.length}`);

const run = max > 0 ? targets.filter((t) => !done.has(t.id)).slice(0, max) : targets.filter((t) => !done.has(t.id));
console.log(`running: ${run.length}, concurrency: ${CONC}`);

let cleared = 0, failed = 0;
async function worker(items) {
  for (const t of items) {
    try {
      const r = await fetch(`${BASE}/api/v1/doctors/${t.id}`, {
        method: "PATCH", headers: H, body: JSON.stringify({ photo: null }),
      });
      if (!r.ok) throw new Error(`patch ${r.status}`);
      cleared++;
    } catch (e) {
      failed++;
      console.log(`FAIL ${t.id} ${t.name}: ${String(e).slice(0, 100)}`);
    }
    done.add(t.id);
    if (done.size % 100 === 0) {
      save();
      console.log(`progress ${done.size}/${targets.length} cleared=${cleared} failed=${failed}`);
    }
  }
}
const shards = Array.from({ length: CONC }, (_, i) => run.filter((_, j) => j % CONC === i));
await Promise.all(shards.map(worker));
save();
console.log(`FINAL cleared=${cleared} failed=${failed}`);
