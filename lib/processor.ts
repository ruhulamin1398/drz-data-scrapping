import { Pool } from "pg";
import { after } from "next/server";
import { db } from "./db";
import { fetchSource, extractInfo, pushDrx } from "./scrape";
import { parseExtracted } from "./parse";
import { fetchDoctorProfile, fetchDoctorPhoto, extractDoctor, deptTitle, pushDoctor } from "./doctor";

export type QRow = {
  id: number; title: string; source_url: string;
  division_id: number; district_id: number | null; type_id: number;
  group_key: string | null; status: string;
  name: string | null; full_address: string | null;
  drx_id: number | null; fail_reason: string | null;
  full_content: boolean;
};

export type TickResult = {
  status: "paused" | "started" | "already-running";
  toppedUp: number; active: number; remaining: number;
  dtoppedUp: number; dactive: number; dremaining: number;
};

export type DocRow = {
  id: number; source_url: string; name: string | null;
  specialty_slug: string; specialty_slugs: string[]; department_ids: string[];
  card_text: string | null; status: string; drx_id: string | null;
  structure_md: string | null;
};

export type PipelineStats = {
  enabled: boolean; concurrency: number; tasks_per_tick: number;
  workerActive: boolean; workerHeartbeat: string | null; heartbeatAt: string | null;
  facilities: Record<string, number>; doctors: Record<string, number>;
  lastRun: { status: string; succeeded: number; failed: number; claimed: number; finishedAt: string | null } | null;
};

// Full snapshot for the cron response (and any monitor): settings + both queue
// tallies + the most recent cron run. Cheap single-round queries.
export async function getPipelineStats(): Promise<PipelineStats> {
  const pool = db();
  const full = await pool.query("SELECT * FROM settings WHERE id=1").catch(() => null);
  const f = full?.rows[0] as {
    enabled: boolean; concurrency: number; tasks_per_tick: number;
    worker_active: boolean; worker_heartbeat: string | null; heartbeat_at: string | null;
  } | undefined;
  const tally = async (table: string) => {
    const out: Record<string, number> = { pending: 0, processing: 0, success: 0, failed: 0 };
    const r = await pool.query(`SELECT status, COUNT(*) c FROM ${table} GROUP BY status`).catch(() => null);
    for (const row of r?.rows ?? []) out[row.status] = Number(row.c);
    return out;
  };
  const last = await pool.query(
    `SELECT status, COALESCE(succeeded,0) succeeded, COALESCE(failed,0) failed,
      COALESCE(claimed,0) claimed, finished_at FROM cron_runs ORDER BY id DESC LIMIT 1`
  ).catch(() => null);
  const lr = last?.rows[0];
  return {
    enabled: !!f?.enabled, concurrency: f?.concurrency ?? 0, tasks_per_tick: f?.tasks_per_tick ?? 0,
    workerActive: !!f?.worker_active, workerHeartbeat: f?.worker_heartbeat ?? null,
    heartbeatAt: f?.heartbeat_at ?? null,
    facilities: await tally("facility_queue"), doctors: await tally("doctor_queue"),
    lastRun: lr ? {
      status: lr.status, succeeded: Number(lr.succeeded), failed: Number(lr.failed),
      claimed: Number(lr.claimed), finishedAt: lr.finished_at,
    } : null,
  };
}

const LOOP_BUDGET_MS = 45000;
const OWNER_STALE_MS = 2 * 60 * 1000;

// Per-instance fast path: on Render (persistent process) this stays true while
// the loop works; on Vercel each invocation may be a fresh instance (DB owns truth).
let loopRunning = false;

async function getSettings(pool: Pool) {
  const r = await pool.query("SELECT * FROM settings WHERE id=1");
  return r.rows[0] as {
    enabled: boolean; concurrency: number; tasks_per_tick: number;
    worker_active: boolean; worker_heartbeat: string | null;
  } | undefined;
}

// Doctor items are slow (~60-90s: jina + big-model extract + multi-push) and do not
// survive Vercel's fire-and-forget after() window — a Vercel claim would just lock
// rows until reconcile frees them. So only the persistent host (Render, where the
// loop lives as long as the process) owns doctor work. Vercel ticks still report stats.
const DOCS_ON_SERVER = !process.env.VERCEL;

