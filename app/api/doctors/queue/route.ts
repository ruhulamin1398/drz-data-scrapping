import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queueCounts, queueStatusWhere } from "@/lib/queue-status";

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
    const statusFilter = queueStatusWhere(status, "status", "started_at", vals.length + 1);
    if (statusFilter) {
      conds.push(statusFilter.clause);
      if (statusFilter.value !== undefined) vals.push(statusFilter.value);
    }
    if (specialty) { vals.push(specialty); conds.push(`specialty_slug=$${vals.length}`); }
    if (city) { vals.push(city); conds.push(`city=$${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    let sql = `SELECT * FROM doctor_queue ${where} ORDER BY updated_at DESC, id DESC`;
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
    const byStatus = await queueCounts(pool, "doctor_queue", cwhere, cvals);
    return NextResponse.json({ items: rows.rows, counts: byStatus });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// PATCH /api/doctors/queue { url, status, ...fields } — single-row reset/retry/edit.
// specialtySlug/departmentIds persist an auto-resolved specialty (browser path).
// city overwrites when given. forceDepartments:true replaces department_ids
// outright (edit dialog); otherwise departmentIds only fill empty slots.
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.url || !b.status) return NextResponse.json({ error: "url + status required" }, { status: 400 });
    const pool = db();
    await pool.query(
      `UPDATE doctor_queue SET status=$2, name=COALESCE($3,name), drx_id=COALESCE($4,drx_id),
        fail_reason=$5,
        specialty_slug=COALESCE($6,specialty_slug),
        specialty_slugs = CASE WHEN $6 IS NOT NULL AND specialty_slugs='{}' THEN ARRAY[$6] ELSE specialty_slugs END,
        department_ids = CASE WHEN $8::boolean THEN $7::text[]
          WHEN $7 IS NOT NULL AND department_ids='{}' THEN $7 ELSE department_ids END,
        city=COALESCE($9,city),
        locked_at = CASE WHEN $2='processing' THEN NULL ELSE locked_at END,
        started_at = CASE WHEN $2='processing' THEN now() ELSE NULL END,
        updated_at=now() WHERE source_url=$1`,
      [b.url, b.status, b.name ?? null, b.drxId ?? null, b.failReason ?? null, b.specialtySlug ?? null, b.departmentIds ?? null, b.forceDepartments === true, b.city ?? null]
    );
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// DELETE /api/doctors/queue { url } — removes the queue row only.
// The backend record (if pushed) is deliberately left untouched.
export async function DELETE(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.url) return NextResponse.json({ error: "url required" }, { status: 400 });
    const pool = db();
    const r = await pool.query(`DELETE FROM doctor_queue WHERE source_url=$1`, [b.url]);
    return NextResponse.json({ ok: true, deleted: r.rowCount ?? 0 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST /api/doctors/queue { action: "retry", statuses: [...], toStatus? }
// Bulk reset. toStatus 'processing' claims rows for immediate browser work with
// locked_at=NULL so the server loop never touches them (it only eats locked rows).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const allowed = ["failed", "success"];
    if (b.action !== "retry" || !Array.isArray(b.statuses)) {
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
    const statuses = b.statuses.filter((s: string) => allowed.includes(s));
    if (!statuses.length) return NextResponse.json({ error: "no valid statuses" }, { status: 400 });
    const processing = b.toStatus === "processing";
    const pool = db();
    const r = await pool.query(
      `UPDATE doctor_queue SET status='${processing ? "processing" : "pending"}',
        fail_reason=NULL, locked_at=NULL, started_at=NULL, updated_at=now()
       WHERE status = ANY($1)`,
      [statuses]
    );
    return NextResponse.json({ reset: r.rowCount ?? 0 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
