import { NextRequest, NextResponse } from "next/server";
import { extractDoctor, deptTitle } from "@/lib/doctor";

// POST { markdown, specialty, card? } — nex-router settings come from env only.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.markdown || !body.specialty) {
      return NextResponse.json({ error: "markdown + specialty required" }, { status: 400 });
    }
    const doctor = await extractDoctor(body.markdown, body.specialty, deptTitle(body.specialty), body.card);
    return NextResponse.json({ doctor });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("required") || msg.includes("empty") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
