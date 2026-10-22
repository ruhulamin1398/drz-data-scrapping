import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/settings — processor config + heartbeat + jina key inventory (masked)
export async function GET() {
  try {
    const r = await db().query("SELECT enabled, facilities_enabled, doctors_enabled, prewarm_enabled, doctor_updates_enabled, concurrency, tasks_per_tick, facilities_tasks_per_tick, doctors_tasks_per_tick, prewarm_tasks_per_tick, doctor_updates_tasks_per_tick, revalidate_base_url, heartbeat_at, jina_keys FROM settings WHERE id=1");
    const row = r.rows[0] ?? {};
    const keys = String(row.jina_keys ?? "").split("\n").map((s: string) => s.trim()).filter(Boolean);
    const { jina_keys: _omit, ...rest } = row;
    return NextResponse.json({
      ...rest, enabled: !!rest.enabled,
      revalidate_base_url: String(rest.revalidate_base_url ?? ""),
      facilities_enabled: rest.facilities_enabled !== false,
      doctors_enabled: rest.doctors_enabled !== false,
      prewarm_enabled: rest.prewarm_enabled !== false,
      doctor_updates_enabled: rest.doctor_updates_enabled !== false,
      concurrency: rest.concurrency ?? 3,
      tasks_per_tick: rest.tasks_per_tick ?? 10,
      facilities_tasks_per_tick: rest.facilities_tasks_per_tick ?? rest.tasks_per_tick ?? 10,
      doctors_tasks_per_tick: rest.doctors_tasks_per_tick ?? rest.tasks_per_tick ?? 10,
      prewarm_tasks_per_tick: rest.prewarm_tasks_per_tick ?? rest.tasks_per_tick ?? 10,
      doctor_updates_tasks_per_tick: rest.doctor_updates_tasks_per_tick ?? rest.doctors_tasks_per_tick ?? rest.tasks_per_tick ?? 10,
      heartbeat_at: rest.heartbeat_at ?? null,
      jina_keys_count: keys.length,
      jina_keys_masked: keys.map((k: string) => `${k.slice(0, 7)}…${k.slice(-4)}`),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// PATCH /api/settings { enabled?, facilities_enabled?, doctors_enabled?, prewarm_enabled?, doctor_updates_enabled?, concurrency 1-1000?, tasks_per_tick 1+?, facilities_tasks_per_tick 1+?, doctors_tasks_per_tick 1+?, prewarm_tasks_per_tick 1+?, doctor_updates_tasks_per_tick 1+?, revalidate_base_url? (http(s) URL or empty), jina_keys? (multiline, one per line, replaces all) }
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    const sets: string[] = [];
    const vals: (boolean | number | string)[] = [];
    if (typeof b.enabled === "boolean") { vals.push(b.enabled); sets.push(`enabled=$${vals.length}`); }
    if (typeof b.facilities_enabled === "boolean") { vals.push(b.facilities_enabled); sets.push(`facilities_enabled=$${vals.length}`); }
    if (typeof b.doctors_enabled === "boolean") { vals.push(b.doctors_enabled); sets.push(`doctors_enabled=$${vals.length}`); }
    if (typeof b.prewarm_enabled === "boolean") { vals.push(b.prewarm_enabled); sets.push(`prewarm_enabled=$${vals.length}`); }
    if (typeof b.doctor_updates_enabled === "boolean") { vals.push(b.doctor_updates_enabled); sets.push(`doctor_updates_enabled=$${vals.length}`); }
    const clampTick = (v: unknown) => Math.max(1, Math.floor(Number(v)) || 1);
    if (b.facilities_tasks_per_tick !== undefined) {
      vals.push(clampTick(b.facilities_tasks_per_tick)); sets.push(`facilities_tasks_per_tick=$${vals.length}`);
    }
    if (b.doctors_tasks_per_tick !== undefined) {
      vals.push(clampTick(b.doctors_tasks_per_tick)); sets.push(`doctors_tasks_per_tick=$${vals.length}`);
    }
    if (b.prewarm_tasks_per_tick !== undefined) {
      vals.push(clampTick(b.prewarm_tasks_per_tick)); sets.push(`prewarm_tasks_per_tick=$${vals.length}`);
    }
    if (b.doctor_updates_tasks_per_tick !== undefined) {
      vals.push(clampTick(b.doctor_updates_tasks_per_tick)); sets.push(`doctor_updates_tasks_per_tick=$${vals.length}`);
    }
    if (b.concurrency !== undefined) {
      const c = Math.min(Math.max(1, Math.floor(Number(b.concurrency)) || 1), 1000);
      vals.push(c); sets.push(`concurrency=$${vals.length}`);
    }
    if (b.tasks_per_tick !== undefined) {
      const t = Math.max(1, Math.floor(Number(b.tasks_per_tick)) || 1);
      vals.push(t); sets.push(`tasks_per_tick=$${vals.length}`);
    }
    if (typeof b.revalidate_base_url === "string") {
      const v = b.revalidate_base_url.trim().replace(/\/+$/, "");
      if (v && !/^https?:\/\//i.test(v)) {
        return NextResponse.json({ error: "revalidate_base_url must be an http(s) URL" }, { status: 400 });
      }
      vals.push(v); sets.push(`revalidate_base_url=$${vals.length}`);
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
    const r = await db().query("SELECT enabled, facilities_enabled, doctors_enabled, prewarm_enabled, doctor_updates_enabled, concurrency, tasks_per_tick, facilities_tasks_per_tick, doctors_tasks_per_tick, prewarm_tasks_per_tick, doctor_updates_tasks_per_tick, revalidate_base_url, heartbeat_at, jina_keys FROM settings WHERE id=1");
    const row = r.rows[0] ?? {};
    const keys = String(row.jina_keys ?? "").split("\n").map((s: string) => s.trim()).filter(Boolean);
    const { jina_keys: _omit, ...rest } = row;
    return NextResponse.json({
      ...rest, enabled: !!rest.enabled,
      revalidate_base_url: String(rest.revalidate_base_url ?? ""),
      facilities_enabled: rest.facilities_enabled !== false,
      doctors_enabled: rest.doctors_enabled !== false,
      prewarm_enabled: rest.prewarm_enabled !== false,
      doctor_updates_enabled: rest.doctor_updates_enabled !== false,
      facilities_tasks_per_tick: rest.facilities_tasks_per_tick ?? rest.tasks_per_tick ?? 10,
      doctors_tasks_per_tick: rest.doctors_tasks_per_tick ?? rest.tasks_per_tick ?? 10,
      prewarm_tasks_per_tick: rest.prewarm_tasks_per_tick ?? rest.tasks_per_tick ?? 10,
      doctor_updates_tasks_per_tick: rest.doctor_updates_tasks_per_tick ?? rest.doctors_tasks_per_tick ?? rest.tasks_per_tick ?? 10,
      jina_keys_count: keys.length,
      jina_keys_masked: keys.map((k: string) => `${k.slice(0, 7)}…${k.slice(-4)}`),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
