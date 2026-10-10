import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

async function getId(ctx: { params: Promise<{ id: string }> }): Promise<number | null> {
  const { id } = await ctx.params;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

// GET /api/doctors/updates/:id — single run detail (view).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const runId = await getId(ctx);
  if (runId === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  try {
    const r = await db().query(
      `SELECT r.*, q.name AS doctor_name FROM doctor_update_runs r
       LEFT JOIN doctor_queue q ON q.id = r.doctor_queue_id WHERE r.id=$1`,
      [runId]
    );
    if (!r.rows.length) return NextResponse.json({ error: "run not found" }, { status: 404 });
    return NextResponse.json({ item: r.rows[0] });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// PATCH /api/doctors/updates/:id { note?, skipIfPhotoExists? }
// note editable any time; skip flag only while pending (otherwise it would
// rewrite history of an already-decided run).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const runId = await getId(ctx);
  if (runId === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  try {
    const b = await req.json();
    const pool = db();
    const cur = await pool.query(`SELECT * FROM doctor_update_runs WHERE id=$1`, [runId]);
    if (!cur.rows.length) return NextResponse.json({ error: "run not found" }, { status: 404 });
    const q = cur.rows[0] as { status: string; options: { skipIfPhotoExists?: boolean } };
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (typeof b.note === "string") {
      vals.push(b.note.slice(0, 1000)); sets.push(`note=$${vals.length}`);
    }
    if (typeof b.skipIfPhotoExists === "boolean") {
      if (q.status !== "pending") {
        return NextResponse.json({ error: "skip flag editable only while pending — re-enqueue for a new run" }, { status: 409 });
      }
      const opts = { ...(q.options ?? {}), skipIfPhotoExists: b.skipIfPhotoExists };
      vals.push(JSON.stringify(opts)); sets.push(`options=$${vals.length}`);
    }
    if (!sets.length) return NextResponse.json({ error: "nothing to update (note?, skipIfPhotoExists?)" }, { status: 400 });
    vals.push(runId);
    await pool.query(`UPDATE doctor_update_runs SET ${sets.join(", ")}, updated_at=now() WHERE id=$${vals.length}`, vals);
    const r = await pool.query(`SELECT * FROM doctor_update_runs WHERE id=$1`, [runId]);
    return NextResponse.json({ ok: true, item: r.rows[0] });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// DELETE /api/doctors/updates/:id — removes the run row (history). Blocked while processing.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const runId = await getId(ctx);
  if (runId === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  try {
    const pool = db();
    const cur = await pool.query(`SELECT status FROM doctor_update_runs WHERE id=$1`, [runId]);
    if (!cur.rows.length) return NextResponse.json({ error: "run not found" }, { status: 404 });
    if (cur.rows[0].status === "processing") {
      return NextResponse.json({ error: "cannot delete while processing" }, { status: 409 });
    }
    await pool.query(`DELETE FROM doctor_update_runs WHERE id=$1`, [runId]);
    return NextResponse.json({ ok: true, id: runId });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