// Atomically claim up to n pending doctor rows. Server claims stamp locked_at=now();
// browser-owned rows keep locked_at=NULL so the server loop never touches them.
async function claimDoctors(pool: Pool, n: number): Promise<DocRow[]> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query(
      `SELECT * FROM doctor_queue WHERE status='pending'
       ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [n]
    );
    const rows = r.rows as DocRow[];
    if (rows.length) {
      await c.query(
        `UPDATE doctor_queue SET status='processing', locked_at=now(), updated_at=now()
         WHERE id = ANY($1)`,
        [rows.map((x) => x.id)]
      );
    }
    await c.query("COMMIT");
    return rows;
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}

async function processDoctorItem(pool: Pool, q: DocRow): Promise<boolean> {
  try {
    // Reuse stored Jina markdown when present — saves a Jina call (rate limits).
    // Otherwise fetch fresh and store it for next time (retries reuse it too).
    let md = q.structure_md;
    if (!md) {
      md = await fetchDoctorProfile(q.source_url);
      await pool.query(
        `UPDATE doctor_queue SET structure_md=$2, updated_at=now() WHERE source_url=$1`,
        [q.source_url, md]
      ).catch(() => {});
    }
    const d = await extractDoctor(md, q.specialty_slug, deptTitle(q.specialty_slug), q.card_text ?? undefined);
    const photo = await fetchDoctorPhoto(q.source_url);
    const r = await pushDoctor({
      ...d, departmentIds: q.department_ids, sourceUrl: q.source_url,
      drxId: q.drx_id ?? undefined, photo: photo || d.photo,
    });
    await pool.query(
      `UPDATE doctor_queue SET status='success', name=$2, drx_id=$3, fail_reason=NULL, updated_at=now() WHERE source_url=$1`,
      [q.source_url, d.name, r.drxId]
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE doctor_queue SET status='failed', fail_reason=$2, updated_at=now() WHERE source_url=$1`,
      [q.source_url, msg.slice(0, 300)]
    ).catch(() => {});
    return false;
  }
}
async function claim(pool: Pool, n: number): Promise<QRow[]> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query(
      `SELECT * FROM facility_queue WHERE status='pending'
       ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [n]
    );
    const rows = r.rows as QRow[];
    if (rows.length) {
      await c.query(
        `UPDATE facility_queue SET status='processing', locked_at=now(), updated_at=now()
         WHERE id = ANY($1)`,
        [rows.map((x) => x.id)]
      );
    }
    await c.query("COMMIT");
    return rows;
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}

async function mark(pool: Pool, url: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");
  await pool.query(`UPDATE facility_queue SET ${sets}, updated_at=now() WHERE source_url=$1`, [url, ...keys.map((k) => patch[k])]);
}

async function processSingleItem(pool: Pool, q: QRow): Promise<boolean> {
  try {
    const f = await fetchSource(q.source_url, !!q.full_content);
    const text = await extractInfo(f.trimmed, q.division_id);
    const p = parseExtracted(text);
    if (!p.fullAddress) {
      await mark(pool, q.source_url, { status: "failed", name: p.name || null, fail_reason: "fullAddress empty from model" });
      return false;
    }
    const divisionId = p.divisionId || q.division_id;
    const districtId = p.districtId || q.district_id;
    if (!districtId) {
      await mark(pool, q.source_url, { status: "failed", name: p.name, full_address: p.fullAddress, fail_reason: "districtId unknown" });
      return false;
    }
    const r = await pushDrx({
      name: p.name, divisionId, districtId, typeId: q.type_id,
      fullAddress: p.fullAddress, phones: p.phones, extraInformation: p.extraInformation,
      drxId: q.drx_id ?? undefined,
    });
    await mark(pool, q.source_url, {
      status: "success", name: p.name, full_address: p.fullAddress,
      phones: p.phones, extra_information: p.extraInformation,
      division_id: divisionId, district_id: districtId, drx_id: r.drxId, fail_reason: null,
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await mark(pool, q.source_url, { status: "failed", fail_reason: msg.slice(0, 300) }).catch(() => {});
    return false;
  }
}

// The background worker: eats server-claimed rows (locked_at NOT NULL — browser
// retries own theirs) until none remain, disabled, or the time budget ends.
// Then it stops and releases ownership; the next tick starts it again if needed.
async function workerLoop(concurrency: number): Promise<{ succeeded: number; failed: number }> {
  const pool = db();
  let succeeded = 0, failed = 0;
  const deadline = Date.now() + LOOP_BUDGET_MS;
  const run = await pool.query("INSERT INTO cron_runs (status) VALUES ('running') RETURNING id").catch(() => null);
  const runId: number | null = run?.rows[0]?.id ?? null;
  try {
    while (Date.now() < deadline) {
      const s = await getSettings(pool);
      if (!s || !s.enabled) break;
      await pool.query("UPDATE settings SET worker_heartbeat=now() WHERE id=1").catch(() => {});
      // Server-owned rows only (locked_at NOT NULL) — browser retries own theirs.
      const batch = await pool.query(
        `SELECT * FROM facility_queue
         WHERE status='processing' AND locked_at IS NOT NULL
         ORDER BY id LIMIT $1`,
        [concurrency]
      );
      const dbatch = DOCS_ON_SERVER
        ? await pool.query(
          `SELECT * FROM doctor_queue
           WHERE status='processing' AND locked_at IS NOT NULL
           ORDER BY id LIMIT $1`,
          [concurrency]
        )
        : { rows: [] as DocRow[] };
      const rows = batch.rows as QRow[];
      const drows = dbatch.rows as DocRow[];
      if (!rows.length && !drows.length) break;
      const results = await Promise.all([
        ...rows.map((q) => processSingleItem(pool, q)),
        ...drows.map((q) => processDoctorItem(pool, q)),
      ]);
      const ok = results.filter(Boolean).length;
      succeeded += ok;
      failed += results.length - ok;
    }
    if (runId !== null) {
      await pool.query(
        `UPDATE cron_runs SET finished_at=now(), duration_ms=$2, status='done',
          succeeded=$3, failed=$4 WHERE id=$1`,
        [runId, Date.now() - (deadline - LOOP_BUDGET_MS), succeeded, failed]
      ).catch(() => {});
    }
  } catch (err) {
    if (runId !== null) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query("UPDATE cron_runs SET finished_at=now(), status='error', error=$2 WHERE id=$1",
        [runId, msg.slice(0, 300)]).catch(() => {});
    }
  } finally {
    await pool.query("UPDATE settings SET worker_active=false, updated_at=now() WHERE id=1").catch(() => {});
    loopRunning = false;
  }
  return { succeeded, failed };
}

function logTick(pool: Pool, status: string, toppedUp: number) {
  return pool.query(
    `INSERT INTO cron_runs (status, finished_at, duration_ms, claimed) VALUES ($1, now(), 0, $2)`,
    [status, toppedUp]
  ).catch(() => {});
}

// One cron tick: reconcile, top pending up to (tasks_per_tick − active) into
// processing, ensure the worker loop is going, and RETURN IMMEDIATELY.
// Next tick while the loop works: only tops up, never restarts it.
export async function runProcessor(): Promise<TickResult> {
  const pool = db();
  const s = await getSettings(pool);
  if (!s || !s.enabled) {
    await logTick(pool, "paused", 0);
    return { status: "paused", toppedUp: 0, active: 0, remaining: 0, dtoppedUp: 0, dactive: 0, dremaining: 0 };
  }
  await pool.query("UPDATE settings SET heartbeat_at=now() WHERE id=1").catch(() => {});

  // Reconcile: rows stuck in processing (dead run, closed tab, old rows without
  // locked_at) go back to pending. Browser-owned rows (locked_at NULL) only when stale.
  await pool.query(
    `UPDATE facility_queue SET status='pending', locked_at=NULL, updated_at=now()
     WHERE status='processing' AND (locked_at IS NULL AND updated_at < now() - INTERVAL '10 minutes'
        OR locked_at < now() - INTERVAL '10 minutes')`
  ).catch(() => {});
  await pool.query(
    `UPDATE doctor_queue SET status='pending', locked_at=NULL, updated_at=now()
     WHERE status='processing' AND (locked_at IS NULL AND updated_at < now() - INTERVAL '10 minutes'
        OR locked_at < now() - INTERVAL '10 minutes')`
  ).catch(() => {});

  const concurrency = Math.min(Math.max(1, s.concurrency || 1), 10);
  const quota = Math.min(Math.max(1, s.tasks_per_tick || 1), 50);
  const active0 = Number((await pool.query("SELECT COUNT(*) c FROM facility_queue WHERE status='processing'")).rows[0].c);
  const dactive0 = Number((await pool.query("SELECT COUNT(*) c FROM doctor_queue WHERE status='processing'")).rows[0].c);
  // Facilities first (existing behavior), doctors take the remaining quota.
  const need = Math.max(0, quota - active0 - dactive0);
  const toppedUp = need > 0 ? (await claim(pool, need)).length : 0;
  const dneed = DOCS_ON_SERVER ? Math.max(0, quota - active0 - dactive0 - toppedUp) : 0;
  const dtoppedUp = dneed > 0 ? (await claimDoctors(pool, dneed)).length : 0;
  const remaining = Number((await pool.query("SELECT COUNT(*) c FROM facility_queue WHERE status='pending'")).rows[0].c);
  const dremaining = Number((await pool.query("SELECT COUNT(*) c FROM doctor_queue WHERE status='pending'")).rows[0].c);

  const tick = { toppedUp, active: active0 + toppedUp, remaining, dtoppedUp, dactive: dactive0 + dtoppedUp, dremaining };
  if (loopRunning) {
    await logTick(pool, "already-running", toppedUp + dtoppedUp);
    return { status: "already-running", ...tick };
  }
  // Atomic cross-instance ownership: only one loop anywhere.
  const own = await pool.query(
    `UPDATE settings SET worker_active=true, worker_heartbeat=now(), updated_at=now() WHERE id=1
     AND (worker_active=false OR worker_heartbeat IS NULL OR worker_heartbeat < now() - INTERVAL '2 minutes')
     RETURNING id`
  ).catch(() => null);
  if (!own || !own.rows.length) {
    await logTick(pool, "already-running", toppedUp + dtoppedUp);
    return { status: "already-running", ...tick };
  }
  loopRunning = true;
  after(() => workerLoop(concurrency));
  await logTick(pool, "started", toppedUp + dtoppedUp);
  return { status: "started", ...tick };
}
