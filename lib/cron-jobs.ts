import type { Pool, PoolClient } from "pg";
import { db } from "./db";
import { normalizeTags } from "./tags";
import {
  DEFAULT_TIMEZONE,
  findPreset,
  isValidTimezone,
  upcomingRuns,
  validateSchedule,
} from "./cron-schedule";
import type {
  CronJob,
  CronJobConfig,
  CronJobHeader,
  CronJobRun,
  CronMethod,
  CronRunResult,
  CronScheduleMode,
  CronTrigger,
} from "./cron-types";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 30_000;
export const MAX_REQUEST_BODY = 64 * 1024;
export const MAX_RESPONSE_BODY = 128 * 1024;
export const MAX_HEADERS = 50;
export const MAX_TITLE = 200;
export const MAX_COMMENT = 2_000;
export const MAX_RUNS_PER_JOB = 200;
export const DISPATCH_LIMIT = 10;

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

// pg returns timestamptz columns as Date objects; JSON APIs need ISO strings.
export type CronJobRow = Omit<CronJob, "headers" | "next_runs" | "next_run_at" | "last_run_at" | "created_at" | "updated_at"> & {
  headers: CronJobHeader[] | null;
  next_run_at: Date | string | null;
  last_run_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type CronJobRunRow = Omit<
  CronJobRun,
  "scheduled_for" | "started_at" | "finished_at" | "created_at" | "response_body" | "body_preview"
> & {
  scheduled_for: Date | string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
  created_at: Date | string;
  response_body?: string | null;
  body_preview?: string | null;
};

const iso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return typeof value === "string" ? value : value.toISOString();
};

function safeNextRuns(expression: string, timezone: string, count = 3): string[] {
  try {
    return upcomingRuns(expression, timezone, count).map((d) => d.toISOString());
  } catch {
    return [];
  }
}

export function serializeJob(row: CronJobRow): CronJob {
  return {
    id: Number(row.id),
    title: row.title,
    url: row.url,
    comment: row.comment ?? null,
    schedule_mode: row.schedule_mode,
    schedule_preset: row.schedule_preset ?? null,
    cron_expression: row.cron_expression,
    timezone: row.timezone || DEFAULT_TIMEZONE,
    tags: Array.isArray(row.tags) ? row.tags : [],
    method: row.method === "POST" ? "POST" : "GET",
    headers: Array.isArray(row.headers) ? row.headers : [],
    body: row.body ?? null,
    timeout_ms: Number(row.timeout_ms) || DEFAULT_TIMEOUT_MS,
    enabled: !!row.enabled,
    next_run_at: iso(row.next_run_at),
    last_run_at: iso(row.last_run_at),
    last_status: row.last_status === "success" || row.last_status === "failed" ? row.last_status : null,
    last_http_status: row.last_http_status ?? null,
    last_duration_ms: row.last_duration_ms ?? null,
    consecutive_failures: Number(row.consecutive_failures) || 0,
    created_at: iso(row.created_at) ?? new Date().toISOString(),
    updated_at: iso(row.updated_at) ?? new Date().toISOString(),
    next_runs: safeNextRuns(row.cron_expression, row.timezone || DEFAULT_TIMEZONE),
  };
}

export function serializeRun(row: CronJobRunRow, includeBody = false): CronJobRun {
  const run: CronJobRun = {
    id: Number(row.id),
    job_id: Number(row.job_id),
    trigger: row.trigger,
    scheduled_for: iso(row.scheduled_for),
    started_at: iso(row.started_at) ?? new Date().toISOString(),
    finished_at: iso(row.finished_at),
    duration_ms: row.duration_ms ?? null,
    status: row.status,
    request_url: row.request_url,
    request_method: row.request_method === "POST" ? "POST" : "GET",
    http_status: row.http_status ?? null,
    response_content_type: row.response_content_type ?? null,
    response_headers: row.response_headers ?? null,
    response_truncated: !!row.response_truncated,
    response_bytes: row.response_bytes ?? null,
    error: row.error ?? null,
    created_at: iso(row.created_at) ?? new Date().toISOString(),
    body_preview: row.body_preview ?? null,
  };
  if (includeBody) run.response_body = row.response_body ?? null;
  return run;
}

type BuildResult = { ok: true; value: CronJobConfig } | { ok: false; error: string };

const fail = (error: string): BuildResult => ({ ok: false, error });

