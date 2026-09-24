// Per-queue tasks-per-tick migration: node scripts/migrate-queue-tasks-per-tick.mjs (reads .env.local, no dotenv dep)
// Adds facilities_tasks_per_tick + doctors_tasks_per_tick, backfilled from the
// existing global tasks_per_tick so current pacing is unchanged.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS facilities_tasks_per_tick INT NOT NULL DEFAULT 10`);
await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS doctors_tasks_per_tick INT NOT NULL DEFAULT 10`);
await c.query(`UPDATE settings SET facilities_tasks_per_tick = tasks_per_tick, doctors_tasks_per_tick = tasks_per_tick WHERE id = 1`);

console.log("OK: settings.facilities_tasks_per_tick + settings.doctors_tasks_per_tick ready");
await c.end();
