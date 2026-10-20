import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serializeRun, type CronJobRunRow } from "@/lib/cron-jobs";

export const dynamic = "force-dynamic";

// GET /api/cron-job-runs/:id — full saved response (body + headers) for the viewer.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const runId = Number(id);
    if (!Number.isFinite(runId) || runId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const r = await db().query(`SELECT * FROM cron_job_runs WHERE id=$1`, [runId]);
    if (!r.rows.length) return NextResponse.json({ error: "run not found" }, { status: 404 });
    return NextResponse.json({ run: serializeRun(r.rows[0] as CronJobRunRow, true) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
