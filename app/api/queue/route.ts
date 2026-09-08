import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/queue?status=..&group=..&limit=.. — list + counts, optionally scoped to one group
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status");
    const group = req.nextUrl.searchParams.get("group");
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 500), 1000);
    const pool = db();
    const conds: string[] = [];
    const vals: (string | number)[] = [];
    if (status) { vals.push(status); conds.push(`status=$${vals.length}`); }
    if (group) { vals.push(group); conds.push(`group_key=$${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    vals.push(limit);
    const rows = await pool.query(`SELECT * FROM facility_queue ${where} ORDER BY id LIMIT $${vals.length}`, vals);
    const cvals: string[] = [];
    const cwhere = group ? `WHERE group_key=$1` : "";
    if (group) cvals.push(group);
    const counts = await pool.query(`SELECT status, COUNT(*) c FROM facility_queue ${cwhere} GROUP BY status`, cvals);
    const byStatus: Record<string, number> = { pending: 0, processing: 0, success: 0, failed: 0 };
    for (const r of counts.rows) byStatus[r.status] = Number(r.c);
    return NextResponse.json({ items: rows.rows, counts: byStatus });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// PATCH /api/queue { url, status, ...fields } — same as before
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.url || !b.status) return NextResponse.json({ error: "url + status required" }, { status: 400 });
    const pool = db();
    // Browser-driven rows stay unlocked (locked_at=NULL) so only the server
    // claim path — which always stamps locked_at=now() — feeds the worker loop.
    await pool.query(
      `UPDATE facility_queue SET status=$2,
        name=COALESCE($3,name), full_address=COALESCE($4,full_address),
        phones=COALESCE($5,phones), extra_information=COALESCE($6,extra_information),
        division_id=COALESCE($7,division_id), district_id=COALESCE($8,district_id),
        type_id=COALESCE($9,type_id), drx_id=COALESCE($10,drx_id),
        fail_reason=$11, full_content = full_content OR $12,
        locked_at = CASE WHEN $2='processing' THEN NULL ELSE locked_at END,
        updated_at=now() WHERE source_url=$1`,
      [b.url, b.status, b.name ?? null, b.fullAddress ?? null,
       b.phones ?? null, b.extraInformation ?? null,
       b.divisionId ?? null, b.districtId ?? null, b.typeId ?? null,
       b.drxId ?? null, b.failReason ?? null, b.fullContent === true]
    );
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST /api/queue { action: "retry", statuses: [...], toStatus?, fullContent?, group? }
// Resets matching rows for manual browser retry. toStatus defaults to 'pending';
// pass 'processing' to claim them synchronously so cron (pending-only) can't steal them.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const allowed = ["failed", "success"];
    let statuses: string[];
    if (b.action === "retry" && Array.isArray(b.statuses)) {
      statuses = b.statuses.filter((s: string) => allowed.includes(s));
      if (!statuses.length) return NextResponse.json({ error: "no valid statuses" }, { status: 400 });
    } else if (b.action === "retry-all") {
      statuses = allowed;
    } else {
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
    const processing = b.toStatus === "processing";
    const pool = db();
    const params: (string | boolean)[] = [...statuses, b.fullContent === true];
    if (b.group) params.push(b.group);
    const r = await pool.query(
      `UPDATE facility_queue SET status='${processing ? "processing" : "pending"}',
        fail_reason=NULL, full_content = full_content OR $2,
        locked_at=${processing ? "now()" : "NULL"}, updated_at=now()
       WHERE status = ANY($1)${b.group ? ` AND group_key=$${params.length}` : ""}`,
      params
    );
    return NextResponse.json({ reset: r.rowCount ?? 0 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
