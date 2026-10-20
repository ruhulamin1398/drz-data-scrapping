import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  buildCronJobConfig,
  computeNextRunAt,
  serializeJob,
  serializeRun,
  type CronJobRow,
  type CronJobRunRow,
} from "@/lib/cron-jobs";

export const dynamic = "force-dynamic";

async function parseId(ctx: { params: Promise<{ id: string }> }): Promise<number | null> {
  const { id } = await ctx.params;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// GET /api/cron-jobs/:id — job + last 20 run summaries (responses stay in the runs endpoint).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = await parseId(ctx);
  if (id === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  try {
    const pool = db();
    const r = await pool.query(`SELECT * FROM cron_jobs WHERE id=$1`, [id]);
    if (!r.rows.length) return NextResponse.json({ error: "job not found" }, { status: 404 });
    const runs = await pool.query(
      `SELECT id, job_id, trigger, scheduled_for, started_at, finished_at, duration_ms, status,
              request_url, request_method, http_status, response_content_type, response_headers,
              response_truncated, response_bytes, error, created_at,
              LEFT(COALESCE(response_body, ''), 600) AS body_preview
       FROM cron_job_runs WHERE job_id=$1 ORDER BY id DESC LIMIT 20`,
      [id]
    );
    return NextResponse.json({
      job: serializeJob(r.rows[0] as CronJobRow),
      runs: (runs.rows as CronJobRunRow[]).map((row) => serializeRun(row)),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// PATCH /api/cron-jobs/:id — partial update; the merged config is revalidated.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = await parseId(ctx);
  if (id === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  try {
    const pool = db();
    const cur = await pool.query(`SELECT * FROM cron_jobs WHERE id=$1`, [id]);
    if (!cur.rows.length) return NextResponse.json({ error: "job not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON body required" }, { status: 400 });
    }
    const current = cur.rows[0] as CronJobRow;
    const merged: Record<string, unknown> = {
      title: current.title,
      url: current.url,
      comment: current.comment,
      schedule_mode: current.schedule_mode,
      schedule_preset: current.schedule_preset,
      cron_expression: current.cron_expression,
      timezone: current.timezone,
      tags: current.tags,
      method: current.method,
      headers: current.headers,
      body: current.body,
      timeout_ms: current.timeout_ms,
      enabled: current.enabled,
      ...body,
    };
    const built = buildCronJobConfig(merged);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
    const cfg = built.value;
    const next = cfg.enabled ? computeNextRunAt(cfg.cron_expression, cfg.timezone) : null;
    const r = await pool.query(
      `UPDATE cron_jobs SET title=$2, url=$3, comment=$4, schedule_mode=$5, schedule_preset=$6,
         cron_expression=$7, timezone=$8, tags=$9, method=$10, headers=$11, body=$12,
         timeout_ms=$13, enabled=$14, next_run_at=$15, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [
        id,
        cfg.title,
        cfg.url,
        cfg.comment,
        cfg.schedule_mode,
        cfg.schedule_preset,
        cfg.cron_expression,
        cfg.timezone,
        cfg.tags,
        cfg.method,
        JSON.stringify(cfg.headers),
        cfg.body,
        cfg.timeout_ms,
        cfg.enabled,
        next,
      ]
    );
    return NextResponse.json({ job: serializeJob(r.rows[0] as CronJobRow) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// DELETE /api/cron-jobs/:id — cascades run history.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = await parseId(ctx);
  if (id === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  try {
    const r = await db().query(`DELETE FROM cron_jobs WHERE id=$1 RETURNING id`, [id]);
    if (!r.rows.length) return NextResponse.json({ error: "job not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