export function buildCronJobConfig(input: Record<string, unknown>): BuildResult {
  const title = String(input.title ?? "").trim().slice(0, MAX_TITLE);
  if (!title) return fail("Title is required");

  const rawUrl = String(input.url ?? "").trim();
  if (!rawUrl) return fail("URL is required");
  if (rawUrl.length > 2048) return fail("URL is too long");
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return fail("URL is not valid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail("URL must start with http:// or https://");
  }

  const timezone = String(input.timezone ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  if (!isValidTimezone(timezone)) return fail(`Unknown timezone: ${timezone}`);

  const scheduleMode: CronScheduleMode = input.schedule_mode === "custom" ? "custom" : "preset";
  let schedulePreset: string | null = null;
  let expression = String(input.cron_expression ?? "").trim();
  if (scheduleMode === "preset") {
    schedulePreset = String(input.schedule_preset ?? "").trim();
    const preset = findPreset(schedulePreset);
    if (!preset) return fail("Choose a valid schedule preset");
    expression = preset.expression;
  }
  const scheduleError = validateSchedule(expression, timezone);
  if (scheduleError) return fail(scheduleError);

  const rawHeaders = Array.isArray(input.headers) ? input.headers : [];
  if (rawHeaders.length > MAX_HEADERS) return fail(`Maximum ${MAX_HEADERS} headers`);
  const headers: CronJobHeader[] = [];
  for (const item of rawHeaders) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const key = String(rec.key ?? "").trim();
    const value = String(rec.value ?? "");
    if (!key && !value) continue;
    if (!key) return fail("Header name is required");
    if (!HEADER_NAME.test(key)) return fail(`Invalid header name: ${key}`);
    if (/[\r\n]/.test(value)) return fail(`Header "${key}" value contains a line break`);
    headers.push({
      key: key.slice(0, 100),
      value: value.slice(0, 4_000),
      enabled: rec.enabled !== false,
    });
  }

  const method: CronMethod = input.method === "POST" ? "POST" : "GET";
  let body: string | null = null;
  if (method === "POST" && typeof input.body === "string" && input.body.trim()) {
    if (input.body.length > MAX_REQUEST_BODY) return fail("Request body is too large (max 64 KB)");
    body = input.body;
  }

  const timeoutMs = Math.min(
    Math.max(Math.floor(Number(input.timeout_ms) || DEFAULT_TIMEOUT_MS), MIN_TIMEOUT_MS),
    MAX_TIMEOUT_MS
  );

  const commentRaw = String(input.comment ?? "").trim();
  return {
    ok: true,
    value: {
      title,
      url: rawUrl,
      comment: commentRaw ? commentRaw.slice(0, MAX_COMMENT) : null,
      schedule_mode: scheduleMode,
      schedule_preset: schedulePreset,
      cron_expression: expression,
      timezone,
      tags: normalizeTags(input.tags),
      method,
      headers,
      body,
      timeout_ms: timeoutMs,
      enabled: input.enabled !== false,
    },
  };
}

export function computeNextRunAt(expression: string, timezone: string, from: Date = new Date()): Date | null {
  try {
    return upcomingRuns(expression, timezone, 1, from)[0] ?? null;
  } catch {
    return null;
  }
}

async function collectHeaders(headers: Headers): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let size = 0;
  for (const [key, value] of headers.entries()) {
    const v = value.slice(0, 2_000);
    if (size + key.length + v.length > 16_000) break;
    out[key] = v;
    size += key.length + v.length;
  }
  return out;
}

async function readBodyCapped(
  res: Response,
  cap: number
): Promise<{ text: string; truncated: boolean; bytes: number }> {
  if (!res.body) return { text: "", truncated: false, bytes: 0 };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > cap) {
        const remaining = cap - (bytes - value.byteLength);
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return {
    text: buf.subarray(0, cap).toString("utf8"),
    truncated,
    bytes: Math.max(bytes, cap),
  };
}

