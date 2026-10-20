import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serializeRun, type CronJobRunRow } from "@/lib/cron-jobs";

export const dynamic = "force-dynamic";

// GET /api/cron-jobs/:id/runs?page=1&per=20&status=&trigger=
// Run metadata + a short body preview; the full saved response is fetched per run.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const jobId = Number(id);
    if (!Number.isFinite(jobId) || jobId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
    const per = Math.min(Math.max(1, Number(sp.get("per") ?? 20) || 20), 100);
    const status = sp.get("status");
    const trigger = sp.get("trigger");

    const conds = ["job_id=$1"];
    const vals: unknown[] = [jobId];
    if (status && ["running", "success", "failed", "timeout"].includes(status)) {
      vals.push(status);
      conds.push(`status=$${vals.length}`);
    }
    if (trigger && ["scheduled", "test"].includes(trigger)) {
      vals.push(trigger);
      conds.push(`trigger=$${vals.length}`);
    }
    const where = `WHERE ${conds.join(" AND ")}`;
    const pool = db();
    const exists = await pool.query(`SELECT id FROM cron_jobs WHERE id=$1`, [jobId]);
    if (!exists.rows.length) return NextResponse.json({ error: "job not found" }, { status: 404 });

    const total = Number(
      (await pool.query(`SELECT COUNT(*)::int AS c FROM cron_job_runs ${where}`, vals)).rows[0].c
    );
    vals.push(per, (page - 1) * per);
    const rows = await pool.query(
      `SELECT id, job_id, trigger, scheduled_for, started_at, finished_at, duration_ms, status,
              request_url, request_method, http_status, response_content_type, response_headers,
              response_truncated, response_bytes, error, created_at,
              LEFT(COALESCE(response_body, ''), 600) AS body_preview
       FROM cron_job_runs ${where}
       ORDER BY id DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    return NextResponse.json({
      runs: (rows.rows as CronJobRunRow[]).map((row) => serializeRun(row)),
      total,
      page,
      per,
      totalPages: Math.max(1, Math.ceil(total / per)),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
