import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/doctors/updates?status=..&type=photo&limit=..&offset=.. — runs + counts.
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status");
    const type = req.nextUrl.searchParams.get("type");
    const all = req.nextUrl.searchParams.get("limit") === "all";
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 100), 1000);
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0);
    const pool = db();
    const conds: string[] = [];
    const vals: (string | number)[] = [];
    if (status) { vals.push(status); conds.push(`r.status=$${vals.length}`); }
    if (type) { vals.push(type); conds.push(`r.type=$${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    let sql = `SELECT r.*, q.name AS doctor_name FROM doctor_update_runs r
      LEFT JOIN doctor_queue q ON q.id = r.doctor_queue_id
      ${where} ORDER BY r.id DESC`;
    if (!all) {
      vals.push(limit, offset);
      sql += ` LIMIT $${vals.length - 1} OFFSET $${vals.length}`;
    }
    const rows = await pool.query(sql, vals).catch((e: unknown) => {
      if (/does not exist|relation/i.test(e instanceof Error ? e.message : String(e))) {
        return { rows: [] as unknown[] };
      }
      throw e;
    });
    const counts = await pool.query(
      `SELECT status, COUNT(*) c FROM doctor_update_runs GROUP BY status`
    ).catch(() => ({ rows: [] as { status: string; c: string }[] }));
    const byStatus: Record<string, number> = { pending: 0, processing: 0, success: 0, failed: 0 };
    for (const r of counts.rows) byStatus[r.status] = Number(r.c);
    return NextResponse.json({ items: rows.rows, counts: byStatus });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST /api/doctors/updates { doctorQueueIds: number[], type?: "photo", options?: { skipIfPhotoExists } }
// or { bulk: { status?, specialty?, city?, limit? }, type?, options? } — enqueues all matching
// pushed doctors (drx_id NOT NULL). Partial unique skips already-active rows.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const type = b.type === "photo" ? "photo" : "photo";
    const skipIfPhotoExists = b.options?.skipIfPhotoExists !== false;
    const pool = db();
    let targets: { id: number; drx_id: string | null; source_url: string }[] = [];
    if (Array.isArray(b.doctorQueueIds) && b.doctorQueueIds.length) {
      const ids = [...new Set(b.doctorQueueIds.map(Number).filter((n: number) => Number.isFinite(n)))].slice(0, 1000);
      if (!ids.length) return NextResponse.json({ error: "no valid doctorQueueIds" }, { status: 400 });
      const r = await pool.query(
        `SELECT id, drx_id, source_url FROM doctor_queue WHERE id = ANY($1) AND drx_id IS NOT NULL`,
        [ids]
      );
      targets = r.rows;
    } else if (b.bulk && typeof b.bulk === "object") {
      const conds = [`drx_id IS NOT NULL`];
      const vals: (string | number)[] = [];
      if (b.bulk.status) { vals.push(b.bulk.status); conds.push(`status=$${vals.length}`); }
      if (b.bulk.specialty) { vals.push(b.bulk.specialty); conds.push(`specialty_slug=$${vals.length}`); }
      if (b.bulk.city) { vals.push(b.bulk.city); conds.push(`city=$${vals.length}`); }
      const lim = Math.min(Math.max(1, Number(b.bulk.limit ?? 200) || 200), 1000);
      const r = await pool.query(
        `SELECT id, drx_id, source_url FROM doctor_queue WHERE ${conds.join(" AND ")} ORDER BY id LIMIT ${lim}`,
        vals
      );
      targets = r.rows;
    } else {
      return NextResponse.json({ error: "doctorQueueIds[] or bulk{} required" }, { status: 400 });
    }
    let enqueued = 0, skippedActive = 0, skippedNoDrx = 0;
    skippedNoDrx = (Array.isArray(b.doctorQueueIds) ? b.doctorQueueIds.length : 0) - targets.length;
    for (const t of targets) {
      const r = await pool.query(
        `INSERT INTO doctor_update_runs (doctor_queue_id, drx_id, source_url, type, status, options)
         VALUES ($1, $2, $3, $4, 'pending', $5)
         ON CONFLICT (doctor_queue_id, type) WHERE status IN ('pending','processing') DO NOTHING`,
        [t.id, t.drx_id, t.source_url, type, JSON.stringify({ skipIfPhotoExists })]
      ).catch((e: unknown) => {
        // Table missing (migration not run yet) → surface clearly.
        throw e;
      });
      if ((r.rowCount ?? 0) > 0) enqueued++;
      else skippedActive++;
    }
    return NextResponse.json({ enqueued, skippedActive, skippedNoDrx: Math.max(0, skippedNoDrx), type });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /does not exist|relation/i.test(msg) ? 500 : 500;
    return NextResponse.json({ error: /doctor_update_runs.*does not exist/i.test(msg) ? "doctor_update_runs missing — run: node scripts/migrate-doctor-update-runs.mjs" : msg }, { status: code });
  }
}
