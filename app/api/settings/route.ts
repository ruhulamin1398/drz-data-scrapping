import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/settings — processor config + heartbeat
export async function GET() {
  try {
    const r = await db().query("SELECT enabled, concurrency, tasks_per_tick, heartbeat_at FROM settings WHERE id=1");
    return NextResponse.json(r.rows[0] ?? { enabled: false, concurrency: 3, tasks_per_tick: 10, heartbeat_at: null });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// PATCH /api/settings { enabled?, concurrency 1-10?, tasks_per_tick 1-50? }
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    const sets: string[] = [];
    const vals: (boolean | number)[] = [];
    if (typeof b.enabled === "boolean") { vals.push(b.enabled); sets.push(`enabled=$${vals.length}`); }
    if (b.concurrency !== undefined) {
      const c = Math.min(Math.max(1, Math.floor(Number(b.concurrency)) || 1), 10);
      vals.push(c); sets.push(`concurrency=$${vals.length}`);
    }
    if (b.tasks_per_tick !== undefined) {
      const t = Math.min(Math.max(1, Math.floor(Number(b.tasks_per_tick)) || 1), 50);
      vals.push(t); sets.push(`tasks_per_tick=$${vals.length}`);
    }
    if (!sets.length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    const r = await db().query(
      `UPDATE settings SET ${sets.join(", ")}, updated_at=now() WHERE id=1
       RETURNING enabled, concurrency, tasks_per_tick, heartbeat_at`,
      vals
    );
    return NextResponse.json(r.rows[0]);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
