import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/settings — processor config + heartbeat + jina key inventory (masked)
export async function GET() {
  try {
    const r = await db().query("SELECT enabled, concurrency, tasks_per_tick, heartbeat_at, jina_keys FROM settings WHERE id=1");
    const row = r.rows[0] ?? {};
    const keys = String(row.jina_keys ?? "").split("\n").map((s: string) => s.trim()).filter(Boolean);
    const { jina_keys: _omit, ...rest } = row;
    return NextResponse.json({
      ...rest, enabled: !!rest.enabled, concurrency: rest.concurrency ?? 3,
      tasks_per_tick: rest.tasks_per_tick ?? 10, heartbeat_at: rest.heartbeat_at ?? null,
      jina_keys_count: keys.length,
      jina_keys_masked: keys.map((k: string) => `${k.slice(0, 7)}…${k.slice(-4)}`),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// PATCH /api/settings { enabled?, concurrency 1-10?, tasks_per_tick 1-50?, jina_keys? (multiline, one per line, replaces all) }
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    const sets: string[] = [];
    const vals: (boolean | number | string)[] = [];
    if (typeof b.enabled === "boolean") { vals.push(b.enabled); sets.push(`enabled=$${vals.length}`); }
    if (b.concurrency !== undefined) {
      const c = Math.min(Math.max(1, Math.floor(Number(b.concurrency)) || 1), 10);
      vals.push(c); sets.push(`concurrency=$${vals.length}`);
    }
    if (b.tasks_per_tick !== undefined) {
      const t = Math.min(Math.max(1, Math.floor(Number(b.tasks_per_tick)) || 1), 50);
      vals.push(t); sets.push(`tasks_per_tick=$${vals.length}`);
    }
    if (typeof b.jina_keys === "string") {
      const cleaned = b.jina_keys.split("\n").map((s: string) => s.trim()).filter(Boolean).join("\n");
      vals.push(cleaned); sets.push(`jina_keys=$${vals.length}`);
      vals.push(0); sets.push(`jina_key_idx=$${vals.length}`);
    }
    if (!sets.length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    await db().query(
      `UPDATE settings SET ${sets.join(", ")}, updated_at=now() WHERE id=1`
    , vals);
    const r = await db().query("SELECT enabled, concurrency, tasks_per_tick, heartbeat_at, jina_keys FROM settings WHERE id=1");
    const row = r.rows[0] ?? {};
    const keys = String(row.jina_keys ?? "").split("\n").map((s: string) => s.trim()).filter(Boolean);
    const { jina_keys: _omit, ...rest } = row;
    return NextResponse.json({
      ...rest, jina_keys_count: keys.length,
      jina_keys_masked: keys.map((k: string) => `${k.slice(0, 7)}…${k.slice(-4)}`),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
