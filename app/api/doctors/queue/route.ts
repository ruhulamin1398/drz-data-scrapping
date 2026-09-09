import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/doctors/queue?status=..&specialty=..&city=..&limit=..&offset=.. — page of rows + unfiltered counts.
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status");
    const specialty = req.nextUrl.searchParams.get("specialty");
    const city = req.nextUrl.searchParams.get("city");
    const all = req.nextUrl.searchParams.get("limit") === "all";
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 500), 1000);
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0);
    const pool = db();
    const conds: string[] = [];
    const vals: (string | number)[] = [];
    if (status) { vals.push(status); conds.push(`status=$${vals.length}`); }
    if (specialty) { vals.push(specialty); conds.push(`specialty_slug=$${vals.length}`); }
    if (city) { vals.push(city); conds.push(`city=$${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    let sql = `SELECT * FROM doctor_queue ${where} ORDER BY id`;
    if (!all) {
      vals.push(limit, offset);
      sql += ` LIMIT $${vals.length - 1} OFFSET $${vals.length}`;
    }
    const rows = await pool.query(sql, vals);
    const cconds: string[] = [];
    const cvals: string[] = [];
    if (specialty) { cvals.push(specialty); cconds.push(`specialty_slug=$${cvals.length}`); }
    if (city) { cvals.push(city); cconds.push(`city=$${cvals.length}`); }
    const cwhere = cconds.length ? `WHERE ${cconds.join(" AND ")}` : "";
    const counts = await pool.query(`SELECT status, COUNT(*) c FROM doctor_queue ${cwhere} GROUP BY status`, cvals);
    const byStatus: Record<string, number> = { pending: 0, processing: 0, success: 0, failed: 0 };
    for (const r of counts.rows) byStatus[r.status] = Number(r.c);
    return NextResponse.json({ items: rows.rows, counts: byStatus });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// PATCH /api/doctors/queue { url, status, ...fields } — single-row reset/retry.
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.url || !b.status) return NextResponse.json({ error: "url + status required" }, { status: 400 });
    const pool = db();
    await pool.query(
      `UPDATE doctor_queue SET status=$2, name=COALESCE($3,name), drx_id=COALESCE($4,drx_id),
        fail_reason=$5, locked_at = CASE WHEN $2='processing' THEN NULL ELSE locked_at END,
        updated_at=now() WHERE source_url=$1`,
      [b.url, b.status, b.name ?? null, b.drxId ?? null, b.failReason ?? null]
    );
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST /api/doctors/queue { action: "retry", statuses: [...] } — bulk reset to pending.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const allowed = ["failed", "success"];
    if (b.action !== "retry" || !Array.isArray(b.statuses)) {
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
    const statuses = b.statuses.filter((s: string) => allowed.includes(s));
    if (!statuses.length) return NextResponse.json({ error: "no valid statuses" }, { status: 400 });
    const pool = db();
    const r = await pool.query(
      `UPDATE doctor_queue SET status='pending', fail_reason=NULL, locked_at=NULL, updated_at=now()
       WHERE status = ANY($1)`,
      [statuses]
    );
    return NextResponse.json({ reset: r.rowCount ?? 0 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
