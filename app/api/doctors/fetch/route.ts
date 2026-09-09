import { NextRequest, NextResponse } from "next/server";
import { fetchDoctorProfile } from "@/lib/doctor";

// POST { url } — profile pages are small, always fetched full. Key from env only.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.url) return NextResponse.json({ error: "url required" }, { status: 400 });
    return NextResponse.json({ markdown: await fetchDoctorProfile(body.url) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("missing") || msg.includes("required") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
