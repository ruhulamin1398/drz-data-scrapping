import { NextRequest, NextResponse } from "next/server";
import { visitUrl } from "@/lib/prewarm";

// POST /api/prewarm/visit { url } — single ISR-warming GET (30s timeout).
// Shared by browser tab workers and nothing else stateful: the caller marks
// the queue row. HTTP < 400 = ok.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.url) return NextResponse.json({ error: "url required" }, { status: 400 });
    const v = await visitUrl(b.url);
    return NextResponse.json(v);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 502 });
  }
}
