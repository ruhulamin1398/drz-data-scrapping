import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/prewarm/queue?status=..&limit=..&offset=.. — page of rows + counts.
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status");
    const all = req.nextUrl.searchParams.get("limit") === "all";
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 500), 1000);
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0);
    const pool = db();
    const conds: string[] = [];
    const vals: (string | number)[] = [];
    if (status) { vals.push(status); conds.push(`status=$${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    let sql = `SELECT * FROM prewarm_queue ${where} ORDER BY id`;
    if (!all) {
      vals.push(limit, offset);
      sql += ` LIMIT $${vals.length - 1} OFFSET $${vals.length}`;
    }
    const rows = await pool.query(sql, vals);
    const counts = await pool.query(`SELECT status, COUNT(*) c FROM prewarm_queue GROUP BY status`);
    const byStatus: Record<string, number> = { pending: 0, processing: 0, success: 0, failed: 0 };
    for (const r of counts.rows) byStatus[r.status] = Number(r.c);
    return NextResponse.json({ items: rows.rows, counts: byStatus });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// PATCH /api/prewarm/queue { url, status, httpCode?, durationMs?, failReason? }
// Single-row update for the browser retry flow (processing rows stay
// unlocked — locked_at=NULL — so the server loop never touches them).
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.url || !b.status) return NextResponse.json({ error: "url + status required" }, { status: 400 });
    await db().query(
      `UPDATE prewarm_queue SET status=$2,
        http_code=COALESCE($3,http_code), duration_ms=COALESCE($4,duration_ms),
        fail_reason=$5,
        locked_at = CASE WHEN $2='processing' THEN NULL ELSE locked_at END,
        updated_at=now() WHERE source_url=$1`,
      [b.url, b.status, b.httpCode ?? null, b.durationMs ?? null, b.failReason ?? null]
    );
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST /api/prewarm/queue { action }
// - retry: failed → processing (claimed for immediate browser work, locked_at=NULL)
// - to-pending: failed → pending (server cron picks them up next tick)
// - clear: wipe the whole queue history
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const pool = db();
    if (b.action === "retry") {
      const r = await pool.query(
        `UPDATE prewarm_queue SET status='processing',
          fail_reason=NULL, locked_at=NULL, updated_at=now()
         WHERE status='failed'`
      );
      return NextResponse.json({ reset: r.rowCount ?? 0 });
    }
    if (b.action === "to-pending") {
      const r = await pool.query(
        `UPDATE prewarm_queue SET status='pending',
          fail_reason=NULL, locked_at=NULL, updated_at=now()
         WHERE status='failed'`
      );
      return NextResponse.json({ reset: r.rowCount ?? 0 });
    }
    if (b.action === "clear") {
      const r = await pool.query(`DELETE FROM prewarm_queue`);
      return NextResponse.json({ cleared: r.rowCount ?? 0 });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
