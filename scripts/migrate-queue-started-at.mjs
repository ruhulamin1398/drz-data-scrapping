// Queue "in progress" marker: node scripts/migrate-queue-started-at.mjs
// (reads .env.local, no dotenv dep). started_at is set only while a row is
// actually running; status='processing' with started_at NULL means claimed but
// still waiting for a worker slot.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing in .env.local");

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

for (const table of ["facility_queue", "doctor_queue", "prewarm_queue", "doctor_update_runs"]) {
  await c.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`);
}

console.log("OK: started_at ready on facility_queue, doctor_queue, prewarm_queue, doctor_update_runs");
await c.end();
