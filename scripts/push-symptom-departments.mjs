// Push symptom -> department links to backend.
// Usage: node scripts/push-symptom-departments.mjs
import fs from "fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const BASE = (process.env.DRX_API_BASE || "https://api-9028.doctorzonebd.com").replace(/\/$/, "");
const TOKEN = process.env.DRX_ADMIN_TOKEN || "";
if (!TOKEN) throw new Error("DRX_ADMIN_TOKEN required");
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const map = JSON.parse(fs.readFileSync("data/symptom-departments.json", "utf8"));

const deps = await (await fetch(`${BASE}/api/v1/departments?limit=100`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const deptBySlug = new Map((deps?.data?.items ?? []).map(d => [d.slug, d.id]));
const deptByName = new Map((deps?.data?.items ?? []).map(d => [d.name.toLowerCase(), d.id]));

const syms = await (await fetch(`${BASE}/api/v1/symptoms?limit=100`, { headers: H })).json();
const symByTitle = new Map(syms.data.items.map(s => [s.title.trim().toLowerCase(), s]));

let ok = 0, fail = 0;
for (const m of map.mappings) {
  const titleKey = m.symptom.trim().toLowerCase();
  const sym = symByTitle.get(titleKey);
  if (!sym) { console.log(`SKIP not found symptom: ${m.symptom}`); fail++; continue; }
  const ids = [];
  for (const slug of m.departments) {
    const id = deptBySlug.get(slug) || deptByName.get(slug.toLowerCase());
    if (!id) { console.log(`  WARN unknown department slug: ${slug} for ${m.symptom}`); continue; }
    ids.push(id);
  }
  if (!ids.length) { console.log(`SKIP ${m.symptom}: no departments to link`); continue; }
  const res = await fetch(`${BASE}/api/v1/symptoms/${sym.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ departmentIds: ids }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log(`FAIL ${m.symptom}: ${res.status} ${JSON.stringify(j).slice(0, 300)}`);
    fail++;
  } else {
    const depts = (j?.data?.departments || []).map(d => d.slug).join(",");
    console.log(`OK ${m.symptom} -> [${depts}] (${ids.length})`);
    ok++;
  }
}
console.log(`DONE ok=${ok} fail=${fail}`);
