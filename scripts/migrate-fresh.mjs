// Fresh-DB migration: node scripts/migrate-fresh.mjs (reads .env.local, no dotenv dep)
// Creates the final facility_queue schema in one go (group_key included).
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`
CREATE TABLE IF NOT EXISTS facility_queue (
  id SERIAL PRIMARY KEY,
  title TEXT,
  source_url TEXT UNIQUE NOT NULL,
  division_id INT,
  district_id INT,
  type_id INT,
  group_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  name TEXT,
  full_address TEXT,
  phones TEXT[] DEFAULT '{}',
  extra_information TEXT,
  drx_id INT,
  fail_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);`);
await c.query(`CREATE INDEX IF NOT EXISTS facility_queue_status_idx ON facility_queue (status)`);
await c.query(`CREATE INDEX IF NOT EXISTS facility_queue_group_idx ON facility_queue (group_key)`);

console.log("OK: facility_queue ready (pending → processing → success/failed, grouped)");
await c.end();
