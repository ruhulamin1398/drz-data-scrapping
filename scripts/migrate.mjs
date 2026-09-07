// One-time migration: node scripts/migrate.mjs (reads .env.local, no dotenv dep)
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`
CREATE TABLE IF NOT EXISTS scraped_facilities (
  id SERIAL PRIMARY KEY,
  title TEXT,
  source_url TEXT UNIQUE NOT NULL,
  name TEXT,
  full_address TEXT,
  phones TEXT[] DEFAULT '{}',
  extra_information TEXT,
  division_id INT,
  district_id INT,
  type_id INT,
  created_at TIMESTAMPTZ DEFAULT now()
);`);

await c.query(`
CREATE TABLE IF NOT EXISTS failed_facilities (
  id SERIAL PRIMARY KEY,
  title TEXT,
  source_url TEXT UNIQUE NOT NULL,
  name TEXT,
  full_address TEXT,
  phones TEXT,
  extra_information TEXT,
  division_id INT,
  district_id INT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);`);

console.log("OK: scraped_facilities + failed_facilities ready");
await c.end();
