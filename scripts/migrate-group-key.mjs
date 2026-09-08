// Adds group_key + backfills it by matching each row's URL to facilities.md.
// Run: node scripts/migrate-group-key.mjs (after the DB is reachable again)
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

// Same key logic as lib/groups.ts: `${divisionId}-${districtId ?? "main"}`
const urlToKey = new Map();
let divId = null, distId = null;
const headerRe = /^##\s*(.+?)\s*\(id:(\d+)\)\s*(?::\s*district\s+(\d+)\.\s*(.+?))?\s*$/;
const itemRe = /^\*\s+\[(.+?)\]\((https?:\/\/[^)]+)\)/;
const md = fs.readFileSync("../facilities.md", "utf8");
for (const raw of md.split("\n")) {
  const line = raw.trim();
  const h = line.match(headerRe);
  if (h) { divId = h[2]; distId = h[3] ?? "main"; continue; }
  const m = line.match(itemRe);
  if (m && divId) urlToKey.set(m[2].trim(), `${divId}-${distId}`);
}
console.log(`groups mapped: ${urlToKey.size} urls`);

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("ALTER TABLE facility_queue ADD COLUMN IF NOT EXISTS group_key TEXT");
await c.query("CREATE INDEX IF NOT EXISTS facility_queue_group_idx ON facility_queue (group_key)");
let n = 0;
for (const [url, key] of urlToKey) {
  const r = await c.query("UPDATE facility_queue SET group_key=$2 WHERE source_url=$1 AND group_key IS NULL", [url, key]);
  n += r.rowCount ?? 0;
}
console.log(`backfilled group_key on ${n} rows`);
await c.end();
