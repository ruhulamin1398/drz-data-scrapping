import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/cron/runs?page=1&per=15&status=done — paginated tick history, newest first
export async function GET(req: NextRequest) {
  try {
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1) || 1);
    const per = Math.min(Math.max(1, Number(req.nextUrl.searchParams.get("per") ?? 15) || 15), 100);
    const status = req.nextUrl.searchParams.get("status");
    const vals: (string | number)[] = [];
    let where = "";
    if (status && ["done", "started", "already-running", "paused", "running", "error"].includes(status)) {
      vals.push(status);
      where = `WHERE status=$${vals.length}`;
    }
    const total = Number((await db().query(`SELECT COUNT(*) c FROM cron_runs ${where}`, vals)).rows[0].c);
    vals.push(per, (page - 1) * per);
    const r = await db().query(
      `SELECT id, started_at, finished_at, duration_ms, status, claimed, succeeded, failed, remaining, error
       FROM cron_runs ${where} ORDER BY id DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    return NextResponse.json({ runs: r.rows, total, page, per, totalPages: Math.max(1, Math.ceil(total / per)) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