export async function executeRequest(config: CronJobConfig): Promise<CronRunResult> {
  const started = Date.now();
  const timeout = Math.min(Math.max(config.timeout_ms, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
  const headers = new Headers();
  for (const h of config.headers) {
    if (h.enabled === false || !h.key.trim()) continue;
    headers.set(h.key.trim(), h.value);
  }
  let body: string | undefined;
  if (config.method === "POST") {
    body = config.body ?? "";
    if (body && !headers.has("content-type")) {
      headers.set("content-type", /^\s*[[{]/.test(body) ? "application/json" : "text/plain; charset=utf-8");
    }
  }
  try {
    const res = await fetch(config.url, {
      method: config.method,
      headers,
      body,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
    const read = await readBodyCapped(res, MAX_RESPONSE_BODY);
    const responseHeaders = await collectHeaders(res.headers);
    const ok = res.status >= 200 && res.status < 300;
    return {
      status: ok ? "success" : "failed",
      httpStatus: res.status,
      durationMs: Date.now() - started,
      contentType: res.headers.get("content-type"),
      headers: responseHeaders,
      body: read.text,
      truncated: read.truncated,
      bytes: read.bytes,
      error: ok ? null : `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /timeout|timed out|aborted/i.test(msg);
    return {
      status: timedOut ? "timeout" : "failed",
      httpStatus: null,
      durationMs: Date.now() - started,
      contentType: null,
      headers: {},
      body: "",
      truncated: false,
      bytes: 0,
      error: timedOut ? `Timed out after ${Math.round(timeout / 1000)}s` : msg.slice(0, 1_000),
    };
  }
}

async function insertRunningRun(
  client: Pool | PoolClient,
  jobId: number,
  config: Pick<CronJobConfig, "url" | "method">,
  trigger: CronTrigger,
  scheduledFor: Date | null
): Promise<number> {
  const r = await client.query(
    `INSERT INTO cron_job_runs (job_id, trigger, scheduled_for, request_url, request_method, status, started_at)
     VALUES ($1, $2, $3, $4, $5, 'running', now()) RETURNING id`,
    [jobId, trigger, scheduledFor, config.url, config.method]
  );
  return Number(r.rows[0].id);
}

async function finishRun(runId: number, result: CronRunResult): Promise<void> {
  await db().query(
    `UPDATE cron_job_runs SET status=$2, finished_at=now(), duration_ms=$3, http_status=$4,
       response_content_type=$5, response_headers=$6, response_body=$7, response_truncated=$8,
       response_bytes=$9, error=$10
     WHERE id=$1`,
    [
      runId,
      result.status,
      result.durationMs,
      result.httpStatus,
      result.contentType,
      JSON.stringify(result.headers),
      result.body,
      result.truncated,
      result.bytes,
      result.error,
    ]
  );
}

async function touchJobAfterRun(jobId: number, result: CronRunResult): Promise<void> {
  await db().query(
    `UPDATE cron_jobs SET last_run_at=now(), last_status=$2, last_http_status=$3, last_duration_ms=$4,
       consecutive_failures = CASE WHEN $2 = 'success' THEN 0 ELSE consecutive_failures + 1 END,
       updated_at=now()
     WHERE id=$1`,
    [jobId, result.status === "success" ? "success" : "failed", result.httpStatus, result.durationMs]
  );
}

async function pruneRuns(jobId: number): Promise<void> {
  await db().query(
    `DELETE FROM cron_job_runs WHERE job_id=$1 AND id NOT IN (
       SELECT id FROM cron_job_runs WHERE job_id=$1 ORDER BY id DESC LIMIT ${MAX_RUNS_PER_JOB}
     )`,
    [jobId]
  );
}

export async function runJobTest(
  config: CronJobConfig,
  jobId: number | null
): Promise<{ notFound: true } | { notFound: false; result: CronRunResult; runId: number | null }> {
  let runId: number | null = null;
  if (jobId !== null) {
    const exists = await db().query(`SELECT id FROM cron_jobs WHERE id=$1`, [jobId]);
    if (!exists.rows.length) return { notFound: true };
    runId = await insertRunningRun(db(), jobId, config, "test", null);
  }
  const result = await executeRequest(config);
  if (runId !== null && jobId !== null) {
    await finishRun(runId, result).catch(() => {});
    await pruneRuns(jobId).catch(() => {});
  }
  return { notFound: false, result, runId };
}

type ClaimedJob = { job: CronJob; runId: number };

// Called from /api/cron after the response is sent. Claims due jobs atomically
// (advancing next_run_at before execution) so overlapping ticks never double-run.
export async function dispatchDueJobs(): Promise<{ due: number; succeeded: number; failed: number }> {
  const pool = db();
  const limit = Math.min(Math.max(Math.floor(Number(process.env.CRON_JOBS_MAX_PER_TICK) || DISPATCH_LIMIT), 1), 50);

  await pool.query(`UPDATE settings SET cron_jobs_heartbeat_at=now() WHERE id=1`).catch(() => {});
  // A process can die mid-run; free those rows after a generous grace period.
  await pool.query(
    `UPDATE cron_job_runs SET status='failed', finished_at=now(),
       error=COALESCE(error, 'run interrupted before completion')
     WHERE status='running' AND started_at < now() - INTERVAL '5 minutes'`
  ).catch(() => {});

  const client = await pool.connect();
  const claimed: ClaimedJob[] = [];
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `SELECT * FROM cron_jobs
       WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= now()
       ORDER BY next_run_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    for (const row of due.rows as CronJobRow[]) {
      const job = serializeJob(row);
      const scheduledFor = job.next_run_at ? new Date(job.next_run_at) : null;
      const runId = await insertRunningRun(client, job.id, job, "scheduled", scheduledFor);
      const next = computeNextRunAt(job.cron_expression, job.timezone);
      await client.query(
        `UPDATE cron_jobs SET next_run_at=$2, updated_at=now() WHERE id=$1`,
        [job.id, next]
      );
      claimed.push({ job, runId });
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  if (!claimed.length) return { due: 0, succeeded: 0, failed: 0 };

  const results = await Promise.all(
    claimed.map(async ({ job, runId }) => {
      const result = await executeRequest(job);
      await finishRun(runId, result).catch(() => {});
      await touchJobAfterRun(job.id, result).catch(() => {});
      await pruneRuns(job.id).catch(() => {});
      return result;
    })
  );

  await pool.query(`UPDATE settings SET cron_jobs_heartbeat_at=now() WHERE id=1`).catch(() => {});
  const succeeded = results.filter((r) => r.status === "success").length;
  return { due: results.length, succeeded, failed: results.length - succeeded };
}
