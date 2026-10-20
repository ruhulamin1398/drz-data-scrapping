import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  buildCronJobConfig,
  runJobTest,
  type CronJobRow,
} from "@/lib/cron-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 35;

// POST /api/cron-jobs/test — execute a request immediately.
// Body: { jobId?: number, config?: {...} }. The supplied config is used (so
// unsaved edits can be tested); when jobId is present the result is recorded
// in history as trigger='test' but last_* on the job is left untouched.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON body required" }, { status: 400 });
    }
    const jobIdRaw = body.jobId ?? body.id;
    let jobId: number | null = null;
    if (jobIdRaw !== undefined && jobIdRaw !== null) {
      jobId = Number(jobIdRaw);
      if (!Number.isFinite(jobId) || jobId <= 0) {
        return NextResponse.json({ error: "invalid job id" }, { status: 400 });
      }
    }

    let configInput: Record<string, unknown> | null = null;
    if (body.config && typeof body.config === "object") {
      configInput = body.config as Record<string, unknown>;
    } else if (jobId !== null) {
      const r = await db().query(`SELECT * FROM cron_jobs WHERE id=$1`, [jobId]);
      if (!r.rows.length) return NextResponse.json({ error: "job not found" }, { status: 404 });
      configInput = r.rows[0] as CronJobRow;
    }
    if (!configInput) {
      return NextResponse.json({ error: "config or jobId required" }, { status: 400 });
    }
    const built = buildCronJobConfig(configInput);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

    const out = await runJobTest(built.value, jobId);
    if (out.notFound) return NextResponse.json({ error: "job not found" }, { status: 404 });
    return NextResponse.json({
      ok: out.result.status === "success",
      result: out.result,
      runId: out.runId,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
