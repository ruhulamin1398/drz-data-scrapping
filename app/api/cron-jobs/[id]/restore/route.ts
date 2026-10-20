import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serializeJob, type CronJobRow } from "@/lib/cron-jobs";

export const dynamic = "force-dynamic";

// POST /api/cron-jobs/:id/restore — take a job out of the trash.
// Restored jobs come back paused so a forgotten job cannot resume firing.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    const pool = db();
    const r = await pool.query(
      `UPDATE cron_jobs
       SET deleted_at=NULL, enabled=false, next_run_at=NULL, updated_at=now()
       WHERE id=$1 AND deleted_at IS NOT NULL
       RETURNING *`,
      [jobId]
    );
    if (!r.rows.length) {
      const exists = await pool.query(`SELECT id FROM cron_jobs WHERE id=$1`, [jobId]);
      if (!exists.rows.length) return NextResponse.json({ error: "job not found" }, { status: 404 });
      return NextResponse.json({ error: "job is not in trash" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, job: serializeJob(r.rows[0] as CronJobRow) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
