import { NextRequest, NextResponse } from "next/server";
import { fetchDoctorProfile } from "@/lib/doctor";
import { db } from "@/lib/db";

// POST { url } — profile pages are small, always fetched full. Keys from
// /settings with rotation. Markdown is stored to structure_md for reuse.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.url) return NextResponse.json({ error: "url required" }, { status: 400 });
    const markdown = await fetchDoctorProfile(body.url);
    await db().query(
      `UPDATE doctor_queue SET structure_md=$2, updated_at=now() WHERE source_url=$1`,
      [body.url, markdown]
    ).catch(() => {});
    return NextResponse.json({ markdown });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("missing") || msg.includes("required") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
