// Doctor queue migration: node scripts/migrate-doctor-queue.mjs (reads .env.local, no dotenv dep)
// Mirrors facility_queue's claim-loop columns for the doctor pipeline (Sylhet pilot).
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`
CREATE TABLE IF NOT EXISTS doctor_queue (
  id SERIAL PRIMARY KEY,
  source_url TEXT UNIQUE NOT NULL,
  name TEXT,
  card_text TEXT,
  specialty_slug TEXT NOT NULL,
  specialty_slugs TEXT[] NOT NULL DEFAULT '{}',
  department_ids TEXT[] NOT NULL DEFAULT '{}',
  city TEXT NOT NULL DEFAULT 'sylhet',
  status TEXT NOT NULL DEFAULT 'pending',
  drx_id INT,
  fail_reason TEXT,
  locked_at TIMESTAMPTZ,
  full_content BOOL NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);`);
await c.query(`CREATE INDEX IF NOT EXISTS doctor_queue_status_idx ON doctor_queue (status)`);
await c.query(`CREATE INDEX IF NOT EXISTS doctor_queue_specialty_idx ON doctor_queue (specialty_slug)`);

console.log("OK: doctor_queue ready");
await c.end();
