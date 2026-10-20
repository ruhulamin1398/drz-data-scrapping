// Cron jobs migration: node scripts/migrate-cron-jobs.mjs (reads .env.local, no dotenv dep)
// URL scheduler: job definitions + run history (saved responses) + scheduler heartbeat.
import fs from "fs";
import { Client } from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query(`
CREATE TABLE IF NOT EXISTS cron_jobs (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  comment TEXT,
  schedule_mode TEXT NOT NULL DEFAULT 'preset' CHECK (schedule_mode IN ('preset','custom')),
  schedule_preset TEXT,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  method TEXT NOT NULL DEFAULT 'GET' CHECK (method IN ('GET','POST')),
  headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  body TEXT,
  timeout_ms INT NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 30000),
  enabled BOOL NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_status TEXT CHECK (last_status IN ('success','failed')),
  last_http_status INT,
  last_duration_ms INT,
  consecutive_failures INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`);

await c.query(`ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

await c.query(`
CREATE TABLE IF NOT EXISTS cron_job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'scheduled' CHECK (trigger IN ('scheduled','test')),
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed','timeout')),
  request_url TEXT NOT NULL,
  request_method TEXT NOT NULL DEFAULT 'GET',
  http_status INT,
  response_content_type TEXT,
  response_headers JSONB,
  response_body TEXT,
  response_truncated BOOL NOT NULL DEFAULT false,
  response_bytes INT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`);

await c.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS cron_jobs_heartbeat_at TIMESTAMPTZ`);
await c.query(`CREATE INDEX IF NOT EXISTS cron_jobs_due_idx ON cron_jobs (next_run_at) WHERE enabled`);
await c.query(`CREATE INDEX IF NOT EXISTS cron_jobs_tags_idx ON cron_jobs USING GIN (tags)`);
await c.query(`CREATE INDEX IF NOT EXISTS cron_job_runs_job_idx ON cron_job_runs (job_id, id DESC)`);
await c.query(`CREATE INDEX IF NOT EXISTS cron_job_runs_status_idx ON cron_job_runs (status, started_at DESC)`);

console.log("OK: cron_jobs + cron_job_runs + settings.cron_jobs_heartbeat_at ready");
await c.end();
