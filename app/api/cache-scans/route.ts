import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Cache scan history — one row per /cache inspector run (cache verdict + 4 PageSpeed runs).
export const dynamic = "force-dynamic";

// POST /api/cache-scans { url, note? } → creates a running scan row, returns its id.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
    const note = typeof body.note === "string" ? body.note.slice(0, 200) : null;
    const r = await db().query(`INSERT INTO cache_scans (url, note) VALUES ($1, $2) RETURNING id, created_at`, [url, note]);
    return NextResponse.json({ id: r.rows[0].id, createdAt: r.rows[0].created_at });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// GET /api/cache-scans?page=1&per=15&url=https://… — paginated history, newest first.
export async function GET(req: NextRequest) {
  try {
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1) || 1);
    const per = Math.min(Math.max(1, Number(req.nextUrl.searchParams.get("per") ?? 15) || 15), 100);
    const url = req.nextUrl.searchParams.get("url")?.trim();
    const vals: (string | number)[] = [];
    let where = "";
    if (url) {
      vals.push(url);
      where = `WHERE url=$${vals.length}`;
    }
    const total = Number((await db().query(`SELECT COUNT(*) c FROM cache_scans ${where}`, vals)).rows[0].c);
    vals.push(per, (page - 1) * per);
    const r = await db().query(
      `SELECT id, created_at, url, final_url, status, verdict, render, cache_ms,
              score_mobile_1, score_mobile_2, score_desktop_1, score_desktop_2, cache_error
       FROM cache_scans ${where} ORDER BY id DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    return NextResponse.json({ scans: r.rows, total, page, per, totalPages: Math.max(1, Math.ceil(total / per)) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
