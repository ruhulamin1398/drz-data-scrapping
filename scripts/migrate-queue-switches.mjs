// Per-queue switches migration: node scripts/migrate-queue-switches.mjs (reads .env.local, no dotenv dep)
// Adds facilities_enabled + doctors_enabled to settings (default true so existing
// global-enabled behavior is unchanged until the user toggles a queue off).
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS facilities_enabled BOOL NOT NULL DEFAULT true`);
await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS doctors_enabled BOOL NOT NULL DEFAULT true`);

console.log("OK: settings.facilities_enabled + settings.doctors_enabled ready");
await c.end();
