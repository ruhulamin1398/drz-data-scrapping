// Cache scan history migration: node scripts/migrate-cache-scans.mjs (reads .env.local)
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`
CREATE TABLE IF NOT EXISTS cache_scans (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  url TEXT NOT NULL,
  final_url TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  note TEXT,
  verdict TEXT,
  render TEXT,
  cache_ms INT,
  cache_json JSONB,
  cache_error TEXT,
  psi_mobile_1 JSONB,
  psi_mobile_2 JSONB,
  psi_desktop_1 JSONB,
  psi_desktop_2 JSONB,
  score_mobile_1 INT,
  score_mobile_2 INT,
  score_desktop_1 INT,
  score_desktop_2 INT
);`);
await c.query(`CREATE INDEX IF NOT EXISTS cache_scans_created_idx ON cache_scans (created_at DESC)`);
await c.query(`CREATE INDEX IF NOT EXISTS cache_scans_url_idx ON cache_scans (url, id DESC)`);

console.log("OK: cache_scans ready");
await c.end();
