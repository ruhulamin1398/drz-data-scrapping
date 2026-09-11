// Migration: Jina keys in settings + structure_md on doctor_queue.
// Usage: node scripts/migrate-jina-structure.mjs (reads .env.local, no dotenv dep)
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS jina_keys TEXT NOT NULL DEFAULT ''`);
await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS jina_key_idx INT NOT NULL DEFAULT 0`);
await c.query(`ALTER TABLE doctor_queue ADD COLUMN IF NOT EXISTS structure_md TEXT`);

console.log("OK: settings.jina_keys, settings.jina_key_idx, doctor_queue.structure_md ready");
await c.end();
