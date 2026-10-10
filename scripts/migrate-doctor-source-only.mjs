// Allow queue rows with only source_url: specialty_slug is now nullable,
// the pipeline auto-resolves specialty + departments from the profile content.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`ALTER TABLE doctor_queue ALTER COLUMN specialty_slug DROP NOT NULL`);

console.log("OK: doctor_queue.specialty_slug nullable");
await c.end();
