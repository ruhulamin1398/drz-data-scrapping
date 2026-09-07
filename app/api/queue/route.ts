import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/queue?status=pending|processing|success|failed&limit=500 — list + counts
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status");
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 500), 1000);
    const pool = db();
    const rows = status
      ? await pool.query("SELECT * FROM facility_queue WHERE status=$1 ORDER BY id LIMIT $2", [status, limit])
      : await pool.query("SELECT * FROM facility_queue ORDER BY id LIMIT $1", [limit]);
    const counts = await pool.query("SELECT status, COUNT(*) c FROM facility_queue GROUP BY status");
    const byStatus: Record<string, number> = { pending: 0, processing: 0, success: 0, failed: 0 };
    for (const r of counts.rows) byStatus[r.status] = Number(r.c);
    return NextResponse.json({ items: rows.rows, counts: byStatus });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// PATCH /api/queue { url, status, name?, fullAddress?, phones?, extraInformation?, divisionId?, districtId?, typeId?, drxId?, failReason? }
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.url || !b.status) return NextResponse.json({ error: "url + status required" }, { status: 400 });
    const pool = db();
    await pool.query(
      `UPDATE facility_queue SET status=$2,
        name=COALESCE($3,name), full_address=COALESCE($4,full_address),
        phones=COALESCE($5,phones), extra_information=COALESCE($6,extra_information),
        division_id=COALESCE($7,division_id), district_id=COALESCE($8,district_id),
        type_id=COALESCE($9,type_id), drx_id=COALESCE($10,drx_id),
        fail_reason=$11, updated_at=now() WHERE source_url=$1`,
      [b.url, b.status, b.name ?? null, b.fullAddress ?? null,
       b.phones ?? null, b.extraInformation ?? null,
       b.divisionId ?? null, b.districtId ?? null, b.typeId ?? null,
       b.drxId ?? null, b.failReason ?? null]
    );
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST /api/queue { action: "retry-failed" } — reset failed back to pending
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (b.action !== "retry-failed") return NextResponse.json({ error: "unknown action" }, { status: 400 });
    const pool = db();
    const r = await pool.query("UPDATE facility_queue SET status='pending', fail_reason=NULL, updated_at=now() WHERE status='failed'");
    return NextResponse.json({ reset: r.rowCount ?? 0 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
