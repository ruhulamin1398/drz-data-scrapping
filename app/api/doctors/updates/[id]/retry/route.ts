import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/doctors/updates/:id/retry — history preserved: inserts a NEW pending
// row copying (doctor_queue_id, type, options). Old row untouched.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const runId = Number(id);
    if (!Number.isFinite(runId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const pool = db();
    const cur = await pool.query(`SELECT * FROM doctor_update_runs WHERE id=$1`, [runId]);
    if (!cur.rows.length) return NextResponse.json({ error: "run not found" }, { status: 404 });
    const q = cur.rows[0] as { doctor_queue_id: number; drx_id: string | null; source_url: string; type: string; options: unknown };
    if (q.type !== "photo") return NextResponse.json({ error: `unsupported type: ${q.type}` }, { status: 400 });
    const r = await pool.query(
      `INSERT INTO doctor_update_runs (doctor_queue_id, drx_id, source_url, type, status, options)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT (doctor_queue_id, type) WHERE status IN ('pending','processing') DO NOTHING RETURNING id`,
      [q.doctor_queue_id, q.drx_id, q.source_url, q.type, JSON.stringify(q.options ?? { skipIfPhotoExists: true })]
    );
    if (!r.rows.length) return NextResponse.json({ ok: false, reason: "active run already pending/processing" }, { status: 409 });
    return NextResponse.json({ ok: true, id: r.rows[0].id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
