import { NextRequest, NextResponse } from "next/server";
import { runProcessor, getPipelineStats } from "@/lib/processor";

export const maxDuration = 60;

// Tick endpoint for cron-job.org (every 1 min). Verifies CRON_SECRET,
// then runs one processing tick. Safe to call any time: disabled settings
// or an empty queue just return without work.
// Response always includes the tick result + full pipeline stats snapshot.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const given = req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret") || "";
  if (!secret || given !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
