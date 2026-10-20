import { NextRequest, NextResponse, after } from "next/server";
import { runProcessor, getPipelineStats } from "@/lib/processor";
import { dispatchDueJobs } from "@/lib/cron-jobs";

export const maxDuration = 60;

// Tick endpoint for cron-job.org (every 1 min). Verifies CRON_SECRET, then runs
// one processor tick plus any due URL cron jobs. Both run independently; jobs
// are dispatched in the background so this response stays fast.
// Response includes the tick result + full pipeline stats snapshot.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret") || "";
  if (!secret || given !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  after(() => {
    dispatchDueJobs().catch((e: unknown) => {
      console.error("cron-jobs dispatch failed:", e instanceof Error ? e.message : String(e));
    });
  });

  try {
    const tick = await runProcessor();
    const stats = await getPipelineStats().catch(() => null);
    return NextResponse.json({ ...tick, stats });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
