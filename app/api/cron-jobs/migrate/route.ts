import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CRON_JOBS_DDL } from "@/lib/cron-schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/cron-jobs/migrate — protected, idempotent schema setup.
// Useful when the database is only reachable from the deployed app.
// Header x-cron-secret (or ?secret=) must match CRON_SECRET.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret") || "";
  if (!secret || given !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    for (const sql of CRON_JOBS_DDL) await db().query(sql);
    return NextResponse.json({ ok: true, statements: CRON_JOBS_DDL.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
