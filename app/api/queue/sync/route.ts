import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inferTypeId } from "@/lib/groups";
import { readGroups } from "@/lib/facilitiesFile";

// POST /api/queue/sync — ensure every facility from facilities.md exists in the
// queue (missing ones added as pending). Idempotent, safe to call on page load.
export async function POST() {
  try {
    const groups = readGroups();
    const pool = db();
    let added = 0;
    let total = 0;
    for (const g of groups) {
      for (const it of g.items) {
        if (!it.url) continue;
        total++;
        const r = await pool.query(
          `INSERT INTO facility_queue (title, source_url, division_id, district_id, type_id, group_key, status)
           VALUES ($1,$2,$3,$4,$5,$6,'pending') ON CONFLICT (source_url) DO NOTHING`,
          [it.title || null, it.url, g.divisionId, g.districtId ?? null, inferTypeId(it.title || ""), g.key]
        );
        if ((r.rowCount ?? 0) > 0) added++;
      }
    }
    return NextResponse.json({ groups: groups.length, total, added });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
