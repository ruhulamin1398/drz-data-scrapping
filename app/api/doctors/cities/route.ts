import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/doctors/cities — distinct cities in the queue with row counts.
// New cities appear here automatically as harvesting expands beyond Sylhet.
export async function GET() {
  try {
    const pool = db();
    const r = await pool.query(
      `SELECT city, COUNT(*) c FROM doctor_queue GROUP BY city ORDER BY city`
    );
    return NextResponse.json({
      cities: r.rows.map((x) => ({ city: x.city as string, count: Number(x.c) })),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
