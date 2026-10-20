// Revalidate base URL migration: node scripts/migrate-revalidate-base.mjs
// (reads .env.local, no dotenv dep). The URL lives in settings — editable on
// /prewarm at any time — instead of an env variable.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing in .env.local");

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS revalidate_base_url TEXT NOT NULL DEFAULT ''`);
// Seed the current frontend origin once so the queue keeps working; change it
// on /prewarm whenever the frontend URL changes.
await c.query(`UPDATE settings SET revalidate_base_url = 'https://www.doctorzonebd.com' WHERE id = 1 AND revalidate_base_url = ''`);

console.log("OK: settings.revalidate_base_url ready (editable on /prewarm)");
await c.end();
