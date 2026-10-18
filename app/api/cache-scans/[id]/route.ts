import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type LaneIn = { data?: unknown; err?: unknown } | null;

// GET /api/cache-scans/:id — full scan row (all JSON blobs) for the detail view.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const scanId = Number(id);
    if (!Number.isFinite(scanId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const r = await db().query(`SELECT * FROM cache_scans WHERE id=$1`, [scanId]);
    if (!r.rows.length) return NextResponse.json({ error: "scan not found" }, { status: 404 });
    return NextResponse.json({ scan: r.rows[0] });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// PATCH /api/cache-scans/:id — partial update as each probe lane settles.
// Body keys: cache{data,err}, psi_mobile_1, psi_mobile_2, psi_desktop_1, psi_desktop_2,
// status, final_url. Scores + verdict/render are derived server-side.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const scanId = Number(id);
    if (!Number.isFinite(scanId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col}=$${vals.length + 1}`); // $1 is reserved for id
    };

    const cache = body.cache as LaneIn | undefined;
    if (cache !== undefined) {
      const d = (cache?.data ?? null) as {
        verdict?: { cache?: string; render?: string };
        timing?: { pass2Ms?: number };
        finalUrl?: string;
      } | null;
      set("cache_json", d ? JSON.stringify(d) : null);
      set("cache_error", typeof cache?.err === "string" ? cache.err : null);
      if (d) {
        set("verdict", d.verdict?.cache ?? null);
        set("render", d.verdict?.render ?? null);
        set("cache_ms", typeof d.timing?.pass2Ms === "number" ? d.timing.pass2Ms : null);
        if (typeof d.finalUrl === "string" && d.finalUrl) set("final_url", d.finalUrl);
      }
    }

    const lanes: [string, string][] = [
      ["psi_mobile_1", "score_mobile_1"],
      ["psi_mobile_2", "score_mobile_2"],
      ["psi_desktop_1", "score_desktop_1"],
      ["psi_desktop_2", "score_desktop_2"],
    ];
    for (const [key, scoreCol] of lanes) {
      if (!(key in body)) continue;
      const lane = body[key] as LaneIn;
      const data = (lane?.data ?? null) as { score?: number | null } | null;
      set(key, JSON.stringify({ data, err: typeof lane?.err === "string" ? lane.err : null }));
      set(scoreCol, typeof data?.score === "number" ? data.score : null);
    }

    if (typeof body.status === "string" && ["running", "done", "failed"].includes(body.status)) set("status", body.status);
    if (typeof body.final_url === "string" && body.final_url) set("final_url", body.final_url);
    if (!sets.length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    sets.push(`updated_at=now()`);

    const r = await db().query(`UPDATE cache_scans SET ${sets.join(", ")} WHERE id=$1 RETURNING id, status, verdict, render`, [
      scanId,
      ...vals,
    ]);
    if (!r.rows.length) return NextResponse.json({ error: "scan not found" }, { status: 404 });
    return NextResponse.json({ ok: true, scan: r.rows[0] });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// DELETE /api/cache-scans/:id — remove one scan from history.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const scanId = Number(id);
    if (!Number.isFinite(scanId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const r = await db().query(`DELETE FROM cache_scans WHERE id=$1 RETURNING id`, [scanId]);
    if (!r.rows.length) return NextResponse.json({ error: "scan not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: r.rows[0].id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
