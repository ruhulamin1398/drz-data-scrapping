// Worker-loop migration: node scripts/migrate-worker.mjs (reads .env.local)
// Adds loop ownership for fire-and-forget ticks (cron returns fast, loop works behind).
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS worker_active BOOL NOT NULL DEFAULT false`);
await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS worker_heartbeat TIMESTAMPTZ`);

console.log("OK: worker_active + worker_heartbeat ready");
await c.end();
