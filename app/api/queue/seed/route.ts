import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inferTypeId } from "@/lib/groups";

// POST { items: [{title, url}], divisionId, districtId? } — step 1: seed all as pending
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const items: { title: string; url: string }[] = b.items ?? [];
    const divisionId = b.divisionId ?? null;
    const districtId = b.districtId ?? null;
    if (!items.length) return NextResponse.json({ error: "items required" }, { status: 400 });

    const pool = db();
    let added = 0;
    for (const it of items) {
      if (!it.url) continue;
      const r = await pool.query(
        `INSERT INTO facility_queue (title, source_url, division_id, district_id, type_id, status)
         VALUES ($1,$2,$3,$4,$5,'pending') ON CONFLICT (source_url) DO NOTHING`,
        [it.title || null, it.url, divisionId, districtId, inferTypeId(it.title || "")]
      );
      if ((r.rowCount ?? 0) > 0) added++;
    }
    return NextResponse.json({ added, skipped: items.length - added });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
