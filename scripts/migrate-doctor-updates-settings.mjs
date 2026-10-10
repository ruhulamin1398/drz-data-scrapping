// Doctor-updates queue settings migration: node scripts/migrate-doctor-updates-settings.mjs (reads .env.local, no dotenv dep)
// Adds doctor_updates_enabled + doctor_updates_tasks_per_tick so the photo-update
// queue processes via cron like facilities/doctors/prewarm, with its own switch + quota.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS doctor_updates_enabled BOOL NOT NULL DEFAULT true`);
await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS doctor_updates_tasks_per_tick INT NOT NULL DEFAULT 10`);
await c.query(`UPDATE settings SET doctor_updates_tasks_per_tick = COALESCE(doctors_tasks_per_tick, tasks_per_tick, 10) WHERE id = 1 AND doctor_updates_tasks_per_tick = 10`);

console.log("OK: settings.doctor_updates_enabled + settings.doctor_updates_tasks_per_tick ready");
await c.end();
