// Bulk-enqueue pushed doctors for experience update:
// node scripts/enqueue-remaining-experience-updates.mjs [limit] (reads .env.local, no dotenv dep)
// Single INSERT..SELECT — one DB round trip, ON CONFLICT skips already-active rows.
// skipIfExperienceSet=true: only doctors WITHOUT experienced_year get updated.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const limit = Math.min(Math.max(1, Number(process.argv[2]) || 100000), 100000);
const skipIfExperienceSet = process.argv[3] !== "force";

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const r = await c.query(
  `INSERT INTO doctor_update_runs (doctor_queue_id, drx_id, source_url, type, status, options)
   SELECT q.id, q.drx_id, q.source_url, 'experience', 'pending', $1
   FROM doctor_queue q
   WHERE q.status='success' AND q.drx_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM doctor_update_runs r WHERE r.doctor_queue_id = q.id AND r.type='experience')
   ORDER BY q.id LIMIT ${limit}
   ON CONFLICT (doctor_queue_id, type) WHERE status IN ('pending','processing') DO NOTHING`,
  [JSON.stringify({ skipIfExperienceSet })]
);

const total = await c.query("SELECT COUNT(*) n FROM doctor_update_runs WHERE type='experience'");
console.log(`enqueued=${r.rowCount} experience_runs=${total.rows[0].n} skipIfSet=${skipIfExperienceSet}`);
await c.end();
