import { NextRequest, NextResponse } from "next/server";
import { extractInfo } from "@/lib/scrape";

// POST { trimmed, divisionId } — nex-router settings come from env only
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const extracted = await extractInfo(body.trimmed ?? "", Number(body.divisionId ?? 41));
    return NextResponse.json({ extracted });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("required") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
