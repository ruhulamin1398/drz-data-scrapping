// Doctor photo-update runs migration: node scripts/migrate-doctor-update-runs.mjs (reads .env.local, no dotenv dep)
// Independent from doctor_queue: one row per (doctor, utility) run, history preserved.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`
CREATE TABLE IF NOT EXISTS doctor_update_runs (
  id BIGSERIAL PRIMARY KEY,
  doctor_queue_id BIGINT NOT NULL REFERENCES doctor_queue(id) ON DELETE CASCADE,
  drx_id TEXT,
  source_url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'photo' CHECK (type IN ('photo')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','success','failed','skipped')),
  options JSONB NOT NULL DEFAULT '{"skipIfPhotoExists": true}',
  result TEXT CHECK (result IN ('updated','skipped','failed')),
  prev_photo TEXT,
  new_photo TEXT,
  attempts INT NOT NULL DEFAULT 0,
  fail_reason TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);`);
// Existing tables keep the old 4-value CHECK — widen it idempotently.
await c.query(`ALTER TABLE doctor_update_runs DROP CONSTRAINT IF EXISTS doctor_update_runs_status_check`);
await c.query(`ALTER TABLE doctor_update_runs ADD CONSTRAINT doctor_update_runs_status_check CHECK (status IN ('pending','processing','success','failed','skipped'))`).catch(() => {});
// Backfill pilot rows: success+skipped → first-class skipped status.
await c.query(`UPDATE doctor_update_runs SET status='skipped', updated_at=now() WHERE status='success' AND result='skipped'`).catch(() => {});
// Change note column: what was there before, what was added, options used + manual remarks.
await c.query(`ALTER TABLE doctor_update_runs ADD COLUMN IF NOT EXISTS note TEXT`);
// Backfill a summary note for already-finished rows missing one.
await c.query(`UPDATE doctor_update_runs SET note = CASE
  WHEN result='updated' THEN 'photo ' || COALESCE(prev_photo,'none') || ' → ' || COALESCE(new_photo,'')
  WHEN result='skipped' THEN 'skipped: ' || COALESCE(fail_reason,'already up to date')
  ELSE note END,
  updated_at=now() WHERE note IS NULL AND status IN ('success','failed','skipped')`).catch(() => {});
// One active run per doctor+utility; unlimited finished history.
await c.query(`DROP INDEX IF EXISTS doctor_update_runs_active_uniq`);
await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS doctor_update_runs_active_uniq ON doctor_update_runs (doctor_queue_id, type) WHERE status IN ('pending','processing')`);
await c.query(`CREATE INDEX IF NOT EXISTS doctor_update_runs_status_idx ON doctor_update_runs (status, type, id)`);
await c.query(`CREATE INDEX IF NOT EXISTS doctor_update_runs_doctor_idx ON doctor_update_runs (doctor_queue_id, type, id DESC)`);

console.log("OK: doctor_update_runs ready");
await c.end();
