// Pre-warm queue migration: node scripts/migrate-prewarm.mjs (reads .env.local, no dotenv dep)
// ISR cache pre-warming: URL queue + per-queue switch columns on settings.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`
CREATE TABLE IF NOT EXISTS prewarm_queue (
  id SERIAL PRIMARY KEY,
  source_url TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  http_code INT,
  duration_ms INT,
  fail_reason TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);`);
await c.query(`CREATE INDEX IF NOT EXISTS prewarm_queue_status_idx ON prewarm_queue (status)`);
await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS prewarm_enabled BOOL NOT NULL DEFAULT true`);
await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS prewarm_tasks_per_tick INT NOT NULL DEFAULT 10`);
await c.query(`UPDATE settings SET prewarm_tasks_per_tick = tasks_per_tick WHERE id = 1`);

console.log("OK: prewarm_queue + settings.prewarm_enabled + settings.prewarm_tasks_per_tick ready");
await c.end();
