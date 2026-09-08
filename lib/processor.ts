import { Pool } from "pg";
import { db } from "./db";
import { fetchSource, extractInfo, pushDrx } from "./scrape";
import { parseExtracted } from "./parse";

export type QRow = {
  id: number; title: string; source_url: string;
  division_id: number; district_id: number | null; type_id: number;
  group_key: string | null; status: string;
  name: string | null; full_address: string | null;
  drx_id: number | null; fail_reason: string | null;
  full_content: boolean;
};

export type TickResult = {
  status: "paused" | "done";
  claimed: number; succeeded: number; failed: number; remaining: number;
};

const TICK_BUDGET_MS = 50000;
const STALE_MS = 10 * 60 * 1000;

async function getSettings(pool: Pool) {
  const r = await pool.query("SELECT * FROM settings WHERE id=1");
  return r.rows[0] as { enabled: boolean; concurrency: number; tasks_per_tick: number; heartbeat_at: string | null } | undefined;
}

// Atomically claim up to n pending rows (SKIP LOCKED = overlapping ticks never collide).
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

// One cron tick: gate on settings.enabled, top up active rows to tasks_per_tick,
// work them with `concurrency` parallel workers. Single attempt, terminal states.
export async function runProcessor(): Promise<TickResult> {
  const pool = db();
  const s = await getSettings(pool);
  if (!s || !s.enabled) return { status: "paused", claimed: 0, succeeded: 0, failed: 0, remaining: 0 };
  await pool.query("UPDATE settings SET heartbeat_at=now() WHERE id=1");

  // Reconcile: rows stuck in processing (dead run, closed tab, old rows without
  // locked_at) go back to pending.
  await pool.query(
    `UPDATE facility_queue SET status='pending', locked_at=NULL, updated_at=now()
     WHERE status='processing' AND (locked_at IS NULL OR locked_at < now() - INTERVAL '10 minutes')`
  );

  const concurrency = Math.min(Math.max(1, s.concurrency || 1), 10);
  const quota = Math.min(Math.max(1, s.tasks_per_tick || 1), 50);
  // Top-up: this tick owns up to (quota − already active) rows, then exits.
  const active0 = Number((await pool.query("SELECT COUNT(*) c FROM facility_queue WHERE status='processing'")).rows[0].c);
  let toClaim = Math.max(0, quota - active0);
  let claimed = 0, succeeded = 0, failed = 0;
  const deadline = Date.now() + TICK_BUDGET_MS;

  while (toClaim > 0 && Date.now() < deadline) {
    const cur = await getSettings(pool);
    if (!cur || !cur.enabled) break; // Stop takes effect within seconds
    const rows = await claim(pool, Math.min(toClaim, concurrency));
    if (!rows.length) break;
    toClaim -= rows.length;
    claimed += rows.length;
    const results = await Promise.all(rows.map((q) => processSingleItem(pool, q)));
    const ok = results.filter(Boolean).length;
    succeeded += ok;
    failed += results.length - ok;
  }

  const remaining = Number((await pool.query("SELECT COUNT(*) c FROM facility_queue WHERE status='pending'")).rows[0].c);
  return { status: "done", claimed, succeeded, failed, remaining };
}
