// Cron migration: node scripts/migrate-cron.mjs (reads .env.local, no dotenv dep)
// Adds server-side processing support: settings + row locks + full-content retry flag.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`
CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY DEFAULT 1,
  enabled BOOL NOT NULL DEFAULT false,
  concurrency INT NOT NULL DEFAULT 3,
  tasks_per_tick INT NOT NULL DEFAULT 10,
  heartbeat_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT settings_single_row CHECK (id = 1)
);`);
await c.query(`INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
await c.query(`ALTER TABLE facility_queue ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ`);
await c.query(`ALTER TABLE facility_queue ADD COLUMN IF NOT EXISTS full_content BOOL NOT NULL DEFAULT false`);

console.log("OK: settings + locked_at + full_content ready");
await c.end();
