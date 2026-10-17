import { NextRequest, NextResponse } from "next/server";
import { revalidateUrl } from "@/lib/prewarm";

// POST /api/prewarm/visit { url } — single ISR revalidate call (30s timeout).
// The frontend admin endpoint marks the page stale, cold-renders it and stamps
// the sitemap store; the caller marks the queue row. warmed=true (<400) = ok.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.url) return NextResponse.json({ error: "url required" }, { status: 400 });
    const v = await revalidateUrl(b.url);
    return NextResponse.json(v);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 502 });
  }
}
